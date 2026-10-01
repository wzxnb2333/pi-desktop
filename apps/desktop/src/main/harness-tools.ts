import { stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { Approval, DesktopData, Thread } from '../shared/contracts.ts';
import type { ComposerPreflight } from '../shared/composer.ts';
import { harnessApprovalSchema, harnessArtifactSchema, harnessAttachmentSchema, type HarnessSection } from '../shared/harness-tools.ts';
import { contextReferenceSchema, type ContextReference, type InputCatalog } from '../shared/input-context.ts';
import { projectDirectories, taskDirectory } from '../shared/project-directories.ts';
import { activeSubtask } from '../shared/subtasks.ts';
import { artifactKind } from './artifact-files.ts';
import { contentVersion } from './composer.ts';
import { safeProjectPath } from './policy.ts';

function bounded(value: string, limit: number): string {
  const end = value.length > limit && /[\uD800-\uDBFF]/.test(value[limit - 1]) && /[\uDC00-\uDFFF]/.test(value[limit]) ? limit - 1 : limit;
  return value.slice(0, end);
}

/** Project only approvals owned by this task; never expose thread ownership or reviewer model names. */
export function harnessApprovals(approvals: readonly Approval[], threadId: string) {
  const projected = approvals.filter(item => item.threadId === threadId).map(item => harnessApprovalSchema.parse({
    id: bounded(item.id, 200),
    tool: bounded(item.tool, 200),
    kind: item.kind,
    description: bounded(item.description, 6000),
    ...(item.review ? { review: { risk: item.review.risk, reason: bounded(item.review.reason, 2000) } } : {}),
    ...(item.options ? { options: item.options.slice(0, 50).map(value => bounded(value, 1000)) } : {}),
  }));
  return { version: 1, approvals: projected, total: projected.length };
}

/** Project only known PDF/HTML artifacts owned by this task; never expose the root path. */
export async function harnessArtifacts(thread: Thread, root: string) {
  const projected: ReturnType<typeof harnessArtifactSchema.parse>[] = [];
  const seen = new Set<string>();
  for (const requested of thread.artifacts.slice(-100)) {
    let path = bounded(requested.replaceAll('\\', '/'), 2000);
    try {
      const absolute = await safeProjectPath(root, requested);
      path = bounded(relative(root, resolve(root, absolute)).replaceAll('\\', '/'), 2000);
      if (seen.has(path)) continue;
      const info = await stat(absolute);
      seen.add(path);
      if (!info.isFile()) { projected.push({ path, kind: 'unknown', state: 'invalid' }); continue; }
      if (info.size > 50 * 1024 * 1024) { projected.push({ path, kind: 'unknown', state: 'invalid' }); continue; }
      let kind: 'pdf' | 'html' | 'unknown' = 'unknown';
      try { kind = artifactKind(path); } catch { /* Keep unsupported artifacts visible as invalid metadata. */ }
      projected.push(kind === 'unknown' ? { path, kind, state: 'invalid' } : { path, kind, state: 'ready', size: info.size });
    } catch (error) {
      if (!seen.has(path)) { seen.add(path); projected.push({ path, kind: 'unknown', state: /ENOENT|不存在/.test(String(error)) ? 'missing' : 'invalid' }); }
    }
  }
  const artifacts = projected.map(item => harnessArtifactSchema.parse(item));
  return { version: 1, artifacts, total: artifacts.length };
}

/** Append model-provided notes to the current composer draft without sending or replacing user content. */
export function appendHarnessDraft(current: { text: string; attachments: string[] } | undefined, text: string) {
  const value = text.trim();
  if (!value) throw new Error('草稿内容不能为空');
  const existing = current?.text ?? '';
  const attachments = [...(current?.attachments ?? [])];
  if (existing === value || existing.endsWith('\\n\\n' + value) || existing.endsWith('\\n' + value))
    return { status: 'already_present' as const, draft: { text: existing, attachments } };
  const next = existing ? existing + '\\n\\n' + value : value;
  if (next.length > 1000000) throw new Error('草稿过长，请先处理现有草稿');
  return { status: 'appended' as const, draft: { text: next, attachments } };
}

/** Replace only the text of the current composer draft while preserving attachments. */
export function replaceHarnessDraftText(current: { text: string; attachments: string[] } | undefined, text: string) {
  if (text.length > 1000000) throw new Error('草稿过长，请先处理现有草稿');
  const existing = current?.text ?? '';
  const attachments = [...(current?.attachments ?? [])];
  if (existing === text) return { status: text ? 'already_present' as const : 'already_empty' as const, draft: { text: existing, attachments } };
  return { status: text ? 'replaced' as const : 'cleared' as const, draft: { text, attachments } };
}

type HarnessContextSearchMatch = Pick<ContextReference, 'kind' | 'id' | 'label' | 'directoryId'> & { description: string };
type HarnessContextCatalogInput = {
  readonly commands: readonly InputCatalog['commands'][number][];
  readonly references: readonly InputCatalog['references'][number][];
};

/** Return bounded metadata for the slash/at context picker without reading file contents. */
export function harnessContextCatalog(catalog: HarnessContextCatalogInput, query: string, fileMatches: readonly HarnessContextSearchMatch[] = []) {
  const needle = query.trim().toLocaleLowerCase();
  const options = [
    ...catalog.references.map(reference => ({ reference, description: reference.description })),
    ...fileMatches.map(match => ({
      reference: contextReferenceSchema.parse({
        kind: match.kind,
        id: match.id,
        label: match.label,
        ...(match.directoryId ? { directoryId: match.directoryId } : {}),
      }),
      description: match.description,
    })),
  ];
  const seen = new Set<string>();
  const references = options.filter(item => {
    const { reference } = item;
    const key = JSON.stringify([reference.directoryId, reference.kind, reference.id]);
    if (seen.has(key)) return false;
    seen.add(key);
    if (!needle) return true;
    return [reference.kind, reference.id, reference.label, item.description].some(value => value.toLocaleLowerCase().includes(needle));
  }).slice(0, 100).map(item => ({
    kind: item.reference.kind,
    id: bounded(item.reference.id, 2000),
    label: bounded(item.reference.label, 300),
    ...(item.reference.directoryId ? { directoryId: bounded(item.reference.directoryId, 200) } : {}),
    description: bounded(item.description, 1000),
  }));
  const commands = catalog.commands.filter(command => !needle || command.id.toLocaleLowerCase().includes(needle));
  return { version: 1, query: bounded(query, 300), commands, references, total: references.length, limited: options.length > references.length };
}

/** Return bounded user/assistant message metadata for selecting an existing message reference. */
export function harnessMessageOptions(thread: Thread, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const candidates = thread.items.filter(item => (item.role === 'user' || item.role === 'assistant') && item.text.trim());
  const matched = candidates.filter(item => !needle || [item.id, item.role, item.text].some(value => value.toLocaleLowerCase().includes(needle)));
  const messages = matched.slice(-100).map(item => ({
    id: bounded(item.id, 200),
    role: item.role,
    preview: bounded(item.text.replace(/\s+/g, ' ').trim(), 800),
    textLength: item.text.length,
    quoteable: true,
  }));
  return { version: 1, query: bounded(query, 300), messages, total: matched.length, limited: matched.length > messages.length };
}

/** Read one bounded exact range from a current user/assistant message for a stable quote reference. */
export function harnessMessageContext(thread: Thread, messageId: string, start?: number, end?: number) {
  const message = thread.items.find(item => item.id === messageId);
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) throw new Error('消息不存在或不可引用');
  const explicitRange = start !== undefined || end !== undefined;
  const rangeStart = start ?? 0;
  const rangeEnd = end ?? Math.min(message.text.length, 8000);
  if (rangeStart < 0 || rangeEnd < rangeStart || rangeEnd > message.text.length) throw new Error('消息引用范围超出正文');
  return { version: 1, message: { id: message.id, role: message.role, start: rangeStart, end: rangeEnd, textLength: message.text.length, version: contentVersion(message.text), content: message.text.slice(rangeStart, rangeEnd), truncated: !explicitRange && rangeEnd < message.text.length } };
}

