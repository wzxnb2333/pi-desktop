import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** One owned parent per test worker; child projects contain no bookkeeping files. */
export class TemporaryDirectories {
  private root: Promise<string> | undefined;
  private readonly tempRoot: string;

  constructor(tempRoot = tmpdir()) {
    this.tempRoot = tempRoot;
  }

  async create(prefix: string): Promise<string> {
    this.root ??= this.createRoot();
    return mkdtemp(join(await this.root, basename(prefix)));
  }

  private async createRoot(): Promise<string> {
    const root = await mkdtemp(join(this.tempRoot, 'pi-desktop-tests-'));
    try {
      await writeFile(join(root, '.pi-test-owner.json'), JSON.stringify({
        kind: 'pi-desktop-test', version: 1, root, pid: process.pid, createdAt: new Date().toISOString(),
      }));
      return root;
    } catch (error) {
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.root) return;
    const pending = this.root;
    const root = await pending;
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
    if (this.root === pending) this.root = undefined;
  }
}
