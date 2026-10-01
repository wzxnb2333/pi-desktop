import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react';
import { tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { recordedTurnChanges, type TurnChange } from '../../lib/turn-changes.ts';
import type { Turn } from '../../lib/timeline-groups.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { Diff } from '../panels/diff.tsx';
import '../../styles/turn-changes.css';

function Counts({ file }: { file: Pick<TurnChange, 'additions' | 'deletions' | 'partial'> }) {
  return <span className="turn-change-counts" title={tr(file.partial ? '部分编辑没有可比较的旧版本，不计入增删统计' : '本轮记录的增删行数，不代表工作区净差异')}>
    {(file.additions > 0 || file.deletions > 0 || !file.partial) && <><span className="added">+{file.additions}</span><span className="removed">−{file.deletions}</span></>}
    {file.partial && (file.additions > 0 || file.deletions > 0) && <span className="turn-change-partial">*</span>}
  </span>;
}

export function TurnChanges({ turn }: { turn: Turn }) {
  const locale = useLocale(), id = useId();
  const { project } = useApp();
  const files = useMemo(() => recordedTurnChanges(turn), [turn, locale]);
  const [all, setAll] = useState(false), [open, setOpen] = useState<Set<string>>(() => new Set());
  if (!files.length) return null;
  const expanded = files.every(file => open.has(file.key));
  const totals = files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions, partial: sum.partial || file.partial }), { additions: 0, deletions: 0, partial: false });
  const visible = all ? files : files.slice(0, 3);
  return <section className="turn-changes" aria-label={tr('本轮编辑预览')}>
    <header className="turn-changes-heading"><span className="turn-changes-icon"><FileDiff size={18} /></span>
      <div><strong>{tr('已编辑 {p0} 个文件', { p0: files.length })}</strong><Counts file={totals} /></div>
      <Button size="xs" variant="ghost" aria-expanded={expanded} onClick={() => { setOpen(new Set(expanded ? [] : files.map(file => file.key))); if (!expanded) setAll(true); }}>{tr(expanded ? '收起变更' : '查看变更')}</Button>
    </header>
    {open.size > 0 && <p className="turn-change-note">{tr('显示本轮保存的编辑内容；文件后续变化不会改写此预览。')}</p>}
    <div className="turn-changes-files">{visible.map((file, index) => {
      const directory = file.directoryId ? project?.directories?.find(root => root.id === file.directoryId)?.name ?? file.directoryId : '';
      const expanded = open.has(file.key), previewId = id + '-' + index;
      return <div className="turn-change-file" key={file.key}>
        <button type="button" className="turn-change-row" aria-expanded={expanded} aria-controls={previewId} title={[directory, file.path].filter(Boolean).join(' / ')} onClick={() => setOpen(current => { const next = new Set(current); if (next.has(file.key)) next.delete(file.key); else next.add(file.key); return next; })}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="turn-change-path">{directory && <span className="turn-change-directory">{directory} / </span>}{file.path}</span><Counts file={file} />
        </button>
        {expanded && <div id={previewId} className="turn-change-preview" role="region" aria-label={file.path}>
          {file.records.map((record, index) => <div key={record.id} className="turn-edit-record">
            {file.records.length > 1 && <small>{tr('编辑记录 {p0}', { p0: index + 1 })}</small>}
            {record.kind === 'patch' ? <Diff text={record.text} split={false} /> : record.kind === 'unavailable' ? <p>{tr('此记录没有保存可预览的内容')}</p> : <>
              {record.kind === 'write' && <p className="turn-change-note">{tr('写入记录没有旧版本，不能计算净增删行数。')}</p>}
              <pre className="turn-written-content">{record.text}</pre>
            </>}
          </div>)}
        </div>}
      </div>;
    })}</div>
    {files.length > 3 && <button type="button" className="turn-changes-more" aria-expanded={all} onClick={() => setAll(!all)}>{tr(all ? '收起文件列表' : '再显示 {p0} 个文件', { p0: files.length - 3 })}<ChevronDown size={12} /></button>}
  </section>;
}
