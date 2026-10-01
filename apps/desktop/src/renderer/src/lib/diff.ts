import { tr } from "../../../shared/localization.ts";
/**
 * Unified-diff parser for the Review panel.
 *
 * `GitService.diff()` hands the renderer one concatenated `git diff` blob per file (tracked changes,
 * staged changes when there is no HEAD, plus a synthesized `--no-index` diff for every untracked
 * file), so every classification the UI needs happens here. Deliberately free of DOM and React
 * imports so it is testable with `node --test`.
 */

export type DiffLineKind = 'context' | 'add' | 'del' | 'nodenl';

/**
 * One rendered row. `text` never carries the leading marker; the marker comes from `diffMarker[kind]`,
 * so `diffMarker[line.kind] + line.text` reproduces the raw diff line for all four kinds.
 */
export type DiffLine = { kind: DiffLineKind; text: string; oldNo?: number; newNo?: number };

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type FileDiffKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';

export type FileDiff = {
  /** `null` when the diff never names the old side; `/dev/null` means the file did not exist. */
  oldPath: string | null;
  newPath: string | null;
  kind: FileDiffKind;
  hunks: DiffHunk[];
  /** Non-fatal findings: malformed input, plus metadata the row model cannot express (mode bits). */
  warnings: string[];
};

export type AlignedRow = {
  left?: DiffLine;
  right?: DiffLine;
  kind: 'pair' | 'del' | 'add' | 'context' | 'gap';
  /** Gap rows only: the two hunk headers the omitted lines sit between, used as the tooltip. */
  hint?: string;
};

/** `GitService.diff()` returns this literal string instead of an empty blob. */
export const noTextDiff = '没有文本差异。';

export const diffMarker: Record<DiffLineKind, string> = {
  context: ' ',
  add: '+',
  del: '-',
  nodenl: '\\',
};

const gitPrefix = 'diff --git ';
const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** Metadata that can legitimately follow a skipped combined-diff hunk. */
const restartPrefixes = [
  'diff --git ',
  'index ',
  'old mode ',
  'new mode ',
  'similarity ',
  'rename ',
  'copy ',
  '--- ',
  '+++ ',
  'Binary ',
  'GIT binary patch',
];

function restartsSection(raw: string): boolean {
  const line = stripCr(raw);
  return line.startsWith('@@') || restartPrefixes.some((prefix) => line.startsWith(prefix));
}

export function parseUnifiedDiff(text: string): FileDiff[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed === noTextDiff) return [];
  return splitSections(text.split('\n')).map(parseFile);
}

/**
 * File sections start at a `diff --git ` line and nowhere else. Splitting on `---`/`+++` would break:
 * an added line whose own text starts with `++` prints as `++++ ...`, and a deleted `--- x` line as
 * `---- ...`, so those prefixes do occur inside hunk bodies. A body line can never put `diff --git ` at
 * column zero, because git prefixes every body line with ' ', '+' or '-'.
 */
