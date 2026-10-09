import { thinkingSchema, type ModelProvider, type ProviderModel, type Settings } from '../../shared/contracts.ts';
import type { Locale } from '../../shared/locale.ts';
import { tr } from '../../shared/localization.ts';
import { allowedThinkingLevels, type ThinkingLevel } from '../../shared/thinking.ts';
import { thinkingLabels } from './lib/labels.ts';
import { useLocale } from './hooks/use-locale.ts';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { SettingsSection } from './SettingsSection.tsx';

/**
 * Every list-of-choices control here is the app's popover `Menu`, not a native `<select>`: the operating
 * system renders a select's popup itself (blue highlight, its own fonts), which is the one piece of
 * chrome the rest of this interface cannot style. `label` keeps the accessible name tests resolve.
 */
export function GeneralSettings({
  draft,
  locale,
  providers,
  models,
  onChange,
  onLocaleChange,
}: {
  draft: Settings;
  locale: Locale;
  providers: ModelProvider[];
  models: ProviderModel[];
  onChange(patch: Partial<Settings>): void;
  onLocaleChange?(locale: Locale): void;
}) {
  useLocale();
  const defaultModel = models.find((model) => model.id === draft.modelId) ?? models[0];
  return (
    <>
      <SettingsSection title={tr('界面与输入')}>
        <FieldRow label={tr('界面语言')} description={tr('立即生效，不会中断任务。')}>
          <Menu
            id="settings-locale"
            label={tr('界面语言')}
            value={locale}
            matchTriggerWidth
            className="settings-select"
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en-US', label: 'English' },
            ]}
            onChange={(value) => onLocaleChange?.(value as Locale)}
          />
        </FieldRow>
        <FieldRow
          label={tr('发送快捷键')}
          description={
            draft.sendShortcut === 'enter' ? tr('Enter 发送，Shift + Enter 换行') : tr('Ctrl + Enter 发送，Enter 换行')
          }
        >
          <Menu
            id="settings-send-shortcut"
            label={tr('发送快捷键')}
            value={draft.sendShortcut}
            matchTriggerWidth
            className="settings-select"
            options={[
              { value: 'enter', label: 'Enter' },
              { value: 'ctrl-enter', label: 'Ctrl + Enter' },
            ]}
            onChange={(value) => onChange({ sendShortcut: value as Settings['sendShortcut'] })}
          />
        </FieldRow>
        <FieldRow label={tr('运行中追加消息')} description={tr('可在输入框临时选择；这里设置默认行为。')}>
          <Menu
            id="settings-follow-up"
            label={tr('运行中追加消息')}
            value={draft.followUpMode}
            matchTriggerWidth
            className="settings-select"
            options={[
              { value: 'followUp', label: tr('排队到下一轮') },
              { value: 'steer', label: tr('引导当前任务') },
            ]}
            onChange={(value) => onChange({ followUpMode: value as Settings['followUpMode'] })}
          />
        </FieldRow>
      </SettingsSection>
      <SettingsSection
        title={tr('模型默认值')}
        description={tr('用于新建任务与快速聊天；已有会话保留各自的模型和思考程度。')}
      >
        <FieldRow label={tr('默认模型')} htmlFor="settings-default-model">
          <Menu
            id="settings-default-model"
            label={tr('默认模型')}
            value={defaultModel?.id ?? ''}
            display={models.length ? undefined : tr('还没有模型')}
            matchTriggerWidth
            className="settings-select"
            disabled={!models.length}
            options={
              models.length
                ? models.map((model) => ({
                    value: model.id,
                    label:
                      (providers.find((provider) => provider.id === model.provider)?.name ?? '') + ' · ' + model.name,
                  }))
                : [{ value: '', label: tr('还没有模型') }]
            }
            onChange={(value) => onChange({ modelId: value })}
          />
        </FieldRow>
        <FieldRow
          label={tr('默认思考程度')}
          htmlFor="settings-default-thinking"
          description={
            defaultModel
              ? tr('当前默认模型支持：{p0}。超出范围的档位会自动回落到最接近的一档。', {
                  p0: allowedThinkingLevels(defaultModel)
                    .map((level) => thinkingLabels[level])
                    .join('、'),
                })
              : tr('添加模型后可设置默认思考程度。')
          }
        >
          <Menu
            id="settings-default-thinking"
            label={tr('默认思考程度')}
            value={draft.thinking}
            matchTriggerWidth
            className="settings-select"
            disabled={!defaultModel}
            options={thinkingSchema.options.map((level) => ({ value: level, label: thinkingLabels[level] }))}
            onChange={(level) => onChange({ thinking: level as ThinkingLevel })}
          />
        </FieldRow>
      </SettingsSection>
      <SettingsSection title={tr('通知与运行')}>
        <FieldRow
          label={tr('任务完成通知')}
          htmlFor="settings-notifications"
          description={tr('点击通知会打开对应任务')}
        >
          <input
            id="settings-notifications"
            type="checkbox"
            checked={draft.notifications !== false}
            onChange={(event) => onChange({ notifications: event.target.checked })}
          />
        </FieldRow>
        <FieldRow label={tr('通知条件')}>
          <Menu
            id="settings-notification-mode"
            label={tr('通知条件')}
            value={draft.notificationMode}
            matchTriggerWidth
            className="settings-select"
            disabled={draft.notifications === false}
            options={[
              { value: 'unfocused', label: tr('窗口不在前台时') },
              { value: 'always', label: tr('每次任务完成时') },
              { value: 'never', label: tr('不发送通知') },
            ]}
            onChange={(value) => onChange({ notificationMode: value as Settings['notificationMode'] })}
          />
        </FieldRow>
        <FieldRow
          label={tr('运行期间防止休眠')}
          htmlFor="settings-prevent-sleep"
          description={tr('仅在任务执行期间保持系统唤醒；等待审批和任务结束后释放。')}
        >
          <input
            id="settings-prevent-sleep"
            type="checkbox"
            checked={draft.preventSleep}
            onChange={(event) => onChange({ preventSleep: event.target.checked })}
          />
        </FieldRow>
        <FieldRow
          label={tr('关闭窗口时保留到托盘')}
          htmlFor="settings-keep-in-tray"
          description={tr('自动化在托盘中继续运行')}
        >
          <input
            id="settings-keep-in-tray"
            type="checkbox"
            checked={draft.keepInTray}
            onChange={(event) => onChange({ keepInTray: event.target.checked })}
          />
        </FieldRow>
      </SettingsSection>
      <SettingsSection title={tr('本机工作环境')}>
        <FieldRow label={tr('默认终端')} description={tr('新建集成终端使用的 shell')}>
          <Menu
            id="settings-terminal"
            label={tr('默认终端')}
            value={draft.terminal}
            matchTriggerWidth
            className="settings-select"
            options={[
              { value: 'powershell', label: 'PowerShell' },
              { value: 'cmd', label: 'Command Prompt' },
              { value: 'git-bash', label: 'Git Bash' },
            ]}
            onChange={(value) => onChange({ terminal: value as Settings['terminal'] })}
          />
        </FieldRow>
        <FieldRow label={tr('编辑器')} description={tr('「打开编辑器」使用的程序')}>
          <Menu
            id="settings-editor"
            label={tr('编辑器')}
            value={draft.editor}
            matchTriggerWidth
            className="settings-select"
            options={[
              { value: 'vscode', label: 'Visual Studio Code' },
              { value: 'system', label: tr('系统默认') },
            ]}
            onChange={(value) => onChange({ editor: value as Settings['editor'] })}
          />
        </FieldRow>
      </SettingsSection>
      <SettingsSection title={tr('扩展任务能力')}>
        <FieldRow
          label={tr('启用可选子任务')}
          htmlFor="settings-subtasks"
          description={tr('默认关闭。启用后由主代理管理子智能体，用户只读查看；危险操作仍按任务权限审批。')}
        >
          <input
            id="settings-subtasks"
            aria-label={tr('启用可选子任务')}
            type="checkbox"
            checked={draft.subtasksEnabled}
            onChange={(event) => onChange({ subtasksEnabled: event.target.checked })}
          />
        </FieldRow>
      </SettingsSection>
    </>
  );
}
