import { tr, localizeAppError } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { AtSign, GitBranch, ListChecks, Shield, Sparkles, Paperclip, Folder, Terminal, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Thread } from '../../../../shared/contracts.ts';
import { permissionModes, policyDescriptions, policyLabels } from '../../lib/labels.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { ReferenceIcon } from '../primitives/reference-icon.tsx';
import { type MenuOption, Menu } from '../primitives/menu.tsx';
import { HomeUtility } from './home-utility.tsx';
import { readAttachmentFiles } from '../../lib/attachment-files.ts';
import { mergeContextReferences } from '../../../../shared/input-context.ts';
import { InputPicker } from './input-picker.tsx';
import { BindProject } from './bind-project.tsx';
import { ModelCapabilities } from './model-capabilities.tsx';
import { ContextUsage } from './context-usage.tsx';
import { ComposerSuggestions, type SuggestionsHandle } from './suggestions.tsx';
import { composerTrigger, type ComposerTrigger } from '../../lib/composer-trigger.ts';
import '../../styles/input-picker.css';
import '../../styles/composer-enhancements.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { composerPayloadSchema, preflightSchema, sendReceiptSchema, contextDetailSchema, referenceKey, type ComposerPreflight } from '../../../../shared/composer.ts';
import { type ContextReference, type InputCommand } from '../../../../shared/input-context.ts';
import { ComposerPanel, DraftHistory, PromptTemplates, ReferenceDetail } from './composer-panels.tsx';
import { AttachmentPreview } from './attachment-preview.tsx';
import { QueueControls } from './queue-controls.tsx';
import { GoalPanel } from '../panels/goal-panel.tsx';


/**
 * Ceiling for the input box, in px: the effect below reads `scrollHeight`, which is px. 200px is ten
 * lines of `--font-sm-lh` (20px). At the ceiling the box stops growing and starts scrolling, so a
 * pasted multi-page prompt cannot push the composer over the timeline.
 */
const MAX_INPUT_HEIGHT = 200;

/**
 * One 28px control size for the whole composer. `--control-size-composer`
 * (`--spacing-token-button-composer`, `app-shared-11c21cbb0024.css:18755` = `calc(var(--spacing)*7)`) is
 * numerically `--control-size-sm`, so asking the shared primitives for `size="sm"` lands the ported
 * metric instead of a hand-written width in `composer.css`.
 */
const CONTROL = 'sm';

