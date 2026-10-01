import type { Settings } from '../../shared/contracts.ts';
import type { Locale } from '../../shared/locale.ts';
import { tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { FieldRow } from './components/primitives/field-row.tsx';
import { SettingsSection } from './SettingsSection.tsx';

export function GeneralSettings({ draft, locale, onChange, onLocaleChange }: {
  draft: Settings;
  locale: Locale;
  onChange(patch: Partial<Settings>): void;
  onLocaleChange?(locale: Locale): void;
}) {
  useLocale();
  return <>
    <SettingsSection title={tr('界面与输入')}>
      <FieldRow label={tr('界面语言')} htmlFor="settings-locale" description={tr('立即生效，不会中断任务。')}>
        <select id="settings-locale" value={locale} onChange={event => onLocaleChange?.(event.target.value as Locale)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select>
      </FieldRow>
      <FieldRow label={tr('发送快捷键')} htmlFor="settings-send-shortcut" description={draft.sendShortcut === 'enter' ? tr('Enter 发送，Shift + Enter 换行') : tr('Ctrl + Enter 发送，Enter 换行')}>
        <select id="settings-send-shortcut" aria-label={tr('发送快捷键')} value={draft.sendShortcut} onChange={event => onChange({ sendShortcut: event.target.value as Settings['sendShortcut'] })}><option value="enter">Enter</option><option value="ctrl-enter">Ctrl + Enter</option></select>
      </FieldRow>
      <FieldRow label={tr('运行中追加消息')} htmlFor="settings-follow-up" description={tr('可在输入框临时选择；这里设置默认行为。')}>
        <select id="settings-follow-up" value={draft.followUpMode} onChange={event => onChange({ followUpMode: event.target.value as Settings['followUpMode'] })}><option value="followUp">{tr('排队到下一轮')}</option><option value="steer">{tr('引导当前任务')}</option></select>
      </FieldRow>
    </SettingsSection>
    <SettingsSection title={tr('通知与运行')}>
      <FieldRow label={tr('任务完成通知')} htmlFor="settings-notifications" description={tr('点击通知会打开对应任务')}>
        <input id="settings-notifications" type="checkbox" checked={draft.notifications !== false} onChange={event => onChange({ notifications: event.target.checked })} />
      </FieldRow>
      <FieldRow label={tr('通知条件')} htmlFor="settings-notification-mode">
        <select id="settings-notification-mode" value={draft.notificationMode} disabled={draft.notifications === false} onChange={event => onChange({ notificationMode: event.target.value as Settings['notificationMode'] })}><option value="unfocused">{tr('窗口不在前台时')}</option><option value="always">{tr('每次任务完成时')}</option><option value="never">{tr('不发送通知')}</option></select>
      </FieldRow>
      <FieldRow label={tr('运行期间防止休眠')} htmlFor="settings-prevent-sleep" description={tr('仅在任务执行期间保持系统唤醒；等待审批和任务结束后释放。')}>
        <input id="settings-prevent-sleep" type="checkbox" checked={draft.preventSleep} onChange={event => onChange({ preventSleep: event.target.checked })} />
      </FieldRow>
      <FieldRow label={tr('关闭窗口时保留到托盘')} htmlFor="settings-keep-in-tray" description={tr('自动化在托盘中继续运行')}>
        <input id="settings-keep-in-tray" type="checkbox" checked={draft.keepInTray} onChange={event => onChange({ keepInTray: event.target.checked })} />
      </FieldRow>
    </SettingsSection>
    <SettingsSection title={tr('本机工作环境')}>
      <FieldRow label={tr('默认终端')} htmlFor="settings-terminal" description={tr('新建集成终端使用的 shell')}>
        <select id="settings-terminal" aria-label={tr('默认终端')} value={draft.terminal} onChange={event => onChange({ terminal: event.target.value as Settings['terminal'] })}><option value="powershell">PowerShell</option><option value="cmd">Command Prompt</option><option value="git-bash">Git Bash</option></select>
      </FieldRow>
      <FieldRow label={tr('编辑器')} htmlFor="settings-editor" description={tr('「打开编辑器」使用的程序')}>
        <select id="settings-editor" aria-label={tr('编辑器')} value={draft.editor} onChange={event => onChange({ editor: event.target.value as Settings['editor'] })}><option value="vscode">Visual Studio Code</option><option value="system">{tr('系统默认')}</option></select>
      </FieldRow>
    </SettingsSection>
    <SettingsSection title={tr('扩展任务能力')}>
      <FieldRow label={tr('启用可选子任务')} htmlFor="settings-subtasks" description={tr('默认关闭。启用后由主代理管理子智能体，用户只读查看；危险操作仍按任务权限审批。')}>
        <input id="settings-subtasks" aria-label={tr('启用可选子任务')} type="checkbox" checked={draft.subtasksEnabled} onChange={event => onChange({ subtasksEnabled: event.target.checked })} />
      </FieldRow>
    </SettingsSection>
  </>;
}
