import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, launchChrome } from './cdp.mjs';
import {
  DEFAULT_STEP_PARAMS, angleBetween, bardeenShadowPoint, horizonRadius, traceBoyerLindquist, traceMino, zamoCamera,
} from './kerr-reference.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!condition) failures.push(label);
};

function exactSchwarzschildSweep(impactParameter, cameraW) {
  const radial = (w) => 1 / (impactParameter * impactParameter) - w * w + 2 * w * w * w;
  let low = 0;
  let high = 1 / 3;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (low + high);
    if (radial(mid) > 0) low = mid; else high = mid;
  }
  const turningW = low;
  const integrateFrom = (wStart) => {
    const sMax = Math.sqrt(1 - wStart / turningW);
    const intervals = 20000;
    let total = 0;
    for (let i = 0; i < intervals; i++) {
      const s0 = (i / intervals) * sMax;
      const s1 = ((i + 1) / intervals) * sMax;
      for (const [node, weight] of [[-0.7745966692414834, 5 / 9], [0, 8 / 9], [0.7745966692414834, 5 / 9]]) {
        const s = 0.5 * (s0 + s1) + 0.5 * (s1 - s0) * node;
        const w = turningW * (1 - s * s);
        total += 0.5 * (s1 - s0) * weight * (2 * turningW * s) / Math.sqrt(Math.max(radial(w), 1e-300));
      }
    }
    return total;
  };
  return integrateFrom(cameraW) + integrateFrom(0);
}

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.setViewport(800, 500, 1);
  await page.goto(fileUrl(path.join(projectRoot, 'index.html'), 'hint=0&scale=0.5'));
  if (!(await page.evaluate('window.blackHole.ready'))) throw new Error(page.consoleMessages.join('\n'));
  const traceOnGpu = async (spec) => page.evaluate(`window.blackHole.traceTestRays(${JSON.stringify(spec)}).then((r) => r)`);

  console.log('\n== Schwarzschild bending angle: GPU vs exact integral (camera r=100) ==');
  {
    const camera = zamoCamera(0, 100, Math.PI / 2, 0);
    const impacts = [5.3, 5.5, 6, 7, 10, 20, 40, 80];
    const directions = impacts.map((b) => {
      const s = (b * camera.lapse) / camera.r;
      return [-Math.sqrt(1 - s * s), 0, s];
    });
    const gpu = await traceOnGpu({ spin: 0, radius: 100, thetaDegrees: 90, phiDegrees: 0, directions });
    impacts.forEach((b, i) => {
      const exact = exactSchwarzschildSweep(b, 0.01);
      const error = Math.abs(wrapAngle(Math.atan2(gpu[i].direction[1], gpu[i].direction[0]) - exact));
      check(`b=${b} sweep matches exact`, gpu[i].outcome === 'escaped' && error < (b < 6 ? 6e-3 : 1e-3), `error ${error.toExponential(2)} rad, ${gpu[i].steps} steps`);
    });
  }

  for (const spin of [0.6, 0.998]) {
    console.log(`\n== Kerr a=${spin}: GPU vs double-precision references (camera r=30, theta=80 deg) ==`);
    const camera = zamoCamera(spin, 30, (80 * Math.PI) / 180, 0.3);
    let seed = 12345;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const directions = Array.from({ length: 200 }, () => {
      const raw = [-1, (random() - 0.5) * 0.9, (random() - 0.5) * 0.9];
      const length = Math.hypot(...raw);
      return raw.map((x) => x / length);
    });
    const gpu = await traceOnGpu({ spin, radius: 30, thetaDegrees: 80, phiDegrees: 0.3 * 180 / Math.PI, directions });
    let outcomeMismatches = 0;
    const directionErrors = [];
    const independentErrors = [];
    const crossingErrors = [];
    directions.forEach((direction, i) => {
      const reference = traceMino(camera, direction);
      const gpuOutcome = gpu[i].outcome;
      if (gpuOutcome !== reference.outcome) { outcomeMismatches++; return; }
      if (gpuOutcome === 'escaped') directionErrors.push(angleBetween(gpu[i].direction, reference.direction));
      if (reference.crossings.length && gpu[i].crossings > 0 && reference.crossings[0].r < 40) {
        crossingErrors.push(Math.abs(gpu[i].firstCrossing.r - reference.crossings[0].r) / reference.crossings[0].r);
      }
      if (i < 40 && gpuOutcome === 'escaped') {
        const independent = traceBoyerLindquist(camera, direction);
        if (independent.outcome === 'escaped') independentErrors.push(angleBetween(gpu[i].direction, independent.direction));
      }
    });
    check(`a=${spin} capture/escape outcome agrees`, outcomeMismatches <= 2, `${outcomeMismatches} of ${directions.length} differ`);
    check(`a=${spin} sky direction vs f64 same-scheme`, percentile(directionErrors, 0.5) < 5e-4 && percentile(directionErrors, 0.95) < 3e-3,
      `median ${percentile(directionErrors, 0.5).toExponential(2)}, p95 ${percentile(directionErrors, 0.95).toExponential(2)}, max ${percentile(directionErrors, 1).toExponential(2)} rad`);
    check(`a=${spin} sky direction vs independent BL integration`, percentile(independentErrors, 0.5) < 1e-3 && percentile(independentErrors, 0.9) < 4e-3,
      `median ${percentile(independentErrors, 0.5).toExponential(2)}, p90 ${percentile(independentErrors, 0.9).toExponential(2)} rad over ${independentErrors.length} rays`);
    check(`a=${spin} first disk-plane crossing radius`, crossingErrors.length > 10 && percentile(crossingErrors, 0.95) < 5e-3,
      `p95 relative error ${percentile(crossingErrors, 0.95).toExponential(2)} over ${crossingErrors.length} crossings`);
  }

  for (const spin of [0, 0.9, 0.998]) {
    const inclination = (85 * Math.PI) / 180;
    console.log(`\n== Shadow outline a=${spin}, inclination 85 deg: GPU capture boundary vs ${spin === 0 ? 'b = 3*sqrt(3)' : 'Bardeen'} ==`);
    const cameraR = 2e4;
    const camera = zamoCamera(spin, cameraR, inclination, 0);
    const analytic = [];
    if (spin > 0) {
      const rPlus = horizonRadius(spin);
      for (let i = 0; i <= 20000; i++) {
        const point = bardeenShadowPoint(spin, rPlus + (4 - rPlus) * (i / 20000) + 1e-9, inclination);
        if (point.betaSquared >= 0 && Number.isFinite(point.alpha)) {
          analytic.push([point.alpha, Math.sqrt(point.betaSquared)], [point.alpha, -Math.sqrt(point.betaSquared)]);
        }
      }
    } else {
      for (let i = 0; i < 4000; i++) analytic.push([Math.sqrt(27) * Math.cos((i / 4000) * 2 * Math.PI), Math.sqrt(27) * Math.sin((i / 4000) * 2 * Math.PI)]);
    }
    const centerAlpha = analytic.reduce((sum, p) => sum + p[0], 0) / analytic.length;
    const angles = Array.from({ length: 24 }, (_, k) => (k / 24) * 2 * Math.PI);
    let low = angles.map(() => 1);
    let high = angles.map(() => 9);
    for (let round = 0; round < 3; round++) {
      const samplesPerAngle = 64;
      const directions = [];
      angles.forEach((chi, k) => {
        for (let j = 0; j < samplesPerAngle; j++) {
          const rho = low[k] + (high[k] - low[k]) * (j / (samplesPerAngle - 1));
          const alpha = centerAlpha + rho * Math.cos(chi);
          const beta = rho * Math.sin(chi);
          const dPhi = alpha / cameraR;
          const dTheta = -beta / cameraR;
          directions.push([-Math.sqrt(1 - dPhi * dPhi - dTheta * dTheta), dTheta, dPhi]);
        }
      });
      const gpu = await traceOnGpu({ spin, radius: cameraR, thetaDegrees: 85, phiDegrees: 0, directions, maxSteps: 6000 });
      angles.forEach((_, k) => {
        let lastCaptured = 0;
        for (let j = 0; j < samplesPerAngle; j++) if (gpu[k * samplesPerAngle + j].outcome !== 'escaped') lastCaptured = j;
        const step = (high[k] - low[k]) / (samplesPerAngle - 1);
        const newLow = low[k] + step * lastCaptured;
        low[k] = newLow;
        high[k] = newLow + step;
      });
    }
    let maxError = 0;
    angles.forEach((chi, k) => {
      const numeric = 0.5 * (low[k] + high[k]);
      let analyticRho = NaN;
      let bestGap = Infinity;
      for (const [alpha, beta] of analytic) {
        const gap = Math.abs(wrapAngle(Math.atan2(beta, alpha - centerAlpha) - chi));
        if (gap < bestGap) { bestGap = gap; analyticRho = Math.hypot(alpha - centerAlpha, beta); }
      }
      maxError = Math.max(maxError, Math.abs(numeric - analyticRho));
    });
    check(`a=${spin} shadow outline matches analytic curve`, maxError < 0.01, `max boundary error ${maxError.toExponential(2)} M over 24 directions`);
  }

  const problems = page.consoleMessages.filter((line) => /error|exception/i.test(line));
  check('no WebGPU or script errors in the console', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally {
  await browser.shutdown();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
