import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, launchChrome } from './cdp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [viewportWidth, viewportHeight] = (process.env.VIEWPORT || '1728x1117').split('x').map(Number);
const devicePixelRatio = Number(process.env.DPR || 2);
const seconds = Number(process.env.SECONDS || 30);
const spin = Number(process.env.SPIN || 0.9);
const FRAME_BUDGET_MS = 1000 / 60;

const flightScript = `
window.flightRecords = [];
window.flightDone = false;
(async () => {
  const durationMs = ${seconds * 1000};
  const records = [];
  const start = performance.now();
  let previous = start;
  const smooth = (t) => t * t * (3 - 2 * t);
  const keyframes = [
    { at: 0.00, distance: 70, azimuth: 0, elevation: 28 },
    { at: 0.25, distance: 14, azimuth: 120, elevation: 8 },
    { at: 0.45, distance: 4.6, azimuth: 230, elevation: 2 },
    { at: 0.60, distance: 6.5, azimuth: 330, elevation: -25 },
    { at: 0.80, distance: 24, azimuth: 470, elevation: 0.5 },
    { at: 1.00, distance: 40, azimuth: 540, elevation: 15 },
  ];
  const pose = (fraction) => {
    let index = keyframes.findIndex((k) => k.at >= fraction);
    if (index <= 0) index = 1;
    const a = keyframes[index - 1];
    const b = keyframes[index];
    const t = smooth(Math.min(Math.max((fraction - a.at) / (b.at - a.at), 0), 1));
    return {
      distance: Math.exp(Math.log(a.distance) + (Math.log(b.distance) - Math.log(a.distance)) * t),
      azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
      elevation: a.elevation + (b.elevation - a.elevation) * t,
    };
  };
  window.blackHole.set({ spin: ${spin} });
  await new Promise((resolve) => {
    const tick = (now) => {
      const fraction = (now - start) / durationMs;
      if (fraction >= 1) return resolve();
      const p = pose(fraction);
      window.blackHole.setCamera({ orbitDistance: p.distance, orbitAzimuthDegrees: p.azimuth, orbitElevationDegrees: p.elevation });
      const stats = window.blackHole.stats();
      records.push({ interval: now - previous, gpuMs: stats.lastGpuMs, scale: stats.renderScale, distance: p.distance, output: stats.output[0], generation: stats.renderTargetGeneration });
      window.flightRecords = records;
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.flightDone = true;
})();
true`;

const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.setViewport(viewportWidth, viewportHeight, devicePixelRatio);
  await page.goto(fileUrl(path.join(projectRoot, 'index.html'), 'hint=0'));
  if (!(await page.evaluate('window.blackHole.ready'))) throw new Error(page.consoleMessages.join('\n'));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.evaluate(flightScript);
  const deadline = Date.now() + (seconds + 30) * 1000;
  while (!(await page.evaluate('window.flightDone'))) {
    if (Date.now() > deadline) throw new Error(`flight did not finish: ${await page.evaluate('JSON.stringify({ frames: window.flightRecords.length, last: window.flightRecords.at(-1), stats: window.blackHole.stats() })')}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (process.env.VERBOSE) console.log(await page.evaluate('JSON.stringify({ frames: window.flightRecords.length, last: window.flightRecords.at(-1) })'));
  }
  const records = (await page.evaluate('window.flightRecords')).slice(5);
  const gpu = records.map((r) => r.gpuMs);
  const intervals = records.map((r) => r.interval);
  const overBudget = gpu.filter((t) => t > FRAME_BUDGET_MS).length;
  const longIntervals = intervals.filter((t) => t > FRAME_BUDGET_MS * 1.5).length;
  const scales = records.map((r) => r.scale);
  console.log(`flight ${seconds}s, canvas ${Math.min(...records.map((r) => r.output))}-${Math.max(...records.map((r) => r.output))} px wide (viewport ${viewportWidth * devicePixelRatio}x${viewportHeight * devicePixelRatio}), spin ${spin}: ${records.length} frames (${(records.length / seconds).toFixed(1)} fps average)`);
  console.log(`GPU ms per frame: p50 ${percentile(gpu, 0.5).toFixed(2)}, p95 ${percentile(gpu, 0.95).toFixed(2)}, p99 ${percentile(gpu, 0.99).toFixed(2)}, max ${Math.max(...gpu).toFixed(2)}; over 16.7 ms: ${overBudget}/${gpu.length}`);
  console.log(`frame interval ms: p50 ${percentile(intervals, 0.5).toFixed(2)}, p99 ${percentile(intervals, 0.99).toFixed(2)}, max ${Math.max(...intervals).toFixed(2)}; intervals over 25 ms: ${longIntervals}`);
  console.log(`render scale: min ${Math.min(...scales).toFixed(2)}, p50 ${percentile(scales, 0.5).toFixed(2)}, max ${Math.max(...scales).toFixed(2)}`);
  const reallocationFrames = new Set();
  records.forEach((r, i) => { if (i > 0 && r.generation !== records[i - 1].generation) for (let k = i; k < i + 4 && k < records.length; k++) reallocationFrames.add(k); });
  const nearReallocation = gpu.filter((_, i) => reallocationFrames.has(i));
  const elsewhere = gpu.filter((_, i) => !reallocationFrames.has(i));
  console.log(`render-target reallocations: ${records.at(-1).generation - records[0].generation}; GPU p95 within 4 frames after one ${percentile(nearReallocation, 0.95)?.toFixed(2)} ms vs elsewhere ${percentile(elsewhere, 0.95).toFixed(2)} ms`);
  const worst = records.map((r, i) => ({ ...r, i })).sort((a, b) => b.gpuMs - a.gpuMs).slice(0, 5);
  console.log('slowest frames:', worst.map((r) => `#${r.i} ${r.gpuMs.toFixed(1)}ms @r=${r.distance.toFixed(1)} scale ${r.scale.toFixed(2)}`).join('; '));
  const problems = page.consoleMessages.filter((line) => /error|exception/i.test(line));
  if (problems.length) console.log(`Console errors:\n${problems.join('\n')}`);
} finally {
  await browser.shutdown();
}
