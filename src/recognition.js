import { FaceStore } from './face-store.js';
import { RecognitionAdapter } from './recognition-adapter.js';
import { matchFace, MatchStability, validDescriptor } from './face-matching.js';

const $ = (id) => document.getElementById(id);

export class LiveRecognition {
  #store = new FaceStore();
  #getSession;
  #active = false;
  #generation = 0;
  #adapter = null;
  #references = [];
  #ready = false;
  #busy = false;
  #lastAttempt = -Infinity;
  #faceCount = 0;
  #presenceGeneration = 0;
  #staleTimer = null;
  #stability = new MatchStability();
  #viewKey = '';

  constructor(getSession) { this.#getSession = getSession; this.#view('idle'); }

  #view(state, name = '') {
    const key = `${state}:${name}`;
    if (this.#viewKey === key) return;
    this.#viewKey = key;
    const copy = {
      idle: ['Aguardando câmera', 'Inicie a câmera para comparar com os rostos cadastrados.'],
      loading: ['Preparando reconhecimento', 'Carregando o modelo e analisando as fotos cadastradas neste navegador.'],
      empty: ['Acesso negado / desconhecido', 'Não há rostos cadastrados neste navegador e endereço. Cadastre uma pessoa antes de comparar.'],
      invalid: ['Acesso negado / fotos inválidas', 'Não foi possível extrair um rosto com qualidade das fotos cadastradas. Adicione fotos nítidas, de frente e bem iluminadas.'],
      ready: ['Reconhecimento pronto', 'Mantenha apenas um rosto visível para comparar.'],
      absent: ['Acesso negado / nenhum rosto', 'A comparação aguarda um rosto visível.'],
      multiple: ['Acesso negado / múltiplos rostos', 'Mantenha apenas uma pessoa visível para reconhecer.'],
      checking: ['Comparando rosto', 'Aguarde três leituras consistentes antes de exibir um nome.'],
      unknown: ['Acesso negado / desconhecido', 'Nenhuma pessoa cadastrada atingiu o critério de correspondência.'],
      quality: ['Acesso negado / imagem inadequada', 'Aproxime o rosto, mantenha-o de frente e melhore a iluminação. Nenhum nome será exibido sem uma captura adequada.'],
      ambiguous: ['Acesso negado / inconclusivo', 'Há cadastros muito semelhantes. Ajuste a posição ou adicione boas fotos às pessoas cadastradas.'],
      matched: ['Correspondência encontrada', 'O rosto corresponde visualmente a um cadastro em três leituras consecutivas.'],
      error: ['Acesso negado / reconhecimento indisponível', 'Pare e reinicie a câmera para tentar novamente. A detecção e os cadastros continuam disponíveis.'],
    };
    const [title, detail] = copy[state];
    $('recognition-panel').dataset.state = state;
    $('recognition-title').textContent = title;
    $('recognition-detail').textContent = detail;
    $('recognized-name').textContent = state === 'matched' ? name : '';
    $('recognized-name').hidden = state !== 'matched';
    $('identity-result').textContent = state === 'matched' ? name : title;
  }

  start() { this.#active = true; this.refresh(); }

  stop(view = 'idle') {
    this.#active = false;
    ++this.#generation;
    this.#adapter?.close();
    this.#adapter = null;
    this.#references = [];
    this.#ready = this.#busy = false;
    this.#faceCount = 0;
    clearTimeout(this.#staleTimer);
    this.#stability.reset();
    this.#view(view);
    $('recognition-references').textContent = '';
  }

  async refresh() {
    if (!this.#active) return;
    const session = this.#getSession();
    if (!session) return;
    const generation = ++this.#generation;
    const current = () => this.#active && generation === this.#generation && session.isCurrent();
    this.#adapter?.close();
    this.#adapter = null;
    this.#references = [];
    this.#ready = this.#busy = false;
    this.#lastAttempt = -Infinity;
    this.#stability.reset();
    clearTimeout(this.#staleTimer);
    this.#view('loading');
    $('recognition-references').textContent = '';
    try {
      const records = await this.#store.list();
      if (!current()) return;
      if (!records.length) { this.#view('empty'); return; }
      const adapter = new RecognitionAdapter();
      this.#adapter = adapter;
      await adapter.initialize();
      if (!current()) return;
      let skipped = 0;
      for (const record of records) {
        const descriptors = [];
        for (const photo of record.photos?.length ? record.photos : [record.photo]) {
          const faces = await adapter.describe(photo);
          if (!current()) return;
          if (faces.length === 1 && faces[0].quality && validDescriptor(faces[0].descriptor)) descriptors.push(faces[0].descriptor);
          else skipped++;
        }
        if (descriptors.length) this.#references.push({ id: record.id, name: record.name, descriptors });
      }
      $('recognition-references').textContent = `${this.#references.length} cadastro(s) disponível(is)` + (skipped ? ` · ${skipped} foto(s) precisa(m) ser refeita(s).` : '.' );
      if (!this.#references.length) { adapter.close(); this.#view('invalid'); return; }
      this.#ready = true;
      this.#view('ready');
    } catch (error) {
      if (!current()) return;
      console.error('Falha ao preparar reconhecimento:', error);
      this.#adapter?.close();
      this.#view('error');
    }
  }

  observe(result) {
    this.#faceCount = result.faceLandmarks?.length || 0;
    if (this.#faceCount !== 1) {
      ++this.#presenceGeneration;
      this.#stability.reset();
      clearTimeout(this.#staleTimer);
      if (this.#ready) this.#view(this.#faceCount ? 'multiple' : 'absent');
      return;
    }
    if (!this.#active || !this.#ready || this.#busy || performance.now() - this.#lastAttempt < 500) return;
    this.#compare();
  }

  async #compare() {
    const session = this.#getSession();
    if (!session) return;
    const generation = this.#generation;
    const presence = this.#presenceGeneration;
    const current = () => generation === this.#generation && session.isCurrent();
    this.#busy = true;
    this.#lastAttempt = performance.now();
    try {
      const faces = await this.#adapter.describe(session.video);
      if (!current() || this.#faceCount !== 1 || presence !== this.#presenceGeneration) return;
      const usable = faces.length === 1 && faces[0].quality;
      const result = usable ? this.#stability.update(matchFace(faces[0].descriptor, this.#references)) : { status: faces.length > 1 ? 'multiple' : 'quality' };
      if (!usable) this.#stability.reset();
      this.#view(result.status, result.name);
      clearTimeout(this.#staleTimer);
      // Um nome não permanece visível se a inferência ou o vídeo deixarem de atualizar.
      this.#staleTimer = setTimeout(() => {
        if (!current()) return;
        // Oculta o nome vencido, mas uma CPU lenta não reinicia a sequência válida.
        if (result.status === 'matched') this.#view('checking');
      }, 3000);
    } catch (error) {
      if (!current()) return;
      console.error('Falha ao comparar rosto:', error);
      this.#ready = false;
      this.#adapter?.close();
      this.#view('error');
    } finally { if (current()) this.#busy = false; }
  }
}
