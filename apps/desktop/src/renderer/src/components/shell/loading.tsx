import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
export function LoadingScreen({ error = '' }: { error?: string }) {
  useLocale();
  return (
    <div className="loading" aria-busy={!error}>
      <div className="loading-titlebar" aria-hidden="true" />
      <div className="loading-content">
        <span className="pi-logo" aria-hidden="true">π</span>
        <p role={error ? 'alert' : 'status'}>{error || tr("正在打开工作台…")}</p>
      </div>
    </div>
  );
}
