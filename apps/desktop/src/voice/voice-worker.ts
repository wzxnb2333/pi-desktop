import { VoiceEngine } from './engine.ts';
import { voiceWorkerRequestSchema } from '../shared/voice.ts';

const engine = new VoiceEngine();
if (!process.parentPort) throw new Error('Voice worker requires a utility process');
process.parentPort.on('message', event => {
  const parsed = voiceWorkerRequestSchema.safeParse(event.data); if (!parsed.success) return;
  const request = parsed.data;
  try { const value = engine.run(request, progress => process.parentPort.postMessage({ id: request.id, progress })); process.parentPort.postMessage({ id: request.id, done: true, value }); }
  catch (reason) { process.parentPort.postMessage({ id: request.id, done: true, error: reason instanceof Error ? reason.message : String(reason) }); }
});
