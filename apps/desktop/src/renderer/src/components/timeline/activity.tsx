import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { Code2, FilePenLine, FileText, FolderOpen, Globe, Pi, Search, Wrench } from 'lucide-react';
import type { TimelineItem } from '../../../../shared/contracts.ts';
import { activity, editStats, elapsed } from '../../lib/activity.ts';
import { conversationTarget } from '../../lib/conversation-search.ts';
import { useApp } from '../../state/app.tsx';
import { Disclosure } from './disclosure.tsx';
import { StructuredToolResult } from './tool-result.tsx';
import { BrowserActivityResult } from './browser-activity.tsx';

export function EditDiff({ item }: { item: TimelineItem }) {
  useLocale();
  const { activeId, act } = useApp();
  const info = activity(item);
  if (!item.details) return null;
  return <div className="activity-diff" aria-label={tr("文件修改差异")}>
    <div className="activity-diff-heading"><button className="activity-file-link" onClick={() => info.path && act({ op: 'file.open', threadId: activeId, path: info.path })}>{info.path?.replaceAll('\\', '/').split('/').at(-1)}</button></div>
    <div className="activity-diff-lines" data-search-target={conversationTarget(item.id, 'diff')} tabIndex={-1}>{item.details.diff.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context'}>{line || ' '}</div>)}</div>
  </div>;
}

export function ToolActivity({ item }: { item: TimelineItem }) {
  useLocale();
  const { activeId, act } = useApp();
  const info = activity(item);
  const Icon = info.kind === 'browser' ? Globe : info.kind === 'harness' ? Pi : info.kind === 'read' ? FileText : info.kind === 'search' ? Search : info.kind === 'list' ? FolderOpen : info.kind === 'edit' || info.kind === 'write' ? FilePenLine : info.kind === 'command' ? Code2 : Wrench;
  const stats = editStats(item);
  const duration = elapsed(item.startedAt, item.completedAt);
  const raw = <>{item.args && <pre className="tool-args" data-search-target={conversationTarget(item.id, 'args')} tabIndex={-1}>{item.args}</pre>}<pre className="tool-output" data-search-target={conversationTarget(item.id, 'output')} tabIndex={-1}>{item.text || (info.running ? tr("等待输出…") : tr("无文本输出"))}</pre></>;
  const summary = info.path && ['read', 'edit', 'write', 'list'].includes(info.kind) ? <>
    {info.label.slice(0, info.label.length - info.path.length)}<button className="activity-file-link" title={info.path} onClick={() => act({ op: 'file.open', threadId: activeId, path: info.path! })}>{info.path.replaceAll('\\', '/').split('/').at(-1) || info.path}</button>
  </> : info.label;
  return <div className={'tool-activity ' + item.state} data-tool-id={item.id} data-tool-kind={info.kind} data-harness-tool={info.kind === 'harness' ? item.toolName : undefined}>
    <Disclosure foldKey={'tool:' + item.id} label={info.label + tr("详情")} summary={summary} busy={info.running} icon={<Icon size={16} aria-hidden="true" />}
      defaultOpen={info.kind === 'tool' && info.running || info.kind === 'browser' && (info.running || info.failed)} accessory={stats ? <span className="activity-stats"><span>+{stats.added}</span><span>−{stats.removed}</span></span> : undefined}>
      {duration && <span className="activity-duration">{tr("耗时")} {duration}</span>}
      {item.details && info.kind === 'edit' && <EditDiff item={item} />}
      {info.kind === 'browser' ? <BrowserActivityResult item={item} /> : item.toolResult && <StructuredToolResult value={item.toolResult} itemId={item.id} />}
      {!item.toolResult && (info.kind === 'command' || info.kind === 'tool') ? raw : <Disclosure foldKey={'raw:' + item.id} summary={tr("原始参数与输出")}>{raw}</Disclosure>}
      {info.failed && <p className="activity-error" role="status">{item.text || tr("工具执行失败")}</p>}
    </Disclosure>
  </div>;
}
