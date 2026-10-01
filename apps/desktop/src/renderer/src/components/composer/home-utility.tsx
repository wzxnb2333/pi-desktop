import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { FolderOpen, GitBranch, Laptop, ListChecks } from 'lucide-react';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { BindProject } from './bind-project.tsx';

const suggestions = [
  { value: 'understand', get label() { return tr("了解这个项目"); }, get prompt() { return tr("请阅读这个项目，说明它的结构、主要功能和启动方式。"); } },
  { value: 'plan', get label() { return tr("制定实现计划"); }, get prompt() { return tr("请先了解项目并帮我制定下一步开发计划。"); } },
  { value: 'review', get label() { return tr("审查最近改动"); }, get prompt() { return tr("请审查当前 Git 改动，找出需要修复的问题。"); } },
];

export function HomeProjectMenu({ heading = false }: { heading?: boolean }) {
  useLocale();
  const { project, data, createThread, running } = useApp();
  return <Menu
    label={heading ? tr("选择任务项目") : tr("输入区项目")}
    className={heading ? 'welcome-project' : 'home-project'}
    value={project?.id ?? ''}
    disabled={running}
    size="sm"
    side={heading ? 'bottom' : 'top'}
    options={data.projects.map(item => ({
      value: item.id,
      label: heading ? item.name : <><FolderOpen size={16} /><span>{item.name}</span></>,
    }))}
    onChange={id => { if (id !== project?.id) void createThread(id).catch(() => {}); }}
  />;
}

export function HomeUtility() {
  useLocale();
  const { thread, running, createThread, act, updateDraft, composerRef, ui, patchUi } = useApp();
  if (!thread) return null;
  if (!thread.projectId) return <div className="composer-home-utility"><BindProject /><span className="hint">{tr('独立聊天不会访问项目文件或运行命令。')}</span></div>;
  return <div className="composer-home-utility" aria-label={tr("新任务环境")}>
    <HomeProjectMenu />
    <span className="home-location"><Laptop size={16} />{tr("本地")}</span>
    {thread.worktreeBranch ? <span className="home-branch" title={thread.worktreeBranch}><GitBranch size={16} /><span>{thread.worktreeBranch}</span></span> :
      <Button className="home-worktree" size="sm" disabled={running} onClick={() => void createThread(thread.projectId, true).catch(() => {})}>
        <GitBranch size={16} />{tr("新建 Worktree")} </Button>}
    <Menu
      label={tr("新任务选项")}
      className="home-options"
      value=""
      placeholder={thread.planMode ? tr("计划模式") : tr("任务选项")}
      kind="action"
      size="sm"
      side="top"
      align="end"
      disabled={running}
      options={[{ value: 'toggle-plan', label: <><ListChecks size={16} />{thread.planMode ? tr("关闭计划模式") : tr("开启计划模式")}</> }, ...suggestions, { value: 'close-task', label: tr("关闭当前任务") }]}
      onChange={value => {
        if (value === 'toggle-plan') act({ op: 'thread.update', id: thread.id, planMode: !thread.planMode });
        else if (value === 'close-task') {
          const remaining = (ui.openThreads ?? [thread.id]).filter(id => id !== thread.id);
          patchUi({ openThreads: remaining, closedThreads: [...(ui.closedThreads ?? []), thread.id].slice(-20), activeThreadId: remaining.at(-1) ?? '' });
        }
        else {
          const suggestion = suggestions.find(item => item.value === value);
          if (suggestion) {
            updateDraft(thread.id, draft => ({ ...draft, text: draft.text ? draft.text + '\n\n' + suggestion.prompt : suggestion.prompt }));
            requestAnimationFrame(() => composerRef.current?.focus());
          }
        }
      }}
    />
  </div>;
}
