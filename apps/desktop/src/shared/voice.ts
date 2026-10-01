import { z } from 'zod';

export const voicePreferencesSchema = z.object({
  modelDirectory: z.string().max(3000).default(''), deviceId: z.string().max(500).default(''),
  language: z.enum(['auto', 'zh', 'en']).default('auto'), speaker: z.number().int().min(0).max(102).default(48),
  speed: z.number().min(0.5).max(2).default(1),
}).strict();
export const voiceModelIdSchema = z.enum(['sensevoice', 'kokoro', 'silero']);
export type VoiceModelId = z.infer<typeof voiceModelIdSchema>;
export type VoicePreferences = z.infer<typeof voicePreferencesSchema>;
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_SECONDS = 120;
export const voiceRequests = [
  z.object({ op: z.literal('voice.status') }).strict(),
  z.object({ op: z.literal('voice.directory') }).strict(),
  z.object({ op: z.literal('voice.model'), id: z.uuid(), model: voiceModelIdSchema, action: z.enum(['download', 'import', 'remove', 'verify']) }).strict(),
  z.object({ op: z.literal('voice.capture.begin'), threadId: z.string(), id: z.uuid(), language: voicePreferencesSchema.shape.language }).strict(),
  z.object({ op: z.literal('voice.capture.push'), threadId: z.string(), id: z.uuid(), pcm: z.string().min(4).max(128000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),
  z.object({ op: z.literal('voice.capture.finish'), threadId: z.string(), id: z.uuid() }).strict(),
  z.object({ op: z.literal('voice.speak'), threadId: z.string(), id: z.uuid(), text: z.string().trim().min(1).max(12000), speaker: voicePreferencesSchema.shape.speaker, speed: voicePreferencesSchema.shape.speed }).strict(),
  z.object({ op: z.literal('voice.cancel'), id: z.uuid() }).strict(),
] as const;
export interface VoiceModelState { id: VoiceModelId; status: 'missing' | 'installed' | 'corrupt'; bytes: number; error?: string; }
export interface VoiceJob { id: string; ownerId: number; kind: 'model' | 'capture' | 'tts'; threadId?: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; stage: string; progress?: number; error?: string; }
export interface VoiceStatus { directory: string; models: VoiceModelState[]; job?: VoiceJob; error?: string; }

// Float32/PCM audio stays in memory. Persistent operations store neither audio nor its encoding.
export const voiceWorkerRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capture.begin'), id: z.uuid(), directory: z.string(), language: voicePreferencesSchema.shape.language }).strict(),
  z.object({ kind: z.literal('capture.push'), id: z.uuid(), pcm: z.string().max(128000) }).strict(),
  z.object({ kind: z.literal('capture.finish'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('tts'), id: z.uuid(), directory: z.string(), text: z.string().max(12000), speaker: voicePreferencesSchema.shape.speaker, speed: voicePreferencesSchema.shape.speed }).strict(),
]);
export type VoiceWorkerRequest = z.infer<typeof voiceWorkerRequestSchema>;
export const voiceWorkerResultSchema = z.object({ id: z.uuid(), error: z.string().optional(), progress: z.number().min(0).max(1).optional(), done: z.boolean().optional(),
  value: z.object({ detected: z.boolean().optional(), ended: z.boolean().optional(), seconds: z.number().optional(), text: z.string().optional(), wav: z.string().max(80000000).optional() }).strict().optional(),
}).strict();
export type VoiceWorkerResult = z.infer<typeof voiceWorkerResultSchema>;
