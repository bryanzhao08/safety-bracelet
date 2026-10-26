import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function staticServer() {
  return http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      let file = path.resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      const info = await stat(file);
      if (info.isDirectory()) file = path.join(file, 'index.html');
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(error.message);
    }
  });
}

async function waitFor(get, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await get(); if (value) return value; }
    catch (error) { if (error.fatal) throw error; lastError = error; }
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome CDP WebSocket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map(), events = new Map();
  socket.addEventListener('message', message => {
    const data = JSON.parse(message.data);
    if (data.id) {
      const request = pending.get(data.id); pending.delete(data.id);
      if (data.error) request.reject(new Error(`${request.method}: ${data.error.message}`));
      else request.resolve(data.result);
    } else if (data.method) for (const listener of events.get(data.method) || []) listener(data.params);
  });
  return {
    on(method, listener) { if (!events.has(method)) events.set(method, []); events.get(method).push(listener); },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id; pending.set(requestId, { resolve, reject, method });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'homebound-app-smoke-'));
  const server = staticServer();
  let chrome, cdp, chromeErrors = '';
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-extensions', `--user-data-dir=${profile}`,
      '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let spawnError;
    chrome.on('error', error => { spawnError = error; });
    chrome.stderr.on('data', chunk => { chromeErrors = (chromeErrors + chunk).slice(-4000); });
    const debugPort = await waitFor(async () => {
      if (spawnError) throw Object.assign(new Error(`Chrome could not start: ${spawnError.message}`), { fatal: true });
      if (chrome.exitCode !== null || chrome.signalCode !== null) {
        throw Object.assign(new Error(`Chrome exited before CDP started (${chrome.signalCode || chrome.exitCode}): ${chromeErrors.trim() || 'no stderr'}`), { fatal: true });
      }
      const file = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      return Number(file.split('\n')[0]) || null;
    }, 'Chrome debugging port');
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, 'Chrome /json/version');
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(origin + '/app/')}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Chrome could not create a tab: ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    const errors = [], requests = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    cdp.on('Runtime.consoleAPICalled', event => { if (event.type === 'error') errors.push(event.args.map(arg => arg.value || arg.description).join(' ')); });
    cdp.on('Log.entryAdded', event => { if (event.entry.level === 'error') errors.push(event.entry.text); });
    cdp.on('Network.requestWillBeSent', event => {
      const url = new URL(event.request.url);
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      requests.push(url.href);
      if (url.origin !== origin && !['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) {
        errors.push(`Disallowed network origin: ${url.origin}`);
      }
    });
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map(method => cdp.send(method)));
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`Page evaluation: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`);
      return result.result.value;
    };
    const navigate = async url => {
      await cdp.send('Page.navigate', { url });
      const expected = new URL(url);
      await waitFor(() => evaluate(`document.readyState === 'complete' && location.origin + location.pathname === ${JSON.stringify(expected.origin + expected.pathname)}`), `page ${url}`);
    };
    const layout = async (route, width) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
      await navigate(origin + route);
      const size = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({scroll: document.documentElement.scrollWidth, inner: innerWidth}))))`);
      if (size.scroll > size.inner) throw new Error(`${route} overflows at ${width}px: scrollWidth ${size.scroll} > innerWidth ${size.inner}`);
    };
    for (const route of ['/app/', '/site/']) for (const width of [360, 390, 430]) await layout(route, width);
    await navigate(origin + '/app/');
    const links = await evaluate(`(async () => {
      const { newId, cardUrl } = await import('/app/lib/card.js');
      const { partyUrl } = await import('/app/lib/party.js');
      const { createVault } = await import('/app/lib/vault.js');
      const { createStore } = await import('/app/lib/store.js');
      const store = createStore(localStorage);
      store.setMe({v:1,id:newId(),n:'Smoke Owner',p:'+15551230000'});
      store.setVault(await createVault('642813'));
      const base = location.origin + '/app/';
      return { cards: [
        cardUrl(base + '?smoke=1', {v:1,id:newId(),n:'Smoke Jordan',p:'+15551230001'}),
        cardUrl(base + '?smoke=2', {v:1,id:newId(),n:'Smoke Priya',p:'+15551230002'}),
      ], party: partyUrl(base + '?smoke=3', {v:1,id:newId(),name:'Smoke Party',startsAt:'2026-10-26T20:00:00.000Z',endsAt:'2026-10-27T02:00:00.000Z',host:{n:'Smoke Host',p:'+15551230003'},ask:{home:true}}) };
    })()`);
    for (let index = 0; index < links.cards.length; index++) {
      await navigate(links.cards[index]);
      await waitFor(() => evaluate(`(async () => {
        const {createStore} = await import('/app/lib/store.js');
        const store = createStore(localStorage);
        return store.listPeople().length >= ${index + 1} && store.listSealed().length >= ${index + 1} && !location.hash;
      })()`), `scan ${index + 1}`);
    }
    await navigate(links.party);
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-party-banner]'))"), 'party banner');
    const storage = await evaluate(`({log:localStorage.getItem('hb_log'), people:localStorage.getItem('hb_people')})`);
    if (!storage.log || storage.log.includes('Smoke Jordan') || storage.log.includes('Smoke Priya')) throw new Error('hb_log contains a plaintext name or is missing');
    if (errors.length) throw new Error(`Browser errors:\n${[...new Set(errors)].join('\n')}`);
    console.log(`App smoke passed: 2 scans, party banner, 6 mobile layouts, ${requests.length} requests, no console errors`);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) chrome.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch(error => { console.error(`App smoke failed: ${error.message}`); process.exitCode = 1; });
