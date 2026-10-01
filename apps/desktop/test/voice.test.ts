import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import sherpa from 'sherpa-onnx-node';
import { mkdtemp } from './fixtures/node-temp.ts';
import { VoiceModels } from '../src/main/voice-models.ts';
import { VoiceEngine, encodePcm } from '../src/voice/engine.ts';
import { voiceModel } from '../src/shared/voice-models.ts';
import { voicePreferencesSchema } from '../src/shared/voice.ts';

const directory = process.env.PI_DESKTOP_VOICE_MODELS || resolve('../../.artifacts/voice-models');
const installed = await access(join(directory, voiceModel('sensevoice').folder, 'model.int8.onnx')).then(() => true, () => false);

test('worklet preserves duration and PCM at 44.1/48 kHz and flushes once without microphone feedback', async () => {
  const source = await readFile('src/renderer/public/voice-capture.js', 'utf8');
  for (const sampleRate of [16000, 44100, 48000]) {
    const chunks: Float32Array[] = []; let flushed = 0;
    class AudioWorkletProcessor { port = { onmessage: (_event: { data: string }) => {}, postMessage: (value: { samples?: Float32Array; flushed?: boolean }) => { if (value.samples) chunks.push(value.samples); if (value.flushed) flushed++; } }; }
    let Constructor: { new(): AudioWorkletProcessor & { process(input: Float32Array[][]): boolean } } | undefined;
    runInNewContext(source, { sampleRate, AudioWorkletProcessor, Float32Array, registerProcessor: (_name: string, value: typeof Constructor) => { Constructor = value; } });
    const worklet = new Constructor!();
    for (let start = 0; start < sampleRate; start += 128) worklet.process([[new Float32Array(Math.min(128, sampleRate - start)).fill(0.25)]]);
    worklet.port.onmessage({ data: 'flush' });
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.length, 0), 16000);
    assert.equal(flushed, 1); assert.ok(chunks.every(chunk => chunk.every(value => Math.abs(value - 0.25) < 0.0001)));
    assert.equal(worklet.process([[new Float32Array(128)]]), false);
  }
  assert.equal(voicePreferencesSchema.parse({}).speaker, 48);
  assert.throws(() => voicePreferencesSchema.parse({ speed: 0 }));
});

test('model ownership, checksum failures, cancellation and crashed staging leave no unowned deletion', { skip: !installed && 'Install pinned models or set PI_DESKTOP_VOICE_MODELS' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-voice-models-')), models = new VoiceModels(root), signal = new AbortController().signal;
  const original = join(directory, 'silero-vad', 'silero_vad.onnx');
  await models.install('silero', original, signal, () => {}); await models.verify('silero', signal, true);
  assert.equal((await models.inspect('silero')).status, 'installed'); assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.pi-voice-stage')), []);
  await writeFile(join(root, 'silero-vad', 'user-notes.txt'), 'PRESERVE'); await assert.rejects(models.remove('silero'), /额外文件/);
  const bytes = await readFile(original); bytes[1000] ^= 1; await writeFile(join(root, 'silero-vad', 'silero_vad.onnx'), bytes);
  await assert.rejects(models.verify('silero', signal, true), /校验失败/);
  // A separate root proves failed imports never replace the previous usable version.
  const failed = join(root, 'failed'), invalid = join(root, 'invalid.onnx'); await writeFile(invalid, bytes);
  const other = new VoiceModels(failed); await assert.rejects(other.install('silero', invalid, signal, () => {}), /校验失败/);
  assert.deepEqual(await readdir(failed), []);
  const controller = new AbortController(); controller.abort(); await assert.rejects(other.install('silero', original, controller.signal, () => {})); assert.deepEqual(await readdir(failed), []);
  const dead = join(failed, '.pi-voice-stage-' + crypto.randomUUID()), unowned = join(failed, '.pi-voice-stage-' + crypto.randomUUID());
  await mkdir(dead); await writeFile(join(dead, 'owner.json'), JSON.stringify({ application: 'Pi Desktop Voice staging', pid: 2147483647 })); await mkdir(unowned);
  await other.recover(); await assert.rejects(access(dead)); await access(unowned);
  await other.install('silero', original, signal, () => {}); await other.remove('silero'); assert.equal((await other.inspect('silero')).status, 'missing');
});

test('real CPU SenseVoice, Silero and Kokoro process fixed Chinese/English audio with network unavailable', { skip: !installed && 'Install pinned models or set PI_DESKTOP_VOICE_MODELS', timeout: 120000 }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED'); };
  try {
    const models = new VoiceModels(directory), engine = new VoiceEngine();
    for (const model of ['sensevoice', 'silero', 'kokoro'] as const) await models.verify(model, new AbortController().signal, true);
    for (const language of ['zh', 'en'] as const) {
      const id = crypto.randomUUID(), audio = sherpa.readWave(join(directory, voiceModel('sensevoice').folder, 'test_wavs', language + '.wav'));
      assert.equal(audio.sampleRate, 16000); engine.run({ kind: 'capture.begin', id, directory, language });
      for (let offset = 0; offset < audio.samples.length; offset += 8000) engine.run({ kind: 'capture.push', id, pcm: encodePcm(audio.samples.subarray(offset, offset + 8000)) });
      const result = engine.run({ kind: 'capture.finish', id });
      assert.match(result.text!, language === 'zh' ? /早上9点.*下午5点/ : /tribal.*boy.*50/i);
      const speech = engine.run({ kind: 'tts', id: crypto.randomUUID(), directory, text: language === 'zh' ? '你好，欢迎使用本地离线语音。' : 'Hello, welcome to local offline speech.', speaker: language === 'zh' ? 48 : 0, speed: 1 });
      const wav = Buffer.from(speech.wav!, 'base64'); assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.ok(speech.seconds! > 1); assert.ok(wav.length > 10000);
    }
    const id = crypto.randomUUID(); engine.run({ kind: 'capture.begin', id, directory, language: 'auto' });
    engine.run({ kind: 'capture.push', id, pcm: encodePcm(new Float32Array(16000)) }); assert.throws(() => engine.run({ kind: 'capture.finish', id }), /未检测到语音/);
    assert.throws(() => engine.run({ kind: 'capture.push', id, pcm: encodePcm(new Float32Array(100)) }), /已失效/);
  } finally { globalThis.fetch = originalFetch; }
});
