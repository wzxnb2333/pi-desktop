import { appearanceSchema, type Appearance, type DesktopRequest, type Settings } from '../../shared/contracts.ts';
import { appearanceFromSettings } from '../../shared/appearance.ts';
import { localizeAppError, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { Button } from './components/primitives/button.tsx';
import { SettingsSection } from './SettingsSection.tsx';

export function AppearanceSettings({ draft, onChange, invoke, onFeedback }: {
  draft: Settings;
  onChange(patch: Partial<Appearance>): void;
  invoke(request: DesktopRequest): Promise<unknown>;
  onFeedback(text: string, error: boolean): void;
}) {
  useLocale();
  const transfer = async (operation: 'theme.import' | 'theme.export') => {
    try {
      if (operation === 'theme.import') {
        const value = await invoke({ op: operation });
        if (value === null) return;
        onChange(appearanceSchema.parse(value));
        onFeedback('主题已导入草稿，请保存设置。', false);
      } else {
        const result = await invoke({ op: operation, appearance: appearanceFromSettings(draft) });
        if (result !== null) onFeedback('主题已导出', false);
      }
    } catch (error) { onFeedback(localizeAppError(error instanceof Error ? error.message : String(error)), true); }
  };
  return <>
    <SettingsSection title={tr('主题与文字')}>
      <FieldRow label={tr('主题')} description={tr('跟随系统时随 Windows 深浅色切换')}>
        <Menu id="settings-theme" label={tr('主题')} value={draft.theme} matchTriggerWidth className="settings-select"
          options={[{ value: 'system', label: tr('跟随系统') }, { value: 'light', label: tr('浅色') }, { value: 'dark', label: tr('深色') }]}
          onChange={value => onChange({ theme: value as Settings['theme'] })} />
      </FieldRow>
    </SettingsSection>
    <SettingsSection title={tr('字体与阅读')}>
    <FieldRow label={tr('字号')} htmlFor="settings-font-size" description={tr('正文文字，12–20 px')}>
      <input id="settings-font-size" type="number" min={12} max={20} value={draft.fontSize} onChange={event => onChange({ fontSize: Number(event.target.value) })} />
    </FieldRow>
    {(['uiFontFamily', 'codeFontFamily'] as const).map(key => <FieldRow key={key} label={tr(key === 'uiFontFamily' ? '界面字体' : '代码字体')} htmlFor={'settings-' + key} description={tr('输入本机已安装的字体名称；留空使用默认值。')}>
      <div className="font-family-field">
        <input id={'settings-' + key} value={draft[key]} placeholder={tr('系统字体')} maxLength={100} onChange={event => onChange({ [key]: event.target.value })} />
        {/* A datalist popup is drawn by the operating system, so the suggestions are a popover menu instead. */}
        <Menu label={tr('常用字体')} placeholder={tr('常用字体')} kind="action" size="sm"
          value=""
          options={(key === 'uiFontFamily' ? ['Segoe UI', 'Microsoft YaHei UI', 'Arial'] : ['Cascadia Code', 'Consolas', 'Courier New']).map(name => ({ value: name, label: name }))}
          onChange={name => onChange({ [key]: name })} />
      </div>
    </FieldRow>)}
    <FieldRow label={tr('代码字号')} htmlFor="settings-code-font-size"><input id="settings-code-font-size" type="number" min={10} max={24} value={draft.codeFontSize} onChange={event => onChange({ codeFontSize: Number(event.target.value) })} /></FieldRow>
    </SettingsSection>
    <SettingsSection title={tr('自定义颜色')} description={tr('颜色使用 #RRGGBB；留空跟随主题。')}>
    {([{ key: 'accentColor', label: '强调色' }, { key: 'backgroundColor', label: '背景色' }, { key: 'foregroundColor', label: '前景色' }] as const).map(({ key, label }) => <FieldRow key={key} label={tr(label)} htmlFor={'settings-' + key}>
      <div className="settings-color-input"><span aria-hidden="true" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(draft[key]) ? draft[key] : undefined }} />
        <input id={'settings-' + key} value={draft[key]} maxLength={7} placeholder={tr('默认颜色')} aria-invalid={draft[key] !== '' && !/^#[0-9a-fA-F]{6}$/.test(draft[key]) || undefined} onChange={event => onChange({ [key]: event.target.value })} />
      </div>
    </FieldRow>)}
    </SettingsSection>
    <section className="appearance-preview" data-preview-theme={draft.theme} aria-label={tr('外观预览')} style={{ color: draft.foregroundColor || undefined, backgroundColor: draft.backgroundColor || undefined, fontFamily: draft.uiFontFamily || undefined }}>
      <span className="appearance-preview-label">{tr('外观预览')}</span>
      <p style={{ fontSize: Math.max(12, Math.min(20, draft.fontSize)) }}>{tr('清晰的界面，让注意力留在任务上。')}</p>
      <code style={{ fontFamily: draft.codeFontFamily || undefined, fontSize: Math.max(10, Math.min(24, draft.codeFontSize)), color: draft.accentColor || undefined }}>const message = "Hello, Pi";</code>
    </section>
    <p className="hint">{tr('预览草稿外观；保存后应用到工作台。')}</p>
    <div className="appearance-actions">
      <Button size="sm" onClick={() => void transfer('theme.import')}>{tr('导入主题')}</Button>
      <Button size="sm" onClick={() => void transfer('theme.export')}>{tr('导出主题')}</Button>
      <Button size="sm" onClick={() => onChange(appearanceSchema.parse({}))}>{tr('恢复默认外观')}</Button>
    </div>
  </>;
}
