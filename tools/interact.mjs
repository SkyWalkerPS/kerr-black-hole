import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, launchChrome } from './cdp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = (query) => fileUrl(path.join(projectRoot, 'index.html'), query);
const outputDirectory = process.argv[2] || '.';
const failures = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!condition) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KEYS = {
  w: { key: 'w', code: 'KeyW', keyCode: 87 },
  o: { key: 'o', code: 'KeyO', keyCode: 79 },
  h: { key: 'h', code: 'KeyH', keyCode: 72 },
  plus: { key: '+', code: 'Equal', keyCode: 187 },
  minus: { key: '-', code: 'Minus', keyCode: 189 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
};

async function key(page, type, name) {
  const { key: keyValue, code, keyCode } = KEYS[name];
  await page.send('Input.dispatchKeyEvent', { type, key: keyValue, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

async function press(page, name) {
  await key(page, 'keyDown', name);
  await key(page, 'keyUp', name);
  await sleep(80);
}

async function holdKey(page, name, milliseconds) {
  await key(page, 'keyDown', name);
  await sleep(milliseconds);
  await key(page, 'keyUp', name);
  await sleep(80);
}

async function dragMouse(page, from, to) {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 10;
    const y = from[1] + ((to[1] - from[1]) * i) / 10;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
}

async function pinch(page, startGap, endGap) {
  const center = [700, 450];
  const points = (gap) => [{ x: center[0] - gap / 2, y: center[1], id: 1 }, { x: center[0] + gap / 2, y: center[1], id: 2 }];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(startGap) });
  for (let i = 1; i <= 10; i++) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(startGap + ((endGap - startGap) * i) / 10) });
    await sleep(16);
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
}

const snapshot = async (page) => page.evaluate('JSON.stringify(window.blackHole.snapshot())').then(JSON.parse);
const isHidden = (page, id) => page.evaluate(`(() => { const element = document.getElementById('${id}'); return element.hidden || element.classList.contains('is-hidden'); })()`);
const degrees = (radians) => (radians * 180) / Math.PI;

