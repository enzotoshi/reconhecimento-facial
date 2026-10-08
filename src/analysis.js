/** Agenda quadros para um detector real, sem acoplar análise à captura. */
export class FrameAnalysis {
  #generation = 0;
  #cancel = null;
  #inFlight = null;

  constructor(detector, { onError = () => {}, onResult = () => {}, maxFps = 0 } = {}) {
    this.detector = detector;
    this.onError = onError;
    this.onResult = onResult;
    this.minInterval = maxFps > 0 ? 1000 / maxFps : 0;
  }

  start(video, canvas) {
    this.stop();
    if (!this.detector) return; // Nenhuma análise ou resultado simulado.
    const generation = this.#generation;
    const context = canvas.getContext('2d');
    const isCurrent = () => generation === this.#generation;
    let lastTimestamp = -Infinity;
    let lastVideoTime = -1;

    const schedule = () => {
      if (!isCurrent()) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        const id = video.requestVideoFrameCallback(tick);
        this.#cancel = () => video.cancelVideoFrameCallback(id);
      } else {
        const id = requestAnimationFrame(tick);
        this.#cancel = () => cancelAnimationFrame(id);
      }
    };

    const tick = async (timestamp) => {
      if (!isCurrent()) return;
      this.#cancel = null;
      try {
        if (timestamp - lastTimestamp < this.minInterval || (typeof video.currentTime === 'number' && video.currentTime === lastVideoTime)) {
          schedule();
          return;
        }
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          // Um reinício também aguarda a inferência da sessão anterior terminar.
          if (this.#inFlight) await this.#inFlight.catch(() => {});
          if (!isCurrent()) return;
          lastTimestamp = timestamp;
          lastVideoTime = video.currentTime;
          const pending = Promise.resolve().then(() => isCurrent() ? this.detector.detect(video, timestamp) : null);
          this.#inFlight = pending;
          let result;
          try {
            result = await pending;
          } finally {
            if (this.#inFlight === pending) this.#inFlight = null;
          }
          if (!isCurrent()) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.clearRect(0, 0, canvas.width, canvas.height);
          this.detector.draw?.(result, context, { width: canvas.width, height: canvas.height });
          this.onResult(result);
        }
        // Agende somente após a análise terminar: sem sobreposição de chamadas.
        schedule();
      } catch (error) {
        if (!isCurrent()) return;
        this.stop();
        context?.clearRect(0, 0, canvas.width, canvas.height);
        this.onError(error);
      }
    };
    schedule();
  }

  stop() {
    ++this.#generation;
    this.#cancel?.();
    this.#cancel = null;
    // Uma inferência em andamento pode terminar, mas não desenha nem agenda quadros.
  }
}
