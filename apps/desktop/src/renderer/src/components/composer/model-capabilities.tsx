import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { tr } from '../../../../shared/localization.ts';
import { findModel, findModelProvider, providerModels } from '../../../../shared/model-configuration.ts';
import { allowedThinkingLevels, resolveThinkingLevel } from '../../../../shared/thinking.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { thinkingLabels } from '../../lib/labels.ts';
import { useApp } from '../../state/app.tsx';
import { Menu } from '../primitives/menu.tsx';

/** Providers first, then their models; the capability panel stays the resting state of the menu. */
export function ModelCapabilities() {
  useLocale();
  const { thread, data, running, act } = useApp();
  const [view, setView] = useState<'capabilities' | 'providers' | 'models'>('capabilities');
  const [pendingProvider, setPendingProvider] = useState('');
  if (!thread) return null;
  const model = findModel(data.settings, thread.modelId);
  const provider = findModelProvider(data.settings, model);
  const activeProvider = data.settings.modelProviders.find(item => item.id === (pendingProvider || provider?.id));
  const listing = view === 'models' && activeProvider ? 'models' : view === 'providers' || !model ? 'providers' : 'capabilities';
  const levels = model ? allowedThinkingLevels(model) : [];
  const thinking = resolveThinkingLevel(model, thread.thinking);
  const focusList = () => requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('.composer-model-popover [role="menuitemradio"]:not([aria-disabled="true"])')?.focus();
  });
  const openProviders = () => { setPendingProvider(provider?.id ?? ''); setView('providers'); focusList(); };
  const openModels = (providerId: string) => { setPendingProvider(providerId); setView('models'); focusList(); };
  const providerOptions = data.settings.modelProviders.map(item => {
    const count = providerModels(data.settings.models, item.id).length;
    return {
      value: item.id,
      disabled: !count,
      label: <span className="composer-model-option"><span className="composer-model-option-name">{item.name}</span>
        <small>{count ? tr('{p0} 个模型', { p0: count }) : tr('还没有模型')}</small></span>,
    };
  });
  const modelOptions = providerModels(data.settings.models, activeProvider?.id ?? '').map(item => ({ value: item.id, label: item.name }));
  const heading = listing === 'models' && activeProvider
    ? <span className="composer-model-heading">
        <button type="button" className="composer-model-back" aria-label={tr('返回提供商')} onClick={openProviders}><ChevronLeft size={13} aria-hidden="true" /></button>
        <span>{activeProvider.name}</span>
      </span>
    : listing === 'providers' ? tr('选择提供商') : undefined;
  return <Menu label={tr('模型与能力')} className="composer-model-capabilities" listClassName="composer-model-popover"
    size="sm" side="top" align="end" disabled={running} value={listing === 'models' ? thread.modelId : activeProvider?.id ?? ''}
    options={listing === 'models' ? modelOptions : providerOptions}
    heading={heading}
    closeOnSelect={listing !== 'providers'}
    display={<><span className="composer-model-name">{model?.name ?? tr('选择模型')}</span>{model && <span className="composer-model-effort">{thinkingLabels[thinking]}</span>}</>}
    onOpenChange={open => { if (!open) { setView('capabilities'); setPendingProvider(''); } }}
    onChange={value => {
      if (listing === 'models') { act({ op: 'thread.update', id: thread.id, modelId: value }); return; }
      openModels(value);
    }}
    content={listing === 'capabilities' && model ? <div className="composer-capability-panel">
      <div className="composer-capability-heading"><strong>{thinkingLabels[thinking]}</strong></div>
      <button type="button" className="composer-model-link" aria-label={tr('模型')} onClick={openProviders}>{model.name}<ChevronRight size={13} /></button>
      <div className="composer-effort-control">
      <input data-popover-autofocus type="range" className="composer-effort-slider" aria-label={tr('思考级别')} aria-valuetext={thinkingLabels[thinking]}
        style={{ background: `linear-gradient(to right, var(--accent) ${levels.length > 1 ? levels.indexOf(thinking) / (levels.length - 1) * 100 : 0}%, var(--hover) 0)` }}
        min={0} max={Math.max(0, levels.length - 1)} step={1} value={levels.indexOf(thinking)} disabled={levels.length < 2 || running}
        onChange={event => { const value = levels[Number(event.currentTarget.value)]; if (value) act({ op: 'thread.update', id: thread.id, thinking: value }); }} />
      <div className="composer-effort-stops" aria-hidden="true">{levels.map(level => <span key={level} data-selected={level === thinking || undefined} />)}</div>
      </div>
    </div> : undefined} />;
}
