import {
  DEFAULT_STEP_PARAMS, angleBetween, bardeenShadowPoint, horizonRadius, traceBoyerLindquist, traceMino, zamoCamera,
} from './kerr-reference.mjs';

const which = process.argv[2] || 'all';

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

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

if (which === 'schwarzschild' || which === 'all') {
  console.log('\n== Schwarzschild: total sweep angle vs exact integral (camera r=100, equatorial) ==');
  const camera = zamoCamera(0, 100, Math.PI / 2, 0);
  console.log('b/M      exact sweep    mino sweep     error(rad)   steps');
  for (const impactTarget of [5.3, 5.5, 6, 7, 10, 20, 40, 80]) {
    const sinZeta = impactTarget * camera.lapse / camera.r;
    const local = [-Math.sqrt(1 - sinZeta * sinZeta), 0, sinZeta];
    const result = traceMino(camera, local);
    const exact = exactSchwarzschildSweep(impactTarget, 1 / camera.r);
    const minoSweep = Math.atan2(result.direction[1], result.direction[0]);
    const error = wrapAngle(minoSweep - exact);
    console.log(`${impactTarget.toFixed(1).padEnd(8)} ${exact.toFixed(6).padEnd(14)} ${minoSweep.toFixed(6).padEnd(14)} ${error.toExponential(2).padEnd(12)} ${result.steps}`);
  }
}

if (which === 'kerr' || which === 'all') {
  for (const spin of [0.6, 0.998]) {
    console.log(`\n== Kerr a=${spin}: Mino scheme vs independent Boyer-Lindquist Hamiltonian (camera r=30, theta=80 deg) ==`);
    const camera = zamoCamera(spin, 30, (80 * Math.PI) / 180, 0.3);
    let seed = 12345;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const errors = [];
    let outcomeMismatches = 0;
    let crossingRadiusErrorMax = 0;
    let crossingTimeErrorMax = 0;
    let crossingPhiErrorMax = 0;
    for (let i = 0; i < 40; i++) {
      const offPhi = (random() - 0.5) * 0.9;
      const offTheta = (random() - 0.5) * 0.9;
      const raw = [-1, offTheta, offPhi];
      const length = Math.hypot(...raw);
      const local = raw.map((x) => x / length);
      const mino = traceMino(camera, local);
      const reference = traceBoyerLindquist(camera, local);
      if (mino.outcome !== reference.outcome) {
        outcomeMismatches++;
        console.log(`  outcome mismatch ray ${i}: mino=${mino.outcome} reference=${reference.outcome}`);
        continue;
      }
      if (mino.outcome === 'escaped') errors.push(angleBetween(mino.direction, reference.direction));
      if (reference.crossings && mino.crossings.length === reference.crossings.length) {
        mino.crossings.forEach((crossing, k) => {
          const ref = reference.crossings[k];
          if (ref.r > 40) return;
          crossingRadiusErrorMax = Math.max(crossingRadiusErrorMax, Math.abs(crossing.r - ref.r) / ref.r);
          crossingTimeErrorMax = Math.max(crossingTimeErrorMax, Math.abs(crossing.t - ref.t));
          crossingPhiErrorMax = Math.max(crossingPhiErrorMax, Math.abs(wrapAngle(crossing.phi - ref.phi)));
        });
      }
    }
    errors.sort((x, y) => x - y);
    console.log(`  escaped rays compared: ${errors.length}, outcome mismatches: ${outcomeMismatches}`);
    console.log(`  direction error median ${errors[errors.length >> 1]?.toExponential(2)} rad, max ${errors[errors.length - 1]?.toExponential(2)} rad`);
    console.log(`  disk-plane crossings inside r<40: max relative radius error ${crossingRadiusErrorMax.toExponential(2)}, max azimuth error ${crossingPhiErrorMax.toExponential(2)} rad, max light-travel-time error ${crossingTimeErrorMax.toExponential(2)} M`);
  }
}

