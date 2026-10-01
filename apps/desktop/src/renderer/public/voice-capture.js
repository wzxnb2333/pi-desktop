// Runs off the UI thread. Average each input sample interval into 16 kHz PCM.
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(8000);
    this.length = 0;
    this.weight = 0;
    this.sum = 0;
    this.closed = false;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.closed = true;
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({ samples }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    if (this.closed) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    const ratio = sampleRate / 16000;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, ratio - this.weight);
        this.sum += value * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= ratio - 1e-8) {
          this.buffer[this.length++] = this.sum / ratio;
          this.sum = 0;
          this.weight = 0;
          if (this.length === this.buffer.length) this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('pi-voice-capture', VoiceCaptureProcessor);
