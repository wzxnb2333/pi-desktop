/** Browser audio exists only in memory. Every cancellation releases the physical input device. */
export class VoiceRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private closed = false;
  private flushed?: () => void;
  constructor(private readonly onChunk: (pcm: string) => void, private readonly onDisconnect: () => void) {}
  async start(deviceId: string): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false });
    this.stream = stream;
    if (this.closed) { this.dispose(); return; }
    stream.getAudioTracks().forEach(track => { track.onended = () => { if (!this.closed) this.onDisconnect(); }; });
    const context = new AudioContext(); this.context = context;
    try {
      await context.audioWorklet.addModule(new URL('./voice-capture.js', document.baseURI).href);
      if (this.closed) { this.dispose(); return; }
      this.node = new AudioWorkletNode(context, 'pi-voice-capture');
      this.node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; flushed?: boolean }>) => {
        if (event.data.flushed) { this.flushed?.(); return; }
        if (!event.data.samples) return;
        const samples = event.data.samples, bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
        for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
        this.onChunk(btoa(String.fromCharCode(...bytes)));
      };
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.node); this.node.connect(context.destination); // Processor emits silence, so no microphone feedback.
      await context.resume();
    } catch (error) { this.dispose(); throw error; }
  }
  async stop(): Promise<void> {
    if (!this.node || this.closed) { this.dispose(); return; }
    try { await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('录音会话已失效，请重新开始')), 3000);
      this.flushed = () => { clearTimeout(timer); resolve(); };
      this.node!.port.postMessage('flush');
    }); } finally { this.dispose(); }
  }
  dispose(): void {
    this.closed = true; this.flushed?.(); this.flushed = undefined;
    this.source?.disconnect(); this.node?.disconnect(); this.node?.port.close();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.source = undefined; this.node = undefined; this.stream = undefined; this.context = undefined;
  }
}

export class VoicePlayback {
  private context = new AudioContext();
  private source?: AudioBufferSourceNode;
  private finish?: () => void;
  private closed = false;
  async play(wav: string): Promise<void> {
    if (this.closed) return;
    const bytes = Uint8Array.from(atob(wav), character => character.charCodeAt(0));
    const buffer = await this.context.decodeAudioData(bytes.buffer);
    if (this.closed) return;
    await this.context.resume();
    if (this.closed) return;
    this.source = this.context.createBufferSource(); this.source.buffer = buffer; this.source.connect(this.context.destination);
    await new Promise<void>(resolve => { this.finish = resolve; this.source!.onended = () => resolve(); this.source!.start(); });
    this.dispose();
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.finish?.(); this.source?.stop(); this.source?.disconnect(); void this.context.close().catch(() => {}); }
}
