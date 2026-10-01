import { KeyRound, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ModelCatalog, Provider } from '../../shared/contracts.ts';
import type { ConnectionMode } from '../../shared/model-configuration.ts';
import { localizeAppError, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { Button } from './components/primitives/button.tsx';
import { ConfirmDialog } from './components/primitives/dialog.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Tabs } from './components/primitives/tabs.tsx';
import { ModelConnection } from './ModelConnection.tsx';
import { SettingsSection } from './SettingsSection.tsx';

export function ModelSettings({ providers, defaultId, selected, keys, mode, catalog, catalogError, error, onSelect, onAdd, onChange, onModeChange, onConvert, onRetry, onKey, onDefault, onDelete }: {
  providers: Provider[];
  defaultId: string;
  selected: string;
  keys: Record<string, string>;
  mode: ConnectionMode;
  catalog: ModelCatalog | null;
  catalogError: string;
  error?: string;
  onSelect(id: string): void;
  onAdd(): void;
  onChange(patch: Partial<Provider>): void;
  onModeChange(mode: ConnectionMode): void;
  onConvert(): void;
  onRetry(): void;
  onKey(id: string, value: string): void;
  onDefault(id: string): void;
  onDelete(id: string): void;
}) {
  useLocale();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const collection = useRef<HTMLElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    setQuery('');
    const input = editor.current?.querySelector<HTMLInputElement>('input:invalid, input[aria-invalid=true]');
    input?.closest('details')?.setAttribute('open', '');
    input?.focus();
  }, [error, selected]);
  const provider = providers.find(item => item.id === selected);
  const visible = providers.filter(item => [item.name, item.provider, item.model].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="model-settings">
    <aside ref={collection} className="model-collection" aria-label={tr('供应商与模型')}>
      <div className="model-collection-compact"><label htmlFor="settings-model-selection">{tr('已配置的模型')}</label>
        <select id="settings-model-selection" value={selected} disabled={!providers.length} onChange={event => onSelect(event.target.value)}>
          {!providers.length && <option value="">{tr('还没有模型')}</option>}
          {providers.map(item => <option key={item.id} value={item.id}>{item.name || tr('新模型')}{item.id === defaultId ? ' · ' + tr('当前默认') : ''}</option>)}
        </select>
      </div>
      <div className="model-collection-heading"><h2>{tr('已配置的模型')}</h2><span className="model-count">{providers.length}</span></div>
      <div className="settings-search model-search"><Search size={14} aria-hidden="true" /><input aria-label={tr('搜索名称、供应商或模型 ID')} placeholder={tr('搜索名称、供应商或模型 ID')} value={query} onChange={event => setQuery(event.target.value)} /></div>
      {!!visible.length && <Tabs orientation="vertical" ariaLabel={tr('已配置的模型')} className="model-tabs" value={selected} onChange={onSelect}
        items={visible.map(item => ({ id: item.id, label: <span className="model-option-text"><span>{item.name || tr('新模型')}</span><small aria-hidden="true">{item.custom ? tr('自定义接口') : item.provider}{item.model && ' · ' + item.model}</small></span>,
          trailing: <span className="model-option-status" aria-hidden="true">{item.id === defaultId ? tr('当前默认') : item.hasKey ? <KeyRound size={12} /> : null}</span> }))} />}
      {!!providers.length && !visible.length && <div className="model-search-empty"><p>{tr('没有匹配的模型')}</p><Button size="sm" variant="ghost" onClick={() => setQuery('')}>{tr('清除搜索')}</Button></div>}
      <Button className="model-add" size="sm" onClick={() => { setQuery(''); onAdd(); }}><Plus size={14} aria-hidden="true" />{tr('添加模型')}</Button>
    </aside>
    <div className="model-editor" ref={editor} data-validation-error={!!error}>
      {error && <p id="model-config-error" className="form-feedback" data-error="true" role="alert">{localizeAppError(error)}</p>}
      {!provider ? <div className="empty-card"><h3>{tr('还没有模型')}</h3><p>{tr('添加一个供应商和模型，然后开始你的第一个任务。')}</p></div> : <>
        <SettingsSection title={tr('连接与凭据')}>
          <FieldRow label={tr('显示名称')} htmlFor={'provider-' + provider.id + '-name'}>
            <input id={'provider-' + provider.id + '-name'} aria-label={tr('显示名称')} aria-invalid={!!error && !provider.name.trim() || undefined} aria-describedby={error ? 'model-config-error' : undefined} required value={provider.name} onChange={event => onChange({ name: event.target.value })} />
          </FieldRow>
          <ModelConnection key={provider.id} provider={provider} mode={mode} catalog={catalog} catalogError={catalogError} onRetry={onRetry} onModeChange={onModeChange} onChange={onChange} onConvert={onConvert}
            credentials={<FieldRow label="API Key" htmlFor={'provider-' + provider.id + '-key'} description={tr('密钥使用系统加密保存；更新后从下一次运行生效。')}>
              <div className="model-key-control"><input id={'provider-' + provider.id + '-key'} type="password" autoComplete="off" value={keys[provider.id] ?? ''}
                onChange={event => onKey(provider.id, event.target.value)} placeholder={provider.hasKey ? tr('已加密保存；留空保持不变') : tr('输入 API Key')} />
                <span className="model-key-status"><KeyRound size={12} aria-hidden="true" />{keys[provider.id] ? tr('密钥待保存') : provider.hasKey ? tr('已保存密钥') : tr('尚未设置密钥')}</span>
              </div>
            </FieldRow>} />
        </SettingsSection>
        <SettingsSection title={tr('模型偏好')}>
          <FieldRow label={tr('默认模型')} description={tr('新任务的起始模型；已有任务保留自己的选择')}>
            <Button size="sm" disabled={defaultId === provider.id} onClick={() => onDefault(provider.id)}>{defaultId === provider.id ? tr('当前默认') : tr('设为默认')}</Button>
          </FieldRow>
          <FieldRow label={tr('删除该模型')} description={tr('保存后本机保存的 API Key 一并清除')}>
            <Button size="sm" variant="ghost" className="model-remove" onClick={() => setDeleting(provider)}><Trash2 size={14} aria-hidden="true" />{tr('删除模型')}</Button>
          </FieldRow>
        </SettingsSection>
        <p className="hint model-privacy-note">{tr('凭据以当前 Windows 用户账户加密后保存在本机，不会写入配置文件。')}</p>
      </>}
    </div>
    {deleting && <ConfirmDialog title={tr('删除模型「{p0}」？', { p0: deleting.name })} description={tr('保存设置后移除该配置及本机密钥。已有任务的历史记录会保留。')} confirmLabel={tr('删除模型')} danger initialFocus="cancel" onCancel={() => setDeleting(null)} onConfirm={() => {
      onDelete(deleting.id); setDeleting(null);
      requestAnimationFrame(() => collection.current?.querySelector<HTMLButtonElement>('.model-add')?.focus());
    }} />}
  </div>;
}
