import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, launchChrome } from './cdp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(process.argv[2] || 'shots');
const requestedViews = process.argv.slice(3);
const [viewportWidth, viewportHeight] = (process.env.VIEWPORT || '1728x1117').split('x').map(Number);
const devicePixelRatio = Number(process.env.DPR || 2);
const renderScale = process.env.SCALE || '0.75';
const extraQuery = process.env.QUERY || '';

const VIEWS = {
  hero: { settings: {}, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  cinematic: { settings: { colorMode: 'cinematic' }, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  faceOn: { settings: {}, camera: { orbitDistance: 32, orbitAzimuthDegrees: 0, orbitElevationDegrees: 78 } },
  edgeOn: { settings: {}, camera: { orbitDistance: 30, orbitAzimuthDegrees: 0, orbitElevationDegrees: 0.6 } },
  above: { settings: {}, camera: { orbitDistance: 22, orbitAzimuthDegrees: 40, orbitElevationDegrees: 28 } },
  close: { settings: {}, camera: { orbitDistance: 7.5, orbitAzimuthDegrees: 20, orbitElevationDegrees: 9 } },
  behind: { settings: {}, camera: { orbitDistance: 26, orbitAzimuthDegrees: 180, orbitElevationDegrees: 6 } },
  wide: { settings: { fieldOfViewDegrees: 80 }, camera: { orbitDistance: 60, orbitAzimuthDegrees: 0, orbitElevationDegrees: 12 } },
  shadowSchwarzschild: { settings: { spin: 0, fieldOfViewDegrees: 2.0, diskTemperature: 1500 }, camera: { orbitDistance: 600, orbitAzimuthDegrees: 0, orbitElevationDegrees: 0 } },
  shadowKerr: { settings: { spin: 0.998, fieldOfViewDegrees: 2.0, diskTemperature: 1500 }, camera: { orbitDistance: 600, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5 } },
  steps: { settings: { debugView: 1 }, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  hero4500: { settings: { diskTemperature: 4500 }, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  hero9000: { settings: { diskTemperature: 9000 }, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  tilt30: { settings: { diskTilt: 30 }, camera: { orbitDistance: 25.6, orbitAzimuthDegrees: 0, orbitElevationDegrees: 5.8 } },
  spin0Edge: { settings: { spin: 0 }, camera: { orbitDistance: 30, orbitAzimuthDegrees: 0, orbitElevationDegrees: 0.6 } },
  spinMaxEdge: { settings: { spin: 0.998 }, camera: { orbitDistance: 30, orbitAzimuthDegrees: 0, orbitElevationDegrees: 0.6 } },
  faceOnClose: { settings: {}, camera: { orbitDistance: 16, orbitAzimuthDegrees: 0, orbitElevationDegrees: 80 } },
};

const viewNames = requestedViews.length ? requestedViews : Object.keys(VIEWS);
mkdirSync(outputDirectory, { recursive: true });
const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.setViewport(viewportWidth, viewportHeight, devicePixelRatio);
  const queryParams = new URLSearchParams({ hint: '0', panel: process.env.PANEL ? '1' : '0', time: '180', scale: renderScale });
  for (const [key, value] of new URLSearchParams(extraQuery)) queryParams.set(key, value);
  const query = queryParams.toString();
  await page.goto(fileUrl(process.env.PAGE ? path.resolve(process.env.PAGE) : path.join(projectRoot, 'index.html'), query));
  const started = await page.evaluate('window.blackHole.ready');
  if (!started) throw new Error(`Renderer did not start.\n${page.consoleMessages.join('\n')}`);
  const baseline = await page.evaluate('JSON.stringify(window.blackHole.snapshot())');
  for (const name of viewNames) {
    const view = VIEWS[name];
    if (!view) throw new Error(`Unknown view ${name}`);
    await page.evaluate(`(() => {
      const baseline = ${baseline};
      const { camera: baselineCamera, renderScale, angleScale, ...baselineSettings } = baseline;
      window.blackHole.set({ ...baselineSettings, ...${JSON.stringify(view.settings)} });
      window.blackHole.setCamera(${JSON.stringify(view.camera)});
    })()`);
    if (process.env.PANEL) await page.evaluate('window.blackHole.showPanel(true)');
    const result = await page.evaluate('window.blackHole.renderFrames(12).then((r) => JSON.stringify(r))');
    if (process.env.PANEL) await new Promise((resolve) => setTimeout(resolve, 400));
    const clip = process.env.CLIP ? Object.fromEntries(['x', 'y', 'width', 'height'].map((key, i) => [key, Number(process.env.CLIP.split(',')[i])])) : undefined;
    const file = await page.screenshot(path.join(outputDirectory, `${name}${clip ? '-clip' : ''}.png`), clip);
    console.log(`${name}: ${file} ${result}`);
  }
  const problems = page.consoleMessages.filter((line) => /error|exception|warn/i.test(line));
  if (problems.length) console.log(`Console:\n${problems.join('\n')}`);
} finally {
  await browser.shutdown();
}
