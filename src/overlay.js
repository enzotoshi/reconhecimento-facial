/** Renderiza somente landmarks reais em coordenadas nativas do vídeo. */
export function drawFaceLandmarks(result, context, { width, height }, connections) {
  context.strokeStyle = '#63e6c7';
  context.lineWidth = Math.max(1.5, width / 600);
  context.lineJoin = 'round';
  for (const face of result.faceLandmarks || []) {
    context.beginPath();
    for (const { start, end } of connections) {
      const from = face[start];
      const to = face[end];
      if (!from || !to) continue;
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
    }
    context.stroke();
  }
}

export function detectionState(result) {
  const count = result.faceLandmarks?.length || 0;
  return count === 0 ? 'absent' : count === 1 ? 'single' : 'multiple';
}
