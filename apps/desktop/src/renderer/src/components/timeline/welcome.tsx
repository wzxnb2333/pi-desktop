import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { FolderOpen, Settings2 } from 'lucide-react';
import { useApp } from '../../state/app.tsx';
import { Composer } from '../composer/composer.tsx';
import { HomeProjectMenu } from '../composer/home-utility.tsx';
import { Button } from '../primitives/button.tsx';

export function Welcome() {
  useLocale();
  const { project, thread, data, addProject, createThread, setView } = useApp();
  return <div className={thread ? 'welcome welcome-task' : 'welcome welcome-start'}>
    <div className="welcome-hero">
      <div className="welcome-heading">
        <span className="welcome-logo" aria-hidden="true">π</span>
        <h1 aria-label={project ? tr('在 {p0} 中构建', { p0: project.name }) : undefined}>{project ? <>{tr("在")} <HomeProjectMenu heading /><span className="welcome-heading-suffix">{tr("中构建")}</span></> : tr("开始你的下一个想法")}</h1>
        {!thread && <p>{tr("从一个问题开始，让 Pi 帮你把想法变成代码。")}</p>}
      </div>
    </div>
    <div className="welcome-dock">
      {!data.settings.providers.length && <aside className="welcome-setup" aria-label={tr("模型配置引导")}>
        <Settings2 size={18} aria-hidden="true" />
        <div><h2>{tr("配置模型以开始任务")}</h2><p>{tr("连接供应商并选择可用模型")}</p></div>
        <Button variant="primary" size="sm" onClick={() => setView('settings')}>{tr("配置 API Key 和模型")}</Button>
      </aside>}
      {thread ? <Composer home /> : <div className="welcome-start-actions">
        <Button variant="primary" onClick={() => void (project ? createThread() : addProject()).catch(() => {})}>
          {!project && <FolderOpen size={16} />}{project ? tr("新建聊天") : tr("添加本地项目")}
        </Button>
      </div>}
    </div>
  </div>;
}
