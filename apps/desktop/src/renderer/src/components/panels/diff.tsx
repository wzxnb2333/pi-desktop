import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { Fragment, useMemo, type CSSProperties } from 'react';
import type { FileContent } from '../../../../shared/contracts.ts';
import {
  alignHunks,
  diffMarker,
  diffPath,
  maxLineNo,
  parseUnifiedDiff,
  type AlignedRow,
  type DiffLine,
  type DiffLineKind,
  type FileDiff,
  type FileDiffKind,
} from '../../lib/diff.ts';

const rowClass: Record<DiffLineKind, string> = {
  context: 'context',
  add: 'addition',
  del: 'deletion',
  nodenl: 'nodenl',
};

const kindLabel: Record<FileDiffKind, string> = {
  get modified() { return tr("修改"); },
  get added() { return tr("新增"); },
  get deleted() { return tr("删除"); },
  get renamed() { return tr("重命名"); },
  get binary() { return tr("二进制"); },
};



/**
 * Parsed, numbered diff. Gutter widths come from `--diff-old`/`--diff-new`, which the token layer can
 * retune later; per file they are sized to the widest line number the hunks can reach.
 */
type LineAction = (path: string, line: number, text: string) => void;
export function Diff({ text, split, onLine }: { text: string; split: boolean; onLine?: LineAction }) {
  const locale = useLocale();
  const files = useMemo(() => parseUnifiedDiff(text), [text, locale]);
  if (!files.length) return null;
  return split ? <SplitDiff files={files} onLine={onLine} /> : <UnifiedDiff files={files} onLine={onLine} />;
}

function gutters(file: FileDiff): CSSProperties {
  const width = `${Math.max(String(maxLineNo(file)).length, 2)}ch`;
  return { '--diff-old': width, '--diff-new': width } as CSSProperties;
}

function fileKey(file: FileDiff, index: number): string {
  return `${index}:${file.oldPath}:${file.newPath}:${file.kind}`;
}

function FileBody({ file, show }: { file: FileDiff; show: boolean }) {
  useLocale();
  return (
    <>
      {show && <FileHead file={file} />}
      {file.warnings.map((warning) => (
        <div className="diff-note" key={warning}>
          {warning}
        </div>
      ))}
      {file.kind === 'binary' ? <div className="diff-note">{tr("二进制文件，无文本差异。")}</div> : null}
      {file.kind !== 'binary' && !file.hunks.length && !file.warnings.length ? (
        <div className="diff-note">{tr("此文件没有文本行变化。")}</div>
      ) : null}
    </>
  );
}

function FileHead({ file }: { file: FileDiff }) {
  useLocale();
  const path = diffPath(file);
  const from = file.kind === 'renamed' && file.oldPath && file.oldPath !== path ? file.oldPath : '';
  return (
    <div className="diff-file-head">
      <span className="diff-kind">{kindLabel[file.kind]}</span>
      <bdi>{path || tr("（未知路径）")}</bdi>
      {from && <span className="diff-from">{tr("自")} {from}</span>}
    </div>
  );
}

function UnifiedDiff({ files, onLine }: { files: FileDiff[]; onLine?: LineAction }) {
  useLocale();
  const multi = files.length > 1;
  return (
    <pre className="diff unified">
      {files.map((file, index) => (
        <div className="diff-file" key={fileKey(file, index)} style={gutters(file)}>
          <FileBody file={file} show={multi || file.kind !== 'modified'} />
          {file.hunks.map((hunk, hunkIndex) => (
            <Fragment key={hunkIndex}>
              <div className="hunk">{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => (
                <UnifiedRow key={lineIndex} line={line} onLine={onLine ? () => onLine(diffPath(file), line.newNo!, line.text) : undefined} />
              ))}
            </Fragment>
          ))}
        </div>
      ))}
    </pre>
  );
}

function UnifiedRow({ line, onLine }: { line: DiffLine; onLine?: () => void }) {
  useLocale();
  return (
    <div className={`diff-line ${rowClass[line.kind]}`}>
      <span className="line-number ln-old">{line.oldNo ?? ''}</span>
      {onLine && line.newNo ? <button className="line-number ln-new" aria-label={tr('评论第 {p0} 行', { p0: line.newNo })} onClick={onLine}>{line.newNo}</button> : <span className="line-number ln-new">{line.newNo ?? ''}</span>}
      {diffMarker[line.kind] + line.text}
    </div>
  );
}

function SplitDiff({ files, onLine }: { files: FileDiff[]; onLine?: LineAction }) {
  useLocale();
  const multi = files.length > 1;
  return (
    <div className="diff split-diff">
      <div className="split-label">
        <span>{tr("原始")}</span>
        <span>{tr("修改后")}</span>
      </div>
      {files.map((file, index) => (
        <div className="diff-file" key={fileKey(file, index)} style={gutters(file)}>
          <FileBody file={file} show={multi || file.kind !== 'modified'} />
          {file.kind === 'binary'
            ? null
            : alignHunks(file.hunks).map((row, rowIndex) => <SplitRow key={rowIndex} row={row} onLine={onLine ? (line, text) => onLine(diffPath(file), line, text) : undefined} />)}
        </div>
      ))}
    </div>
  );
}

function SplitRow({ row, onLine }: { row: AlignedRow; onLine?: (line: number, text: string) => void }) {
  useLocale();
  if (row.kind === 'gap')
    return (
      <div className="split-row gap" title={row.hint}>
        <div className="split-cell old">⋯</div>
        <div className="split-cell new">⋯</div>
      </div>
    );
  return (
    <div className={`split-row ${row.kind}`}>
      <SplitCell line={row.left} side="old" />
      <SplitCell line={row.right} side="new" onLine={onLine} />
    </div>
  );
}

function SplitCell({ line, side, onLine }: { line?: DiffLine; side: 'old' | 'new'; onLine?: (line: number, text: string) => void }) {
  useLocale();
  if (!line) return <div className={`split-cell ${side} blank`} />;
  return (
    <div className={`split-cell ${side} ${rowClass[line.kind]}`}>
      {onLine && line.newNo ? <button className="line-number ln-new" aria-label={tr('评论第 {p0} 行', { p0: line.newNo })} onClick={() => onLine(line.newNo!, line.text)}>{line.newNo}</button> : <span className={`line-number ln-${side}`}>{(side === 'old' ? line.oldNo : line.newNo) ?? ''}</span>}
      {diffMarker[line.kind] + line.text}
    </div>
  );
}

export function FilePreview({ file }: { file: FileContent }) {
  useLocale();
  return (
    <div className="file-preview">
      <div className="file-preview-heading">
        {file.path}
        {file.truncated && <span>  {tr("· 已截断")}</span>}
      </div>
      {file.kind === 'image' ? (
        <img src={file.content} alt={file.path} />
      ) : file.kind === 'binary' ? (
        <p>{tr("二进制文件，请在编辑器中打开。")}</p>
      ) : (
        <pre>{file.content}</pre>
      )}
    </div>
  );
}
