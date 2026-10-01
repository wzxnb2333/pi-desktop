import { useLocale } from "./hooks/use-locale.ts";
import { Workspace } from './components/shell/workspace.tsx';
import { Titlebar } from './components/shell/titlebar.tsx';
import { LoadingScreen } from './components/shell/loading.tsx';
import { AppProvider, useApp } from './state/app.tsx';

function Shell() {
  useLocale();
  const { ready, error } = useApp();
  if (!ready) return <LoadingScreen error={error} />;
  return (
    <div className="desktop">
      <Titlebar />
      <Workspace />
    </div>
  );
}

export function App() {
  useLocale();
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
