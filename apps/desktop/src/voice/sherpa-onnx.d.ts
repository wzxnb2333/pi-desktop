declare module 'sherpa-onnx-node' {
  interface Waveform { samples: Float32Array; sampleRate: number; }
  interface Stream { acceptWaveform(audio: Waveform): void; }
  interface RecognizerConfig { featConfig: { sampleRate: number; featureDim: number }; modelConfig: { senseVoice: { model: string; language: string; useInverseTextNormalization: number }; tokens: string; numThreads: number; provider: string; debug: boolean }; }
  interface TtsConfig { model: { kokoro: { model: string; voices: string; tokens: string; dataDir: string; lexicon: string }; numThreads: number; provider: string; debug: boolean }; maxNumSentences: number; }
  interface VadConfig { sileroVad: { model: string; threshold: number; minSpeechDuration: number; minSilenceDuration: number; windowSize: number; maxSpeechDuration: number }; sampleRate: number; numThreads: number; debug: boolean; }
  class OfflineRecognizer { constructor(config: RecognizerConfig); createStream(): Stream; decode(stream: Stream): void; getResult(stream: Stream): { text: string; lang?: string }; }
  class GenerationConfig { constructor(config: { sid: number; speed: number; silenceScale?: number }); }
  class OfflineTts { constructor(config: TtsConfig); numSpeakers: number; sampleRate: number; generate(input: { text: string; generationConfig: GenerationConfig; enableExternalBuffer?: boolean }): Waveform; }
  class Vad { constructor(config: VadConfig, bufferSeconds: number); acceptWaveform(samples: Float32Array): void; isDetected(): boolean; isEmpty(): boolean; front(copy?: boolean): { samples: Float32Array; start: number }; pop(): void; flush(): void; }
  function readWave(path: string): Waveform;
  function writeWave(path: string, audio: Waveform): boolean;
  const sherpa: { OfflineRecognizer: typeof OfflineRecognizer; OfflineTts: typeof OfflineTts; Vad: typeof Vad; GenerationConfig: typeof GenerationConfig; readWave: typeof readWave; writeWave: typeof writeWave; version: string };
  export default sherpa;
}
