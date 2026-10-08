import { CameraCapture } from './camera.js';
import { FrameAnalysis } from './analysis.js';
import { FaceLandmarkerAdapter } from './integration.js';
import { detectionState } from './overlay.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const camera = new CameraCapture();
let analysis = null;
let detector = null;
let panelState = '';
let operation = 0;
let state = 'off';
let removeEndedListener = () => {};

function setAnalysis(next, error) {
  if (panelState === next) return; // Evita anúncios repetidos a cada quadro.
  panelState = next;
  const messages = {
    idle: ['Aguardando câmera', 'Ative a câmera para detectar o rosto', 'Os contornos faciais serão exibidos sobre a imagem. A confirmação de identidade ainda não está configurada.', 'Parada'],
    loading: ['Carregando modelo', 'Preparando a detecção facial', 'A câmera já está ativa. Aguarde o carregamento do modelo local do MediaPipe.', 'Carregando'],
    ready: ['Analisando', 'Aguardando o primeiro resultado', 'Mantenha o rosto visível e centralizado na moldura.', 'Em execução'],
    absent: ['Nenhum rosto', 'Nenhum rosto detectado', 'Fique de frente para a câmera e procure uma boa iluminação.', 'Nenhum rosto'],
    single: ['Rosto detectado', 'Contornos faciais detectados', 'Os contornos acompanham o rosto em tempo real. Sua identidade ainda não foi verificada.', 'Um rosto'],
    multiple: ['Ajuste a captura', 'Mais de um rosto detectado', 'Mantenha apenas uma pessoa visível na câmera.', 'Múltiplos rostos'],
    error: ['Erro na detecção', 'A análise facial está indisponível', 'A câmera permanece ativa. Pare e inicie novamente para tentar. ' + (error?.message || ''), 'Indisponível'],
  };
  const [tag, title, detail, result] = messages[next];
  $('analysis-tag').textContent = tag;
  $('analysis-tag').dataset.state = next;
  $('analysis-title').textContent = title;
  $('analysis-detail').textContent = detail;
  $('detection-result').textContent = result;
}

function setState(next, title, detail) {
  state = next;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('status-dot').dataset.state = next;
  $('viewer').classList.toggle('active', next === 'active');
  $('live-label').hidden = next !== 'active';
  $('start-button').disabled = next === 'active' || next === 'pending';
  $('stop-button').disabled = next !== 'active' && next !== 'pending';
  $('device-select').disabled = next !== 'active';
  $('capture-result').textContent = { off: 'Desligada', pending: 'Aguardando', active: 'Ativa', error: 'Indisponível' }[next];
  $('placeholder').lastElementChild.textContent = next === 'pending' ? 'Aguardando autorização…' : next === 'error' ? 'Não foi possível acessar a câmera' : 'Sua câmera está desligada';
}

function release() {
  ++operation;
  analysis?.stop();
  analysis = null;
  detector?.close();
  detector = null;
  setAnalysis('idle');
  removeEndedListener();
  removeEndedListener = () => {};
  camera.stop();
  video.pause();
  video.srcObject = null;
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  $('device-field').hidden = true;
}

function stop() {
  release();
  setState('off', 'Câmera desligada', 'Clique em iniciar para permitir o acesso à câmera.');
}

function showError(error) {
  const errors = {
    NotAllowedError: ['Permissão negada', 'Permita o acesso à câmera nas configurações deste site no navegador e tente novamente.'],
    SecurityError: ['Acesso bloqueado', 'Confira as permissões do navegador e abra o site em localhost ou HTTPS.'],
    NotFoundError: ['Câmera não encontrada', 'Conecte uma câmera ou verifique se ela está habilitada no dispositivo.'],
    OverconstrainedError: ['Câmera não disponível', 'A câmera selecionada não está disponível. Inicie novamente para usar a câmera padrão.'],
    NotReadableError: ['Câmera ocupada ou indisponível', 'Feche aplicativos que possam estar usando a câmera e tente novamente.'],
    AbortError: ['Captura interrompida', 'A câmera não pôde ser iniciada. Tente novamente.'],
    CAMERA_UNSUPPORTED: ['Navegador ou endereço incompatível', 'Use um navegador com acesso à câmera e abra o site em localhost ou HTTPS.'],
  };
  const [title, detail] = errors[error?.message] || errors[error?.name] || ['Erro de acesso à câmera', 'Verifique a conexão e as permissões da câmera e tente novamente.'];
  setState('error', title, detail);
}

async function refreshDevices() {
  const current = operation;
  try {
    const devices = await camera.devices();
    if (state !== 'active' || current !== operation) return;
    const deviceId = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    $('device-select').replaceChildren(...devices.map((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Câmera ${index + 1}`;
      option.selected = device.deviceId === deviceId;
      return option;
    }));
    $('device-field').hidden = devices.length < 2;
  } catch {
    if (current === operation) $('device-field').hidden = true;
  }
}

async function start(deviceId) {
  release();
  const current = operation;
  setState('pending', 'Solicitando permissão', 'Autorize a câmera na janela do navegador. Você pode cancelar clicando em parar.');
  try {
    const stream = await camera.start(deviceId);
    if (current !== operation || !stream) return;
    const track = stream.getVideoTracks()[0];
    const ended = () => {
      if (current !== operation) return;
      release();
      setState('error', 'Câmera desconectada', 'A captura foi interrompida pelo dispositivo ou navegador. Inicie novamente para tentar.');
    };
    track.addEventListener('ended', ended);
    removeEndedListener = () => track.removeEventListener('ended', ended);
    const mirrored = track.getSettings().facingMode === 'user';
    video.classList.toggle('mirrored', mirrored);
    canvas.classList.toggle('mirrored', mirrored);
    video.srcObject = stream;
    await video.play();
    if (current !== operation) return;
    setState('active', 'Câmera ativa', 'Mantenha o rosto centralizado na moldura.');
    await refreshDevices();
    if (current !== operation) return;

    // O modelo só é inicializado após o clique e o início da câmera.
    setAnalysis('loading');
    try {
      const candidate = new FaceLandmarkerAdapter();
      detector = candidate; // Permite cancelar inclusive durante a inicialização.
      await candidate.initialize();
      if (current !== operation) { candidate.close(); return; }
      analysis = new FrameAnalysis(candidate, {
        maxFps: 15,
        onResult: (result) => setAnalysis(detectionState(result)),
        onError: (error) => { candidate.close(); setAnalysis('error', error); },
      });
      setAnalysis('ready');
      analysis.start(video, canvas);
    } catch (error) {
      if (current !== operation) return;
      detector?.close();
      detector = null;
      setAnalysis('error', error);
    }
  } catch (error) {
    if (current !== operation) return;
    release();
    showError(error);
  }
}

$('start-button').addEventListener('click', () => start());
$('stop-button').addEventListener('click', stop);
$('device-select').addEventListener('change', (event) => start(event.target.value));
navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
// Se a tela virar um componente, use dispose() na desmontagem.
function dispose() {
  stop();
  navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
}
window.addEventListener('pagehide', dispose);
// Restaura apenas os listeners ao voltar pelo histórico; nunca liga a câmera sozinha.
window.addEventListener('pageshow', () => navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices));
setAnalysis('idle');
