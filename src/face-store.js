/** Cadastro local de nome + foto. Não armazena templates de reconhecimento. */
export class FaceStore {
  #database = null;

  async #open() {
    if (!globalThis.indexedDB) throw new Error('STORAGE_UNAVAILABLE');
    if (!this.#database) {
      this.#database = new Promise((resolve, reject) => {
        const request = indexedDB.open('acesso-facial', 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('faces', { keyPath: 'id' });
          store.createIndex('nameKey', 'nameKey', { unique: true });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('STORAGE_BLOCKED'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => { database.close(); this.#database = null; };
          resolve(database);
        };
      }).catch((error) => { this.#database = null; throw error; });
    }
    return this.#database;
  }

  async #request(mode, action) {
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('faces', mode);
      const request = action(transaction.objectStore('faces'));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || request.error || new Error('STORAGE_UNAVAILABLE'));
    });
  }

  async list() {
    const records = await this.#request('readonly', (store) => store.getAll());
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  async add(name, photo) {
    const normalized = normalizeName(name);
    if (!(photo instanceof Blob) || !photo.size) throw new Error('PHOTO_REQUIRED');
    return this.#request('readwrite', (store) => store.add({
      id: crypto.randomUUID(), name: normalized.name, nameKey: normalized.key,
      photo, createdAt: Date.now(),
    }));
  }

  async delete(id) {
    return this.#request('readwrite', (store) => store.delete(id));
  }

  async addPhoto(id, photo) {
    if (!(photo instanceof Blob) || !photo.size) throw new Error('PHOTO_REQUIRED');
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('faces', 'readwrite');
      const store = transaction.objectStore('faces');
      const request = store.get(id);
      let failure;
      request.onsuccess = () => {
        const record = request.result;
        if (!record) { failure = new Error('RECORD_MISSING'); transaction.abort(); return; }
        const photos = record.photos?.length ? record.photos : [record.photo];
        if (photos.length >= 5) { failure = new Error('PHOTO_LIMIT'); transaction.abort(); return; }
        store.put({ ...record, photos: [...photos, photo] });
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure || transaction.error || request.error);
    });
  }
}

export function normalizeName(value) {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new Error('INVALID_NAME');
  return { name, key: name.toLocaleLowerCase('pt-BR') };
}
