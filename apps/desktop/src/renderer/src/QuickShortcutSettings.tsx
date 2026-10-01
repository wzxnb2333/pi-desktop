import { useEffect, useRef, useState } from 'react';
import { globalShortcutStateSchema, type DesktopRequest, type Settings, type ShortcutStatus } from '../../shared/contracts.ts';
import { localizeAppError, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { Button } from './components/primitives/button.tsx';

export function QuickShortcutSettings({ shortcuts, invoke }: { shortcuts: Settings['shortcuts']; invoke(request: DesktopRequest): Promise<unknown> }) {
  useLocale();
  const [state, setState] = useState<ShortcutStatus>();
  const [pending, setPending] = useState(false);
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  const key = JSON.stringify(shortcuts ?? {});
  useEffect(() => {
    let active = true;
    void invokeRef.current({ op: 'window.shortcut', retry: false }).then(value => {
      const result = globalShortcutStateSchema.safeParse(value);
      if (active && result.success) setState(result.data);
    }).catch(() => {});
    return () => { active = false; };
  }, [key]);
  if (!state) return null;
  return <div className="shortcut-registration" role={state.error ? 'alert' : 'status'}>
    <p>{state.error ? localizeAppError(state.error) : tr(state.registered ? '快捷聊天快捷键已启用' : '快捷聊天快捷键已关闭')}</p>
    {state.registered && <p className="hint">{tr('当前生效的快捷键：')}<kbd>{state.registered}</kbd></p>}
    {state.error && <Button size="sm" disabled={pending} onClick={() => {
      setPending(true);
      void invoke({ op: 'window.shortcut', retry: true }).then(value => setState(globalShortcutStateSchema.parse(value))).catch(() => {}).finally(() => setPending(false));
    }}>{tr('重试注册')}</Button>}
  </div>;
}
