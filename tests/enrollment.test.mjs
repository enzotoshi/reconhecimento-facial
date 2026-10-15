import test from 'node:test';
import assert from 'node:assert/strict';
import { faceBounds } from '../src/enrollment.js';
import { normalizeName } from '../src/face-store.js';

test('nomes equivalentes produzem a mesma chave, preservando o nome de exibição', () => {
  assert.deepEqual(normalizeName('  Ana   Silva  '), { name: 'Ana Silva', key: 'ana silva' });
  assert.equal(normalizeName('ANA SILVA').key, normalizeName('Ana Silva').key);
  assert.throws(() => normalizeName('  '), /INVALID_NAME/);
  assert.throws(() => normalizeName('a'.repeat(81)), /INVALID_NAME/);
});

test('recorte do rosto inclui margem e respeita limites do quadro', () => {
  const bounds = faceBounds([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], 100, 200);
  assert.deepEqual(bounds, { x: 5, y: 10, width: 90, height: 180 });
  const edge = faceBounds([{ x: -0.1, y: 0 }, { x: 1.1, y: 1 }], 100, 200);
  assert.deepEqual(edge, { x: 0, y: 0, width: 100, height: 200 });
  assert.throws(() => faceBounds([], 100, 200), /INVALID_FACE/);
  assert.throws(() => faceBounds([{ x: NaN, y: 0.1 }], 100, 200), /INVALID_FACE/);
});
