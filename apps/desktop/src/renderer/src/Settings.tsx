import { tr, localizeLabel, localizeAppError } from "../../shared/localization.ts";
import { useLocale } from "./hooks/use-locale.ts";
import { useContentMotion } from './hooks/use-content-motion.ts';
import { ArrowLeft, Boxes, Check, Database, Globe2, Keyboard, Plug2, Search, Settings2, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type DesktopData,
  type DesktopRequest,
  type ModelProvider,
  type ProviderModel,
  type ModelCatalog,
  modelCatalogSchema,
  settingsSchema,
  type Settings as SettingsType,
} from '../../shared/contracts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { Tabs } from './components/primitives/tabs.tsx';
import { UnsavedNavigation, type RegisterViewGuard } from './components/primitives/unsaved-navigation.tsx';
import { ModelSettings } from './ModelSettings.tsx';
import { GeneralSettings } from './GeneralSettings.tsx';
import { McpSettings } from './McpSettings.tsx';
import { AppearanceSettings } from './AppearanceSettings.tsx';
import { QuickShortcutSettings } from './QuickShortcutSettings.tsx';
import { MemorySettings } from './MemorySettings.tsx';
import { VoiceSettings } from './VoiceSettings.tsx';
import { BrowserSettings } from './BrowserSettings.tsx';
import { parseMcpSecrets, validateMcpConfiguration } from '../../shared/mcp-configuration.ts';
import { DEFAULT_KEYBINDINGS, keyboardShortcut, shortcutConflicts, shortcutMatchesQuery } from '../../shared/shortcuts.ts';
import { settingsChanges, sameSetting } from '../../shared/settings-updates.ts';
import { findModelProvider, validateModel, validateProvider } from '../../shared/model-configuration.ts';

import type { Locale } from '../../shared/locale.ts';

type Invoke = (request: DesktopRequest) => Promise<unknown>;
interface Feedback {
  text: string;
  error: boolean;
}

const CATEGORIES = { general: '通用', appearance: '外观', shortcuts: '键盘快捷键', models: '模型', permissions: '审批与信任', mcp: 'MCP', browser: '浏览器连接', memories: '跨会话记忆', voice: '离线语音' } as const;
export type SettingsCategory = keyof typeof CATEGORIES;
const CATEGORY_ICONS = { general: Settings2, appearance: Sun, shortcuts: Keyboard, models: Boxes, permissions: ShieldCheck, mcp: Plug2, browser: Globe2, memories: Database, voice: Settings2 };
const CATEGORY_DESCRIPTIONS = {
  general: '调整输入、通知和本机工作方式。', appearance: '为界面和代码选择合适的主题、字体与颜色。',
  shortcuts: '查找命令并设置符合习惯的按键。', models: '管理模型连接、凭据和能力，供任务选择。',
  permissions: '管理新任务的执行权限与项目授权。', mcp: '连接外部工具，按需管理授权与工具策略。',
  memories: '决定哪些信息可以跨会话保留和使用。', voice: '管理本地语音模型、设备和声音。', browser: '连接 Chrome 扩展并管理任务标签授权。',
} as const;
const CATEGORY_GROUPS = [
  { label: '个人', items: ['general', 'appearance', 'shortcuts', 'memories', 'voice'] },
  { label: '集成', items: ['mcp', 'browser'] },
  { label: '编码', items: ['models', 'permissions'] },
] as const;
const CATEGORY_KEYWORDS: Record<SettingsCategory, string[]> = {
  general: ['界面语言', '默认终端', '编辑器', '发送快捷键', '默认模型', '默认思考程度', '模型默认值', '任务完成通知', '通知条件', '运行期间防止休眠', '运行中追加消息', '关闭窗口时保留到托盘', '启用可选子任务'],
  appearance: ['主题', '字号', '界面字体', '代码字体', '代码字号', '强调色', '背景色', '前景色', '导入主题', '导出主题'], shortcuts: ['快捷键'], models: ['提供商', '模型', 'API Key', 'Base URL', '供应商'],
  permissions: ['默认审批', '项目可信度'], mcp: ['服务器', '工具'],
  memories: ['跨会话记忆', '记忆范围', '自动生成记忆候选'],
  voice: ['离线语音', '录音设备', '模型目录', '本地听写', '合成音色'], browser: ['Chrome', '浏览器连接', '配对码', '标签授权'],
};

