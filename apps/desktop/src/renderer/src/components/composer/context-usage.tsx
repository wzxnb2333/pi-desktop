import type { Thread } from '../../../../shared/contracts.ts';
import { getLocale, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Tooltip } from '../primitives/tooltip.tsx';
import '../../styles/context-usage.css';

export function ContextUsage({ usage }: { usage: Thread['usage'] }) {
  useLocale();
  const percent = usage?.contextPercent;
  const known = percent != null && Number.isFinite(percent);
  const label = tr('上下文') + ' ' + (known ? percent.toFixed(1) + '%' : tr('未知'));
  const format = (value: number | null | undefined) => value == null ? tr('未知') : value.toLocaleString(getLocale());
  return <Tooltip label={<div className="context-usage-detail">
    <strong>{label}</strong>
    <p>{tr('当前')} {format(usage?.contextTokens)} / {format(usage?.contextWindow)} tokens</p>
    {usage && <p>{tr('输入')} {format(usage.input)} {tr('· 输出')} {format(usage.output)} {tr('· 总计')} {format(usage.total)} tokens</p>}
    {usage?.cost !== undefined && <p>{tr('SDK 记录费用')} ${usage.cost.toFixed(4)}</p>}
    {!known && <p>{tr('供应商未返回的上下文占用显示为未知。')}</p>}
  </div>}>
    <span className="context-usage-ring" role="img" tabIndex={0} aria-label={label} data-known={known}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="context-usage-track" cx="10" cy="10" r="7" />
        {known && <circle className="context-usage-value" cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, percent))} 100`} transform="rotate(-90 10 10)" />}
      </svg>
    </span>
  </Tooltip>;
}
