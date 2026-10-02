import { tr, localizeAppError } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useState } from 'react';
import { useApp } from '../../state/app.tsx';

export function StatusBar({ inline = false }: { inline?: boolean }) {
  useLocale();
  const { thread } = useApp();
  const Container = inline ? 'span' : 'footer';
  return (
    <Container className="statusbar">
      <span className="local-dot" />
      <span>{tr("本地运行")}</span>
      {thread && (
        <>
          <span className="separator">/</span>
          <span title={thread.cwd}>{thread.cwd}</span>
        </>
      )}
      <span className="flex-spacer" />
      <span>Pi 0.86.1</span>
    </Container>
  );
}

/*
 * Errors are transient by design: a toast names the failure and gets out of the way, so a failed
 * background action cannot leave a permanent bar across the workbench. It carries no close button:
 * it leaves on its own, pointing at it holds it open, and Escape clears it immediately.
 */
const ERROR_LINGER_MS = 7000;

export function ErrorBanner() {
  useLocale();
  const { error, setError } = useApp();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!error || held) return;
    const timer = setTimeout(() => setError(''), ERROR_LINGER_MS);
    return () => clearTimeout(timer);
  }, [error, held, setError]);
  useEffect(() => {
    if (!error) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setError(''); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [error, setError]);
  if (!error) return null;
  return (
    <div
      className="error-banner"
      role="alert"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
    >
      {localizeAppError(error)}
    </div>
  );
}
