import { tr, getLocale, localizeAppError } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { CircleHelp, ShieldCheck } from 'lucide-react';
import { isValidElement, memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { Approval, TimelineItem } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { ToolActivity } from './activity.tsx';
import { messageLink } from '../../lib/message-links.ts';
import { useOpenLink } from '../../hooks/use-open-link.ts';
import { MarkdownCodeBlock, MarkdownTable } from './markdown-blocks.tsx';
import { MessageActions } from './message-actions.tsx';
import { MessageContext } from './message-context.tsx';
import { quoteSourcePositions } from '../../lib/markdown-selection.ts';

export function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

function containsHan(node: ReactNode): boolean {
  if (typeof node === 'string') return /\p{Script=Han}/u.test(node);
  if (Array.isArray(node)) return node.some(containsHan);
  return isValidElement<{ children?: ReactNode }>(node) && containsHan(node.props.children);
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  useLocale();
  const { thread } = useApp();
  const openLink = useOpenLink();
  const link = messageLink(href, thread?.cwd ?? '');
  if (link.kind === 'unavailable') return <span title={link.reason}>{children}</span>;
  const title = link.kind === 'file' ? link.path + (link.line ? ':' + link.line + (link.column ? ':' + link.column : '') : '') + tr(" · 在文件面板打开，Ctrl/⌘ 点击使用外部编辑器") : link.url + tr(" · 在右侧浏览器打开，Ctrl/⌘ 点击使用系统浏览器");
  return <button type="button" className="text-link" title={title} onClick={event => openLink(href, event.ctrlKey || event.metaKey)}>{children}</button>;
}

// Only our controlled link component receives raw hrefs. Other URL attributes keep Markdown's default policy.
const markdownUrl: UrlTransform = (url, key, node) => key === 'href' && node.tagName === 'a' ? url : defaultUrlTransform(url);

// Stable component identities keep text selections and search ranges intact on unrelated UI saves.
const markdownComponents: Components = {
  p: ({ children }) => <p dir="auto" data-markdown-han-text={containsHan(children) ? 'true' : undefined}>{children}</p>,
  h1: ({ children }) => <h1 dir="auto">{children}</h1>,
  h2: ({ children }) => <h2 dir="auto">{children}</h2>,
  h3: ({ children }) => <h3 dir="auto">{children}</h3>,
  h4: ({ children }) => <h4 dir="auto">{children}</h4>,
  h5: ({ children }) => <h5 dir="auto">{children}</h5>,
  h6: ({ children }) => <h6 dir="auto">{children}</h6>,
  ul: ({ children, className }) => <ul dir="auto" className={className}>{children}</ul>,
  ol: ({ children, className, start }) => <ol dir="auto" className={className} start={start}>{children}</ol>,
  blockquote: ({ children }) => <blockquote dir="auto">{children}</blockquote>,
  pre: MarkdownCodeBlock,
  table: MarkdownTable,
  th: ({ node: _node, ...props }) => <th {...props} dir="auto" />,
  td: ({ node: _node, ...props }) => <td {...props} dir="auto" />,
  a: MarkdownLink,
};

// Markdown parsing/highlighting is content work, independent of drafts, scroll saves and IPC snapshots.
// Keep its DOM mounted so selections, code wrapping and search ranges survive those updates.
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }], quoteSourcePositions]} components={markdownComponents} urlTransform={markdownUrl}>{text}</ReactMarkdown>;
});

