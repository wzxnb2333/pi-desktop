import { createHash } from 'node:crypto';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserHistorySchema, browserHistoryEntrySchema, historyRangeStart, type BrowserDataRange, type BrowserHistoryEntry, type BrowserHistoryPage } from '../shared/browser-history.ts';

/** Browser visits are private main-process data; they are queried, never broadcast with every chat token. */
export class BrowserHistory {
  private entries: BrowserHistoryEntry[] = [];
  private readonly tabs = new Map<string, string>();
  private writing: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private dirty = false;
  private revision = 0;
  private blocked = false;
  error = '';
  constructor(private readonly storage: string, private readonly failed: (error: unknown) => void = () => {}) {}
  private get path() { return join(this.storage, 'browser-history.json'); }
  async load(): Promise<void> {
    let found = false;
    for (const path of [this.path, this.path + '.bak']) {
      let raw: string;
      try { raw = await readFile(path, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') found = true; continue; }
      found = true;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'version' in parsed && typeof parsed.version === 'number' && parsed.version > 1) { this.blocked = true; this.error = '浏览历史来自更新版本，原文件已保留'; return; }
        const data = browserHistorySchema.parse(parsed);
        if (path !== this.path) {
          await this.preserveDamaged(); await writeFile(this.path + '.tmp', JSON.stringify(data)); await rename(this.path + '.tmp', this.path);
        }
        this.entries = data.entries; this.error = ''; this.blocked = false; return;
      } catch { /* Try the exact previous saved version; never replace broken data with empty history. */ }
    }
    if (found) { this.blocked = true; this.error = '浏览历史无法读取，原文件已保留；可在清理全部历史时重置'; }
  }
  private async preserveDamaged() {
    for (const source of [this.path, this.path + '.bak']) {
      let raw: Buffer;
      try { raw = await readFile(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const path = this.path + '.recovery-' + createHash('sha256').update(raw).digest('hex').slice(0, 16);
      await writeFile(path, raw, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    }
  }
  visit(tab: string, url: string, title: string, navigation: boolean, now = Date.now()): void {
    if (this.blocked) return;
    const current = this.entries.find(item => item.id === this.tabs.get(tab));
    if (!navigation && (!current || current.url !== url || current.title === title)) return;
    if (navigation) {
      const value = browserHistoryEntrySchema.safeParse({ id: crypto.randomUUID(), url, title: title.slice(0, 2000), visitedAt: now });
      if (!value.success) return;
      this.entries.push(value.data); this.tabs.set(tab, value.data.id);
      if (this.entries.length > 10000) this.entries.splice(0, this.entries.length - 10000);
    } else if (current) current.title = title.slice(0, 2000);
    this.revision++; this.dirty = true; clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.failed); }, 200);
  }
  query(query: string, offset = 0, limit = 100): BrowserHistoryPage {
    const text = query.trim().toLocaleLowerCase();
    const all = this.entries.filter(item => !text || (item.title + '\n' + item.url).toLocaleLowerCase().includes(text)).sort((a, b) => b.visitedAt - a.visitedAt);
    return { entries: all.slice(offset, offset + limit), total: all.length, ...(this.error ? { error: this.error } : {}) };
  }
  closeTab(tab: string): void { this.tabs.delete(tab); }
  range(range: BrowserDataRange, until = Date.now()) {
    if (this.blocked && range !== 'all') throw new Error(this.error);
    const since = historyRangeStart(range, until), selected = this.entries.filter(item => item.visitedAt >= since && item.visitedAt <= until);
    return { since, until, count: selected.length, origins: [...new Set(selected.map(item => new URL(item.url).origin))] };
  }
  async clear(range: BrowserDataRange, until: number): Promise<number> {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      if (this.blocked) {
        if (range !== 'all') throw new Error(this.error);
        await this.preserveDamaged();
      }
      const since = historyRangeStart(range, until), revision = this.revision;
      const selected = new Set(this.entries.filter(item => item.visitedAt >= since && item.visitedAt <= until).map(item => item.id));
      await this.persist(this.entries.filter(item => !selected.has(item.id)), true);
      // Publish only after both copies are saved. Visits received during I/O retain their own IDs and titles.
      this.entries = this.entries.filter(item => !selected.has(item.id));
      for (const [tab, id] of this.tabs) if (selected.has(id)) this.tabs.delete(tab);
      this.dirty = this.revision !== revision; this.revision++; this.blocked = false;
      return selected.size;
    });
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    await this.enqueue(async () => {
      if (!this.dirty || this.blocked) return;
      const revision = this.revision;
      await this.persist(this.entries, false);
      this.dirty = this.revision !== revision;
    });
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.writing.then(work);
    this.writing = operation.then(() => {}, () => {});
    return operation;
  }
  private async persist(entries: BrowserHistoryEntry[], clearBackup: boolean): Promise<void> {
    const content = JSON.stringify(browserHistorySchema.parse({ version: 1, entries }));
    try {
      await writeFile(this.path + '.tmp', content);
      if (clearBackup) {
        // Prune the recovery copy first: successful deletion must never be undone by fallback recovery.
        await writeFile(this.path + '.bak.tmp', content);
        await rename(this.path + '.bak.tmp', this.path + '.bak');
      } else {
        await copyFile(this.path, this.path + '.bak').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      await rename(this.path + '.tmp', this.path); this.error = '';
    } catch (error) { this.error = '浏览历史保存失败\n' + String(error); throw error; }
  }
}
