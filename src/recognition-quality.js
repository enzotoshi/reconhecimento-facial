/** Filtros de captura, não uma estimativa de identidade ou vivacidade. */
export function assessFaceQuality({ score, width, height, brightness, contrast }) {
  if (![score, width, height, brightness, contrast].every(Number.isFinite)) return false;
  return score >= 0.75 && width >= 80 && height >= 80 && brightness >= 30 && brightness <= 225 && contrast >= 15;
}

export function measureFaceQuality(canvas, face) {
  const box = face.detection.box;
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(canvas.width - x, Math.floor(box.width)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.floor(box.height)));
  const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data;
  let sum = 0, squared = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    sum += gray; squared += gray * gray;
  }
  const brightness = sum / count;
  return assessFaceQuality({ score: face.detection.score, width, height, brightness, contrast: Math.sqrt(Math.max(0, squared / count - brightness ** 2)) });
}
