import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { include: ['@mediapipe/tasks-vision', '@vladmandic/face-api'] },
  worker: { format: 'es' },
});
