import { FaceStore } from './face-store.js';

const $ = (id) => document.getElementById(id);

export function faceBounds(landmarks, width, height) {
  if (!landmarks?.length || !width || !height || landmarks.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('INVALID_FACE');
  }
  const xs = landmarks.map((point) => point.x * width);
  const ys = landmarks.map((point) => point.y * height);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = (maxX - minX) * 0.25, padY = (maxY - minY) * 0.25;
  const x = Math.max(0, minX - padX), y = Math.max(0, minY - padY);
  const cropWidth = Math.min(width, maxX + padX) - x;
  const cropHeight = Math.min(height, maxY + padY) - y;
  if (cropWidth < 2 || cropHeight < 2) throw new Error('INVALID_FACE');
  return { x, y, width: cropWidth, height: cropHeight };
}

function messageFor(error) {
  if (error?.name === 'ConstraintError') return 'Já existe um cadastro com esse nome. Use outro nome ou exclua o cadastro anterior.';
  if (error?.name === 'QuotaExceededError') return 'O armazenamento está cheio. Exclua cadastros ou libere espaço no navegador.';
  const messages = {
    INVALID_NAME: 'Informe um nome entre 2 e 80 caracteres.',
    PHOTO_REQUIRED: 'Capture uma foto antes de salvar.',
    SINGLE_FACE_REQUIRED: 'A foto precisa conter apenas um rosto detectado. Posicione-se e capture novamente.',
    INVALID_FACE: 'Não foi possível recortar o rosto. Ajuste a posição e capture novamente.',
    CAPTURE_CANCELLED: 'A câmera foi interrompida. Inicie novamente para capturar.',
    STORAGE_BLOCKED: 'Feche outras abas deste site e tente novamente.',
    RECORD_MISSING: 'O cadastro não existe mais. Atualize a lista e tente novamente.',
    PHOTO_LIMIT: 'Este cadastro já tem cinco fotos. Exclua e refaça o cadastro se precisar substituir as imagens.',
  };
  return messages[error?.message] || 'Não foi possível concluir. Confira se o navegador permite salvar dados deste site e tente novamente.';
}

export class Enrollment {
  #store = new FaceStore();
  #getSession;
  #onChange;
  #draft = null;
  #draftUrl = null;
  #listUrls = [];
  #busy = false;
  #captureState = 'idle';
  #listVersion = 0;
  #disposed = false;

