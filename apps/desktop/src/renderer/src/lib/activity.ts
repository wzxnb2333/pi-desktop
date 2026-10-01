import { tr } from "../../../shared/localization.ts";
import type { TimelineItem } from '../../../shared/contracts.ts';
import { isHarnessToolName } from '../../../shared/harness-tools.ts';

export type ActivityKind = 'read' | 'search' | 'list' | 'edit' | 'write' | 'command' | 'harness' | 'tool';
export function activity(item: TimelineItem) {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(item.args ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch { /* Keep raw, incomplete arguments available in the details. */ }
  const kinds: Record<string, ActivityKind> = { read: 'read', grep: 'search', find: 'search', ls: 'list', edit: 'edit', write: 'write', powershell: 'command', bash: 'command' };
  const kind = isHarnessToolName(item.toolName) ? 'harness' : kinds[item.toolName ?? ''] ?? 'tool';
  const path = typeof args.path === 'string' ? args.path : undefined;
  const query = typeof args.pattern === 'string' ? args.pattern : undefined;
  const command = typeof args.command === 'string' ? args.command : undefined;
  const running = item.state === 'running';
  // Desktop-interface calls read exactly like any other call: the π icon marks them, not a caption.
  const wording = kind === 'harness' ? 'tool' : kind;
  const verbs = { read: running ? tr("正在读取") : tr("已读取"), search: running ? tr("正在搜索") : tr("已搜索"), list: running ? tr("正在列出目录") : tr("已列出目录"), edit: running ? tr("正在编辑") : tr("已编辑"), write: running ? tr("正在写入") : tr("已写入"), command: running ? tr("正在执行") : tr("已执行"), tool: running ? tr("正在调用") : tr("已调用") };
  const subject = kind === 'command' ? command : kind === 'search' ? query : path;
  const failed = item.state === 'error';
  const label = `${failed ? item.stopReason === 'aborted' ? tr("已停止") : tr("操作失败") : verbs[wording]} ${subject ?? item.toolName ?? tr("工具")}`;
  return { kind, path, query, command, label, running, failed };
}
export function activitySummary(items: TimelineItem[], live = false): string {
  const current = items.findLast((item) => item.state === 'running');
  if (current) return activity(current).label;
  if (live) return tr("正在思考");
  const counts = new Map<ActivityKind, number>();
  for (const item of items) { const kind = activity(item).kind; counts.set(kind, (counts.get(kind) ?? 0) + 1); }
  const names = { read: tr("次读取"), search: tr("次搜索"), list: tr("次列目录"), edit: tr("次编辑"), write: tr("次写入"), command: tr("条命令"), tool: tr("次工具调用") };
  const summary = [...counts].map(([kind, count]) => `${count} ${names[kind === 'harness' ? 'tool' : kind]}`).join('、');
  const failures = items.filter((item) => item.state === 'error').length;
  return summary + (failures ? tr(" · {p0} 个失败", { p0: failures }) : '');
}
export function elapsed(start?: number, end?: number): string {
  if (start === undefined || end === undefined || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  return seconds < 60 ? tr("{p0} 秒", { p0: seconds }) : tr("{p0} 分 {p1} 秒", { p0: Math.floor(seconds / 60), p1: seconds % 60 });
}
export function editStats(item: TimelineItem): { added: number; removed: number } | undefined {
  if (item.toolName !== 'edit' || item.state !== 'done' || !item.details) return;
  const lines = item.details.diff.split('\n');
  return { added: lines.filter((line) => line.startsWith('+')).length, removed: lines.filter((line) => line.startsWith('-')).length };
}
