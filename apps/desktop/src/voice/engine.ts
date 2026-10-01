import { join } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { voiceModel } from '../shared/voice-models.ts';
import { VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE, type VoiceWorkerRequest, type VoiceWorkerResult } from '../shared/voice.ts';

export function encodePcm(samples: Float32Array): string {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  return bytes.toString('base64');
}
function decodePcm(value: string): Float32Array {
  const bytes = Buffer.from(value, 'base64'); if (bytes.length % 2) throw new Error('录音数据无效');
  const samples = new Float32Array(bytes.length / 2); for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768; return samples;
}
function wave(samples: Float32Array, sampleRate: number): string {
  const pcm = Buffer.from(encodePcm(samples), 'base64'), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

/** Native CPU inference only. The owning utility process is killed for cancellation. */
export class VoiceEngine {
  private recognizer?: InstanceType<typeof sherpa.OfflineRecognizer>;
  private recognizerKey = '';
  private tts?: InstanceType<typeof sherpa.OfflineTts>;
  private ttsDirectory = '';
  private capture?: { id: string; vad: InstanceType<typeof sherpa.Vad>; chunks: Float32Array[]; tail: Float32Array; count: number; heard: boolean };
  run(request: VoiceWorkerRequest, progress: (value: number) => void = () => {}): NonNullable<VoiceWorkerResult['value']> {
    if (request.kind === 'capture.begin') {
      const key = request.directory + '/' + request.language;
      if (key !== this.recognizerKey || !this.recognizer) {
        const model = join(request.directory, voiceModel('sensevoice').folder);
        this.recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: VOICE_SAMPLE_RATE, featureDim: 80 }, modelConfig: { senseVoice: { model: join(model, 'model.int8.onnx'), language: request.language, useInverseTextNormalization: 1 }, tokens: join(model, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: false } });
        this.recognizerKey = key;
      }
      const vad = new sherpa.Vad({ sileroVad: { model: join(request.directory, voiceModel('silero').folder, 'silero_vad.onnx'), threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.9, windowSize: 512, maxSpeechDuration: 30 }, sampleRate: VOICE_SAMPLE_RATE, numThreads: 1, debug: false }, VOICE_MAX_SECONDS + 2);
      this.capture = { id: request.id, vad, chunks: [], tail: new Float32Array(), count: 0, heard: false }; return { seconds: 0, detected: false, ended: false };
    }
    if (request.kind === 'capture.push') {
      const capture = this.capture; if (!capture || capture.id !== request.id) throw new Error('录音会话已失效，请重新开始');
      const samples = decodePcm(request.pcm); if (capture.count + samples.length > VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS) throw new Error('录音已达到两分钟限制，请先识别当前内容');
      capture.chunks.push(samples); capture.count += samples.length;
      const combined = new Float32Array(capture.tail.length + samples.length); combined.set(capture.tail); combined.set(samples, capture.tail.length);
      let position = 0; for (; position + 512 <= combined.length; position += 512) { capture.vad.acceptWaveform(combined.subarray(position, position + 512)); capture.heard ||= capture.vad.isDetected(); }
      capture.tail = combined.slice(position);
      return { seconds: capture.count / VOICE_SAMPLE_RATE, detected: capture.vad.isDetected(), ended: !capture.vad.isEmpty() };
    }
    if (request.kind === 'capture.finish') {
      const capture = this.capture; if (!capture || capture.id !== request.id || !this.recognizer) throw new Error('录音会话已失效，请重新开始');
      this.capture = undefined;
      if (capture.tail.length) { const padded = new Float32Array(512); padded.set(capture.tail); capture.vad.acceptWaveform(padded); }
      capture.vad.flush(); if (!capture.heard && capture.vad.isEmpty()) throw new Error('未检测到语音，请检查麦克风后重试');
      const samples = new Float32Array(capture.count); let offset = 0; for (const chunk of capture.chunks) { samples.set(chunk, offset); offset += chunk.length; }
      progress(0.2); const stream = this.recognizer.createStream(); stream.acceptWaveform({ samples, sampleRate: VOICE_SAMPLE_RATE }); this.recognizer.decode(stream);
      const text = this.recognizer.getResult(stream).text.replace(/<\|[^|]+\|>/g, '').trim(); if (!text) throw new Error('没有识别到文字，请重新录音');
      progress(1); return { text, seconds: capture.count / VOICE_SAMPLE_RATE };
    }
    if (!this.tts || this.ttsDirectory !== request.directory) {
      const model = join(request.directory, voiceModel('kokoro').folder);
      this.tts = new sherpa.OfflineTts({ model: { kokoro: { model: join(model, 'model.onnx'), voices: join(model, 'voices.bin'), tokens: join(model, 'tokens.txt'), dataDir: join(model, 'espeak-ng-data'), lexicon: join(model, 'lexicon-us-en.txt') + ',' + join(model, 'lexicon-zh.txt') }, numThreads: 2, provider: 'cpu', debug: false }, maxNumSentences: 1 });
      this.ttsDirectory = request.directory;
    }
    if (request.speaker >= this.tts.numSpeakers) throw new Error('所选音色不属于此模型');
    // Electron's V8 sandbox prohibits native external ArrayBuffers; ask the binding for a copy.
    progress(0.2); const result = this.tts.generate({ text: request.text, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ sid: request.speaker, speed: request.speed, silenceScale: 0.2 }) });
    if (result.samples.length / result.sampleRate > 600) throw new Error('朗读内容过长，请选择较短文本');
    progress(1); return { wav: wave(result.samples, result.sampleRate), seconds: result.samples.length / result.sampleRate };
  }
}
