import type { VoiceModelId } from './voice.ts';

export interface VoiceModelAsset { id: VoiceModelId; label: string; folder: string; filename: string; tag: string; bytes: number; sha256: string; required: string[]; }
export const VOICE_MODELS: VoiceModelAsset[] = [
  { id: 'sensevoice', label: 'SenseVoice INT8 · 2024-07-17', folder: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', filename: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2', tag: 'asr-models', bytes: 163002883, sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e', required: ['model.int8.onnx', 'tokens.txt'] },
  { id: 'kokoro', label: 'Kokoro 中文 / English · 1.1', folder: 'kokoro-multi-lang-v1_1', filename: 'kokoro-multi-lang-v1_1.tar.bz2', tag: 'tts-models', bytes: 364816464, sha256: 'a3f4c73d043860e3fd2e5b06f36795eb81de0fc8e8de6df703245edddd87dbad', required: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'espeak-ng-data'] },
  { id: 'silero', label: 'Silero VAD', folder: 'silero-vad', filename: 'silero_vad.onnx', tag: 'asr-models', bytes: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', required: ['silero_vad.onnx'] },
];
export function voiceModel(id: VoiceModelId): VoiceModelAsset { return VOICE_MODELS.find(item => item.id === id)!; }
export function voiceModelUrl(asset: VoiceModelAsset): string { return 'https://github.com/k2-fsa/sherpa-onnx/releases/download/' + asset.tag + '/' + asset.filename; }