function splitSections(lines: string[]): string[][] {
  const sections: string[][] = [];
  for (const line of lines) {
    if (line.startsWith(gitPrefix)) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  // Splitting a blob that ends in a newline always leaves one empty tail element; a real empty context
  // line is emitted by git as a single space.
  for (const section of sections) if (section.at(-1) === '') section.pop();
  return sections;
}

type FileFlags = {
  newFile: boolean;
  deletedFile: boolean;
  renamed: boolean;
  binary: boolean;
  indexFromZero: boolean;
  indexToZero: boolean;
};

function parseFile(section: string[]): FileDiff {
  const file: FileDiff = { ...headerPaths(stripCr(section[0])), kind: 'modified', hunks: [], warnings: [] };
  const flags: FileFlags = {
    newFile: false,
    deletedFile: false,
    renamed: false,
    binary: false,
    indexFromZero: false,
    indexToZero: false,
  };
  let afterHunk = false;
  let i = 1;
  while (i < section.length) {
    const line = stripCr(section[i]);
    if (!line) {
      i++;
      continue;
    }
    if (/^diff --(?:cc|combined)\b/.test(line)) {
      // A merge diff has one column per parent and names only one path, so none of its rows map onto
      // an old/new pair. git.ts never emits it, but skipping beats inventing rows.
      file.warnings.push(tr("合并差异（combined diff）有多个父提交，无法按新旧两列解析，已跳过该文件。"));
      break;
    }
    if (line.startsWith('@@@')) {
      // A combined diff has one column per parent, so its rows do not map onto an old/new pair.
      // Skipping keeps the counts of the surrounding regular hunks from being misread.
      file.warnings.push(tr("合并差异（combined diff）无法按新旧两列解析，已跳过该段。"));
      afterHunk = true;
      i++;
      while (i < section.length && !restartsSection(section[i])) i++;
      continue;
    }
    if (line.startsWith('@@')) {
      afterHunk = true;
      i = readHunk(file, section, i);
      continue;
    }
    i++;
    if (afterHunk) {
      file.warnings.push(tr("忽略 hunk 之外的行：{p0}", { p0: line }));
      continue;
    }
    if (line.startsWith('--- ')) file.oldPath = sidePath(line.slice(4), 'old');
    else if (line.startsWith('+++ ')) file.newPath = sidePath(line.slice(4), 'new');
    else if (line.startsWith('rename from ')) {
      file.oldPath = unquote(line.slice(12));
      flags.renamed = true;
    } else if (line.startsWith('rename to ')) {
      file.newPath = unquote(line.slice(10));
      flags.renamed = true;
    } else if (line.startsWith('copy from ')) {
      file.oldPath = unquote(line.slice(10));
      flags.renamed = true;
      file.warnings.push(tr("复制的文件按重命名显示。"));
    } else if (line.startsWith('copy to ')) file.newPath = unquote(line.slice(8));
    else if (line.startsWith('new file mode')) flags.newFile = true;
    else if (line.startsWith('deleted file mode')) flags.deletedFile = true;
    else if (line.startsWith('old mode ') || line.startsWith('new mode '))
      file.warnings.push(tr("文件权限变更：{p0}", { p0: line }));
    else if (line.startsWith('index ')) readIndexLine(line, flags);
    else if (line.startsWith('GIT binary patch')) {
      flags.binary = true;
      break; // The rest of the section is base85 payload, not diff rows.
    } else if (line.startsWith('Binary files')) {
      flags.binary = true;
      const pair = /^(?:Binary files) (.+) and (.+) differ$/.exec(line);
      if (pair) {
        file.oldPath = sidePath(pair[1], 'old');
        file.newPath = sidePath(pair[2], 'new');
      }
      break;
    } else if (!/^(similarity|dissimilarity) index /.test(line)) file.warnings.push(tr("忽略未识别的头部行：{p0}", { p0: line }));
  }
  file.kind = resolveKind(file, flags);
  return file;
}

function resolveKind(file: FileDiff, flags: FileFlags): FileDiffKind {
  if (flags.binary) return 'binary';
  if (flags.renamed) return 'renamed';
  if (flags.newFile || file.oldPath === '/dev/null' || flags.indexFromZero) return 'added';
  if (flags.deletedFile || file.newPath === '/dev/null' || flags.indexToZero) return 'deleted';
  return 'modified';
}

/** `index <sha>..<sha>`: an all-zero side is git's way of saying "no preimage"/"no postimage". */
function readIndexLine(line: string, flags: FileFlags): void {
  const pair = /^index (\d+)\.\.(\d+)/.exec(line);
  if (!pair) return;
  if (/^0+$/.test(pair[1])) flags.indexFromZero = true;
  if (/^0+$/.test(pair[2])) flags.indexToZero = true;
}

function readHunk(file: FileDiff, section: string[], start: number): number {
  const header = stripCr(section[start]);
  const match = hunkHeader.exec(header);
  if (!match) {
    file.warnings.push(tr("无法解析的 hunk 头：{p0}", { p0: header }));
    return start + 1;
  }
  const hunk: DiffHunk = {
    header,
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    lines: [],
  };
  // Per the unified format a missing count means 1, and each counter points at the next number used.
  let oldAt = hunk.oldStart;
  let newAt = hunk.newStart;
  let i = start + 1;
  // A trailing "\ No newline at end of file" is not counted by the header, so keep reading while the
  // next line is one — otherwise the marker for the last added line would escape the hunk.
  while (
    oldAt - hunk.oldStart < hunk.oldCount ||
    newAt - hunk.newStart < hunk.newCount ||
    section[i]?.startsWith('\\')
  ) {
    if (i >= section.length) {
      file.warnings.push(tr("hunk {p0} 在数据结束前被截断", { p0: header }));
      break;
    }
    // Body lines keep their trailing CR: for a CRLF file it is part of the compared content.
    const raw = section[i];
    i++;
    if (raw.startsWith('\\')) {
      hunk.lines.push({ kind: 'nodenl', text: raw.slice(1) });
      continue;
    }
    let kind: DiffLineKind;
    if (raw === '' || raw.startsWith(' ')) kind = 'context';
    else if (raw.startsWith('+')) kind = 'add';
    else if (raw.startsWith('-')) kind = 'del';
    else {
      file.warnings.push(tr("hunk {p0} 中出现无法归类的行：{p1}", { p0: header, p1: raw }));
      break;
    }
    const line: DiffLine = { kind, text: raw.slice(1) };
    if (kind !== 'add') line.oldNo = oldAt++;
    if (kind !== 'del') line.newNo = newAt++;
    hunk.lines.push(line);
    if (oldAt - hunk.oldStart > hunk.oldCount || newAt - hunk.newStart > hunk.newCount) {
      file.warnings.push(tr("hunk {p0} 的行数超出头部声明", { p0: header }));
      break;
    }
  }
  file.hunks.push(hunk);
  return i;
}

/**
 * Side-by-side alignment for one hunk. Runs never cross a hunk boundary: the two sides number
 * independently per hunk, so pairing across hunks would match unrelated lines.
 */
export function alignSideBySide(hunk: DiffHunk): AlignedRow[] {
  const rows: AlignedRow[] = [];
  let left: DiffLine[] = [];
  let right: DiffLine[] = [];
  const flush = () => {
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i++) rows.push({ kind: 'pair', left: left[i], right: right[i] });
    for (let i = shared; i < left.length; i++) rows.push({ kind: 'del', left: left[i] });
    for (let i = shared; i < right.length; i++) rows.push({ kind: 'add', right: right[i] });
    left = [];
    right = [];
  };
  let previous: Side = 'both';
  for (const line of hunk.lines) {
    const side = sideOf(line, previous);
    previous = side;
    if (side === 'both') {
      flush();
      rows.push({ kind: 'context', left: line, right: line });
    } else if (side === 'left') {
      // A left row after the right run already started means the runs interleaved; close the pair.
      if (right.length) flush();
      left.push(line);
    } else right.push(line);
  }
  flush();
  return rows;
}

