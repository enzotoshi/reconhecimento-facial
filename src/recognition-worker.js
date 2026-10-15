import * as faceapi from '@vladmandic/face-api';
import { measureFaceQuality } from './recognition-quality.js';

// FaceAPI usa canvases internamente. Aqui eles existem somente dentro deste worker.
faceapi.env.setEnv({
  Canvas: OffscreenCanvas,
  CanvasRenderingContext2D: new OffscreenCanvas(1, 1).getContext('2d').constructor,
  Image: ImageBitmap, ImageData, Video: class {},
  createCanvasElement: () => new OffscreenCanvas(1, 1),
  createImageElement: () => { throw new Error('Use ImageBitmap no worker.'); },
  createVideoElement: () => { throw new Error('Use ImageBitmap no worker.'); },
  fetch: self.fetch.bind(self),
  readFile: () => { throw new Error('Arquivos locais devem ser servidos por HTTP.'); },
});

let initialized = false;
let queue = Promise.resolve();

async function describeCanvas(canvas) {
  const run = () => faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.7, maxResults: 2 }))
    .withFaceLandmarks().withFaceDescriptors();
  try { return await run(); }
  catch (error) {
    if (faceapi.tf.getBackend() !== 'webgl') throw error;
    // Alguns dispositivos aceitam WebGL, mas falham ao executar a rede.
    await faceapi.tf.setBackend('cpu');
    await faceapi.tf.ready();
    return run();
  }
}

async function handle({ id, type, bitmap, modelPath }) {
  try {
    if (type === 'init') {
      try {
        if (!(await faceapi.tf.setBackend('webgl'))) throw new Error('GPU indisponível');
      } catch { await faceapi.tf.setBackend('cpu'); }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);
      initialized = true;
      self.postMessage({ id, result: true });
    } else if (type === 'describe') {
      if (!initialized) throw new Error('Reconhecimento não inicializado.');
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const faces = await describeCanvas(canvas);
      self.postMessage({ id, result: faces.map((face) => ({
        descriptor: Array.from(face.descriptor), quality: measureFaceQuality(canvas, face),
      })) });
      canvas.width = canvas.height = 1;
    }
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Não foi possível comparar os rostos.' });
  } finally {
    bitmap?.close();
  }
}

// Toda inferência é serializada, inclusive a preparação das fotos de referência.
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