/** Build an exact quote reference without exposing its text in the mutation result. */
export function harnessQuoteReference(thread: Thread, messageId: string, start?: number, end?: number): ContextReference {
  const result = harnessMessageContext(thread, messageId, start, end);
  if (result.message.truncated) throw new Error('消息过长，请先指定完整引用范围');
  return { kind: 'quote', id: result.message.id, label: '引用消息', version: result.message.version,
    quote: { start: result.message.start, end: result.message.end, text: result.message.content } };
}

type HarnessContextIdentity = Pick<ContextReference, 'kind' | 'id' | 'directoryId' | 'range'> & { quote?: { start: number; end: number } };
function harnessContextIdentityKey(reference: HarnessContextIdentity): string {
  return JSON.stringify([reference.directoryId, reference.kind, reference.id, reference.range, reference.quote?.start, reference.quote?.end]);
}

/** Remove one exact composer reference without exposing or changing draft text. */
export function removeHarnessContext(current: readonly ContextReference[], target: HarnessContextIdentity) {
  const key = harnessContextIdentityKey(target);
  const references = current.filter(reference => harnessContextIdentityKey(reference) !== key);
  return { status: references.length < current.length ? 'removed' as const : 'not_found' as const, removed: current.length - references.length, references };
}

/** Return bounded metadata for current draft references without exposing file or quote contents. */
export function harnessContextReferences(references: readonly ContextReference[]) {
  const projected = references.slice(0, 1000).map(reference => ({
    kind: reference.kind, id: bounded(reference.id, 2000), label: bounded(reference.label, 300),
    ...(reference.directoryId ? { directoryId: bounded(reference.directoryId, 200) } : {}),
    ...(reference.version ? { version: bounded(reference.version, 100) } : {}),
    ...(reference.range ? { range: reference.range } : {}),
    ...(reference.quote ? { quote: { start: reference.quote.start, end: reference.quote.end, textLength: reference.quote.text.length } } : {}),
  }));
  return { version: 1, references: projected, total: references.length, limited: references.length > projected.length };
}

