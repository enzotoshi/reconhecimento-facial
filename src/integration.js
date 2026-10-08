import { drawFaceLandmarks } from './overlay.js';

/** Adaptador MediaPipe: o worker mantém modelo e inferências fora da interface. */
export class FaceLandmarkerAdapter {
  #worker;
  #pending = new Map();
  #sequence = 0;
  #closed = false;
  #connections = [];

  constructor() {
    if (!globalThis.Worker || !globalThis.createImageBitmap) {
      throw new Error('Este navegador não suporta análise facial em segundo plano.');
    }
    this.#worker = new Worker(new URL('./face-worker.js', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      this.#pending.delete(data.id);
      clearTimeout(pending.timeout);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    this.#worker.onerror = (event) => {
      event.preventDefault();
      this.close(new Error(event.message || 'Não foi possível executar o MediaPipe.'));
    };
    this.#worker.onmessageerror = () => this.close(new Error('Falha na comunicação com a análise facial.'));
  }

  async initialize() {
    const base = new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI);
    const result = await this.#request('init', {
      wasmRoot: new URL('wasm/', base).href,
      modelPath: new URL('face_landmarker.task', base).href,
    }, [], 45000);
    this.#connections = result.connections;
  }

  async detect(video, timestamp) {
    if (this.#closed) throw new Error('Análise encerrada.');
    const bitmap = await createImageBitmap(video);
    if (this.#closed) {
      bitmap.close();
      throw new Error('Análise encerrada.');
    }
    try {
      return await this.#request('detect', { bitmap, timestamp }, [bitmap], 15000);
    } finally {
      // O quadro transferido é fechado no worker; close() também é seguro aqui.
      bitmap.close();
    }
  }

  draw(result, context, dimensions) {
    drawFaceLandmarks(result, context, dimensions, this.#connections);
  }

  #request(type, data, transfer = [], timeoutMs) {
    if (this.#closed) return Promise.reject(new Error('Análise encerrada.'));
    return new Promise((resolve, reject) => {
      const id = ++this.#sequence;
      const timeout = setTimeout(() => this.close(new Error('A análise demorou demais. Pare e inicie a câmera para tentar novamente.')), timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      try { this.#worker.postMessage({ id, type, ...data }, transfer); }
      catch (error) { this.close(error); }
    });
  }

  close(error = new Error('Análise encerrada.')) {
    if (this.#closed) return;
    this.#closed = true;
    // Terminar o worker libera modelo, memória WASM e inferências pendentes.
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

// IDENTIDADE: exige um módulo independente com comparação biométrica, vivacidade,
// cadastro e autorização segura. Os landmarks do MediaPipe não identificam a pessoa.
