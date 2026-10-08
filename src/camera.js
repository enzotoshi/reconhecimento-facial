export class CameraCapture {
  #stream = null;
  #generation = 0;

  get stream() { return this.#stream; }

  async start(deviceId) {
    this.stop();
    const generation = this.#generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('CAMERA_UNSUPPORTED');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'user' } }),
        width: { ideal: 1280 }, height: { ideal: 960 },
      },
    });
    // getUserMedia não pode ser cancelado: libere uma resposta que chegou após parar.
    if (generation !== this.#generation) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    this.#stream = stream;
    return stream;
  }

  stop() {
    ++this.#generation;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }

  async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput' && device.deviceId);
  }
}