  constructor(getSession, onChange = () => {}) {
    this.#getSession = getSession;
    this.#onChange = onChange;
    $('mode-detect').addEventListener('click', () => this.#setMode(false));
    $('mode-enroll').addEventListener('click', () => this.#setMode(true));
    $('capture-face').addEventListener('click', () => this.#capture());
    $('clear-photo').addEventListener('click', () => this.#clearDraft());
    $('face-name').addEventListener('input', () => this.#updateControls());
    $('enrollment-form').addEventListener('submit', (event) => { event.preventDefault(); this.#save(); });
    this.setCaptureState('idle');
    this.refresh();
  }

  #setMode(enroll) {
    $('mode-detect').setAttribute('aria-pressed', String(!enroll));
    $('mode-enroll').setAttribute('aria-pressed', String(enroll));
    $('detection-panel').hidden = enroll;
    $('enrollment-panel').hidden = !enroll;
  }

  setCaptureState(state) {
    this.#captureState = state;
    const hints = {
      idle: 'Inicie a câmera para capturar o rosto.', loading: 'Aguarde o carregamento do detector.',
      ready: 'Aguarde a primeira detecção.', absent: 'Nenhum rosto detectado. Olhe para a câmera.',
      single: 'Um rosto detectado. Você pode capturar a foto.', multiple: 'Deixe apenas uma pessoa visível na câmera.',
      error: 'O detector está indisponível. Pare e reinicie a câmera.',
    };
    if ($('enrollment-hint').textContent !== hints[state]) $('enrollment-hint').textContent = hints[state];
    this.#updateControls();
  }

  #updateControls() {
    $('capture-face').disabled = this.#busy || this.#captureState !== 'single';
    $('save-face').disabled = this.#busy || !this.#draft || $('face-name').value.trim().length < 2;
    $('clear-photo').disabled = this.#busy;
    $('face-name').disabled = this.#busy;
    $('enrollment-form').setAttribute('aria-busy', String(this.#busy));
    document.querySelectorAll('.add-face-photo').forEach((button) => {
      button.disabled = this.#busy || !this.#draft || button.dataset.full === 'true';
    });
  }

  #message(text, error = false) {
    $('enrollment-message').textContent = text;
    $('enrollment-message').dataset.error = String(error);
  }

  async #capture() {
    if (this.#busy || this.#captureState !== 'single') return;
    const session = this.#getSession();
    if (!session) return;
    this.#busy = true;
    this.#updateControls();
    this.#message('Capturando e verificando a foto…');
    let snapshot;
    try {
      snapshot = await createImageBitmap(session.video);
      // Analisa exatamente a foto congelada, evitando recortar com landmarks de outro quadro.
      const result = await session.detector.detect(snapshot, performance.now());
      if (!session.isCurrent() || this.#disposed) throw new Error('CAPTURE_CANCELLED');
      if (result.faceLandmarks?.length !== 1) throw new Error('SINGLE_FACE_REQUIRED');
      const bounds = faceBounds(result.faceLandmarks[0], snapshot.width, snapshot.height);
      const crop = document.createElement('canvas');
      const scale = Math.min(1, 480 / Math.max(bounds.width, bounds.height));
      crop.width = Math.max(1, Math.round(bounds.width * scale));
      crop.height = Math.max(1, Math.round(bounds.height * scale));
      crop.getContext('2d').drawImage(snapshot, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, crop.width, crop.height);
      const blob = await new Promise((resolve) => crop.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('PHOTO_REQUIRED');
      if (!session.isCurrent() || this.#disposed) throw new Error('CAPTURE_CANCELLED');
      this.#clearDraft();
      this.#draft = blob;
      this.#draftUrl = URL.createObjectURL(blob);
      $('face-preview').src = this.#draftUrl;
      $('photo-preview').hidden = false;
      this.#message('Confira a foto e informe o nome. O cadastro só será salvo ao clicar em salvar.');
    } catch (error) {
      if (!this.#disposed) this.#message(messageFor(error), true);
    } finally {
      snapshot?.close();
      this.#busy = false;
      if (!this.#disposed) this.#updateControls();
    }
  }

  #clearDraft() {
    if (this.#draftUrl) URL.revokeObjectURL(this.#draftUrl);
    this.#draft = this.#draftUrl = null;
    $('face-preview').removeAttribute('src');
    $('photo-preview').hidden = true;
    this.#updateControls();
  }

  async #save() {
    if (this.#busy || !this.#draft || !$('enrollment-form').reportValidity()) return;
    this.#busy = true;
    this.#updateControls();
    try {
      await this.#store.add($('face-name').value, this.#draft);
      this.#onChange();
      if (this.#disposed) return;
      this.#clearDraft();
      $('enrollment-form').reset();
      this.#message('Cadastro salvo neste navegador. A identidade ainda não foi verificada.');
      await this.refresh();
    } catch (error) {
      if (!this.#disposed) this.#message(messageFor(error), true);
    } finally {
      this.#busy = false;
      if (!this.#disposed) this.#updateControls();
    }
  }

  async refresh() {
    const version = ++this.#listVersion;
    try {
      const records = await this.#store.list();
      if (this.#disposed || version !== this.#listVersion) return;
      this.#listUrls.forEach((url) => URL.revokeObjectURL(url));
      this.#listUrls = [];
      $('registered-list').replaceChildren(...records.map((record) => {
        const item = document.createElement('li');
        const image = document.createElement('img');
        image.src = URL.createObjectURL(record.photo);
        this.#listUrls.push(image.src);
        image.alt = `Foto cadastrada de ${record.name}`;
        image.width = image.height = 52;
        const description = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = record.name;
        const date = document.createElement('span');
        const photoCount = record.photos?.length || 1;
        date.textContent = `${photoCount} foto(s) · ${new Date(record.createdAt).toLocaleDateString('pt-BR')}`;
        description.append(name, date);
        const actions = document.createElement('div');
        actions.className = 'registered-actions';
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'delete-face add-face-photo';
        add.textContent = 'Adicionar foto'; add.dataset.full = String(photoCount >= 5);
        add.disabled = this.#busy || !this.#draft || photoCount >= 5;
        add.setAttribute('aria-label', `Adicionar a foto capturada ao cadastro de ${record.name}`);
        add.addEventListener('click', () => this.#addPhoto(record.id, record.name));
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'delete-face remove-face';
        remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir cadastro de ${record.name}`);
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try { await this.#store.delete(record.id); this.#onChange(); await this.refresh(); this.#message('Cadastro excluído deste navegador.'); }
          catch (error) { remove.disabled = false; this.#message(messageFor(error), true); }
        });
        actions.append(add, remove);
        item.append(image, description, actions);
        return item;
      }));
      $('registered-empty').hidden = records.length > 0;
      $('registered-count').textContent = String(records.length);
      $('storage-message').textContent = '';
    } catch (error) {
      if (!this.#disposed && version === this.#listVersion) $('storage-message').textContent = messageFor(error);
    }
  }

  async #addPhoto(id, name) {
    if (this.#busy || !this.#draft) return;
    this.#busy = true;
    this.#updateControls();
    try {
      await this.#store.addPhoto(id, this.#draft);
      this.#onChange();
      if (this.#disposed) return;
      this.#clearDraft();
      this.#message(`Nova foto adicionada ao cadastro de ${name}.`);
      await this.refresh();
    } catch (error) {
      if (!this.#disposed) this.#message(messageFor(error), true);
    } finally {
      this.#busy = false;
      if (!this.#disposed) this.#updateControls();
    }
  }

  dispose() {
    this.#disposed = true;
    ++this.#listVersion;
    this.#clearDraft();
    this.#listUrls.forEach((url) => URL.revokeObjectURL(url));
    this.#listUrls = [];
  }

  resume() { this.#disposed = false; this.refresh(); }
}
