import { tr } from "../../../shared/localization.ts";
export function gitStatusLabel(status: string): string {
  if (status === '??') return tr("未跟踪");
  if (/U|AA|DD/.test(status)) return tr("冲突");
  if (status.includes('R')) return tr("重命名");
  if (status.includes('C')) return tr("复制");
  if (status.includes('D')) return tr("删除");
  if (status.includes('A')) return tr("新增");
  if (status.includes('M')) return tr("修改");
  if (status.includes('T')) return tr("类型变更");
  return tr("变更");
}
