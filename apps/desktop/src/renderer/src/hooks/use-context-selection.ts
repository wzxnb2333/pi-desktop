import { useLayoutEffect, useRef, useState } from 'react';
import type { ContextReference } from '../../../shared/input-context.ts';
import { localizeAppError } from '../../../shared/localization.ts';

export type SelectContext = (reference: ContextReference, selection: AbortController) => Promise<boolean>;

/** A selection belongs to the visible query. Leaving it cancels local commit, not the IPC read. */
export function useContextSelection(onSelect: SelectContext, scope: string) {
  const current = useRef<AbortController | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    setPending(false); setError('');
    return () => current.current?.abort();
  }, [scope]);
  const select = async (reference: ContextReference, complete?: () => void) => {
    if (current.current) return;
    const selection = new AbortController();
    current.current = selection; setPending(true); setError('');
    const release = () => {
      if (current.current !== selection) return;
      current.current = undefined; setPending(false);
    };
    selection.signal.addEventListener('abort', release, { once: true });
    try {
      const accepted = await onSelect(reference, selection);
      if (accepted && !selection.signal.aborted && current.current === selection) complete?.();
    } catch (reason) {
      if (!selection.signal.aborted && current.current === selection) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      selection.signal.removeEventListener('abort', release); release();
    }
  };
  return { pending, error, select };
}
