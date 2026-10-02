import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FileContent } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { FilePreview } from './diff.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { filePosition } from '../../lib/message-links.ts';
import { fileBufferDirty, fileBuffers } from '../../lib/file-buffers.ts';
import { FileNavigator } from './file-navigator.tsx';
import { ArtifactPreviewPanel } from './artifact-preview.tsx';

/** The 文件 tool tab: the whole pane is the project tree; opened files become their own panel tabs. */
export function FileNavigatorPanel({ hidden }: { hidden?: boolean }) {
  useLocale();
  const { selectedPath, openFileTab } = useApp();
  return <section className="files-navigator" hidden={hidden}>
    <FileNavigator selectedPath={selectedPath} onOpen={(path, targetLine) => openFileTab(path, targetLine ? { line: targetLine } : undefined)} />
  </section>;
}

/** One open file: toolbar, source editor or PDF/HTML preview, per file tab. */
export function FileTabPanel({ path, blockedClose }: { path: string; blockedClose?: boolean }) {
  useLocale();
  const { activeId, directory, fileScopeId, invoke, act, threadUi, patchThread } = useApp();
  const buffers = useSyncExternalStore(fileBuffers.subscribe, fileBuffers.snapshot);
  const key = fileScopeId + '/' + path;
  const buffer = buffers.get(key);
  const file = buffer?.file;
  const content = buffer?.content ?? '';
  const [actionError, setActionError] = useState<{ scope: string; path: string; message: string }>();
  const error = actionError?.scope === fileScopeId ? localizeAppError(actionError.message) + ' (' + actionError.path + ')' : buffer?.error;
  const [reloadDiscard, setReloadDiscard] = useState<{ content: string; version?: string }>();
  const editor = useRef<HTMLTextAreaElement>(null);
  // Per mount: a fresh tab (task, directory or revisit) replays the reader's last location.
  const handledLocation = useRef('');
  const [line, setLine] = useState(1);
  const [reload, setReload] = useState(0);
  const pdf = /\.pdf$/i.test(path), html = /\.html?$/i.test(path);
  const [sourcePath, setSourcePath] = useState('');
  const preview = pdf || html && sourcePath !== key;
  const jump = useCallback((number: number, column = 1) => {
    const area = editor.current; if (!area) return;
    const position = filePosition(area.value, number, column);
    const style = getComputedStyle(area);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    area.focus(); area.setSelectionRange(position.offset, position.offset);
    area.scrollTop = Math.max(0, position.line - 3) * lineHeight;
    setLine(position.line);
  }, []);
  useEffect(() => {
    const location = threadUi.fileLocation;
    if (!location || location.id === handledLocation.current || location.path !== path || file?.path !== path || file.kind !== 'text') return;
    if (html && sourcePath !== key) { setSourcePath(key); return; }
    jump(location.line, location.column);
    handledLocation.current = location.id;
  }, [file, activeId, path, threadUi.fileLocation, jump, html, sourcePath, key]);
  useEffect(() => {
    setActionError(undefined);
    setReloadDiscard(undefined);
    if (!pdf) void fileBuffers.load(key, async () => await invoke({ op: 'file.read', threadId: activeId, path }) as FileContent);
  }, [activeId, fileScopeId, key, path, invoke, reload, pdf]);
  const dirty = fileBufferDirty(buffer);
  const save = () => {
    setActionError(undefined);
    void fileBuffers.save(key, async (base, content) => await invoke({ op: 'file.write', threadId: activeId, path: base.path, content, version: base.version! }) as FileContent);
  };
  const confirmReload = () => {
    const current = fileBuffers.snapshot().get(key);
    setActionError(undefined);
    setReloadDiscard({ content: current?.content ?? '', version: current?.file?.version });
  };
  return <section className="files-workbench" aria-busy={!!buffer?.loading || !!buffer?.saving}>
    <div className="file-toolbar"><span title={path}>{path.split(/[\\/]/).map((part, index, parts) => index === parts.length - 1 ? <span key={index}>{part}</span> : <button key={index} onClick={() => patchThread({ fileDirectory: parts.slice(0, index + 1).join('/') })}>{part} ›</button>)}</span><button onClick={() => void navigator.clipboard.writeText((directory?.path ?? '').replace(/[\\/]$/, '') + '/' + path)}>{tr("复制路径")}</button><button onClick={() => act({ op: 'file.reveal', threadId: activeId, path })}>{tr("所在目录")}</button><button onClick={() => act({ op: 'file.open', threadId: activeId, path })}>{tr("编辑器")}</button></div>
    {buffer?.loading && <p className="hint file-editor-status" role="status">{tr('正在读取文件…')}</p>}
    {html && <div className="artifact-toolbar"><button aria-pressed={preview} onClick={() => setSourcePath('')}>{tr('渲染预览')}</button><button aria-pressed={!preview} onClick={() => setSourcePath(key)}>{tr('HTML 源码')}</button>{dirty && <span role="status">{tr('预览使用磁盘版本；未保存的源码保留在编辑器中。')}</span>}</div>}
    {preview && <ArtifactPreviewPanel key={key + '/' + reload + '/' + (file?.version ?? '')} path={path} />}
    {file?.kind === 'text' ? <div className="file-source" hidden={preview}><div className="file-toolbar">
      <button disabled={!dirty || !file.writable || buffer?.saving} onClick={save}>{buffer?.saving ? tr('正在保存…') : tr('保存') + (dirty ? ' *' : '')}</button>
      <button disabled={buffer?.saving || buffer?.loading} onClick={() => { if (dirty) confirmReload(); else setReload(value => value + 1); }}>{tr('重新加载')}</button>
      <label>{tr('行')} <input aria-label={tr('定位行号')} type="number" min={1} value={line} onChange={event => setLine(Number(event.target.value))} /></label>
      <button onClick={() => patchThread({ fileLocation: { id: crypto.randomUUID(), path: file.path, line: filePosition(editor.current?.value ?? content, line).line } })}>{tr('跳转')}</button>
      <span className="file-editor-status" role="status" data-save-id={buffer?.saveAttempt?.id} data-save-state={buffer?.saveAttempt?.state} title={buffer?.saveAttempt ? tr('保存操作 {p0}', { p0: buffer.saveAttempt.id }) : undefined}>{buffer?.saving ? tr('正在保存…') : dirty ? tr('有未保存的修改') : tr('已保存到磁盘')}</span>
    </div><textarea ref={editor} className="file-editor" aria-label={tr('文件内容 ') + file.path} spellCheck={false} readOnly={!file.writable} value={content} onChange={event => fileBuffers.edit(key, event.target.value)} /></div> : file && !preview && <FilePreview file={file} />}
    {file?.kind === 'text' && !file.writable && <p className="hint">{file.truncated ? tr("文件较大，仅显示前 512 KB，内置编辑器只读。") : tr("此文件不是受支持的 UTF-8 编码，内置编辑器只读。")}{tr("请使用外部编辑器修改。")}</p>}
    {blockedClose && <div role="alert" className="file-navigation-error"><p>{tr('正在保存 {p0}，请完成后再关闭或重新加载。', { p0: path })}</p></div>}
    {error && <div role="alert" className="file-navigation-error"><p>{localizeAppError(error)}</p>{buffer?.saveAttempt && <details><summary>{tr('保存诊断')}</summary><p>{tr('保存操作 {p0}', { p0: buffer.saveAttempt.id })}</p><p>{tr('基准版本 {p0}', { p0: buffer.saveAttempt.baseVersion.slice(0, 12) })}</p><p>{tr('耗时 {p0} ms', { p0: (buffer.saveAttempt.finishedAt ?? Date.now()) - buffer.saveAttempt.startedAt })}</p></details>}{!file && <button disabled={buffer?.loading} onClick={() => setReload(value => value + 1)}>{tr('重试读取文件')}</button>}</div>}
    {reloadDiscard && <ConfirmDialog title={tr('放弃未保存的文件修改？')} description={(directory?.name ? directory.name + ' / ' : '') + path} confirmLabel={tr('放弃修改')} danger onCancel={() => setReloadDiscard(undefined)} onConfirm={() => {
      const current = fileBuffers.snapshot().get(key);
      if (current?.saving) { setReloadDiscard(undefined); return; }
      if (current?.loading) return;
      if (current?.content !== reloadDiscard.content || current?.file?.version !== reloadDiscard.version) {
        setActionError({ scope: fileScopeId, path, message: '文件内容已变化，未丢弃修改。请核对后重新操作。' }); setReloadDiscard(undefined); return;
      }
      void fileBuffers.load(key, async () => await invoke({ op: 'file.read', threadId: activeId, path }) as FileContent, { discardChanges: true });
      setReloadDiscard(undefined);
    }} />}
  </section>;
}
