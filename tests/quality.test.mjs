import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFaceQuality } from '../src/recognition-quality.js';

test('imagem pequena, escura, estourada ou sem contraste não pode identificar alguém', () => {
  const good = { score: 0.95, width: 140, height: 180, brightness: 125, contrast: 40 };
  assert.equal(assessFaceQuality(good), true);
  for (const invalid of [{ width: 40 }, { brightness: 10 }, { brightness: 250 }, { contrast: 5 }, { score: 0.5 }, { brightness: NaN }]) {
    assert.equal(assessFaceQuality({ ...good, ...invalid }), false);
  }
});
