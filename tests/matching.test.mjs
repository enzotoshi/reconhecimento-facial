import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFace, MatchStability } from '../src/face-matching.js';

const vector = (first = 0) => [first, ...Array(127).fill(0)];
const reference = (id, first) => ({ id, name: id, descriptor: vector(first) });

test('correspondência exige proximidade; nunca escolhe um desconhecido só por ser o mais próximo', () => {
  assert.equal(matchFace(vector(), [reference('Ana', 0.8)]).status, 'unknown');
  assert.equal(matchFace(vector(), [reference('Ana', 0.2), reference('Bia', 0.9)]).name, 'Ana');
  assert.equal(matchFace(vector(), []).status, 'unknown');
});

test('cadastros próximos demais são inconclusivos, mesmo abaixo do limite', () => {
  assert.equal(matchFace(vector(), [reference('Ana', 0.2), reference('Bia', 0.22)]).status, 'ambiguous');
  assert.equal(matchFace(vector(), [reference('Ana', 0.2), reference('Bia', 0.2)]).status, 'ambiguous');
});

test('descritores inválidos não produzem correspondências', () => {
  assert.equal(matchFace([0, 1], [reference('Ana', 0)]).status, 'unknown');
  const corrupt = vector(); corrupt[1] = NaN;
  assert.equal(matchFace(corrupt, [reference('Ana', 0)]).status, 'unknown');
  assert.equal(matchFace(vector(), [{ ...reference('Ana', 0), descriptor: corrupt }]).status, 'unknown');
});

test('amostras são agrupadas por pessoa e uma foto isolada não vence referências incompatíveis', () => {
  const ana = { id: 'Ana', name: 'Ana', descriptors: [vector(0.2), vector(0.25), vector(0.7)] };
  assert.equal(matchFace(vector(), [ana]).name, 'Ana');
  assert.equal(matchFace(vector(), [{ ...ana, descriptors: [vector(0.1), vector(0.9)] }]).status, 'unknown');
  assert.equal(matchFace(vector(), [ana, { id: 'Bia', name: 'Bia', descriptors: [vector(0.24), vector(0.26)] }]).status, 'ambiguous');
});

test('consenso tolera inferência lenta mas expira após uma pausa longa', () => {
  const stability = new MatchStability();
  const candidate = { status: 'candidate', id: 'Ana', name: 'Ana' };
  stability.update(candidate, 0);
  stability.update(candidate, 4000);
  assert.equal(stability.update(candidate, 8000).status, 'matched');
  assert.equal(stability.update(candidate, 20000).status, 'checking');
});

test('nome só é exibido após três leituras consecutivas; desconhecido e mudança reiniciam a sequência', () => {
  const stability = new MatchStability();
  const ana = { status: 'candidate', id: '1', name: 'Ana' };
  const bia = { status: 'candidate', id: '2', name: 'Bia' };
  assert.equal(stability.update(ana).status, 'checking');
  assert.equal(stability.update(ana).status, 'checking');
  assert.equal(stability.update(ana).name, 'Ana');
  assert.equal(stability.update(bia).status, 'checking');
  stability.update({ status: 'unknown' });
  assert.equal(stability.update(ana).status, 'checking');
  stability.reset();
  assert.equal(stability.update(ana).status, 'checking');
});