function attachmentIdentity(path: string): string {
  return contentVersion(path.replaceAll('\\', '/'));
}

function attachmentRevision(attachments: readonly string[]): string {
  return contentVersion(JSON.stringify(attachments.map(path => path.replaceAll('\\', '/'))));
}

/** Add managed attachment paths with an optimistic revision check. */
export function addHarnessDraftAttachments(current: readonly string[], additions: readonly string[], revision: string) {
  if (attachmentRevision(current) !== revision) throw new Error('草稿附件已变化，请先重新读取');
  const attachments = [...current];
  for (const path of additions) if (!attachments.includes(path)) attachments.push(path);
  if (attachments.length > 10) throw new Error('每次最多保留 10 个草稿附件');
  return {
    status: attachments.length > current.length ? 'added' as const : 'already_present' as const,
    added: attachments.length - current.length,
    attachments,
    revision: attachmentRevision(attachments),
  };
}

/** Return bounded attachment metadata without exposing absolute paths or file contents. */
export async function harnessDraftAttachments(root: string, attachments: readonly string[]) {
  const projected: Array<ReturnType<typeof harnessAttachmentSchema.parse>> = [];
  for (const requested of attachments.slice(0, 1000)) {
    const raw = requested.replaceAll('\\', '/');
    const fallbackName = bounded(basename(raw) || raw, 255);
    let item: ReturnType<typeof harnessAttachmentSchema.parse> = { id: attachmentIdentity(requested), name: fallbackName, path: fallbackName, location: 'unknown', state: 'missing' };
    let projectPath: string | undefined;
    try {
      projectPath = await safeProjectPath(root, requested);
    } catch {
      /* Continue with a basename-only external projection when the path is outside the project. */
    }
    if (projectPath) {
      const path = bounded(relative(root, resolve(root, projectPath)).replaceAll('\\', '/'), 2000);
      item = { id: attachmentIdentity(requested), name: bounded(basename(path) || fallbackName, 255), path, location: 'project', state: 'missing' };
      try {
        const info = await stat(projectPath);
        item = { ...item, state: !info.isFile() || info.size > 10 * 1024 * 1024 ? 'invalid' : 'ready', ...(info.isFile() && info.size <= 10 * 1024 * 1024 ? { size: info.size } : {}) };
      } catch {
        /* Keep project attachment as missing metadata. */
      }
    } else if (isAbsolute(requested)) {
      item = { ...item, location: 'external' };
      try {
        const info = await stat(requested);
        item = { ...item, state: !info.isFile() || info.size > 10 * 1024 * 1024 ? 'invalid' : 'ready', ...(info.isFile() && info.size <= 10 * 1024 * 1024 ? { size: info.size } : {}) };
      } catch {
        /* Keep the external attachment as missing metadata. */
      }
    }
    projected.push(harnessAttachmentSchema.parse(item));
  }
  const attachmentsResult = projected.map(item => harnessAttachmentSchema.parse(item));
  return { version: 1, revision: attachmentRevision(attachments), attachments: attachmentsResult, total: attachments.length, limited: attachments.length > attachmentsResult.length };
}

