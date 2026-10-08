import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker;
let lastTimestamp = -1;

self.onmessage = async ({ data }) => {
  const { id, type, bitmap } = data;
  try {
    if (type === 'init') {
      // O worker é um módulo ES: carregue também o runtime WASM em formato módulo.
      const vision = await FilesetResolver.forVisionTasks(data.wasmRoot, true);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.modelPath, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      self.postMessage({ id, result: { connections: FaceLandmarker.FACE_LANDMARKS_CONTOURS } });
    } else if (type === 'detect') {
      if (!landmarker) throw new Error('Modelo não inicializado.');
      lastTimestamp = Math.max(data.timestamp, lastTimestamp + 1);
      const result = landmarker.detectForVideo(bitmap, lastTimestamp);
      self.postMessage({ id, result: { faceLandmarks: result.faceLandmarks } });
    }
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Falha no MediaPipe.' });
  } finally {
    bitmap?.close();
  }
};
