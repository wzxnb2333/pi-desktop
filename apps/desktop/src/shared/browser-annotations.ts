import { z } from 'zod';
import { browserUrlSchema } from './browser-tools.ts';

export const annotationRectSchema = z.object({ x: z.number().min(0).max(20000), y: z.number().min(0).max(20000), width: z.number().positive().max(20000), height: z.number().positive().max(20000) }).strict();
export const annotationElementSchema = z.object({ id: z.number().int().nonnegative(), tag: z.string().max(100), label: z.string().max(300), selector: z.string().max(4000), rect: annotationRectSchema }).strict();
export const annotationPageSchema = z.object({ url: browserUrlSchema, title: z.string().max(2000), width: z.number().positive().max(20000), height: z.number().positive().max(20000), scrollX: z.number().nonnegative(), scrollY: z.number().nonnegative(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), elements: z.array(annotationElementSchema).max(5000) }).strict();
export const annotationCaptureSchema = z.object({ id: z.uuid(), page: annotationPageSchema, image: z.string().startsWith('data:image/png;base64,').max(15000000) }).strict();
export const browserAnnotationSchema = z.object({
  id: z.uuid(), createdAt: z.number(), tabId: z.string().min(1).max(200),
  url: browserUrlSchema, title: z.string().max(2000), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  viewport: z.object({ width: z.number().positive(), height: z.number().positive(), scrollX: z.number(), scrollY: z.number() }).strict(),
  mode: z.enum(['element', 'region']), rect: annotationRectSchema, element: annotationElementSchema.optional(),
  comment: z.string().min(1).max(10000),
  deleting: z.boolean().optional(),
}).strict();
export const annotationSelectionSchema = z.object({ mode: z.enum(['element', 'region']), elementId: z.number().int().nonnegative().max(4999).optional(), rect: annotationRectSchema.optional(), comment: z.string().trim().min(1).max(10000) }).strict();
export type AnnotationPage = z.infer<typeof annotationPageSchema>;
export type AnnotationCapture = z.infer<typeof annotationCaptureSchema>;
export type BrowserAnnotation = z.infer<typeof browserAnnotationSchema>;
export type AnnotationSelection = z.infer<typeof annotationSelectionSchema>;
export type AnnotationRect = z.infer<typeof annotationRectSchema>;
export function annotationSelection(page: AnnotationPage, input: AnnotationSelection) {
  const selection = annotationSelectionSchema.parse(input);
  const element = selection.mode === 'element' ? page.elements.find(item => item.id === selection.elementId) : undefined;
  const rect = selection.mode === 'element' ? element?.rect : selection.rect;
  if (!rect || rect.x + rect.width > page.width + .01 || rect.y + rect.height > page.height + .01) throw new Error('请选择截图范围内的元素或区域');
  return { mode: selection.mode, rect, comment: selection.comment, ...(element ? { element } : {}) };
}