const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.setViewport(1440, 900, 2);
  await page.goto(pageUrl('scale=0.4'));
  check('renderer starts', await page.evaluate('window.blackHole.ready'));
  await sleep(500);

  const start = await snapshot(page);
  check('starts orbiting at the default view', Math.abs(start.camera.orbitDistance - 25.6) < 1e-6 && Math.abs(degrees(start.camera.orbitElevation) - 5.8) < 1e-6 && start.fieldOfViewDegrees === 110,
    `distance ${start.camera.orbitDistance} M, elevation ${degrees(start.camera.orbitElevation).toFixed(1)} deg, field of view ${start.fieldOfViewDegrees} deg`);
  check('settings panel is open at start', !(await isHidden(page, 'panel')));
  check('no hint covers the view when the panel is open', await isHidden(page, 'hint'));
  check('camera has no fly mode', start.camera.mode === undefined && start.camera.position === undefined);

  await holdKey(page, 'w', 300);
  await press(page, 'o');
  const afterFlyKeys = await snapshot(page);
  check('W and O no longer move the camera', JSON.stringify(afterFlyKeys.camera) === JSON.stringify(start.camera));

  await dragMouse(page, [700, 450], [820, 450]);
  const afterDragRight = await snapshot(page);
  check('dragging right orbits the camera', afterDragRight.camera.orbitAzimuth < start.camera.orbitAzimuth - 0.3,
    `azimuth ${degrees(start.camera.orbitAzimuth).toFixed(1)} -> ${degrees(afterDragRight.camera.orbitAzimuth).toFixed(1)} deg`);
  await dragMouse(page, [700, 450], [700, 530]);
  const afterDragDown = await snapshot(page);
  check('dragging down raises the camera above the disk', afterDragDown.camera.orbitElevation > afterDragRight.camera.orbitElevation + 0.2,
    `elevation ${degrees(afterDragRight.camera.orbitElevation).toFixed(1)} -> ${degrees(afterDragDown.camera.orbitElevation).toFixed(1)} deg`);
  check('pointer is never locked', await page.evaluate('document.pointerLockElement === null'));

  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: 300 });
  await sleep(100);
  const afterWheelOut = await snapshot(page);
  check('scrolling down zooms out', afterWheelOut.camera.orbitDistance > afterDragDown.camera.orbitDistance * 1.1 && afterWheelOut.fieldOfViewDegrees === 110,
    `${afterDragDown.camera.orbitDistance.toFixed(2)} -> ${afterWheelOut.camera.orbitDistance.toFixed(2)} M`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: -600 });
  await sleep(100);
  const afterWheelIn = await snapshot(page);
  check('scrolling up zooms in', afterWheelIn.camera.orbitDistance < afterWheelOut.camera.orbitDistance / 1.2,
    `${afterWheelOut.camera.orbitDistance.toFixed(2)} -> ${afterWheelIn.camera.orbitDistance.toFixed(2)} M`);

  await holdKey(page, 'ArrowRight', 400);
  const afterArrowRight = await snapshot(page);
  check('right arrow orbits', afterArrowRight.camera.orbitAzimuth > afterWheelIn.camera.orbitAzimuth + 0.1);
  await holdKey(page, 'ArrowUp', 400);
  const afterArrowUp = await snapshot(page);
  check('up arrow raises the camera', afterArrowUp.camera.orbitElevation > afterArrowRight.camera.orbitElevation + 0.1);
  await press(page, 'plus');
  const afterPlus = await snapshot(page);
  await press(page, 'minus');
  await press(page, 'minus');
  const afterMinus = await snapshot(page);
  check('+ and - zoom', afterPlus.camera.orbitDistance < afterArrowUp.camera.orbitDistance && afterMinus.camera.orbitDistance > afterPlus.camera.orbitDistance,
    `${afterArrowUp.camera.orbitDistance.toFixed(2)} -> ${afterPlus.camera.orbitDistance.toFixed(2)} -> ${afterMinus.camera.orbitDistance.toFixed(2)} M`);

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await pinch(page, 120, 360);
  const afterPinch = await snapshot(page);
  check('pinching outward zooms in on touch screens', afterPinch.camera.orbitDistance < afterMinus.camera.orbitDistance * 0.6,
    `${afterMinus.camera.orbitDistance.toFixed(2)} -> ${afterPinch.camera.orbitDistance.toFixed(2)} M`);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  await press(page, 'h');
  const panelHiddenAfterFirstH = await isHidden(page, 'panel');
  await press(page, 'h');
  await sleep(200);
  check('H hides and shows the settings panel', panelHiddenAfterFirstH && !(await isHidden(page, 'panel')));
  const fpsText = await page.evaluate("document.getElementById('fps').textContent");
  check('panel shows a live FPS number', Number(fpsText) > 0, `"${fpsText}" fps`);

  await page.evaluate(`(() => { const spin = document.getElementById('spin'); spin.value = '0.5'; spin.dispatchEvent(new Event('input')); })()`);
  await page.evaluate(`(() => { const tilt = document.getElementById('tilt'); tilt.value = '25'; tilt.dispatchEvent(new Event('input')); })()`);
  await page.evaluate(`document.getElementById('color-cinematic').click()`);
  const afterPanel = await snapshot(page);
  check('panel sliders and color toggle change settings', afterPanel.spin === 0.5 && afterPanel.diskTilt === 25 && afterPanel.colorMode === 'cinematic');
  await page.screenshot(path.join(outputDirectory, 'interact-panel.png'));

  const problems = page.consoleMessages.filter((line) => /error|exception/i.test(line));
  check('no errors during interaction', problems.length === 0, problems.slice(0, 2).join(' | '));

  const phonePage = await browser.newPage();
  await phonePage.setViewport(390, 844, 3);
  await phonePage.goto(pageUrl('scale=0.4'));
  await phonePage.evaluate('window.blackHole.ready');
  check('on a phone-sized screen the panel starts hidden and a hint explains the gestures', (await isHidden(phonePage, 'panel')) && !(await isHidden(phonePage, 'hint')));

  const noGpuPage = await browser.newPage();
  await noGpuPage.setViewport(1200, 800, 2);
  await noGpuPage.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });" });
  await noGpuPage.goto(pageUrl(''));
  await noGpuPage.evaluate('window.blackHole.ready');
  const notice = await noGpuPage.evaluate("(() => { const n = document.getElementById('notice'); return { visible: !n.hidden, text: n.innerText }; })()");
  check('missing WebGPU shows a clear message naming the browsers', notice.visible && /Chrome/.test(notice.text) && /Safari/.test(notice.text), notice.text.split('\n')[0]);
  await noGpuPage.screenshot(path.join(outputDirectory, 'no-webgpu.png'));
} finally {
  await browser.shutdown();
}
console.log(failures.length ? `\n${failures.length} interaction check(s) failed` : '\nAll interaction checks passed');
process.exit(failures.length ? 1 : 0);