export function SettingsNavigation({
  category,
  onChange,
  onBack,
  width,
}: {
  category: SettingsCategory;
  onChange(category: SettingsCategory): void;
  onBack?: () => void;
  width?: number;
}) {
  useLocale();
  const [query, setQuery] = useState('');
  const groups = CATEGORY_GROUPS.map(group => ({ ...group, items: group.items.filter(item =>
    [CATEGORIES[item], ...CATEGORY_KEYWORDS[item]].map(localizeLabel).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) }));
  return (
    <aside
      className={width ? 'sidebar settings-sidebar' : 'settings-nav'}
      style={width ? { width } : undefined}
    >
      {onBack && (
        <Button className="nav-row settings-back" onClick={onBack}>
          <ArrowLeft size={16} />
          {tr("返回工作台")} </Button>
      )}
      {onBack && <div className="settings-search"><Search size={14} aria-hidden="true" />
        <input aria-label={tr("搜索设置")} placeholder={tr("搜索设置")} value={query} onChange={event => setQuery(event.target.value)} />
      </div>}
      <nav
        className="settings-nav"
        aria-label={tr("设置分类")}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-category]'),
          );
          const current = buttons.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const next = buttons[current + (event.key === 'ArrowDown' ? 1 : -1)];
          next?.focus();
          next?.click();
        }}
      >
        {groups.filter(group => group.items.length).map(group => <section className="settings-nav-group" key={group.label}>
          <h2>{tr(group.label)}</h2>
          {group.items.map(item => {
            const Icon = CATEGORY_ICONS[item];
            return <button
            key={item}
            data-category={item}
            type="button"
            className={category === item ? 'active' : ''}
            aria-current={category === item ? 'true' : undefined}
            onClick={() => onChange(item)}
          >
            <Icon size={16} aria-hidden="true" /><span>{localizeLabel(CATEGORIES[item])}</span>
          </button>;
          })}
        </section>)}
        {!groups.some(group => group.items.length) && <p className="settings-nav-empty" role="status">{tr("没有匹配的设置")}</p>}
      </nav>
    </aside>
  );
}