if (which === 'shadow' || which === 'all') {
  for (const spin of [0.5, 0.9, 0.998]) {
    const inclination = (85 * Math.PI) / 180;
    console.log(`\n== Kerr shadow outline a=${spin}, inclination 85 deg: capture boundary vs Bardeen ==`);
    const cameraR = 1e5;
    const camera = zamoCamera(spin, cameraR, inclination, 0);
    const analytic = [];
    const rPlus = horizonRadius(spin);
    for (let i = 0; i <= 20000; i++) {
      const rp = rPlus + (4 - rPlus) * (i / 20000) + 1e-9;
      const point = bardeenShadowPoint(spin, rp, inclination);
      if (point.betaSquared >= 0 && Number.isFinite(point.alpha)) {
        analytic.push([point.alpha, Math.sqrt(point.betaSquared)]);
        analytic.push([point.alpha, -Math.sqrt(point.betaSquared)]);
      }
    }
    const centerAlpha = analytic.reduce((sum, p) => sum + p[0], 0) / analytic.length;
    let maxError = 0;
    for (let k = 0; k < 24; k++) {
      const chi = (k / 24) * 2 * Math.PI;
      const isCaptured = (rho) => {
        const alpha = centerAlpha + rho * Math.cos(chi);
        const beta = rho * Math.sin(chi);
        const dPhi = alpha / cameraR;
        const dTheta = -beta / cameraR;
        const local = [-Math.sqrt(1 - dPhi * dPhi - dTheta * dTheta), dTheta, dPhi];
        return traceMino(camera, local, { ...DEFAULT_STEP_PARAMS, maxSteps: 20000 }).outcome !== 'escaped';
      };
      let low = 0.5;
      let high = 9;
      for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (low + high);
        if (isCaptured(mid)) low = mid; else high = mid;
      }
      const numericRho = 0.5 * (low + high);
      let analyticRho = NaN;
      let bestAngleGap = Infinity;
      for (const [alpha, beta] of analytic) {
        const gap = Math.abs(wrapAngle(Math.atan2(beta, alpha - centerAlpha) - chi));
        if (gap < bestAngleGap) { bestAngleGap = gap; analyticRho = Math.hypot(alpha - centerAlpha, beta); }
      }
      maxError = Math.max(maxError, Math.abs(numericRho - analyticRho));
      if (k % 6 === 0) console.log(`  chi=${(chi * 180 / Math.PI).toFixed(0).padStart(3)} deg  numeric ${numericRho.toFixed(4)}  analytic ${analyticRho.toFixed(4)}`);
    }
    console.log(`  max |numeric - analytic| boundary radius over 24 angles: ${maxError.toExponential(2)} M`);
  }
}

if (which === 'cost' || which === 'all') {
  console.log('\n== Cost: steps per pixel and direction error vs an 8x finer run (camera r=30, theta=85 deg, 60 deg FOV) ==');
  for (const spin of [0.0, 0.9, 0.998]) {
    const camera = zamoCamera(spin, 30, (85 * Math.PI) / 180, 0);
    const fine = { ...DEFAULT_STEP_PARAMS, angleNear: DEFAULT_STEP_PARAMS.angleNear / 8, angleFar: DEFAULT_STEP_PARAMS.angleFar / 8, wSpan: DEFAULT_STEP_PARAMS.wSpan / 8, maxSteps: 40000 };
    const steps = [];
    const errors = [];
    const tanHalf = Math.tan((30 * Math.PI) / 180);
    const grid = 48;
    for (let iy = 0; iy < grid; iy++) {
      for (let ix = 0; ix < grid; ix++) {
        const x = ((ix + 0.5) / grid * 2 - 1) * tanHalf * 1.6;
        const y = ((iy + 0.5) / grid * 2 - 1) * tanHalf;
        const raw = [-1, -y, x];
        const length = Math.hypot(...raw);
        const local = raw.map((v) => v / length);
        const coarse = traceMino(camera, local, { ...DEFAULT_STEP_PARAMS, maxSteps: 400 });
        steps.push(coarse.steps);
        if (coarse.outcome === 'escaped') {
          const reference = traceMino(camera, local, fine);
          if (reference.outcome === 'escaped') errors.push(angleBetween(coarse.direction, reference.direction));
        }
      }
    }
    steps.sort((a, b) => a - b);
    errors.sort((a, b) => a - b);
    const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
    const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    console.log(`  a=${spin}: steps mean ${mean.toFixed(1)}, p50 ${pct(steps, 0.5)}, p95 ${pct(steps, 0.95)}, max ${steps[steps.length - 1]} | direction error p50 ${pct(errors, 0.5).toExponential(1)}, p99 ${pct(errors, 0.99).toExponential(1)}, max ${errors[errors.length - 1].toExponential(1)} rad`);
  }
}
