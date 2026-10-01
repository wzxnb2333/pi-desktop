import { useLayoutEffect, useRef, useState } from 'react';
import { tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { ConfirmDialog } from './dialog.tsx';

export type RegisterViewGuard = (guard: (proceed: () => void, cancel: () => void) => void) => () => void;
type NavigationAttempt = { proceed: () => void; cancel: () => void };

/** Form drafts remain in memory until the user saves or explicitly discards them. */
export function UnsavedNavigation({ dirty, busy, register }: {
  dirty: boolean;
  busy: boolean;
  register?: RegisterViewGuard;
}) {
  useLocale();
  const [leave, setLeave] = useState<NavigationAttempt>();
  const pending = useRef<NavigationAttempt | undefined>(undefined);
  const [waiting, setWaiting] = useState(false);
  useLayoutEffect(() => {
    if (!dirty && !busy) return;
    return register?.((proceed, cancel) => {
      pending.current?.cancel();
      pending.current = undefined;
      if (busy) {
        setLeave(undefined); setWaiting(true); cancel();
      } else {
        const attempt = { proceed, cancel };
        pending.current = attempt;
        setLeave(attempt);
      }
    });
  }, [register, dirty, busy]);
  useLayoutEffect(() => { if (!busy) setWaiting(false); }, [busy]);
  useLayoutEffect(() => () => { pending.current?.cancel(); pending.current = undefined; }, []);
  return <>
    {busy && waiting && <p className="form-feedback" role="alert">{tr("正在保存，请完成后再离开。")}</p>}
    {leave && <ConfirmDialog title={tr("放弃未保存的修改？")} description={tr("当前表单尚未保存。切换后这些修改会丢失。")}
      confirmLabel={tr("放弃修改")} cancelLabel={tr("继续编辑")} initialFocus="cancel" danger
      onCancel={() => { pending.current = undefined; setLeave(undefined); leave.cancel(); }}
      onConfirm={() => { pending.current = undefined; setLeave(undefined); leave.proceed(); }} />}
  </>;
}
