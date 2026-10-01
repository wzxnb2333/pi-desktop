import { useState } from 'react';
import { ChevronRight, Zap } from 'lucide-react';
import { tr } from '../../../../shared/localization.ts';
import { allowedThinkingLevels, resolveThinkingLevel } from '../../../../shared/thinking.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { thinkingLabels } from '../../lib/labels.ts';
import { useApp } from '../../state/app.tsx';
import { Menu } from '../primitives/menu.tsx';

export function ModelCapabilities() {
  useLocale();
  const { thread, data, running, act } = useApp();
  const [models, setModels] = useState(false);
  if (!thread) return null;
  const provider = data.settings.providers.find(item => item.id === thread.providerId);
  const levels = provider ? allowedThinkingLevels(provider) : [];
  const thinking = resolveThinkingLevel(provider, thread.thinking);
  const showModels = models || !provider;
  return <Menu label={tr('模型与能力')} className="composer-model-capabilities" listClassName="composer-model-popover"
    size="sm" side="top" align="end" disabled={running} value={thread.providerId}
    options={data.settings.providers.map(item => ({ value: item.id, label: item.name }))}
    heading={showModels ? tr('选择模型') : undefined}
    display={<><span className="composer-model-name">{provider?.name ?? tr('选择模型')}</span>{provider && <span className="composer-model-effort">{thinkingLabels[thinking]}</span>}</>}
    onOpenChange={open => { if (!open) setModels(false); }}
    onChange={providerId => act({ op: 'thread.update', id: thread.id, providerId })}
    content={showModels ? undefined : <div className="composer-capability-panel">
      <div className="composer-capability-heading"><Zap size={16} /><strong>{thinkingLabels[thinking]}</strong></div>
      <button type="button" className="composer-model-link" aria-label={tr('模型')} onClick={() => setModels(true)}>{provider.name}<ChevronRight size={13} /></button>
      <div className="composer-effort-control">
      <input data-popover-autofocus type="range" className="composer-effort-slider" aria-label={tr('思考级别')} aria-valuetext={thinkingLabels[thinking]}
        style={{ background: `linear-gradient(to right, var(--accent) ${levels.length > 1 ? levels.indexOf(thinking) / (levels.length - 1) * 100 : 0}%, var(--hover) 0)` }}
        min={0} max={Math.max(0, levels.length - 1)} step={1} value={levels.indexOf(thinking)} disabled={levels.length < 2 || running}
        onChange={event => { const value = levels[Number(event.currentTarget.value)]; if (value) act({ op: 'thread.update', id: thread.id, thinking: value }); }} />
      <div className="composer-effort-stops" aria-hidden="true">{levels.map(level => <span key={level} data-selected={level === thinking || undefined} />)}</div>
      </div>
    </div>} />;
}