export function Settings({
  data,
  invoke,
  category: externalCategory,
  onCategoryChange,
  onLocaleChange,
  registerViewGuard,
}: {
  data: DesktopData;
  invoke: Invoke;
  category?: SettingsCategory;
  onCategoryChange?: (category: SettingsCategory) => void;
  onLocaleChange?: (locale: Locale) => void;
  registerViewGuard?: RegisterViewGuard;
}) {
  useLocale();
  const [draft, setDraft] = useState<SettingsType>(() => structuredClone(data.settings));
  const baseline = useRef(draft);
  const [localCategory, setLocalCategory] = useState<SettingsCategory>('models');
  const category = externalCategory ?? localCategory;
  const setCategory = onCategoryChange ?? setLocalCategory;
  const pageRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  useContentMotion(bodyRef, category);
  useContentMotion(headingRef, category);
  useEffect(() => { pageRef.current?.scrollTo({ top: 0 }); }, [category]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [modelIssue, setModelIssue] = useState<{ id: string; text: string } | null>(null);
  const [selected, setSelected] = useState(draft.modelProviders[0]?.id || '');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const observedSettings = useRef(data.settings);
  useEffect(() => {
    // Only a new main-process snapshot can replace a pristine draft. A save completing
    // must not replay an older prop snapshot over freshly stored credential metadata.
    if (sameSetting(observedSettings.current, data.settings)) return;
    observedSettings.current = data.settings;
    if (saving || !sameSetting(draft, baseline.current) || Object.values(keys).some(Boolean) || Object.values(secrets).some(value => !!value.trim())) return;
    baseline.current = data.settings; setDraft(structuredClone(data.settings));
    setSelected(previous => data.settings.modelProviders.some(provider => provider.id === previous) ? previous : data.settings.modelProviders[0]?.id ?? '');
  }, [data.settings]);
  const [shortcutQuery, setShortcutQuery] = useState('');
  const savingRef = useRef(false);
  const focusAfterSave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (saving) return;
    const target = focusAfterSave.current;
    focusAfterSave.current = null;
    if (target?.isConnected && document.activeElement === document.body) target.focus();
  }, [saving]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [requestCatalog] = useState(() => invoke);
  useEffect(() => {
    let active = true;
    setCatalogError('');
    requestCatalog({ op: 'models.catalog' }).then((value) => {
      const parsed = modelCatalogSchema.parse(value);
      if (!parsed.length) throw new Error('empty catalog');
      if (active) setCatalog(parsed);
    }).catch(() => {
      if (active) setCatalogError("内置模型目录加载失败，可重试或使用自定义接口。");
    });
    return () => { active = false; };
  }, [requestCatalog, catalogAttempt]);
  const patch = (value: Partial<SettingsType>) => {
    setDraft((prev) => ({ ...prev, ...value }));
    setFeedback(null);
  };
  const patchProvider = (value: Partial<ModelProvider>) => {
    setModelIssue(null);
    patch({
      modelProviders: draft.modelProviders.map((item) => (item.id === selected ? { ...item, ...value } : item)),
    });
  };
  const patchModel = (id: string, value: Partial<ProviderModel>) => {
    setModelIssue(null);
    patch({ models: draft.models.map((model) => model.id === id ? { ...model, ...value } : model) });
  };
  const removeModel = (id: string) => {
    const remaining = draft.models.filter((model) => model.id !== id);
    patch({
      models: remaining,
      modelId: draft.modelId === id ? remaining.find((model) => model.provider === selected)?.id ?? remaining[0]?.id ?? '' : draft.modelId,
    });
    setModelIssue(null);
  };
  const persist = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    focusAfterSave.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaving(true);
    try {
      const conflicts = shortcutConflicts(draft.shortcuts);
      if (conflicts.length) throw new Error(conflicts.join('；'));
      const settings = { ...draft,
        modelProviders: draft.modelProviders.map((item) => ({ ...item, name: item.name.trim(), baseUrl: item.baseUrl.trim() })),
        models: draft.models.map((item) => ({ ...item, name: item.name.trim(), model: item.model.trim() })),
        mcpServers: draft.mcpServers.map(server => ({ ...server, name: server.name.trim(), command: server.command.trim(), url: server.url.trim() })) };
      const changes = settingsChanges(baseline.current, settings);
      for (const server of settings.mcpServers) validateMcpConfiguration(server);
      // Preferences do not depend on reloading the model catalog. Validate provider and model edits
      // from every category, and explicit model saves, without blocking unrelated groups. When the
      // catalog did not load, only the entries this draft touched are validated: an unrelated
      // built-in provider must not veto saving a custom one that does not need the catalog at all.
      const touchedProvider = (item: ModelProvider) => !baseline.current.modelProviders.some(old => old.id === item.id && sameSetting(old, item));
      const touchedModel = (item: ProviderModel) => !baseline.current.models.some(old => old.id === item.id && sameSetting(old, item));
      if (changes.modelProviders || changes.models || category === 'models') {
        for (const item of settings.modelProviders) {
          if (!catalog && !touchedProvider(item)) continue;
          try { validateProvider(item, catalog); }
          catch (reason) {
            setModelIssue({ id: item.id, text: reason instanceof Error ? reason.message : String(reason) });
            setSelected(item.id); setCategory('models');
            throw reason;
          }
        }
        for (const model of settings.models) {
          const owner = findModelProvider(settings, model);
          if (!catalog && !touchedModel(model) && !(owner && touchedProvider(owner))) continue;
          try { validateModel(model, owner, catalog); }
          catch (reason) {
            setModelIssue({ id: model.provider, text: reason instanceof Error ? reason.message : String(reason) });
            setSelected(model.provider); setCategory('models');
            throw reason;
          }
        }
      }
      setModelIssue(null);
      const pending = draft.mcpServers.flatMap(({ id }) => {
        const value = parseMcpSecrets(secrets[id] ?? '');
        return value === undefined ? [] : [{ id, value }];
      });
      const base = Object.fromEntries((Object.keys(changes) as (keyof SettingsType)[]).map(key => [key, baseline.current[key]]));
      const saved = settingsSchema.parse(await invoke({ op: 'settings.patch', patch: changes, base }));
      baseline.current = saved;
      setDraft(saved);
      // Credentials are renderer-only drafts keyed by the stable provider id. Save every remaining
      // provider's draft, regardless of the visible category; a failed write retains only unfinished keys.
      for (const provider of settings.modelProviders) {
        const { id } = provider;
        const key = keys[id];
        if (!key) continue;
        await invoke({ op: 'provider.key', id, key, base: provider });
        baseline.current = { ...baseline.current, modelProviders: baseline.current.modelProviders.map(item => item.id === id ? { ...item, hasKey: true } : item) };
        setKeys(previous => {
          if (previous[id] !== key) return previous;
          const next = { ...previous }; delete next[id]; return next;
        });
        setDraft(previous => ({ ...previous, modelProviders: previous.modelProviders.map(item => item.id === id ? { ...item, hasKey: true } : item) }));
      }
      for (const secret of pending) {
        await invoke({ op: 'mcp.secret', ...secret, base: settings.mcpServers.find(server => server.id === secret.id)! });
        setSecrets((prev) => ({ ...prev, [secret.id]: '' }));
      }
      return true;
    } finally { savingRef.current = false; setSaving(false); }
  };
  const save = async () => {
    try {
      if (!await persist()) return;
      setFeedback({ text: "设置已保存", error: false });
    } catch (reason) {
      // `invoke` already raised the banner; the status line is the row-level feedback the reference
      // shows next to the commit button.
      setFeedback({ text: reason instanceof Error ? reason.message : String(reason), error: true });
    }
  };
  const addProvider = (created: ModelProvider) => {
    patch({ modelProviders: [...draft.modelProviders, created], modelId: draft.modelId || '' });
    setSelected(created.id);
  };
  const removeProvider = (id: string) => {
    const remaining = draft.modelProviders.filter(item => item.id !== id);
    const index = draft.modelProviders.findIndex(item => item.id === id);
    const models = draft.models.filter(model => model.provider !== id);
    patch({
      modelProviders: remaining,
      models,
      modelId: models.some(model => model.id === draft.modelId) ? draft.modelId : models[0]?.id ?? '',
    });
    setKeys(previous => { const next = { ...previous }; delete next[id]; return next; });
    setModelIssue(null);
    setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? '');
  };

  const dirty = !sameSetting(draft, baseline.current) || Object.values(keys).some(Boolean) || Object.values(secrets).some(value => !!value.trim());
  return (
    <section className="settings-page" ref={pageRef} data-settings-category={category}>
      <header className="page-heading" ref={headingRef}>
        <h1>{localizeLabel(CATEGORIES[category])}</h1>
        <p className="settings-description">{tr(CATEGORY_DESCRIPTIONS[category])}</p>
      </header>
      <UnsavedNavigation register={registerViewGuard} busy={saving || memoryBusy}
        dirty={memoryDirty || dirty} />
      <div className="settings-layout">
        {externalCategory === undefined && <SettingsNavigation category={category} onChange={setCategory} />}
        <div className="settings-body" ref={bodyRef}>
          <fieldset className="settings-fields" disabled={saving} aria-label={tr("设置内容")} aria-busy={saving}>
          <MemorySettings data={data} preferences={draft.memory} onChange={memory => patch({ memory })} invoke={invoke} active={category === 'memories'} onDirty={setMemoryDirty} onBusy={setMemoryBusy} />
          <VoiceSettings preferences={draft.voice} savedDirectory={data.settings.voice.modelDirectory} onChange={voice => patch({ voice })} invoke={invoke} active={category === 'voice'} />
          {category === 'models' && <ModelSettings providers={draft.modelProviders} models={draft.models} defaultId={draft.modelId} selected={selected} keys={keys} invoke={invoke} persist={persist}
            savedProviderIds={baseline.current.modelProviders.map(provider => provider.id)}
            error={modelIssue?.id === selected ? modelIssue.text : undefined}
            catalog={catalog} catalogError={catalogError} onSelect={setSelected} onAddProvider={addProvider}
            onChange={patchProvider} onRetry={() => setCatalogAttempt(value => value + 1)}
            onKey={(id, value) => { setKeys(previous => ({ ...previous, [id]: value })); setFeedback(null); }}
            onAddModel={models => patch({ models: [...draft.models, ...models], modelId: draft.modelId || models[0]?.id || '' })}
            onModelChange={patchModel} onModelDelete={removeModel} onDeleteProvider={removeProvider} />}
          {category === 'general' && <GeneralSettings draft={draft} locale={data.ui.locale} providers={draft.modelProviders} models={draft.models} onChange={patch} onLocaleChange={onLocaleChange} />}
          {category === 'appearance' && <AppearanceSettings draft={draft} onChange={patch} invoke={invoke} onFeedback={(text, error) => setFeedback({ text, error })} />}
          {category === 'shortcuts' && (
            <>
              <div className="section-heading">
                <div>
                  <h2>{tr("工作台快捷键")}</h2>
                  <p className="hint">{tr("点击输入框后按组合键；Delete 清除。冲突会阻止保存。文件树快捷键仅在文件树获得焦点时生效。")}</p>
                </div>
              </div>
              <div className="shortcut-search settings-search"><Search size={14} aria-hidden="true" />
                <input aria-label={tr('搜索命令或快捷键')} placeholder={tr('输入命令名称，或直接按组合键')} value={shortcutQuery} onChange={event => setShortcutQuery(event.target.value)} onKeyDown={event => {
                  if (!(event.ctrlKey || event.altKey || event.metaKey)) return;
                  const keys = keyboardShortcut(event.nativeEvent);
                  if (keys) { event.preventDefault(); event.stopPropagation(); setShortcutQuery(keys); }
                }} />
              </div>
              <ul className="shortcut-list">
                {Object.entries(DEFAULT_KEYBINDINGS).filter(([id, item]) => shortcutMatchesQuery(localizeLabel(item.label), draft.shortcuts?.[id] ?? item.keys, shortcutQuery)).map(([id, item]) => (
                  <li key={id}>
                    <input aria-label={localizeLabel(item.label) + tr(" 快捷键")} readOnly value={draft.shortcuts?.[id] ?? item.keys} onKeyDown={event => { if (event.key === 'Tab') return; event.preventDefault(); const keys = event.key === 'Delete' ? '' : keyboardShortcut(event.nativeEvent); if (keys || event.key === 'Delete') patch({ shortcuts: { ...draft.shortcuts, [id]: keys } }); }} />
                    <span>{localizeLabel(item.label)}</span>
                  </li>
                ))}
              </ul>
              {!Object.entries(DEFAULT_KEYBINDINGS).some(([id, item]) => shortcutMatchesQuery(localizeLabel(item.label), draft.shortcuts?.[id] ?? item.keys, shortcutQuery)) && <p role="status">{tr('没有匹配的快捷键')}</p>}
              <Button size="sm" onClick={() => patch({ shortcuts: {} })}>{tr("恢复默认快捷键")}</Button>
              <QuickShortcutSettings shortcuts={data.settings.shortcuts} invoke={invoke} />
              {shortcutConflicts(draft.shortcuts).map(conflict => <p role="alert" key={conflict}>{conflict}</p>)}
            </>
          )}
          {category === 'permissions' && (
            <>
              <div className="section-heading">
                <div>
                  <h2>{tr("执行策略")}</h2>
                  <p className="hint">{tr("默认值只作用于新任务；进行中的任务保留自己的策略与推理强度。")}</p>
                </div>
              </div>
              <div className="field-stack">
                <FieldRow
                  label={tr("默认审批")}
                  description={tr(draft.policy === 'auto' ? '由独立模型请求审查操作；危险或不确定时交给你确认。' : draft.policy === 'full' ? '允许任务在完全访问模式下执行操作。' : '逐次确认需要授权的操作。')}
                >
                  <Menu id="settings-policy" label={tr("默认审批")} value={draft.policy} matchTriggerWidth className="settings-select"
                    options={[
                      ...(draft.policy === 'deny' ? [{ value: 'deny', label: tr('只读模式') }] : []),
                      { value: 'ask', label: tr('请求批准') },
                      { value: 'auto', label: tr('替我批准') },
                      { value: 'full', label: tr('完全访问') },
                    ]}
                    onChange={value => patch({ policy: value as SettingsType['policy'] })} />
                </FieldRow>
              </div>
              <details className="settings-explanation"><summary>{tr('沙箱与代审批说明')}</summary>
              <p className="hint">
                {tr('沙箱限制项目外访问并禁用网络；初始化失败时不会退回完全访问。沙箱模式下，外部扩展和 MCP 需要单独授权。')} </p>
              <p className="hint">{tr('替我批准使用当前任务模型的独立审查请求，不提供执行工具。低风险才自动放行；危险、不确定、超时或失败均由你手动批准，且不会扩大沙箱权限。')}</p></details>
              <div className="section-heading">
                <div>
                  <h2>{tr("项目可信度")}</h2>
                  <p className="hint">{tr("信任决定该项目能否使用 Skills、扩展与 MCP 工具。")} {tr("项目授权立即生效，无需保存设置。")}</p>
                </div>
              </div>
              <div className="field-stack">
                {data.projects.map((project) => (
                  <FieldRow key={project.id} label={project.name} description={project.path}>
                    <Button
                      size="sm"
                      onClick={() =>
                        void invoke({ op: 'project.trust', id: project.id, trusted: !project.trusted }).catch(
                          () => {},
                        )
                      }
                    >
                      {project.trusted ? tr("撤销信任") : tr("信任项目")}
                    </Button>
                  </FieldRow>
                ))}
                {!data.projects.length && <p className="hint">{tr("还没有项目。在侧栏点击「添加项目」。")}</p>}
              </div>
            </>
          )}
          {category === 'mcp' && <McpSettings data={data} servers={draft.mcpServers} secrets={secrets}
            policies={draft.mcpToolPolicies} onPoliciesChange={mcpToolPolicies => patch({ mcpToolPolicies })}
            onChange={mcpServers => patch({ mcpServers })} onSecret={(id, value) => { setSecrets(previous => ({ ...previous, [id]: value })); setFeedback(null); }}
            persist={persist} invoke={invoke} onFeedback={(text, error) => setFeedback({ text, error })} />}
          {category === 'browser' && <BrowserSettings data={data} invoke={invoke} />}
          </fieldset>
          <p className="hint">
            {tr("偏好保存后立即生效；模型、Skills 和 MCP 改动从下一次运行生效，不中断当前任务。")}
          </p>
          <footer className="settings-footer">
            <Button variant="primary" aria-disabled={saving || undefined} onClick={() => void save()}>
              <Check size={15} />
              {saving ? tr("正在保存设置…") : tr("保存设置")} </Button>
            {memoryDirty ? <span className="settings-save-hint" data-dirty>{tr('记忆草稿请使用「保存并确认记忆」单独保存。')}</span> : !feedback && <span className="settings-save-hint" data-dirty={dirty}>{dirty ? tr("有未保存的更改") : tr("设置与已保存内容一致")}</span>}
            <span className="form-feedback" data-error={feedback?.error || undefined} role="status">
              {localizeAppError(feedback?.text || '')}
            </span>
          </footer>
        </div>
      </div>
    </section>
  );
}
