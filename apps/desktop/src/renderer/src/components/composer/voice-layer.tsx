import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useApp } from '../../state/app.tsx';
import { VoiceControl } from './voice-control.tsx';

interface Outlet { element: HTMLDivElement | null; disabled: boolean; }
const VoiceOutletContext = createContext<(value: Outlet) => void>(() => {});

/** Welcome and timeline use different composer hosts; keep one voice controller across that move. */
export function VoiceLayer({ children }: { children: ReactNode }) {
  const { thread, view } = useApp(), [outlet, setOutlet] = useState<Outlet>({ element: null, disabled: false });
  return <VoiceOutletContext.Provider value={setOutlet}>{children}
    {thread && view === 'thread' && <VoiceControl key={thread.id} target={outlet.element} disabled={outlet.disabled} />}
  </VoiceOutletContext.Provider>;
}
export function VoiceOutlet({ disabled }: { disabled: boolean }) {
  const setOutlet = useContext(VoiceOutletContext);
  const mount = useCallback((element: HTMLDivElement | null) => { setOutlet({ element, disabled }); }, [setOutlet, disabled]);
  return <div className="voice-outlet" ref={mount} />;
}
