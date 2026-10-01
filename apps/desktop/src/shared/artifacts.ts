import { z } from 'zod';
import { annotationRectSchema } from './browser-annotations.ts';

export const artifactBoundsSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000) }).strict();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactAnnotationSchema = z.object({
  id: z.uuid(), createdAt: z.number(), directoryId: z.string(), root: z.string(), path: z.string(), kind: z.enum(['pdf', 'html']),
  version: digest, resources: z.record(z.string(), digest), imageHash: digest,
  page: z.number().int().min(1).max(100000), width: z.number().positive().max(20000), height: z.number().positive().max(20000),
  scrollX: z.number().nonnegative(), scrollY: z.number().nonnegative(), rect: annotationRectSchema, comment: z.string().trim().min(1).max(10000),
  deleting: z.boolean().optional(),
}).strict();
export const artifactPdfCaptureSchema = z.object({ page: z.number().int().min(1).max(100000), image: z.string().startsWith('data:image/png;base64,').max(15000000) }).strict();
export type ArtifactAnnotation = z.infer<typeof artifactAnnotationSchema>;
export interface ArtifactDocument { id: string; path: string; kind: 'pdf' | 'html'; version: string; data?: string; }
export interface ArtifactStatus { loading: boolean; error?: string; blocked: string[]; allowed: string[]; }
export interface ArtifactCapture { id: string; image: string; width: number; height: number; page: number; }
export interface ArtifactAnnotationView { item: ArtifactAnnotation; image: string; stale: boolean; }
