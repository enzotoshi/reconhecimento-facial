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
let lastConsoleError = '';
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
    if (response.method === 'Runtime.consoleAPICalled' && response.params.type === 'error') lastConsoleError = response.params.args.map((arg) => arg.description || arg.value).join(' ');
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
    throw new Error('Estado esperado não atingido: ' + document.getElementById('recognition-panel')?.textContent + ' / ' + document.getElementById('recognition-references')?.textContent + '\\n' + document.body.innerText);
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
  await evaluate("document.getElementById('mode-enroll').click()");
  assert.equal(await evaluate("document.getElementById('capture-face').disabled && document.getElementById('save-face').disabled"), true);

  await evaluate("window.lastStream = document.getElementById('video').srcObject; document.getElementById('stop-button').click()");
  assert.equal(await evaluate("lastStream.getTracks().every(track => track.readyState === 'ended') && document.getElementById('video').srcObject === null"), true);

  const response = await fetch('https://storage.googleapis.com/mediapipe-assets/business-person.png');
  if (!response.ok) throw new Error('Falha ao baixar o retrato oficial de QA.');
  const portrait = Buffer.from(await response.arrayBuffer()).toString('base64');
  await evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${portrait}';
    await image.decode();
    window.fixtureImage = image;
    const fixture = document.createElement('canvas');
    fixture.width = image.naturalWidth; fixture.height = image.naturalHeight;
    const context = fixture.getContext('2d');
    context.drawImage(image, 0, 0);
    window.fixtureCanvas = fixture;
    window.fixtureTimer = setInterval(() => {
      context.filter = window.fixtureFilter || 'none';
      context.drawImage(window.fixtureImage, 0, 0);
      context.filter = 'none';
    }, 80);
    navigator.mediaDevices.getUserMedia = async () => fixture.captureStream(15);
  })()`);
  await evaluate("document.getElementById('start-button').click()");
  await wait("document.getElementById('analysis-tag').dataset.state === 'single'");
  assert.equal(await evaluate("(() => { const canvas = document.getElementById('overlay'); const video = document.getElementById('video'); return canvas.width === video.videoWidth && canvas.height === video.videoHeight && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0); })()"), true);
  console.log('OK: retrato oficial analisado pelo modelo; um rosto real e contornos no canvas.');

  await evaluate("document.getElementById('face-name').value = 'Pessoa de teste'; document.getElementById('face-name').dispatchEvent(new Event('input')); document.getElementById('capture-face').click()");
  await wait("!document.getElementById('photo-preview').hidden && !document.getElementById('save-face').disabled");
  assert.equal(await evaluate("document.querySelectorAll('#registered-list li').length"), 0);
  await evaluate("document.getElementById('save-face').click()");
  await wait("document.querySelectorAll('#registered-list li').length === 1");
  assert.equal(await evaluate("document.querySelector('#registered-list strong').textContent"), 'Pessoa de teste');
  assert.equal(await evaluate("document.getElementById('photo-preview').hidden"), true);
  try { await wait("document.getElementById('recognition-panel').dataset.state === 'matched'"); }
  catch (error) { throw new Error(`${error.message}\n${lastConsoleError}`); }
  assert.equal(await evaluate("document.getElementById('recognized-name').textContent"), 'Pessoa de teste');
  console.log('OK: reconhecimento real associa o vídeo à foto cadastrada após três leituras.');

  await evaluate("window.fixtureFilter = 'brightness(0.8)'");
  await delay(200);
  await evaluate("document.getElementById('capture-face').click()");
  await wait("!document.getElementById('photo-preview').hidden && !document.querySelector('.add-face-photo').disabled");
  await evaluate("document.querySelector('.add-face-photo').click()");
  await wait("document.querySelector('#registered-list li span').textContent.startsWith('2 foto')");
  await wait("document.getElementById('recognition-panel').dataset.state === 'matched'");
  assert.equal(await evaluate("document.getElementById('recognized-name').textContent"), 'Pessoa de teste');
  console.log('OK: segunda foto com iluminação diferente reforça o mesmo cadastro e mantém o reconhecimento.');

  const differentResponse = await fetch('https://storage.googleapis.com/mediapipe-assets/portrait.jpg');
  if (!differentResponse.ok) throw new Error('Falha ao carregar outro rosto para teste.');
  const differentPortrait = Buffer.from(await differentResponse.arrayBuffer()).toString('base64');
  const changePortrait = (base64) => evaluate(`(async () => {
    const image = new Image(); image.src = 'data:image/png;base64,${base64}'; await image.decode();
    window.fixtureCanvas.width = image.naturalWidth; window.fixtureCanvas.height = image.naturalHeight;
    window.fixtureImage = image;
    window.fixtureCanvas.getContext('2d').drawImage(image, 0, 0);
  })()`);
  await changePortrait(differentPortrait);
  await wait("document.getElementById('recognition-panel').dataset.state === 'unknown'");
  assert.equal(await evaluate("document.getElementById('recognition-title').textContent"), 'Acesso negado / desconhecido');
  assert.equal(await evaluate("document.getElementById('recognized-name').hidden"), true);
  console.log('OK: uma pessoa diferente é desconhecida; o nome anterior é removido.');
  await changePortrait(portrait);
  await wait("document.getElementById('recognition-panel').dataset.state === 'matched'");
  // Um segundo cadastro de nome equivalente deve falhar sem sobrescrever o primeiro.
  await evaluate("document.getElementById('face-name').value = 'PESSOA DE TESTE'; document.getElementById('face-name').dispatchEvent(new Event('input')); document.getElementById('capture-face').click()");
  await wait("!document.getElementById('photo-preview').hidden && !document.getElementById('save-face').disabled");
  await evaluate("document.getElementById('save-face').click()");
  await wait("document.getElementById('enrollment-message').dataset.error === 'true'");
  assert.equal(await evaluate("document.querySelectorAll('#registered-list li').length"), 1);
  console.log('OK: captura do quadro exato, prévia antes de salvar, cadastro local e proteção contra nome duplicado.');

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

  loaded = false;
  await call('Page.reload');
  for (let attempt = 0; !loaded && attempt < 200; attempt++) await delay(50);
  assert.equal(loaded, true);
  await wait("document.querySelectorAll('#registered-list li').length === 1");
  await evaluate("document.getElementById('mode-enroll').click()");
  assert.equal(await evaluate("document.querySelector('#registered-list strong').textContent"), 'Pessoa de teste');
  assert.equal(await evaluate("document.getElementById('video').srcObject === null"), true);
  await evaluate("document.getElementById('start-button').click()");
  await wait("document.getElementById('recognition-panel').dataset.state !== 'idle'");
  await evaluate("document.querySelector('#registered-list .remove-face').click()");
  await wait("document.querySelectorAll('#registered-list li').length === 0 && document.getElementById('registered-count').textContent === '0'");
  console.log('OK: cadastro persiste após recarregar e exclusão remove a foto e o registro.');
  await wait("document.getElementById('recognition-panel').dataset.state === 'empty'");
  assert.equal(await evaluate("document.getElementById('recognition-title').textContent"), 'Acesso negado / desconhecido');
  assert.equal(await evaluate("document.getElementById('recognized-name').hidden"), true);
  await evaluate("document.getElementById('stop-button').click()");
} finally {
  for (const pending of requests.values()) clearTimeout(pending.timeout);
  socket?.close();
  browser.kill();
  console.log(`Perfil temporário de QA: ${profile}`);
}
