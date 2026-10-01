import { z } from 'zod';

export const reviewScopeSchema = z.enum(['uncommitted', 'branch', 'commit']);
export const reviewFindingInputSchema = z.object({
  priority: z.number().int().min(0).max(3), title: z.string().min(1).max(240),
  body: z.string().min(1).max(10000), path: z.string().min(1).max(2000),
  line: z.number().int().positive(), endLine: z.number().int().positive(),
}).strict();
export const reviewSubmissionSchema = z.object({ summary: z.string().min(1).max(20000), findings: z.array(reviewFindingInputSchema).max(100) }).strict();
export const reviewFileSchema = z.object({ path: z.string(), version: z.string(), lines: z.number().int().nonnegative(), deleted: z.boolean(), binary: z.boolean() }).strict();
export const reviewRunSchema = z.object({
  parentThreadId: z.string(), scope: reviewScopeSchema, ref: z.string(), instructions: z.string(),
  capturedAt: z.number(), base: z.string(), target: z.string(), files: z.array(reviewFileSchema),
  phase: z.enum(['capturing', 'running', 'complete', 'cancelled', 'error']), summary: z.string().default(''),
  findings: z.array(reviewFindingInputSchema.extend({ id: z.string(), ignored: z.boolean().default(false), feedback: z.array(z.string()).default([]) })).default([]),
  submittedAt: z.number().optional(), completedAt: z.number().optional(),
}).strict();
export const lineCommentSchema = z.object({
  id: z.string(), directoryId: z.string(), path: z.string(), version: z.string(),
  line: z.number().int().positive(), endLine: z.number().int().positive(), body: z.string().min(1).max(10000),
  excerpt: z.string().max(100000), createdAt: z.number(),
}).strict();
export type ReviewRun = z.infer<typeof reviewRunSchema>;
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;
export type ReviewFile = z.infer<typeof reviewFileSchema>;
export type LineComment = z.infer<typeof lineCommentSchema>;
export interface ReviewInspection { files: Array<ReviewFile & { stale: boolean }>; comments: Array<LineComment & { stale: boolean }> }

export function validateReviewSubmission(input: unknown, files: ReviewFile[]): ReviewSubmission {
  const result = reviewSubmissionSchema.parse(input);
  for (const finding of result.findings) {
    const file = files.find(file => file.path === finding.path);
    if (!file || file.binary || finding.endLine < finding.line || finding.endLine > file.lines)
      throw new Error('审查发现的位置不属于已捕获的文本范围');
  }
  return result;
}