/** Remove one draft attachment by an opaque identity and an optimistic revision. */
export function removeHarnessDraftAttachment(current: readonly string[], id: string, revision: string) {
  if (attachmentRevision(current) !== revision) throw new Error('草稿附件已变化，请先重新读取');
  const index = current.findIndex(path => attachmentIdentity(path) === id);
  if (index < 0) return { status: 'not_found' as const, removed: 0, attachments: [...current], revision: attachmentRevision(current) };
  const attachments = current.filter((_path, item) => item !== index);
  return { status: 'removed' as const, removed: 1, attachments, revision: attachmentRevision(attachments) };
}

/** Project composer preflight without returning draft text or attachment/context contents. */
export function harnessDraftPreflight(draft: { text: string; attachments: readonly string[] }, contextReferences: readonly ContextReference[], result: ComposerPreflight) {
  return {
    version: 1,
    valid: result.issues.length === 0,
    issues: result.issues.slice(0, 100).map(issue => ({ target: bounded(issue.target, 300), message: bounded(issue.message, 2000) })),
    estimatedTokens: result.estimatedTokens,
    contextWindow: result.contextWindow,
    images: result.images,
    textLength: draft.text.length,
    attachments: draft.attachments.length,
    contextReferences: contextReferences.length,
  };
}

/** Return a stable, content-free composer revision for coordinating follow-up harness calls. */
export function harnessDraftState(draft: { text: string; attachments: readonly string[] }, contextReferences: readonly ContextReference[]) {
  const revision = contentVersion(JSON.stringify({
    text: draft.text,
    attachments: draft.attachments.map(path => path.replaceAll('\\', '/')),
    context: contextReferences.map(reference => ({
      kind: reference.kind,
      id: reference.id,
      directoryId: reference.directoryId,
      version: reference.version,
      range: reference.range,
      quote: reference.quote ? { start: reference.quote.start, end: reference.quote.end } : undefined,
    })),
  }));
  return {
    version: 1,
    revision,
    hasText: draft.text.trim().length > 0,
    textLength: draft.text.length,
    attachments: draft.attachments.length,
    contextReferences: contextReferences.length,
  };
}

/** Return metadata for restorable draft snapshots without exposing their text or paths. */
export function harnessDraftHistory(thread: Thread) {
  const items = (thread.draftHistory ?? []).slice(0, 20).map(snapshot => ({
    id: bounded(snapshot.id, 200),
    at: snapshot.at,
    textLength: snapshot.text.length,
    attachments: snapshot.attachments.length,
    contextReferences: snapshot.context.length,
  }));
  return { version: 1, items, total: items.length };
}

/** Return bounded metadata for messages waiting in this chat's steer/follow-up queue. */
export function harnessQueuedMessages(thread: Thread) {
  const queue = thread.queue ?? [];
  const messages = queue.slice(0, 100).map(item => ({
    ...(item.id ? { id: bounded(item.id, 200) } : {}),
    revision: item.revision ?? 0,
    kind: item.kind,
    preview: bounded(item.text.replace(/\s+/g, ' ').trim(), 1200),
    textLength: item.text.length,
    attachments: item.attachments.length,
    contextReferences: item.context?.length ?? 0,
  }));
  return { version: 1, messages, total: queue.length, limited: queue.length > messages.length, revision: harnessQueueRevision(queue) };
}

