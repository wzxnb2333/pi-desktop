import { SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { threadSchema, uiThreadSchema, type Thread } from '../shared/contracts.ts';
import { MESSAGE_INPUT_ENTRY, storedMessageInputSchema } from '../shared/message-input.ts';
import type { ComposerPayload } from '../shared/composer.ts';
import { restoreItems } from '../worker/timeline.ts';
import { importAttachmentBatch } from './attachment-import.ts';
import { safeProjectPath } from './policy.ts';

/** Fork an immutable session path without starting extensions or mutating a live worker. */
export async function prepareMessageRevision(storage: string, source: Thread, itemId: string, kind: 'edit' | 'regenerate', text?: string) {
  if (!source.sessionFile) throw new Error('消息尚未保存，暂时无法创建分支');
  const at = source.items.findIndex(item => item.id === itemId);
  const selected = source.items[at];
  if (!selected || (kind === 'edit' ? selected.role !== 'user' : selected.role !== 'assistant')) throw new Error('此消息不能执行该操作');
  const user = kind === 'edit' ? selected : source.items.slice(0, at).findLast(item => item.role === 'user');
  if (!user?.entryId) throw new Error('消息尚未保存，暂时无法创建分支');
  const original = SessionManager.open(source.sessionFile);
  const branch = original.getBranch();
  const index = branch.findIndex(entry => entry.id === user.entryId);
  const entry = branch[index];
  if (index < 0 || entry.type !== 'message' || entry.message.role !== 'user') throw new Error('原消息不在当前会话分支中');
  const previous = structuredClone(branch.slice(0, index));
  const id = crypto.randomUUID();
  const sessionRoot = join(storage, 'agent', 'sessions', 'message-revisions', id);
  const attachmentRoot = join(storage, 'attachments', id);
  const cleanup = async () => {
    await rm(sessionRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
    await rm(attachmentRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  };
  try {
    const copies = new Map<string, string>();
    const copy = async (path: string) => {
      if (copies.has(path)) return copies.get(path)!;
      const safe = await safeProjectPath(join(storage, 'attachments', source.id), path);
      const size = await stat(safe); if (!size.isFile() || size.size > 10 * 1024 * 1024) throw new Error('附件必须是小于 10 MB 的普通文件');
      const bytes = await readFile(safe);
      const [destination] = await importAttachmentBatch(storage, id, [{ name: basename(safe), base64: bytes.toString('base64') }]);
      copies.set(path, destination); return destination;
    };
    // Historical cards receive independent copies, so removing the parent cannot break them.
    for (const old of previous) {
      if (old.type !== 'custom' || old.customType !== MESSAGE_INPUT_ENTRY) continue;
      const parsed = storedMessageInputSchema.safeParse(old.data);
      if (!parsed.success) continue;
      for (const part of parsed.data.input.parts) if (part.path) part.path = await copy(part.path);
      old.data = parsed.data;
    }
    const payload: ComposerPayload = { text: text ?? user.input?.text ?? (typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')), attachments: [], context: structuredClone(user.input?.parts.flatMap(part => part.reference ? [part.reference] : []) ?? []) };
    for (const part of user.input?.parts ?? []) if (part.path) payload.attachments.push(await copy(part.path));
    if (!user.input && Array.isArray(entry.message.content)) {
      const images = entry.message.content.filter(part => part.type === 'image');
      for (const [i, image] of images.entries()) {
        const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[image.mimeType];
        if (!extension) throw new Error('不支持此附件格式，请使用 UTF-8 文本或图片');
        payload.attachments.push(...await importAttachmentBatch(storage, id, [{ name: 'image-' + (i + 1) + '.' + extension, base64: image.data }]));
      }
    }
    if (!payload.text.trim() && !payload.attachments.length && !payload.context.length) throw new Error('请输入消息或添加附件与引用');
    await mkdir(sessionRoot, { recursive: true });
    const manager = SessionManager.create(source.cwd, sessionRoot, { parentSession: source.sessionFile });
    const sessionFile = manager.getSessionFile()!;
    // Persist even an empty branch so restart-before-send preserves its identity and parent.
    await writeFile(sessionFile, [manager.getHeader(), ...previous].map(value => JSON.stringify(value)).join('\n') + '\n', { flag: 'wx' });
    const thread = threadSchema.parse({ id, projectId: source.projectId, directoryId: source.directoryId, cwd: source.cwd,
      title: source.title + ' · 分支', modelId: source.modelId, thinking: source.thinking, policy: source.policy, planMode: source.planMode,
      worktreeBranch: source.worktreeBranch, baseCommit: source.baseCommit, workspaceRevision: source.workspaceRevision,
      sessionFile, items: restoreItems(previous), createdAt: Date.now(), updatedAt: Date.now() });
    const ui = uiThreadSchema.parse({ draft: { text: payload.text, attachments: payload.attachments }, contextReferences: payload.context });
    return { thread, ui, payload, allowed: new Set([...copies.values(), ...payload.attachments]), cleanup };
  } catch (error) {
    try { await cleanup(); } catch (failure) { throw new AggregateError([error, failure], '消息分支创建失败，临时目录清理失败'); }
    throw error;
  }
}
