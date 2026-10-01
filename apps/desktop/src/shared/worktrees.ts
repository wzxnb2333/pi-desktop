import { z } from 'zod';

export const managedWorktreeSchema = z.object({
  id: z.uuid(), threadId: z.string(), projectId: z.string(), directoryId: z.string(),
  path: z.string(), checkoutPath: z.string(), localPath: z.string(), branch: z.string(), baseCommit: z.string(),
  localBaseline: z.string(), worktreeBaseline: z.string(),
  createdAt: z.number(), lastUsedAt: z.number(), status: z.enum(['ready', 'archived']),
  archiveTree: z.string().optional(), archiveHead: z.string().optional(), archivedAt: z.number().optional(),
  archiveIndex: z.string().optional(), snapshotThreadId: z.string().optional(), restoreInProgress: z.boolean().optional(),
  cleanupError: z.string().optional(), cleanupAttemptedAt: z.number().optional(),
  lastTransferId: z.uuid().optional(),
  restoreFiles: z.object({ ino: z.string(), dev: z.string(), tree: z.string() }).strict().optional(),
  restoreIndexPreparation: z.object({ ino: z.string(), dev: z.string(), tree: z.string() }).strict().optional(),
  archiveRemoval: z.object({
    path: z.string(), phase: z.enum(['prepared', 'moved']), ino: z.string(), dev: z.string(),
    gitDirectory: z.string(), gitIno: z.string(), gitDev: z.string(), gitFile: z.string(), indexHash: z.string(),
  }).strict().optional(),
}).strict();
export type ManagedWorktree = z.infer<typeof managedWorktreeSchema>;
export interface TransferResult { id: string; sourceTree: string; targetTree: string; changed: number; warning?: string; }
export const worktreeRecoveryIssueSchema = z.object({
  id: z.string(), worktreeId: z.string().optional(), message: z.string(), details: z.string(),
}).strict();
export type WorktreeRecoveryIssue = z.infer<typeof worktreeRecoveryIssueSchema>;

export const worktreeCreationIssueSchema = z.object({
  id: z.string(), projectId: z.string(), directoryId: z.string(), path: z.string(), branch: z.string(), message: z.string(), canOpen: z.boolean(),
}).strict();
export type WorktreeCreationIssue = z.infer<typeof worktreeCreationIssueSchema>;
