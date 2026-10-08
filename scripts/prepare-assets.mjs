import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const target = new URL('public/mediapipe/', root);
await mkdir(target, { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('wasm/', target), { recursive: true });

// Modelo oficial, revisão 1. Não há download de modelos durante a captura.
const source = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const model = new URL('face_landmarker.task', target);
const expectedHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const valid = (bytes) => createHash('sha256').update(bytes).digest('hex') === expectedHash;
let bytes;
try { bytes = await readFile(model); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!bytes || !valid(bytes)) {
  console.log('Baixando o modelo oficial Face Landmarker…');
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Falha ao baixar o modelo: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('O modelo baixado falhou na verificação SHA-256.');
  await writeFile(model, bytes);
}
console.log(`Modelo local validado: ${bytes.length} bytes.`);
console.log('Modelo e WASM preparados em public/mediapipe/.');
