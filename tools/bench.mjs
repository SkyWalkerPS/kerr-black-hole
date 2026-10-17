import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, launchChrome } from './cdp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [viewportWidth, viewportHeight] = (process.env.VIEWPORT || '1728x1117').split('x').map(Number);
const devicePixelRatio = Number(process.env.DPR || 2);
const frames = Number(process.env.FRAMES || 300);
const pinnedScale = process.env.SCALE;
const extraQuery = process.env.QUERY || '';
const FRAME_BUDGET_MS = 1000 / 60;

const VIEWS = {
  hero: { camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  edgeOn: { camera: { orbitDistance: 30, orbitAzimuthDegrees: 0, orbitElevationDegrees: 0.6 } },
  faceOn: { camera: { orbitDistance: 32, orbitAzimuthDegrees: 0, orbitElevationDegrees: 78 } },
  close: { camera: { orbitDistance: 7.5, orbitAzimuthDegrees: 20, orbitElevationDegrees: 9 } },
  grazing: { camera: { orbitDistance: 4.2, orbitAzimuthDegrees: 0, orbitElevationDegrees: 2 } },
  above: { camera: { orbitDistance: 22, orbitAzimuthDegrees: 40, orbitElevationDegrees: 28 } },
  far: { camera: { orbitDistance: 300, orbitAzimuthDegrees: 30, orbitElevationDegrees: 10 } },
  maxSpinClose: { settings: { spin: 0.998 }, camera: { orbitDistance: 5, orbitAzimuthDegrees: 0, orbitElevationDegrees: 4 } },
  maxSteps: { settings: { maxSteps: 512 }, camera: { orbitDistance: 12, orbitAzimuthDegrees: 0, orbitElevationDegrees: 1 } },
};

const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

const viewNames = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWS);
const browser = await launchChrome();
let worst = 0;
try {
  const page = await browser.newPage();
  await page.setViewport(viewportWidth, viewportHeight, devicePixelRatio);
  const query = ['hint=0', pinnedScale ? `scale=${pinnedScale}` : '', extraQuery].filter(Boolean).join('&');
  await page.goto(fileUrl(process.env.PAGE ? path.resolve(process.env.PAGE) : path.join(projectRoot, 'index.html'), query));
  if (!(await page.evaluate('window.blackHole.ready'))) throw new Error(page.consoleMessages.join('\n'));
  const baseline = await page.evaluate('JSON.stringify(window.blackHole.snapshot())');
  console.log(`viewport ${viewportWidth}x${viewportHeight} @${devicePixelRatio}x, ${frames} frames per view, budget ${FRAME_BUDGET_MS.toFixed(1)} ms`);
  console.log('view            gpu p50   p95    p99    max   over-budget  trace p50  scale(end)  internal       gpu p10');
  for (const name of viewNames) {
    const view = VIEWS[name];
    await page.evaluate(`(() => {
      const { camera, renderScale, angleScale, ...baselineSettings } = ${baseline};
      window.blackHole.set({ ...baselineSettings, ...${JSON.stringify(view.settings || {})} });
      window.blackHole.setCamera(${JSON.stringify(view.camera)});
    })()`);
    const result = await page.evaluate(`window.blackHole.benchmark({ frames: ${frames}, warmup: 90, paced: ${process.env.UNPACED ? 'false' : 'true'} })`);
    const over = result.gpuTimes.filter((t) => t > FRAME_BUDGET_MS).length;
    worst = Math.max(worst, percentile(result.gpuTimes, 0.99));
    console.log(`${name.padEnd(15)} ${percentile(result.gpuTimes, 0.5).toFixed(2).padStart(6)} ${percentile(result.gpuTimes, 0.95).toFixed(2).padStart(6)} ${percentile(result.gpuTimes, 0.99).toFixed(2).padStart(6)} ${Math.max(...result.gpuTimes).toFixed(2).padStart(6)}   ${String(over).padStart(4)}/${result.gpuTimes.length}    ${percentile(result.traceTimes, 0.5).toFixed(2).padStart(6)}     ${result.scales[result.scales.length - 1].toFixed(3)}      ${result.internal.join('x').padEnd(12)}   ${percentile(result.gpuTimes, 0.1).toFixed(2)}`);
  }
  const problems = page.consoleMessages.filter((line) => /error|exception/i.test(line));
  if (problems.length) console.log(`Console errors:\n${problems.join('\n')}`);
} finally {
  await browser.shutdown();
}
console.log(`worst p99 GPU frame time: ${worst.toFixed(2)} ms (${worst <= FRAME_BUDGET_MS ? 'within' : 'OVER'} the 16.7 ms budget)`);