/** Return an opaque revision for the current steer/follow-up queue. */
export function harnessQueueRevision(queue: readonly NonNullable<Thread['queue']>[number][]) {
  const entries = queue.map(item => ({
    id: item.id ?? '', revision: item.revision ?? 0, text: item.text, attachments: item.attachments, kind: item.kind, context: item.context ?? [],
  })).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.revision - b.revision);
  return contentVersion(JSON.stringify(entries));
}

/** Explicit projection only: never serialize settings, credentials, drafts or unrelated tasks. */
export function harnessSnapshot(data: DesktopData, thread: Thread, captured: Thread, section: HarnessSection, currentUi = data.ui) {
  const project = data.projects.find(project => project.id === captured.projectId);
  const readOnly = !!thread.review || !!thread.sidechat?.temporary || thread.planMode || captured.planMode || thread.policy === 'deny' || captured.policy === 'deny';
  const children = data.subtasks.filter(record => record.parentThreadId === thread.id);
  const sidechats = data.threads.filter(item => item.sidechat?.temporary && item.sidechat.parentThreadId === thread.id && !item.deletedAt)
    .slice(-20).map(item => ({ id: item.id, status: item.status, updatedAt: item.updatedAt }));
  return {
    version: 1,
    permissions: { capturedPolicy: captured.policy, currentPolicy: thread.policy, readOnly,
      commandExecution: readOnly ? 'disabled' : captured.policy === 'full' && thread.policy === 'full' ? 'full' : 'sandbox',
      canDelegate: data.settings.subtasksEnabled && !thread.subtaskId && !thread.review && !thread.sidechat?.temporary,
      canAskParent: !!thread.subtaskId, canChangePolicy: false },
    ...(['all', 'session'].includes(section) ? { session: {
      id: thread.id, title: thread.title, role: thread.subtaskId ? 'child' : thread.review ? 'review' : thread.sidechat?.temporary ? 'sidechat' : 'main',
      status: thread.status, model: { modelId: captured.modelId, thinking: captured.thinking },
      usage: thread.usage, plan: thread.plan, goal: thread.goal ? { objective: thread.goal.objective, status: thread.goal.status } : null,
      queuedMessages: thread.queue?.length ?? 0, activeChildren: children.filter(activeSubtask).length,
      pendingChildQuestions: children.reduce((sum, child) => sum + (child.questions?.filter(question => question.status === 'pending').length ?? 0), 0),
    } } : {}),
    ...(['all', 'view'].includes(section) ? { view: {
      appView: currentUi.view,
      activeThreadId: currentUi.activeThreadId,
      sidebarOpen: currentUi.sidebarOpen,
      reviewOpen: currentUi.reviewOpen,
      summaryOpen: currentUi.summaryOpen ?? false,
      activePanelTab: currentUi.threads[thread.id]?.activePanelTab ?? null,
      activeBrowserTab: currentUi.threads[thread.id]?.activeBrowserTab ?? null,
      sidechatId: currentUi.threads[thread.id]?.sidechatId ?? null,
      sidechats,
      panelTabs: (currentUi.threads[thread.id]?.panelTabs ?? []).slice(-20),
      browserTabs: (currentUi.threads[thread.id]?.browserTabs ?? []).slice(-20),
      selectedPath: currentUi.threads[thread.id]?.selectedPath ?? '',
    } } : {}),
    ...(['all', 'workspace'].includes(section) ? { workspace: {
      projectId: captured.projectId, cwd: captured.cwd, branch: captured.worktreeBranch ?? null,
      directories: project ? projectDirectories(project).filter(directory => !thread.subtaskId || directory.id === (captured.directoryId ?? project.id))
        .map(directory => taskDirectory(project, captured, directory.id)) : [],
    } } : {}),
    ...(['all', 'operations'].includes(section) ? { operations: data.operations.filter(operation => operation.threadId === thread.id).slice(-30)
      .map(operation => ({ id: operation.id, kind: operation.kind, status: operation.status, stage: operation.stage, startedAt: operation.startedAt, endedAt: operation.endedAt })) } : {}),
  };
}
