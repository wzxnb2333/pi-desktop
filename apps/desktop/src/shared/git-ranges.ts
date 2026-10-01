import { z } from 'zod';

export const roundSnapshotSchema = z.object({
  id: z.string(), threadId: z.string(), cwd: z.string(), startedAt: z.number(), completedAt: z.number().optional(),
  before: z.string(), after: z.string().optional(), state: z.enum(['running', 'complete', 'error']), error: z.string().optional(),
}).strict();
export type RoundSnapshot = z.infer<typeof roundSnapshotSchema>;
export const hunkRecoverySchema = z.object({ id: z.uuid(), cwd: z.string(), path: z.string(), originalVersion: z.string(), revertedVersion: z.string(), createdAt: z.number(), state: z.enum(['prepared', 'applied', 'restoring', 'restored']) }).strict();
export type HunkRecoveryRecord = z.infer<typeof hunkRecoverySchema>;
export type HunkRecoveryView = Omit<HunkRecoveryRecord, 'state'> & { state: HunkRecoveryRecord['state'] | 'unapplied'; error?: string; receiptPending?: boolean };
export interface HunkRecoveryListing { records: HunkRecoveryView[]; errors: { id: string; message: string }[]; }
export interface GitRange {
  files: { path: string; status: string; staged: boolean }[];
  diff: string;
  base: string;
  target: string;
  startedAt?: number;
  completedAt?: number;
  attribution: 'workspace' | 'branch';
}
