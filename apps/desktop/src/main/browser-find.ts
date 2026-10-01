import type { WebContents } from 'electron';
import type { BrowserFindState } from '../shared/contracts.ts';

type FindTarget = Pick<WebContents, 'findInPage' | 'stopFindInPage'>;
type FindResult = { requestId: number; matches: number; activeMatchOrdinal: number; finalUpdate: boolean };

/** Each native page owns its query. Late Chromium results cannot replace a newer search. */
export class BrowserFind {
  state: BrowserFindState = { text: '', requestId: 0, matches: 0, active: 0, pending: false };
  private reload = false;
  private loading = false;
  private forward = true;
  private readonly target: FindTarget;
  constructor(target: FindTarget) { this.target = target; }

  search(text: string, forward: boolean): void {
    const fresh = text !== this.state.text || this.state.requestId === 0;
    if (!text || fresh) this.target.stopFindInPage('clearSelection');
    this.reload = this.loading && !!text;
    this.forward = forward;
    if (!text) { this.state = { text: '', requestId: 0, matches: 0, active: 0, pending: false }; return; }
    if (this.loading) { this.state = { text, requestId: 0, matches: 0, active: 0, pending: true }; return; }
    const requestId = this.target.findInPage(text, { forward, findNext: fresh });
    this.state = { text, requestId, matches: fresh ? 0 : this.state.matches, active: fresh ? 0 : this.state.active, pending: true };
  }

  result(result: FindResult): boolean {
    if (!this.state.text || !this.state.requestId || result.requestId !== this.state.requestId || !this.state.pending) return false;
    // Chromium can emit partial counts before the final ordinal is known.
    if (!result.finalUpdate) return false;
    this.state = { ...this.state, matches: result.matches, active: result.activeMatchOrdinal, pending: false };
    return true;
  }

  navigating(): void {
    this.loading = true;
    this.forward = true;
    this.reload = !!this.state.text;
    this.target.stopFindInPage('clearSelection');
    this.state = { ...this.state, requestId: 0, matches: 0, active: 0, pending: this.reload };
  }

  loaded(): void {
    this.loading = false;
    if (this.reload) this.search(this.state.text, this.forward);
  }
}
