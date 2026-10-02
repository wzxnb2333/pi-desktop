import type { Thread } from '../../../../shared/contracts.ts';
import { getLocale, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Tooltip } from '../primitives/tooltip.tsx';
import '../../styles/context-usage.css';

export function ContextUsage({ usage }: { usage: Thread['usage'] }) {
  useLocale();
  const percent = usage?.contextPercent;
  /*
   * A new conversation has no reported context yet, and an empty ring would only ever say "unknown".
   * The control therefore stays out of the composer until the provider reports a real percentage;
   * zero is a known value and keeps its ring.
   */
  if (percent == null || !Number.isFinite(percent)) return null;
  const format = (value: number | null | undefined) => value == null ? tr('未知') : value.toLocaleString(getLocale());
  const label = tr('上下文') + ' ' + percent.toFixed(1) + '%';
  return <Tooltip label={<div className="context-usage-detail">
    <strong>{label}</strong>
    <p>{tr('当前')} {format(usage?.contextTokens)} / {format(usage?.contextWindow)} tokens</p>
    {usage && <p>{tr('输入')} {format(usage.input)} {tr('· 输出')} {format(usage.output)} {tr('· 总计')} {format(usage.total)} tokens</p>}
    {usage?.cost !== undefined && <p>{tr('SDK 记录费用')} ${usage.cost.toFixed(4)}</p>}
  </div>}>
    <span className="context-usage-ring" role="img" tabIndex={0} aria-label={label}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="context-usage-track" cx="10" cy="10" r="7" />
        <circle className="context-usage-value" cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, percent))} 100`} transform="rotate(-90 10 10)" />
      </svg>
    </span>
  </Tooltip>;
}
