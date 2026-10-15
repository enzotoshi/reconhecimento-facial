/** Sessão independente de reconhecimento; modelos e quadros ficam no dispositivo. */
export class RecognitionAdapter {
  #worker;
  #pending = new Map();
  #id = 0;
  #closed = false;

  constructor() {
    if (!globalThis.OffscreenCanvas) throw new Error('Reconhecimento indisponível neste navegador.');
    this.#worker = new Worker(new URL('./recognition-worker.js', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      this.#pending.delete(data.id);
      clearTimeout(pending.timeout);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    this.#worker.onerror = (event) => { event.preventDefault(); this.close(new Error(event.message || 'Falha no reconhecimento.')); };
    this.#worker.onmessageerror = () => this.close(new Error('Falha de comunicação com o reconhecimento.'));
  }

  initialize() {
    return this.#request('init', { modelPath: new URL(`${import.meta.env.BASE_URL}recognition/`, document.baseURI).href }, [], 45000);
  }

  async describe(source) {
    if (this.#closed) throw new Error('Reconhecimento encerrado.');
    const bitmap = await createImageBitmap(source);
    try {
      if (this.#closed) throw new Error('Reconhecimento encerrado.');
      return await this.#request('describe', { bitmap }, [bitmap], 40000);
    } finally { bitmap.close(); }
  }

  #request(type, data, transfer, timeoutMs) {
    if (this.#closed) return Promise.reject(new Error('Reconhecimento encerrado.'));
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const timeout = setTimeout(() => this.close(new Error('O reconhecimento demorou demais.')), timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      try { this.#worker.postMessage({ id, type, ...data }, transfer); }
      catch (error) { this.close(error); }
    });
  }

  close(error = new Error('Reconhecimento encerrado.')) {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker.terminate();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.#pending.clear();
  }
}
