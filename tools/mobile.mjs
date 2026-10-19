import { mkdirSync } from 'node:fs';
import { fileUrl, launchChrome } from './cdp.mjs';

const PAGE = new URL('../index.html', import.meta.url).pathname;
const OUTPUT_DIRECTORY = new URL('../screenshots/mobile/', import.meta.url).pathname;
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const PHONE_PORTRAIT = { width: 390, height: 844 };
const PHONE_PIXEL_RATIO = 3;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function emulatePhone(page, { width, height }) {
  const portrait = height > width;
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: PHONE_PIXEL_RATIO, mobile: true,
    screenWidth: width, screenHeight: height,
    screenOrientation: { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: portrait ? 0 : 90 },
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

async function touch(page, type, points) {
  await page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}

async function settle(page, frames = 40) {
  for (let i = 0; i < frames; i++) await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');
}

const layoutProbe = `(() => {
  const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  return {
    touch: document.body.classList.contains('is-touch'),
    wantsLandscape: document.body.classList.contains('wants-landscape'),
    rotateVisible: getComputedStyle(document.getElementById('rotate')).display !== 'none',
    panelOpen: !document.getElementById('panel').classList.contains('is-hidden'),
    panel: rect('panel'),
    panelScrollable: document.getElementById('panel').scrollHeight > document.getElementById('panel').clientHeight + 1,
    toolbar: rect('toolbar'),
    toolbarVisible: getComputedStyle(document.getElementById('toolbar')).display !== 'none',
    hintText: document.getElementById('hint').textContent,
    canvas: [document.getElementById('view').width, document.getElementById('view').height],
    viewport: [innerWidth, innerHeight],
  };
})()`;

const browser = await launchChrome();
try {
  const page = await browser.newPage();

  await emulatePhone(page, PHONE_PORTRAIT);
  await page.goto(fileUrl(PAGE));
  if (!(await page.evaluate('window.blackHole.ready'))) throw new Error(page.consoleMessages.join('\n'));
  await settle(page);
  let layout = await page.evaluate(layoutProbe);
  check('touch layout detected', layout.touch);
  check('portrait shows the rotate prompt', layout.wantsLandscape && layout.rotateVisible);
  check('panel starts closed in portrait', !layout.panelOpen);
  check('canvas capped at 2x pixel ratio', layout.canvas[0] === PHONE_PORTRAIT.width * 2 && layout.canvas[1] === PHONE_PORTRAIT.height * 2, layout.canvas.join('×'));
  await page.screenshot(`${OUTPUT_DIRECTORY}portrait-prompt.png`);

  await page.evaluate(`document.getElementById('rotate-dismiss').click(), true`);
  await settle(page, 60);
  layout = await page.evaluate(layoutProbe);
  check('"Keep it upright" hides the prompt', !layout.rotateVisible);
  await page.screenshot(`${OUTPUT_DIRECTORY}portrait-upright.png`);

  await emulatePhone(page, PHONE_LANDSCAPE);
  await page.goto(fileUrl(PAGE));
  if (!(await page.evaluate('window.blackHole.ready'))) throw new Error(page.consoleMessages.join('\n'));
  await settle(page, 90);
  layout = await page.evaluate(layoutProbe);
  check('landscape has no rotate prompt', !layout.rotateVisible);
  check('panel starts open in landscape', layout.panelOpen);
  check('compact panel fits the height without scrolling', !layout.panelScrollable && layout.panel.bottom <= PHONE_LANDSCAPE.height, `panel ${Math.round(layout.panel.width)}×${Math.round(layout.panel.height)}`);
  check('toolbar visible and clear of the panel', layout.toolbarVisible && layout.toolbar.left > layout.panel.right);
  check('touch hint text', layout.hintText === 'Drag to orbit, pinch to zoom.');
  await page.screenshot(`${OUTPUT_DIRECTORY}landscape-panel.png`);

  const center = [PHONE_LANDSCAPE.width * 0.62, PHONE_LANDSCAPE.height * 0.5];
  const before = await page.evaluate('({ ...window.blackHole.camera })');
  await touch(page, 'touchStart', [center]);
  for (let step = 1; step <= 10; step++) {
    await touch(page, 'touchMove', [[center[0] + step * 12, center[1]]]);
    await settle(page, 1);
  }
  await touch(page, 'touchEnd', []);
  await settle(page, 3);
  const afterDrag = await page.evaluate('({ ...window.blackHole.camera })');
  check('one-finger drag orbits', Math.abs(afterDrag.orbitAzimuth - before.orbitAzimuth) > 0.05, `Δaz ${(afterDrag.orbitAzimuth - before.orbitAzimuth).toFixed(3)} rad`);

  await touch(page, 'touchStart', [[center[0] - 40, center[1]], [center[0] + 40, center[1]]]);
  for (let step = 1; step <= 10; step++) {
    await touch(page, 'touchMove', [[center[0] - 40 - step * 8, center[1]], [center[0] + 40 + step * 8, center[1]]]);
    await settle(page, 1);
  }
  await touch(page, 'touchEnd', []);
  await settle(page, 3);
  const afterPinch = await page.evaluate('({ ...window.blackHole.camera })');
  check('pinch out zooms in', afterPinch.orbitDistance < afterDrag.orbitDistance * 0.8, `${afterDrag.orbitDistance.toFixed(1)} → ${afterPinch.orbitDistance.toFixed(1)}`);

  const settingsButton = await page.evaluate(`(() => { const r = document.getElementById('settings-button').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await touch(page, 'touchStart', [settingsButton]);
  await touch(page, 'touchEnd', []);
  await settle(page, 20);
  layout = await page.evaluate(layoutProbe);
  check('settings button closes the panel', !layout.panelOpen);
  await page.screenshot(`${OUTPUT_DIRECTORY}landscape-clean.png`);
  await touch(page, 'touchStart', [settingsButton]);
  await touch(page, 'touchEnd', []);
  await settle(page, 5);
  layout = await page.evaluate(layoutProbe);
  check('settings button opens it again', layout.panelOpen);

  const spinSlider = await page.evaluate(`(() => { const r = document.getElementById('spin').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()`);
  await touch(page, 'touchStart', [[spinSlider[0] + spinSlider[2] * 0.2, spinSlider[1]]]);
  await touch(page, 'touchEnd', []);
  await settle(page, 5);
  const spinAfterTap = await page.evaluate('window.blackHole.settings.spin');
  check('tapping the spin slider sets the spin', Math.abs(spinAfterTap - 0.998 * 0.2) < 0.08, `spin ${spinAfterTap.toFixed(3)}`);

  const errors = page.consoleMessages.filter((line) => /error|exception/i.test(line));
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.shutdown();
}
const failed = results.filter((result) => !result.passed).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
