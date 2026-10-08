import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraCapture } from '../src/camera.js';
import { FrameAnalysis } from '../src/analysis.js';
import { detectionState } from '../src/overlay.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function mockCamera(getUserMedia) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  globalThis.isSecureContext = true;
}

test('cancelar uma permissão pendente libera o stream recebido depois', async () => {
  const request = deferred();
  let stopped = 0;
  mockCamera(() => request.promise);
  const camera = new CameraCapture();
  const pending = camera.start();
  camera.stop();
  request.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  assert.equal(await pending, null);
  assert.equal(stopped, 1);
  assert.equal(camera.stream, null);
});

test('captura prefere frontal, não pede áudio e encerra todas as faixas', async () => {
  let constraints;
  let stopped = 0;
  const stream = { getTracks: () => [1, 2].map(() => ({ stop() { stopped++; } })) };
  mockCamera(async (options) => { constraints = options; return stream; });
  const camera = new CameraCapture();
  await camera.start();
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, 'user');
  camera.stop();
  assert.equal(stopped, 2);
  assert.equal(camera.stream, null);
});

function surface() {
  let nextId = 0;
  let draws = 0;
  const callbacks = new Map();
  const video = {
    readyState: 2, videoWidth: 640, videoHeight: 480,
    requestVideoFrameCallback(callback) { callbacks.set(++nextId, callback); return nextId; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); },
  };
  const canvas = { getContext: () => ({ clearRect() {} }) };
  return { video, canvas, callbacks, draw() { draws++; }, get draws() { return draws; }, tick() {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    return callback(100);
  } };
}

test('sem detector real não agenda quadros', () => {
  const ui = surface();
  new FrameAnalysis(null).start(ui.video, ui.canvas);
  assert.equal(ui.callbacks.size, 0);
});

test('reiniciar cancela o callback anterior; parar cancela o loop', () => {
  const ui = surface();
  const analysis = new FrameAnalysis({ detect() {} });
  analysis.start(ui.video, ui.canvas);
  analysis.start(ui.video, ui.canvas);
  assert.equal(ui.callbacks.size, 1);
  analysis.stop();
  assert.equal(ui.callbacks.size, 0);
});

test('reinício aguarda inferência antiga e descarta sua sobreposição', async () => {
  const ui = surface();
  const first = deferred();
  let calls = 0;
  const analysis = new FrameAnalysis({ detect() { return ++calls === 1 ? first.promise : {}; }, draw: ui.draw });
  analysis.start(ui.video, ui.canvas);
  const oldTick = ui.tick();
  await Promise.resolve();
  assert.equal(calls, 1);
  analysis.start(ui.video, ui.canvas);
  const newTick = ui.tick();
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve({});
  await Promise.all([oldTick, newTick]);
  assert.equal(calls, 2);
  assert.equal(ui.draws, 1);
  assert.equal(ui.callbacks.size, 1);
  assert.equal(ui.canvas.width, 640);
  analysis.stop();
});

test('parar durante a inferência impede desenho e novo agendamento', async () => {
  const ui = surface();
  const request = deferred();
  let results = 0;
  const analysis = new FrameAnalysis({ detect: () => request.promise, draw: ui.draw }, { onResult() { results++; } });
  analysis.start(ui.video, ui.canvas);
  const pending = ui.tick();
  await Promise.resolve();
  analysis.stop();
  request.resolve({});
  await pending;
  assert.equal(ui.draws, 0);
  assert.equal(ui.callbacks.size, 0);
  assert.equal(results, 0);
});

test('resultado diferencia ausência, um rosto e múltiplos rostos', () => {
  assert.equal(detectionState({ faceLandmarks: [] }), 'absent');
  assert.equal(detectionState({ faceLandmarks: [[]] }), 'single');
  assert.equal(detectionState({ faceLandmarks: [[], []] }), 'multiple');
});

test('erro de análise encerra o loop e é informado uma vez', async () => {
  const ui = surface();
  let errors = 0;
  const analysis = new FrameAnalysis({ detect() { throw new Error('modelo indisponível'); } }, { onError() { errors++; } });
  analysis.start(ui.video, ui.canvas);
  await ui.tick();
  assert.equal(errors, 1);
  assert.equal(ui.callbacks.size, 0);
});
