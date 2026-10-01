import { tr, localizeAppError } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { X } from 'lucide-react';
import { useApp } from '../../state/app.tsx';
import { IconButton } from '../primitives/icon-button.tsx';

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

export function ErrorBanner() {
  useLocale();
  const { error, setError } = useApp();
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{localizeAppError(error)}</span>
      <IconButton label={tr("关闭错误提示")} onClick={() => setError('')}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
