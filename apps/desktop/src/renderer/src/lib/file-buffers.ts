import type { FileContent } from '../../../shared/contracts.ts';
import { normalizedFileEdit } from '../../../shared/file-edits.ts';

export interface FileBuffer {
  file?: FileContent;
  content: string;
  loading: boolean;
  saving: boolean;
  error: string;
  errorKind?: 'read' | 'save' | 'conflict';
  /** A reload observed a different disk version while the user's edit was retained. */
  conflicted?: boolean;
  saveAttempt?: { id: string; startedAt: number; finishedAt?: number; state: 'pending' | 'verified' | 'failed'; baseVersion: string; savedVersion?: string };
}

export const fileBufferDirty = (buffer: FileBuffer | undefined): boolean =>
  !!buffer?.file && (buffer.content !== buffer.file.content || !!buffer.conflicted);

/** Session-owned buffers keep the latest edit and disk version across panel/task remounts. */
export class FileBuffers {
  private buffers: ReadonlyMap<string, FileBuffer> = new Map();
  private listeners = new Set<() => void>();
  private reads = new Map<string, object>();

  snapshot = (): ReadonlyMap<string, FileBuffer> => this.buffers;
  hasUnsaved = (): boolean => [...this.buffers.values()].some(buffer => buffer.saving || fileBufferDirty(buffer));
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(key: string, buffer: FileBuffer): void {
    this.buffers = new Map(this.buffers).set(key, buffer);
    for (const listener of this.listeners) listener();
  }

  async load(key: string, read: () => Promise<FileContent>, options: { discardChanges?: boolean } = {}): Promise<void> {
    const request = {};
    this.reads.set(key, request);
    const previous = this.buffers.get(key);
    this.update(key, { ...previous, file: previous?.file, content: previous?.content ?? '', saving: previous?.saving ?? false, loading: true, error: previous?.errorKind === 'save' ? previous.error : '', errorKind: previous?.errorKind === 'save' ? 'save' : undefined });
    try {
      const file = await read();
      if (this.reads.get(key) !== request) return;
      const current = this.buffers.get(key)!;
      // A read started before a save can return an obsolete version after that save completes.
      if (current.saving || current.file !== previous?.file) {
        this.update(key, { ...current, loading: false });
      } else if (current.file && (options.discardChanges ? current.content !== previous?.content : fileBufferDirty(current))) {
        const conflict = current.file.version !== file.version;
        this.update(key, {
          ...current, loading: false, conflicted: conflict,
          error: conflict ? '文件已在外部修改。未保存内容已保留，请比较后重新加载。' : current.errorKind === 'save' ? current.error : '',
          errorKind: conflict ? 'conflict' : current.errorKind === 'save' ? 'save' : undefined,
        });
      } else {
        // A confirmed reload replaces the draft only after a successful read. Edits
        // made while reading, failed reads, and newer saves keep their own buffer.
        this.update(key, { file, content: file.content, saving: false, loading: false, error: '' });
      }
    } catch (reason) {
      if (this.reads.get(key) === request) {
        const current = this.buffers.get(key)!;
        this.update(key, current.saving || current.file !== previous?.file
          ? { ...current, loading: false }
          : { ...current, loading: false, error: reason instanceof Error ? reason.message : String(reason), errorKind: 'read' });
      }
    } finally {
      if (this.reads.get(key) === request) this.reads.delete(key);
    }
  }

  edit(key: string, content: string): void {
    const current = this.buffers.get(key);
    if (!current?.file?.writable) return;
    this.update(key, { ...current, content });
  }

  async save(key: string, write: (file: FileContent, content: string) => Promise<FileContent>): Promise<void> {
    const submitted = this.buffers.get(key);
    if (!submitted?.file?.version || !submitted.file.writable || submitted.saving || !fileBufferDirty(submitted)) return;
    const attempt = { id: crypto.randomUUID(), startedAt: Date.now(), state: 'pending' as const, baseVersion: submitted.file.version };
    this.update(key, { ...submitted, saving: true, error: '', errorKind: undefined, saveAttempt: attempt });
    try {
      const expected = normalizedFileEdit(submitted.file.content, submitted.content);
      const file = await write(submitted.file, submitted.content);
      if (file.path !== submitted.file.path || file.kind !== 'text' || file.truncated || !file.version || file.content !== expected)
        throw new Error('保存回执与提交内容不一致，草稿已保留，请比较磁盘内容');
      const latest = this.buffers.get(key)!;
      // Keep edits made after submission; otherwise accept persisted newline/BOM normalization.
      const content = latest.content === submitted.content ? file.content : latest.content;
      this.update(key, { ...latest, file, content, saving: false, error: '', errorKind: undefined, conflicted: false, saveAttempt: { ...attempt, state: 'verified', finishedAt: Date.now(), savedVersion: file.version } });
    } catch (reason) {
      const latest = this.buffers.get(key)!;
      this.update(key, { ...latest, saving: false, error: reason instanceof Error ? reason.message : String(reason), errorKind: 'save', saveAttempt: { ...attempt, state: 'failed', finishedAt: Date.now() } });
    }
  }

  discard(key: string): boolean {
    // A dispatched write cannot be cancelled by closing or reloading an editor.
    if (this.buffers.get(key)?.saving) return false;
    this.reads.delete(key);
    if (this.buffers.has(key)) {
      const next = new Map(this.buffers);
      next.delete(key);
      this.buffers = next;
      for (const listener of this.listeners) listener();
    }
    return true;
  }
}

export const fileBuffers = new FileBuffers();
