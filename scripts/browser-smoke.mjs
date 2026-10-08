// QA real no Edge/Chrome, sem câmera física: padrão de vídeo e retrato oficial.
// Nenhum resultado de inferência é simulado. Execute com o servidor já iniciado.
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const site = process.argv[2] || 'http://127.0.0.1:8000';
let executable;
for (const path of [process.env.BROWSER_BINARY, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(path); executable = path; break; } catch { /* Próximo navegador. */ }
}
if (!executable) throw new Error('Defina BROWSER_BINARY com o caminho do Edge ou Chrome.');
const profile = await mkdtemp(join(tmpdir(), 'mediapipe-browser-qa-'));
const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let sequence = 0;
let loaded = false;
const requests = new Map();
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  if (!port) throw new Error('O navegador de teste não iniciou.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === 'Page.loadEventFired') loaded = true;
    const pending = requests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    requests.delete(response.id);
    if (response.error) pending.reject(new Error(JSON.stringify(response.error)));
    else pending.resolve(response.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 65000);
    requests.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = (condition) => evaluate(`(async () => {
    const limit = Date.now() + 50000;
    while (Date.now() < limit) {
      if (${condition}) return true;
      if (document.getElementById('analysis-tag')?.dataset.state === 'error') throw new Error(document.getElementById('analysis-detail').textContent);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Estado esperado não atingido: ' + document.body.innerText);
  })()`);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url: site });
  for (let attempt = 0; !loaded && attempt < 200; attempt++) await delay(50);
  assert.equal(loaded, true, 'A página deve carregar antes das verificações.');
  await wait("document.getElementById('start-button') && document.getElementById('analysis-tag').dataset.state === 'idle'");
  assert.equal(await evaluate("document.getElementById('video').srcObject === null"), true);
  await evaluate("document.getElementById('start-button').click()");
  await wait("document.getElementById('analysis-tag').dataset.state === 'absent'");
  console.log('OK: câmera por clique; MediaPipe real inicializado; vídeo sem rosto não gera detecção.');

  await evaluate("window.lastStream = document.getElementById('video').srcObject; document.getElementById('stop-button').click()");
  assert.equal(await evaluate("lastStream.getTracks().every(track => track.readyState === 'ended') && document.getElementById('video').srcObject === null"), true);

  const response = await fetch('https://storage.googleapis.com/mediapipe-assets/business-person.png');
  if (!response.ok) throw new Error('Falha ao baixar o retrato oficial de QA.');
  const portrait = Buffer.from(await response.arrayBuffer()).toString('base64');
  await evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${portrait}';
    await image.decode();
    const fixture = document.createElement('canvas');
    fixture.width = image.naturalWidth; fixture.height = image.naturalHeight;
    const context = fixture.getContext('2d');
    context.drawImage(image, 0, 0);
    window.fixtureTimer = setInterval(() => context.drawImage(image, 0, 0), 80);
    navigator.mediaDevices.getUserMedia = async () => fixture.captureStream(15);
  })()`);
  await evaluate("document.getElementById('start-button').click()");
  await wait("document.getElementById('analysis-tag').dataset.state === 'single'");
  assert.equal(await evaluate("(() => { const canvas = document.getElementById('overlay'); const video = document.getElementById('video'); return canvas.width === video.videoWidth && canvas.height === video.videoHeight && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0); })()"), true);
  console.log('OK: retrato oficial analisado pelo modelo; um rosto real e contornos no canvas.');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  console.log('OK: viewport de celular sem rolagem horizontal.');
  await evaluate("document.getElementById('stop-button').click()");
  await evaluate("document.getElementById('start-button').click()");
  await wait("document.getElementById('analysis-tag').dataset.state === 'loading'");
  await evaluate("window.lastStream = document.getElementById('video').srcObject; document.getElementById('stop-button').click(); clearInterval(window.fixtureTimer)");
  await delay(500);
  assert.equal(await evaluate("document.getElementById('analysis-tag').dataset.state === 'idle' && lastStream.getTracks().every(track => track.readyState === 'ended')"), true);
  console.log('OK: parar durante inicialização libera o stream e descarta o worker.');

  for (const [name, title] of [['NotAllowedError', 'Permissão negada'], ['NotFoundError', 'Câmera não encontrada'], ['NotReadableError', 'Câmera ocupada ou indisponível']]) {
    await evaluate(`navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('QA', '${name}'); }; document.getElementById('start-button').click()`);
    await wait("document.getElementById('status-dot').dataset.state === 'error'");
    assert.equal(await evaluate("document.getElementById('status-title').textContent"), title);
  }
  console.log('OK: permissão negada, câmera ausente e câmera ocupada recuperáveis.');
} finally {
  for (const pending of requests.values()) clearTimeout(pending.timeout);
  socket?.close();
  browser.kill();
  console.log(`Perfil temporário de QA: ${profile}`);
}