type Side = 'left' | 'right' | 'both';

function sideOf(line: DiffLine, previous: Side): Side {
  if (line.kind === 'add') return 'right';
  if (line.kind === 'del') return 'left';
  if (line.kind === 'context') return 'both';
  // "\ No newline at end of file" describes the row above it, so it belongs to that row's side.
  return previous;
}

/** Per-hunk alignment stitched together with a gap row wherever lines were skipped. */
export function alignHunks(hunks: DiffHunk[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  let previous: DiffHunk | undefined;
  for (const hunk of hunks) {
    if (previous) {
      const oldGap = hunk.oldStart - (previous.oldStart + previous.oldCount);
      const newGap = hunk.newStart - (previous.newStart + previous.newCount);
      rows.push({
        kind: 'gap',
        hint: tr("{p0} → {p1}（省略 旧 {p2} 行 / 新 {p3} 行）", { p0: previous.header, p1: hunk.header, p2: Math.max(oldGap, 0), p3: Math.max(newGap, 0) }),
      });
    }
    rows.push(...alignSideBySide(hunk));
    previous = hunk;
  }
  return rows;
}

/** Widest line number in the file, so the gutters can be sized once per file instead of per row. */
export function maxLineNo(file: FileDiff): number {
  let max = 0;
  for (const hunk of file.hunks) {
    // The header counts the lines covered, so the last number printed is start + count - 1.
    max = Math.max(max, hunk.oldStart + hunk.oldCount - 1, hunk.newStart + hunk.newCount - 1);
  }
  return max;
}

export function diffPath(file: FileDiff): string {
  if (file.kind === 'deleted') return file.oldPath ?? file.newPath ?? '';
  return file.newPath ?? file.oldPath ?? '';
}

/**
 * `git --no-index` appends a bare tab to `+++ b/<path>` for paths git considers special, and a tab or
 * quote gets the whole path C-quoted. Cut at the first tab before unquoting so neither leaks through.
 */
function sidePath(raw: string, side: 'old' | 'new'): string | null {
  const value = stripCr(raw).split('\t')[0].trim();
  if (!value) return null;
  if (value === '/dev/null') return '/dev/null';
  return stripSidePrefix(unquote(value), side === 'old' ? 'a/' : 'b/');
}

function stripSidePrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function unquote(value: string): string {
  const path = stripCr(value).trim();
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path;
  return path.slice(1, -1).replace(/\\([abfnrtv"\\/]|[0-7]{1,3})/g, (_, esc: string) => {
    const simple: Record<string, string> = {
      a: '\u0007',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
    };
    const decoded = simple[esc];
    if (decoded) return decoded;
    return /^\d/.test(esc) ? String.fromCharCode(Number.parseInt(esc, 8)) : esc;
  });
}

/** Fallback for sections without `---`/`+++` (pure renames, binary changes): `diff --git a/x b/x`. */
function headerPaths(header: string): { oldPath: string | null; newPath: string | null } {
  const rest = header.startsWith(gitPrefix) ? header.slice(gitPrefix.length) : '';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== ' ') continue;
    const oldSide = rest.slice(0, i);
    const newSide = rest.slice(i + 1);
    if (oldSide.startsWith('a/') && newSide.startsWith('b/') && oldSide.slice(2) === newSide.slice(2))
      return { oldPath: unquote(oldSide).slice(2), newPath: unquote(newSide).slice(2) };
  }
  return { oldPath: null, newPath: null };
}

function stripCr(line: string | undefined): string {
  if (line === undefined) return '';
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
