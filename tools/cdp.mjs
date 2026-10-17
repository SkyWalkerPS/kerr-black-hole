import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextMessageId = 1;
    this.pendingReplies = new Map();
    this.eventListeners = new Map();
    socket.addEventListener('message', (event) => this.handleMessage(JSON.parse(event.data)));
    socket.addEventListener('close', () => this.rejectPendingReplies('DevTools connection closed'));
  }

  rejectPendingReplies(reason) {
    for (const pending of this.pendingReplies.values()) pending.reject(new Error(`${pending.method}: ${reason}`));
    this.pendingReplies.clear();
  }

  static open(webSocketUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      socket.addEventListener('open', () => resolve(new CdpConnection(socket)));
      socket.addEventListener('error', (error) => reject(error));
    });
  }

  handleMessage(message) {
    if (message.id !== undefined) {
      const pending = this.pendingReplies.get(message.id);
      if (!pending) return;
      this.pendingReplies.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    const listenerKey = `${message.sessionId || ''}|${message.method}`;
    for (const listener of this.eventListeners.get(listenerKey) || []) listener(message.params);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextMessageId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pendingReplies.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(method, listener, sessionId = undefined) {
    const listenerKey = `${sessionId || ''}|${method}`;
    if (!this.eventListeners.has(listenerKey)) this.eventListeners.set(listenerKey, []);
    this.eventListeners.get(listenerKey).push(listener);
  }

  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new CdpPage(this, sessionId, targetId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    return page;
  }

  async close() {
    const closeTimeout = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([this.send('Browser.close').catch(() => undefined), closeTimeout]);
    this.socket.close();
  }
}

class CdpPage {
  constructor(connection, sessionId, targetId) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.consoleMessages = [];
    this.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || '')).join(' ');
      this.consoleMessages.push(`[${params.type}] ${text}`);
    });
    this.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails;
      this.consoleMessages.push(`[exception] ${details.exception?.description || details.text}`);
    });
    this.on('Log.entryAdded', (params) => this.consoleMessages.push(`[log:${params.entry.level}] ${params.entry.text}`));
  }

  send(method, params = {}) {
    return this.connection.send(method, params, this.sessionId);
  }

  on(method, listener) {
    this.connection.on(method, listener, this.sessionId);
  }

  async setViewport(width, height, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  }

  async goto(url, timeoutMs = 30000) {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeoutMs);
      this.on('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
    });
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Page evaluation failed: ${description}`);
    }
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 30000, pollMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`Timed out waiting for: ${expression}\nConsole:\n${this.consoleMessages.join('\n')}`);
  }

  async screenshot(filePath, clip = undefined) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: clip.scale ?? 1 } } : {}) });
    writeFileSync(filePath, Buffer.from(data, 'base64'));
    return filePath;
  }
}

export async function launchChrome({ headless = true, extraArgs = [], chromePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATH } = {}) {
  const userDataDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'blackhole-chrome-'));
  const args = [
    headless ? '--headless=new' : null,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--enable-features=WebGPUDeveloperFeatures',
    '--hide-scrollbars',
    '--mute-audio',
    ...extraArgs,
    'about:blank',
  ].filter(Boolean);
  const chromeProcess = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const webSocketUrl = await new Promise((resolve, reject) => {
    let stderrText = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not report a DevTools URL:\n${stderrText}`)), 30000);
    chromeProcess.stderr.on('data', (chunk) => {
      stderrText += chunk.toString();
      const match = stderrText.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chromeProcess.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited with ${code}:\n${stderrText}`)); });
  });
  const connection = await CdpConnection.open(webSocketUrl);
  connection.shutdown = async () => {
    await connection.close();
    await new Promise((resolve) => {
      if (chromeProcess.exitCode !== null) return resolve();
      const killTimer = setTimeout(() => { chromeProcess.kill('SIGKILL'); resolve(); }, 5000);
      chromeProcess.on('exit', () => { clearTimeout(killTimer); resolve(); });
    });
    rmSync(userDataDir, { recursive: true, force: true });
  };
  return connection;
}

export function fileUrl(absolutePath, query = '') {
  return `file://${absolutePath}${query ? `?${query}` : ''}`;
}