export function Message({ item, searchTarget, actions = true }: { item: TimelineItem; searchTarget?: string; actions?: boolean }) {
  useLocale();
  if (item.role === 'tool') return <ToolActivity item={item} />;
  if (item.role === 'notice' && item.noticeKind === 'model-switch')
    return (
      <div className="notice model-switch" data-message-id={item.id} data-notice-kind="model-switch" data-search-target={searchTarget} tabIndex={-1} aria-label={item.text}>
        <span className="notice-rule" aria-hidden="true" />
        <span className="notice-text">{item.text}</span>
        <span className="notice-rule" aria-hidden="true" />
      </div>
    );
  if (item.role === 'notice')
    return (
      <div className={`notice ${item.state === 'error' ? 'danger' : ''}`} data-message-id={item.id} data-search-target={searchTarget} tabIndex={-1}>
        <CircleHelp size={18} />
        <span className="notice-text">{item.text}</span>
      </div>
    );
  const body = (
    <div className="markdown" data-quote-body={actions && item.state !== 'running' || undefined} data-markdown-text-style={item.role === 'user' ? 'user-message' : 'assistant-message'} data-search-target={searchTarget} tabIndex={searchTarget ? -1 : undefined}>
      <MarkdownBody text={item.role === 'user' ? item.input?.text ?? item.text : item.text} />
    </div>
  );
  if (item.role === 'user')
    return (
      <article className="message user" data-message-id={item.id} tabIndex={-1}>
        <h4 className="sr-only">{tr("你")}</h4>
        {(item.input?.text ?? item.text) && <div className="user-message-bubble" data-user-message-bubble="true">{body}</div>}
        {!!item.input?.parts.length && <MessageContext item={item} />}
        <div className="message-meta">
          {actions && item.state !== 'running' && <MessageActions item={item} />}
          <time dateTime={new Date(item.timestamp).toISOString()}>{timeLabel(item.timestamp)}</time>
        </div>
      </article>
    );
  // Assistant prose has no per-card chrome: the turn header renders the π Pi label and time once.
  // Thinking stays with its own item rather than being merged across the turn.
  return (
    <article className="message assistant" data-message-id={item.id} tabIndex={-1}>
      {item.thinking && (
        <details className="thinking">
          <summary>{tr("思考过程")}</summary>
          <div>{item.thinking}</div>
        </details>
      )}
      {body}
      {actions && item.state !== 'running' && <MessageActions item={item} />}
    </article>
  );
}

export function ApprovalCard({ approval }: { approval: Approval }) {
  useLocale();
  const { invoke } = useApp();
  const [value, setValue] = useState(approval.kind === 'select' ? approval.options?.[0] || '' : '');
  const [busy, setBusy] = useState(false);
  const replying = useRef(false);
  const descriptionRef = useRef<HTMLPreElement>(null);
  const [descriptionScrollable, setDescriptionScrollable] = useState(false);
  useLayoutEffect(() => {
    const description = descriptionRef.current;
    if (!description) return;
    const measure = () => setDescriptionScrollable(description.scrollHeight > description.clientHeight || description.scrollWidth > description.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(description);
    return () => observer.disconnect();
  }, [approval.description]);
  const reply = async (approved: boolean) => {
    if (replying.current) return;
    replying.current = true;
    setBusy(true);
    try {
      await invoke({ op: 'approval.reply', id: approval.id, approved, ...(approved ? { value } : {}) });
    } catch {
      // The shared error banner reports failures; this card remains available to retry.
      replying.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="approval-card" aria-label={tr("待审批操作")} aria-busy={busy} data-approval-id={approval.id} tabIndex={-1}>
      <div className="approval-content">
        <div className="approval-header" role="alert" aria-atomic="true">
          <div className="approval-eyebrow"><ShieldCheck size={16} /><span>{approval.scope === 'external-tools' ? tr('外部扩展与 MCP') : approval.tool}</span><span className="approval-status">{tr("需要确认")}</span></div>
          <div className="approval-titles">
            <h3 className="approval-title">{approval.kind === 'input' ? tr("请提供回复") : approval.kind === 'select' ? tr("请选择回复") : tr("允许执行此操作？")}</h3>
            {approval.review && <p className="approval-description" data-approval-review={approval.review.risk}>
              <strong>{approval.review.risk === 'high' ? tr('独立审查发现风险，需要你批准') : tr('独立审查无法确认安全，需要你批准')}</strong>
              <br />{localizeAppError(approval.review.reason)}<br />{tr('审查模型：{p0}', { p0: approval.review.model })}
            </p>}
            <pre ref={descriptionRef} className="approval-description" tabIndex={descriptionScrollable ? 0 : -1}>{approval.scope === 'external-tools' ? tr('这些外部程序不在命令沙箱内，将以本机用户权限运行。仅为本次会话授权：') + '\n' : ''}{approval.description}</pre>
          </div>
        </div>
        {approval.kind === 'input' && (
          <input form={'approval-reply-' + approval.id} aria-label={tr("回复内容")} disabled={busy} value={value} onChange={(event) => setValue(event.target.value)} />
        )}
        {approval.kind === 'select' && (
          <select form={'approval-reply-' + approval.id} aria-label={tr("选择回复")} disabled={busy} value={value} onChange={(event) => setValue(event.target.value)}>
            {approval.options?.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        )}
      </div>
      <form id={'approval-reply-' + approval.id} className="approval-footer" onSubmit={event => { event.preventDefault(); void reply(true); }}>
        <div className="approval-actions">
          <button type="button" disabled={busy} onClick={() => void reply(false)}>{tr("拒绝")}</button>
          <button type="submit" className="primary" disabled={busy}>{tr("允许这一次")}</button>
        </div>
      </form>
    </section>
  );
}
