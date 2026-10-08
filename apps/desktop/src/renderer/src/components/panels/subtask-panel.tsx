import { useLayoutEffect, useRef } from 'react';
import { ChevronRight, Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ModelProvider, ProviderModel } from '../../../../shared/contracts.ts';
import { activeSubtask, type Subtask } from '../../../../shared/subtasks.ts';
import type { ThinkingLevel } from '../../../../shared/thinking.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { thinkingLabels } from '../../lib/labels.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useSubtaskNavigation } from '../../hooks/use-subtask-navigation.ts';
import { useApp } from '../../state/app.tsx';
import { Menu } from '../primitives/menu.tsx';
import { ApprovalCard } from '../timeline/message.tsx';

const statuses = { queued: '排队中', preparing: '准备中', running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' } as const;
const questionStatuses = { pending: '等待主代理答复', answered: '主代理已答复', expired: '等待答复超时', cancelled: '已取消', interrupted: '已中断' } as const;
function subtaskStatus(record: Subtask) {
  return localizeLabel(activeSubtask(record) && record.questions?.some(question => question.status === 'pending') ? '等待主代理答复' : statuses[record.status]);
}
export function SubtaskLink({ record, compact = false }: { record: Subtask; compact?: boolean }) {
  useLocale(); const open = useSubtaskNavigation();
  if (compact) return <button type="button" className="subagent-creation" onClick={() => open(record.id)} data-subtask-id={record.id} title={record.definition.title + ' · ' + subtaskStatus(record)}>
    <Network size={14} aria-hidden="true" /><span>{tr('已创建 {p0}', { p0: record.definition.title })}</span>
  </button>;
  return <button type="button" className="subagent-card" onClick={() => open(record.id)} data-subtask-id={record.id}>
    <Network size={16} aria-hidden="true" /><span className="subagent-card-copy"><strong>{record.definition.title}</strong>
      <small><span className={'subagent-status ' + record.status}>{subtaskStatus(record)}</span>{' · '}{record.definition.environment === 'local' ? tr('本地只读') : 'Worktree'}</small></span>
    <ChevronRight size={14} aria-hidden="true" />
  </button>;
}

export function SubtaskPanel() {
  useLocale(); const { thread, data } = useApp();
  const records = data.subtasks.filter(record => record.parentThreadId === thread?.id);
  const active = records.filter(activeSubtask), history = records.filter(record => !activeSubtask(record));
  return <section className="subagent-roster" aria-label={tr('子智能体')}>
    <header><h2>{tr('子智能体')}</h2><span>{active.length}</span></header>
    <p className="hint">{tr('由主代理管理，可在此查看运行过程。')}</p>
    <div className="subagent-list">{active.map(record => <SubtaskLink key={record.id} record={record} />)}</div>
    {!active.length && <p className="hint">{tr('当前没有活动的子智能体')}</p>}
    {!!history.length && <details className="subagent-history"><summary>{tr('已结束')} · {history.length}</summary><div className="subagent-list">{[...history].reverse().map(record => <SubtaskLink key={record.id} record={record} />)}</div></details>}
  </section>;
}

/**
 * The child runs on its parent's model and reasoning level unless the panel or the main agent overrides it
 * (`subtask.update`); users cannot edit a child through `thread.update`, which refuses subagent sessions.
 */
/**
 * Read-only summary of what the child actually runs on: it follows its parent unless the delegation (or the
 * main agent through subtask.update) overrode it. Users cannot edit children - the main process refuses
 * every user-originated subtask.* call, so the panel only shows the result.
 */
function SubtaskRunSettings({ record, parentModelId, parentThinking, models, providers }: {
  record: Subtask; parentModelId: string; parentThinking: ThinkingLevel;
  models: ProviderModel[]; providers: ModelProvider[];
}) {
  const overrideId = record.definition.modelId;
  const model = overrideId ? models.find(item => item.id === overrideId) : models.find(item => item.id === parentModelId);
  const label = (item: ProviderModel | undefined, id: string) => item ? (providers.find(provider => provider.id === item.provider)?.name ?? item.provider) + ' · ' + item.name : id;
  return <div className="subagent-run-settings">
    <span className="subagent-run-field">{tr('子代理模型')}：<strong>{label(model, overrideId ?? parentModelId)}</strong>{!overrideId && <em>{tr('跟随主代理')}</em>}</span>
    <span className="subagent-run-field">{tr('子代理思考档位')}：<strong>{thinkingLabels[record.definition.thinking ?? parentThinking]}</strong>{!record.definition.thinking && <em>{tr('跟随主代理')}</em>}</span>
  </div>;
}

/** No composer or message actions. File links never use the parent's working directory. */
export function SubtaskConversation({ id, hidden }: { id: string; hidden: boolean }) {
  useLocale(); const { thread, data, approvals } = useApp();
  const record = data.subtasks.find(item => item.id === id && item.parentThreadId === thread?.id);
  const child = data.threads.find(item => item.id === record?.childThreadId);
  const scroll = useRef<HTMLDivElement>(null), follow = useRef(true);
  useLayoutEffect(() => { if (!hidden && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [hidden, child?.items, record?.status, approvals]);
  return <section className="subagent-conversation" hidden={hidden} aria-label={tr('子智能体会话')} data-child-thread={child?.id}>
    {!record ? <p className="hint">{tr('子智能体会话不可用')}</p> : <>
      <header><strong>{record.definition.title}</strong><span>{subtaskStatus(record)} · {tr('只读')}</span></header>
      {!!thread && <SubtaskRunSettings record={record} parentModelId={thread.modelId} parentThinking={thread.thinking}
        models={data.settings.models} providers={data.settings.modelProviders} />}
      <div ref={scroll} className="subagent-transcript" onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64; }}>
        <details className="subagent-instructions"><summary>{tr('委派要求')}</summary><p>{record.definition.prompt}</p></details>
        {(record.questions ?? []).map(question => <details className="subagent-instructions" data-subtask-question={question.id} key={question.id} open={question.status === 'pending'}>
          <summary>{tr('询问主代理')} · {localizeLabel(questionStatuses[question.status])}</summary>
          <p>{question.question}</p>{question.answer && <p><strong>{tr('主代理答复')}</strong><br />{question.answer}</p>}
        </details>)}
        {(child?.items ?? []).filter(item => item.role !== 'user').map(item => <article className={'subagent-message ' + item.role} key={item.id}>
          {item.role === 'tool' ? <details><summary>{item.toolName || tr('工具')}{item.state === 'running' ? ' · ' + tr('进行中') : ''}</summary>{item.args && <pre>{item.args}</pre>}<pre>{item.text}</pre>{item.details && <pre>{item.details.diff}</pre>}{item.toolResult && <pre>{JSON.stringify(item.toolResult, null, 2)}</pre>}</details> : <>
            {item.thinking && <details><summary>{tr('思考过程')}</summary><pre>{item.thinking}</pre></details>}
            <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <span title={href}>{children}</span>, img: ({ alt }) => <span>{alt}</span> }}>{item.text}</ReactMarkdown></div>
          </>}
        </article>)}
        {record.error && <p role="alert">{localizeAppError(record.error)}</p>}
        {!child?.items.length && <p className="hint">{activeSubtask(record) ? tr('等待子智能体输出…') : record.result || tr('子智能体会话不可用')}</p>}
        {approvals.filter(approval => approval.threadId === child?.id).map(approval => <ApprovalCard key={approval.id} approval={approval} />)}
      </div>
    </>}
  </section>;
}