export function Composer({ home = false }: { home?: boolean }) {
  useLocale();
  const {
    thread,
    data,
    running,
    invoke,
    act,
    text,
    setText,
    attachments,
    setAttachments,
    composerRef,
    followRef,
    createThread,
    updateDraft, setError, threadUi, updateContextReferences, setReviewOpen, setReviewTab,
  } = useApp();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(0);
  const importingRef = useRef(0);
  const pendingAttachments = useRef(new Map<string, number>());
  const referenceSelections = useRef(new Map<string, { threadId: string; selection: AbortController }>());
  const [referenceThreads, setReferenceThreads] = useState<string[]>([]);
  useEffect(() => () => { for (const item of referenceSelections.current.values()) item.selection.abort(); }, []);
  const [picker, setPicker] = useState<{ id: string; tab: 'files' | 'commands' | 'skill' | 'tool'; trigger?: ComposerTrigger }>();
  const [caret, setCaret] = useState<{ id: string; start: number; end: number; value: string; focused: boolean }>();
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const [activeOption, setActiveOption] = useState<string>();
  const suggestionsRef = useRef<SuggestionsHandle>(null);
  const suggestionsId = useId();
  const [withdrawing, setWithdrawing] = useState(false);
  const [queueModes, setQueueModes] = useState<Record<string, 'steer' | 'followUp'>>({});

  const [panel, setPanel] = useState<{ id: string; kind: string }>();
  const [detail, setDetail] = useState<{ id: string; reference: ContextReference }>();
  const [expanded, setExpanded] = useState(''), [preview, setPreview] = useState(false);
  const [delivery, setDelivery] = useState<{ id: string; status: string; error?: string; check?: ComposerPreflight }>();
  const [failedImports, setFailedImports] = useState<Array<{ id: string; threadId: string; file: File; error: string }>>([]);
  const [importItems, setImportItems] = useState<Array<{ id: string; threadId: string; name: string }>>([]);
  const draftKey = JSON.stringify([thread?.id, text, attachments, threadUi.contextReferences, thread?.modelId]);
  useEffect(() => { setDelivery(previous => previous && ['failed', 'checked', 'accepted'].includes(previous.status) ? undefined : previous); }, [draftKey]);

  // Declared before the early return so the hook count never depends on whether a task is selected.
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, expanded === thread?.id ? Math.max(240, window.innerHeight * .48) : MAX_INPUT_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  }, [composerRef, text, expanded, thread?.id]);

  if (!thread) return null;
  const tokenKey = JSON.stringify([thread.id, text, caret?.start, caret?.end]);
  const suggestion = !composing && !withdrawing && picker?.id !== thread.id && panel?.id !== thread.id && !preview && caret?.id === thread.id && caret.focused && caret.value === text && tokenKey !== dismissed
    ? composerTrigger(text, caret.start, caret.end) : undefined;
  const captureCaret = (element: HTMLTextAreaElement) => setCaret({ id: thread.id, start: element.selectionStart, end: element.selectionEnd, value: element.value, focused: document.activeElement === element });
  const consumeTrigger = (token: ComposerTrigger, replacement = '') => {
    const id = thread.id;
    updateDraft(id, draft => draft.text.slice(token.start, token.end) === token.kind + token.query
      ? { ...draft, text: draft.text.slice(0, token.start) + replacement + draft.text.slice(token.end) } : draft);
    setCaret(undefined);
    requestAnimationFrame(() => { const input = composerRef.current; if (input?.dataset.threadId === id) { input.focus(); input.setSelectionRange(token.start + replacement.length, token.start + replacement.length); } });
  };
  const queueMode = queueModes[thread.id] ?? data.settings.followUpMode;
  const references = threadUi.contextReferences ?? [];
  const addingReference = referenceThreads.includes(thread.id);
  const addReference = async (reference: ContextReference, selection: AbortController) => {
    if (selection.signal.aborted || submitting.current || withdrawing) return false;
    const id = crypto.randomUUID(), threadId = thread.id;
    const release = () => {
      if (referenceSelections.current.delete(id)) setReferenceThreads([...referenceSelections.current.values()].map(item => item.threadId));
    };
    referenceSelections.current.set(id, { threadId, selection });
    setReferenceThreads([...referenceSelections.current.values()].map(item => item.threadId));
    selection.signal.addEventListener('abort', release, { once: true });
    try {
      const detail = contextDetailSchema.parse(await invoke({ op: 'composer.contextDetail', threadId, reference }));
      if (selection.signal.aborted) return false;
      updateContextReferences(threadId, current => mergeContextReferences(current, [detail.reference]));
      return true;
    } finally { selection.signal.removeEventListener('abort', release); release(); }
  };
  const sendLabel = running ? (queueMode === 'steer' ? tr('引导发送') : tr('排队发送')) : tr('发送消息');

  const payload = { text, attachments, context: references, ...(running ? { queue: queueMode } : {}) };
  const send = async () => {
    if ((!text.trim() && !attachments.length && !references.length) || !thread.modelId || submitting.current || withdrawing || importingRef.current || [...referenceSelections.current.values()].some(item => item.threadId === thread.id)) return;
    if (text.length > 100000 || attachments.length > 10 || references.length > 20) { setError(tr('每条消息最多 100000 字和 10 个附件；撤回内容已完整保留，请分批发送。')); return; }
    const id = thread.id, value = text;
    submitting.current = true; setPending(true); setDelivery({ id, status: 'checking' });
    try {
      const serialized = JSON.stringify(payload), key = 'pi-composer-send:' + id;
      let previous: { requestId: string; payload: string } | undefined;
      try { previous = JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined; } catch { /* Ignore malformed local UI state. */ }
      let previousPayload: typeof payload | undefined;
      try { previousPayload = previous ? composerPayloadSchema.parse(JSON.parse(previous.payload)) : undefined; } catch { /* A malformed attempt never authorizes a send. */ }
      const sameContent = previousPayload && JSON.stringify({ ...previousPayload, queue: undefined }) === JSON.stringify({ ...payload, queue: undefined });
      // Resolve an existing receipt first: sources may have changed after an accepted send.
      // The main process still validates every new or failed attempt before execution.
      if (!sameContent) {
        const check = preflightSchema.parse(await invoke({ op: 'composer.preflight', threadId: id, payload }));
        setDelivery({ id, status: check.issues.length ? 'failed' : 'sending', check });
        if (check.issues.length) return;
      } else setDelivery({ id, status: 'sending' });
      const requestId = sameContent && previous ? previous.requestId : crypto.randomUUID();
      const sending = sameContent && previousPayload ? previousPayload : payload;
      localStorage.setItem(key, JSON.stringify({ requestId, payload: sameContent ? previous!.payload : serialized }));
      const receipt = sendReceiptSchema.parse(await invoke({ op: 'thread.send', id, requestId, ...sending }));
      if (receipt.status === 'uncertain') { setDelivery({ id, status: 'uncertain' }); return; }
      if (receipt.status !== 'accepted') throw new Error(receipt.error ?? tr('发送失败，内容已保留'));
      localStorage.removeItem(key);
      updateDraft(id, draft => ({ text: draft.text === value ? '' : draft.text, attachments: draft.attachments.filter(path => !attachments.includes(path)) }));
      updateContextReferences(id, current => current.filter(item => !references.some(sent => referenceKey(sent) === referenceKey(item))));
      setDelivery({ id, status: 'accepted' }); followRef.current = true;
    } catch (reason) { setDelivery({ id, status: 'failed', error: localizeAppError(reason instanceof Error ? reason.message : String(reason)) }); }
    finally { submitting.current = false; setPending(false); }
  };
  const openCommand = (command: InputCommand) => {
    setPicker(undefined);
    if (command === 'expand') { setExpanded(thread.id); setPreview(false); requestAnimationFrame(() => composerRef.current?.focus()); }
    else if (command === 'review') { setReviewTab('review'); setReviewOpen(true); }
    else setPanel({ id: thread.id, kind: command });
  };
  const updateThread = (patch: Partial<Pick<Thread, 'modelId' | 'thinking' | 'policy' | 'planMode'>>) =>
    act({ op: 'thread.update', id: thread.id, ...patch });
  const addFiles = async (files: File[]) => {
    if (withdrawing) return;
    const id = thread.id;
    if (attachments.length + (pendingAttachments.current.get(id) ?? 0) + files.length > 10) { setError(tr('每次最多添加 10 个附件')); return; }
    pendingAttachments.current.set(id, (pendingAttachments.current.get(id) ?? 0) + files.length);
    importingRef.current++; setImporting(importingRef.current);
    const incoming = files.map(file => ({ id: crypto.randomUUID(), threadId: id, name: file.name }));
    setImportItems(current => [...current, ...incoming]);
    try {
      for (const [index, file] of files.entries()) {
        try {
          const result = await invoke({ op: 'attachment.add', threadId: id, files: await readAttachmentFiles([file]) });
          if (!Array.isArray(result) || !result.every((path): path is string => typeof path === 'string')) throw new Error(tr('附件内容格式无效'));
          updateDraft(id, draft => ({ ...draft, attachments: [...new Set([...draft.attachments, ...result])] }));
        } catch (reason) { setFailedImports(previous => [...previous, { id: crypto.randomUUID(), threadId: id, file, error: localizeAppError(reason instanceof Error ? reason.message : String(reason)) }]); }
        finally { setImportItems(current => current.filter(item => item.id !== incoming[index].id)); }
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pendingAttachments.current.set(id, (pendingAttachments.current.get(id) ?? 0) - files.length); importingRef.current--; setImporting(importingRef.current); }
  };

  // The shield sits in an inline span, so without an explicit row it lands on the text baseline and
  // its gap is a literal space; `composer-policy-label` gives the trigger and every menu row the same
  // icon centring and spacing.
  const policyLabel = (value: Thread['policy']) =>
    <span className="composer-policy-label" title={policyDescriptions[value]}><Shield size={14} aria-hidden="true" />{policyLabels[value]}</span>;
  const policyOptions: MenuOption[] = permissionModes.map(value => ({ value, label: policyLabel(value) }));
  const policyMenu = <Menu
    label={tr("执行策略")}
    className={'composer-menu-policy policy-' + thread.policy}
    size={CONTROL}
    side="top"
    disabled={running || !!thread.review || !!thread.sidechat?.temporary}
    value={thread.policy}
    display={policyLabel(thread.policy)}
    options={policyOptions}
    onChange={(policy) => updateThread({ policy: policy as Thread['policy'] })}
  />;

  return (
    <div className="composer-area" data-home-composer={home || undefined}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); if ([...event.dataTransfer.items].some(item => item.webkitGetAsEntry()?.isDirectory)) { setError(tr('请通过上下文选择器引用文件夹')); return; } void addFiles(Array.from(event.dataTransfer.files)); }}
      onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addFiles(files); } }}>
      {importItems.filter(item => item.threadId === thread.id).map(item => <p key={item.id} className="hint composer-import-status" role="status">{item.name} · {tr('正在添加附件…')}</p>)}
      {!!thread.queue?.length && <div className="queued-messages" aria-label={tr("排队消息")}>
        <div>{tr("待发送 ·")} {thread.queue.length}<Button size="xs" disabled={withdrawing} onClick={() => { setWithdrawing(true); void invoke({ op: 'thread.queueClear', id: thread.id }).catch(() => {}).finally(() => setWithdrawing(false)); }}>{tr("全部撤回至草稿")}</Button></div>
        <QueueControls key={thread.id} />
      </div>}
      {home && <HomeUtility />}
      {!home && !thread.projectId && <BindProject />}
      {picker?.id === thread.id && <InputPicker key={thread.id} initial={picker.tab} onCommand={openCommand} onClose={() => setPicker(undefined)} onSelect={async (reference, selection) => {
        const accepted = await addReference(reference, selection);
        if (accepted && !selection.signal.aborted && picker.trigger) { consumeTrigger(picker.trigger); setPicker(undefined); }
        return accepted;
      }} />}
      {suggestion && <ComposerSuggestions key={thread.id + suggestion.kind} trigger={suggestion} draftText={text} controller={suggestionsRef} listId={suggestionsId}
        onCommand={openCommand} onTemplate={value => consumeTrigger(suggestion, value)} onActiveId={setActiveOption} onDismiss={() => setDismissed(tokenKey)} onComplete={() => consumeTrigger(suggestion)}
        onReference={addReference}
        onBrowse={() => setPicker({ id: thread.id, tab: 'files', trigger: suggestion })} />}
      {panel?.id === thread.id && panel.kind === 'goal' && <GoalPanel close={() => setPanel(undefined)} />}
      {panel?.id === thread.id && panel.kind === 'history' && <DraftHistory close={() => setPanel(undefined)} />}
      {panel?.id === thread.id && panel.kind === 'templates' && <PromptTemplates close={() => setPanel(undefined)} />}
      {panel?.id === thread.id && panel.kind === 'help' && <ComposerPanel title={tr('输入帮助')} close={() => setPanel(undefined)}><p>{tr('输入 / 选择命令、技能或模板；输入 @ 搜索所有项目目录。')}</p><p>{tr('使用 + 管理附件、草稿历史和长消息编辑。运行时可选择引导或排队。')}</p><p>/plan · /goal · /review · /compact · /stop · /templates · /history · /expand</p></ComposerPanel>}
      {detail?.id === thread.id && <ReferenceDetail key={referenceKey(detail.reference)} reference={detail.reference} close={() => setDetail(undefined)} />}
      {delivery?.id === thread.id && <div className="composer-delivery" role={delivery.status === 'failed' ? 'alert' : 'status'}>
        {delivery.status === 'checking' ? tr('检查中…') : delivery.status === 'sending' ? tr('正在发送…') : delivery.status === 'checked' ? tr('发送前检查') : delivery.status === 'accepted' ? tr('已接收') : delivery.status === 'uncertain' ? tr('发送状态未知，请先检查会话；未自动重发。') : tr('发送失败，内容已保留')}
        {delivery.error && <p>{delivery.error}</p>}{delivery.check?.issues.map((issue, index) => <p key={index}>{issue.target} {localizeAppError(issue.message)}</p>)}
        {delivery.check && <small>{tr('预计新增 {p0} tokens（含图片粗估），模型窗口 {p1}。', { p0: delivery.check.estimatedTokens, p1: delivery.check.contextWindow })} {tr('这是本地估算，不代表供应商实际用量。')}</small>}
        {delivery.status === 'failed' && <Button size="xs" disabled={pending} onClick={() => void send()}>{tr('重试')}</Button>}
      </div>}
      {failedImports.filter(item => item.threadId === thread.id).map(item => <div className="composer-import-error" role="alert" key={item.id}><span>{item.file.name} · {item.error}</span><Button size="xs" onClick={() => { setFailedImports(previous => previous.filter(row => row.id !== item.id)); void addFiles([item.file]); }}>{tr('重试')}</Button><IconButton label={tr('移除附件 {p0}', { p0: item.file.name })} size="sm" onClick={() => setFailedImports(previous => previous.filter(row => row.id !== item.id))}><X size={14} /></IconButton></div>)}
      {addingReference && <div className="composer-import-status" role="status">{tr('正在添加引用…')} <Button size="xs" onClick={() => { for (const item of referenceSelections.current.values()) if (item.threadId === thread.id) item.selection.abort(); }}>{tr('取消添加引用')}</Button></div>}
      <div className={'composer' + (expanded === thread.id ? ' composer-expanded' : '')} data-composer-layout="multiline" data-composer-surface-variant="opaque">
        <div className="composer-context" aria-label={tr('已引用的上下文')}>
          {references.map(reference => <span className="attachment" key={referenceKey(reference)} title={reference.id}>
            <button type="button" className="composer-reference-open" onClick={() => setDetail({ id: thread.id, reference })}><AtSign size={12} /><span className="attachment-name">{reference.label}{reference.range && `:${reference.range.start}-${reference.range.end}`}</span></button>
            <button type="button" className="icon-button btn-icon btn-2xs attachment-remove" aria-label={tr('移除引用 {p0}', { p0: reference.label })}
              onClick={() => updateContextReferences(thread.id, current => current.filter(item => referenceKey(item) !== referenceKey(reference)))}><X size={12} /></button>
          </span>)}
        </div>
        <div className="attachments" data-visible-attachments={attachments.length > 0 || undefined}>
          {attachments.map(path => <AttachmentPreview key={path} path={path} disabled={withdrawing} remove={() => setAttachments(attachments.filter(item => item !== path))} />)}
        </div>
        {(expanded === thread.id || text.length > 500) && <div className="composer-editor-tools"><Button size="xs" onClick={() => { setExpanded(expanded === thread.id ? '' : thread.id); setPreview(false); }}>{tr(expanded === thread.id ? '收起编辑' : '展开编辑')}</Button>{expanded === thread.id && <Button size="xs" aria-pressed={preview} onClick={() => setPreview(!preview)}>{tr(preview ? '编辑草稿' : '预览草稿')}</Button>}</div>}
        {expanded === thread.id && preview && <div className="markdown composer-draft-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>}
        {/*
         * `rows={1}` is load-bearing: `scrollHeight` never reports less than the element's intrinsic
         * height, and a textarea defaults to two rows, so the grow-to-fit effect would floor at ~40px
         * and an empty composer could never collapse to one line.
         */}
        <textarea
          ref={composerRef}
          className="composer-input" hidden={expanded === thread.id && preview}
          data-thread-id={thread.id}
          rows={1}
          aria-label={tr("向 Pi 发送消息")}
          aria-autocomplete="list"
          aria-controls={suggestion ? suggestionsId : undefined}
          aria-activedescendant={suggestion ? activeOption : undefined}
          title={tr('输入 / 选择命令或技能，@ 引用上下文')}
          placeholder={running ? (queueMode === 'steer' ? tr('补充说明，引导当前任务…') : tr("补充说明，发送到队列…")) : tr("描述任务，或提出一个问题…")}
          value={text}
          readOnly={withdrawing}
          onChange={(event) => { setText(event.target.value); captureCaret(event.currentTarget); }}
          onSelect={event => captureCaret(event.currentTarget)}
          onFocus={event => captureCaret(event.currentTarget)}
          onBlur={() => setCaret(previous => previous ? { ...previous, focused: false } : previous)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={event => { setComposing(false); captureCaret(event.currentTarget); }}
          onKeyDown={(event) => {
            if (composing || event.nativeEvent.isComposing) return;
            if (suggestion && suggestionsRef.current?.keyDown(event)) return;
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              !event.shiftKey &&
              (data.settings.sendShortcut === 'enter' || event.ctrlKey)
            ) {
              event.preventDefault();
              void send().catch(() => {});
            }
          }}
        />
        <div className="composer-actions">
          <Menu label={tr('添加上下文与操作')} className="composer-add-menu" iconOnly kind="action" size={CONTROL} side="top" value=""
            disabled={withdrawing || importing > 0} display={<ReferenceIcon name="plus" size={20} />}
            options={[
              { value: 'attachments', label: <><Paperclip size={16} />{tr('添加附件')}</> },
              { value: 'files', label: <><Folder size={16} />{tr('文件与文件夹')}</>, disabled: !thread.projectId },
              { value: 'skill', label: <><Sparkles size={16} />{tr('选择技能')}</> },
              { value: 'tool', label: <><Terminal size={16} />{tr('工具')}</> },
              { value: 'expand', label: tr('展开编辑') }, { value: 'history', label: tr('草稿历史') }, { value: 'templates', label: tr('提示词模板') }, { value: 'preflight', label: tr('发送前检查'), disabled: addingReference },
              { value: 'plan', label: <><ListChecks size={16} />{tr(thread.planMode ? '关闭计划模式' : '开启计划模式')}</>, disabled: running },
              ...(thread.projectId && !thread.worktreeBranch ? [{ value: 'worktree', label: <><GitBranch size={16} />{tr('新建 Worktree')}</>, disabled: running }] : []),
            ]} onChange={value => {
              if (value === 'attachments') { const id = thread.id; void invoke({ op: 'attachment.pick', threadId: id }).then(paths => {
                updateDraft(id, draft => ({ ...draft, attachments: [...new Set([...draft.attachments, ...(paths as string[])])] }));
              }).catch(() => {}); }
              else if (value === 'preflight') { setDelivery({ id: thread.id, status: 'checking' }); void invoke({ op: 'composer.preflight', threadId: thread.id, payload }).then(raw => { const check = preflightSchema.parse(raw); setDelivery({ id: thread.id, status: check.issues.length ? 'failed' : 'checked', check }); }).catch(reason => setDelivery({ id: thread.id, status: 'failed', error: String(reason) })); }
              else if (['expand', 'history', 'templates'].includes(value)) openCommand(value as InputCommand);
              else if (value === 'plan') updateThread({ planMode: !thread.planMode });
              else if (value === 'worktree') void createThread(thread.projectId, true).catch(() => {});
              else setPicker({ id: thread.id, tab: value as 'files' | 'skill' | 'tool' });
            }} />
          {policyMenu}
          {thread.planMode && <Button className="composer-plan-chip" size="xs" aria-label={tr('关闭计划模式')} disabled={running} onClick={() => updateThread({ planMode: false })}><ListChecks size={13} /><span>{tr('计划模式')}</span><X size={12} /></Button>}
          <span className="flex-spacer" />
          <ContextUsage usage={thread.usage} />
          <ModelCapabilities key={thread.id} />
          <div className="composer-submit-controls">
            {running && <Menu label={tr('运行中追加消息')} size={CONTROL} side="top" align="end" value={queueMode}
              options={[{ value: 'steer', label: tr('引导') }, { value: 'followUp', label: tr('排队') }]}
              onChange={value => setQueueModes(previous => ({ ...previous, [thread.id]: value as 'steer' | 'followUp' }))} />}
            {running && (
              <IconButton
                label={tr("停止任务")}
                size={CONTROL}
                onClick={() => act({ op: 'thread.stop', id: thread.id })}
              >
                <ReferenceIcon name="stop" size={20} />
              </IconButton>
            )}
            <Button
              className="send-button"
              variant="primary"
              size={CONTROL}
              aria-label={sendLabel}
              title={sendLabel}
              disabled={pending || withdrawing || importing > 0 || addingReference || (!text.trim() && !attachments.length && !references.length) || !thread.modelId}
              onClick={() => void send().catch(() => {})}
            >
              <ReferenceIcon name="send" size={20} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
