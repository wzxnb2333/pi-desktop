import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FileContent } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { FilePreview } from './diff.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Tabs } from '../primitives/tabs.tsx';
import { filePosition } from '../../lib/message-links.ts';
import { fileBufferDirty, fileBuffers } from '../../lib/file-buffers.ts';
import { FileNavigator } from './file-navigator.tsx';
import { ArtifactPreviewPanel } from './artifact-preview.tsx';

export function FilesPanel() {
  useLocale();
  const { activeId, directory, fileScopeId, invoke, act, selectedPath, setSelectedPath, threadUi, patchThread } = useApp();
  const handledLocation = useRef('');
  const buffers = useSyncExternalStore(fileBuffers.subscribe, fileBuffers.snapshot);
  const key = fileScopeId + '/' + selectedPath;
  const buffer = buffers.get(key);
  const file = buffer?.file;
  const content = buffer?.content ?? '';
  const [blockedPath, setBlockedPath] = useState('');
  const [actionError, setActionError] = useState<{ scope: string; path: string; message: string }>();
  const error = blockedPath && buffers.get(fileScopeId + '/' + blockedPath)?.saving
    ? tr('正在保存 {p0}，请完成后再关闭或重新加载。', { p0: blockedPath })
    : actionError?.scope === fileScopeId ? localizeAppError(actionError.message) + ' (' + actionError.path + ')' : buffer?.error;
  const [discard, setDiscard] = useState<{ scope: string; path: string; action: 'close' | 'reload'; content: string; version?: string }>();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [line, setLine] = useState(1);
  const [reload, setReload] = useState(0);
  const pdf = /\.pdf$/i.test(selectedPath), html = /\.html?$/i.test(selectedPath);
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
    if (!location || location.id === handledLocation.current || location.path !== selectedPath || file?.path !== selectedPath || file.kind !== 'text') return;
    if (html && sourcePath !== key) { setSourcePath(key); return; }
    jump(location.line, location.column);
    handledLocation.current = location.id;
  }, [file, selectedPath, threadUi.fileLocation, jump, html, sourcePath, key]);
  useEffect(() => {
    setBlockedPath('');
    setActionError(undefined);
    setDiscard(undefined);
    if (selectedPath && !/\.pdf$/i.test(selectedPath)) void fileBuffers.load(fileScopeId + '/' + selectedPath, async () => await invoke({ op: 'file.read', threadId: activeId, path: selectedPath }) as FileContent);
  }, [activeId, fileScopeId, selectedPath, invoke, reload]);
  const dirty = fileBufferDirty(buffer);
  const save = () => {
    setBlockedPath('');
    setActionError(undefined);
    void fileBuffers.save(key, async (base, content) => await invoke({ op: 'file.write', threadId: activeId, path: base.path, content, version: base.version! }) as FileContent);
  };
  const confirmDiscard = (path: string, action: 'close' | 'reload') => {
    const current = fileBuffers.snapshot().get(fileScopeId + '/' + path);
    setActionError(undefined);
    setDiscard({ scope: fileScopeId, path, action, content: current?.content ?? '', version: current?.file?.version });
  };
  const close = (path: string) => {
    if (!fileBuffers.discard(fileScopeId + '/' + path)) {
      setBlockedPath(path);
      return;
    }
    const remaining = (threadUi.openFiles ?? []).filter(item => item !== path);
    patchThread({ openFiles: remaining, selectedPath: selectedPath === path ? remaining.at(-1) ?? '' : selectedPath });
    setDiscard(undefined);
  };
  return <section className="files-workbench" aria-busy={!!buffer?.loading || !!buffer?.saving}>
    <FileNavigator selectedPath={selectedPath} onOpen={(path, targetLine) => { setSelectedPath(path); if (targetLine) patchThread({ fileLocation: { id: crypto.randomUUID(), path, line: targetLine } }); }} onRefresh={() => setReload(value => value + 1)} />
    <Tabs className="panel-strip" ariaLabel={tr("打开的文件")} value={selectedPath} onChange={setSelectedPath} onClose={path => {
      const pending = fileBuffers.snapshot().get(fileScopeId + '/' + path);
      if (pending?.saving) setBlockedPath(path);
      else if (fileBufferDirty(pending)) confirmDiscard(path, 'close');
      else close(path);
    }} items={(threadUi.openFiles ?? []).map(path => {
      const pending = buffers.get(fileScopeId + '/' + path);
      return { id: path, label: path.split(/[\\/]/).at(-1) + (pending?.saving || fileBufferDirty(pending) ? ' *' : ''), closeLabel: tr("关闭文件 ") + path };
    })} />
    {selectedPath && <><div className="file-toolbar"><span title={selectedPath}>{selectedPath.split(/[\\/]/).map((part, index, parts) => index === parts.length - 1 ? <span key={index}>{part}</span> : <button key={index} onClick={() => patchThread({ fileDirectory: parts.slice(0, index + 1).join('/') })}>{part} ›</button>)}</span><button onClick={() => void navigator.clipboard.writeText((directory?.path ?? '').replace(/[\\/]$/, '') + '/' + selectedPath)}>{tr("复制路径")}</button><button onClick={() => act({ op: 'file.reveal', threadId: activeId, path: selectedPath })}>{tr("所在目录")}</button><button onClick={() => act({ op: 'file.open', threadId: activeId, path: selectedPath })}>{tr("编辑器")}</button></div>
    {buffer?.loading && <p className="hint file-editor-status" role="status">{tr('正在读取文件…')}</p>}
    {html && <div className="artifact-toolbar"><button aria-pressed={preview} onClick={() => setSourcePath('')}>{tr('渲染预览')}</button><button aria-pressed={!preview} onClick={() => setSourcePath(key)}>{tr('HTML 源码')}</button>{dirty && <span role="status">{tr('预览使用磁盘版本；未保存的源码保留在编辑器中。')}</span>}</div>}
    {preview && <ArtifactPreviewPanel key={key + '/' + reload + '/' + (file?.version ?? '')} path={selectedPath} />}
    {file?.kind === 'text' ? <div className="file-source" hidden={preview}><div className="file-toolbar">
      <button disabled={!dirty || !file.writable || buffer?.saving} onClick={save}>{buffer?.saving ? tr('正在保存…') : tr('保存') + (dirty ? ' *' : '')}</button>
      <button disabled={buffer?.saving || buffer?.loading} onClick={() => { if (dirty) confirmDiscard(selectedPath, 'reload'); else setReload(value => value + 1); }}>{tr('重新加载')}</button>
      <label>{tr('行')} <input aria-label={tr('定位行号')} type="number" min={1} value={line} onChange={event => setLine(Number(event.target.value))} /></label>
      <button onClick={() => patchThread({ fileLocation: { id: crypto.randomUUID(), path: file.path, line: filePosition(editor.current?.value ?? content, line).line } })}>{tr('跳转')}</button>
      <span className="file-editor-status" role="status" data-save-id={buffer?.saveAttempt?.id} data-save-state={buffer?.saveAttempt?.state} title={buffer?.saveAttempt ? tr('保存操作 {p0}', { p0: buffer.saveAttempt.id }) : undefined}>{buffer?.saving ? tr('正在保存…') : dirty ? tr('有未保存的修改') : tr('已保存到磁盘')}</span>
    </div><textarea ref={editor} className="file-editor" aria-label={tr('文件内容 ') + file.path} spellCheck={false} readOnly={!file.writable} value={content} onChange={event => fileBuffers.edit(key, event.target.value)} /></div> : file && !preview && <FilePreview file={file} />}</>}
    {file?.kind === 'text' && !file.writable && <p className="hint">{file.truncated ? tr("文件较大，仅显示前 512 KB，内置编辑器只读。") : tr("此文件不是受支持的 UTF-8 编码，内置编辑器只读。")}{tr("请使用外部编辑器修改。")}</p>}
    {error && <div role="alert" className="file-navigation-error"><p>{localizeAppError(error)}</p>{buffer?.saveAttempt && <details><summary>{tr('保存诊断')}</summary><p>{tr('保存操作 {p0}', { p0: buffer.saveAttempt.id })}</p><p>{tr('基准版本 {p0}', { p0: buffer.saveAttempt.baseVersion.slice(0, 12) })}</p><p>{tr('耗时 {p0} ms', { p0: (buffer.saveAttempt.finishedAt ?? Date.now()) - buffer.saveAttempt.startedAt })}</p></details>}{!file && <button disabled={buffer?.loading} onClick={() => setReload(value => value + 1)}>{tr('重试读取文件')}</button>}</div>}
    {discard?.scope === fileScopeId && <ConfirmDialog title={tr('放弃未保存的文件修改？')} description={(directory?.name ? directory.name + ' / ' : '') + discard.path} confirmLabel={tr('放弃修改')} danger onCancel={() => setDiscard(undefined)} onConfirm={() => {
      const current = fileBuffers.snapshot().get(discard.scope + '/' + discard.path);
      if (current?.saving) { setBlockedPath(discard.path); setDiscard(undefined); return; }
      if (current?.loading) return;
      if (current?.content !== discard.content || current?.file?.version !== discard.version) {
        setActionError({ scope: discard.scope, path: discard.path, message: '文件内容已变化，未丢弃修改。请核对后重新操作。' }); setDiscard(undefined); return;
      }
      if (discard.action === 'close') close(discard.path);
      else {
        void fileBuffers.load(discard.scope + '/' + discard.path, async () => await invoke({ op: 'file.read', threadId: activeId, path: discard.path }) as FileContent, { discardChanges: true });
        setDiscard(undefined);
      }
    }} />}
  </section>;
}

