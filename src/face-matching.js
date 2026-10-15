// Distância euclidiana, não probabilidade. Valores precisam de calibração em uso real.
export const MATCH_THRESHOLD = 0.5;
export const MATCH_MARGIN = 0.07;

export function validDescriptor(descriptor) {
  return descriptor?.length === 128 && Array.from(descriptor).every(Number.isFinite);
}

export function matchFace(query, references) {
  if (!validDescriptor(query)) return { status: 'unknown' };
  // Agrupe fotos pela pessoa: múltiplas amostras não viram candidatos concorrentes.
  const ranked = references.map((reference) => {
    const descriptors = reference.descriptors || [reference.descriptor];
    const distances = descriptors.filter(validDescriptor).map((descriptor) =>
      Math.sqrt(query.reduce((sum, value, index) => sum + (value - descriptor[index]) ** 2, 0)),
    ).sort((a, b) => a - b);
    // Quando há várias fotos, duas referências precisam apoiar a decisão.
    const supporting = distances.slice(0, 2);
    return { id: reference.id, name: reference.name,
      distance: supporting.length && !(supporting.length === 2 && supporting[1] > 0.55)
        ? supporting.reduce((sum, distance) => sum + distance, 0) / supporting.length : Infinity,
    };
  }).filter((reference) => Number.isFinite(reference.distance)).sort((a, b) => a.distance - b.distance);
  const [best, second] = ranked;
  if (!best || best.distance > MATCH_THRESHOLD) return { status: 'unknown' };
  if (second && second.distance - best.distance < MATCH_MARGIN) return { status: 'ambiguous' };
  return { status: 'candidate', ...best };
}

export class MatchStability {
  #id = null;
  #count = 0;
  #lastAt = -Infinity;

  reset() { this.#id = null; this.#count = 0; this.#lastAt = -Infinity; }

  update(result, now = performance.now()) {
    if (result.status !== 'candidate') { this.reset(); return result; }
    if (now - this.#lastAt > 10000) this.reset();
    this.#lastAt = now;
    this.#count = this.#id === result.id ? this.#count + 1 : 1;
    this.#id = result.id;
    return this.#count >= 3 ? { ...result, status: 'matched' } : { status: 'checking' };
  }
}
