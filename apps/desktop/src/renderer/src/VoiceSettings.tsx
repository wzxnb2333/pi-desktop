import { useEffect, useState } from 'react';
import type { DesktopRequest } from '../../shared/contracts.ts';
import type { VoiceModelId, VoicePreferences, VoiceStatus } from '../../shared/voice.ts';
import { VOICE_MODELS } from '../../shared/voice-models.ts';
import { localizeAppError, localizeLabel, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { FieldRow } from './components/primitives/field-row.tsx';
import { ConfirmDialog } from './components/primitives/dialog.tsx';
import { SettingsSection } from './SettingsSection.tsx';

// Kokoro 1.1 has Chinese female 3..57, Chinese male 58..102 and English female 0..2.
export const VOICE_CHOICES = [{ id: 48, label: '中文女声' }, { id: 58, label: '中文男声' }, { id: 0, label: '美式英文女声' }, { id: 2, label: '英式英文女声' }] as const;
export function VoiceSettings({ preferences, savedDirectory, onChange, invoke, active }: { preferences: VoicePreferences; savedDirectory: string; onChange(value: VoicePreferences): void; invoke(request: DesktopRequest): Promise<unknown>; active: boolean }) {
  useLocale(); const [status, setStatus] = useState<VoiceStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [remove, setRemove] = useState<VoiceModelId>();
  const refresh = async () => { try { setStatus(await invoke({ op: 'voice.status' }) as VoiceStatus); } catch (error) { setError(localizeAppError(String(error))); } };
  const listDevices = async () => { try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput')); } catch { setError(tr('麦克风不可用，请检查 Windows 隐私设置、设备连接和录音权限。')); } };
  useEffect(() => { if (!active) return; let live = true; const update = async () => { try { const result = await invoke({ op: 'voice.status' }) as VoiceStatus; if (live) setStatus(result); } catch (reason) { if (live) setError(localizeAppError(String(reason))); } }; void update(); const timer = setInterval(() => void update(), 700); void listDevices(); return () => { live = false; clearInterval(timer); }; }, [active, invoke]);
  const action = async (model: VoiceModelId, action: 'download' | 'import' | 'remove' | 'verify') => {
    if (busy) return; setBusy(true); setError(''); setFeedback('');
    try { const result = await invoke({ op: 'voice.model', id: crypto.randomUUID(), model, action }); if (result !== null) setFeedback(tr('模型操作已完成')); }
    catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { await refresh(); setBusy(false); }
  };
  const patch = (value: Partial<VoicePreferences>) => onChange({ ...preferences, ...value });
  const pendingDirectory = preferences.modelDirectory !== savedDirectory, running = busy || status?.job?.status === 'running';
  return <div className="voice-settings" hidden={!active}>
    <SettingsSection title={tr('录音与朗读')} description={tr('录音只在内存中处理，不上传语音服务。识别文字按当前聊天模型发送。')}>
      <FieldRow label={tr('模型目录')} description={tr('修改模型目录前需要卸载现有模型。模型持久保存，不属于测试缓存。')}><div className="voice-directory"><code>{preferences.modelDirectory || status?.directory}</code><button type="button" disabled={running} onClick={() => void invoke({ op: 'voice.directory' }).then(path => { if (typeof path === 'string') patch({ modelDirectory: path }); }).catch(reason => setError(localizeAppError(String(reason))))}>{tr('选择目录')}</button></div></FieldRow>
      <FieldRow label={tr('录音设备')} htmlFor="voice-device"><div className="voice-device"><select id="voice-device" value={preferences.deviceId} onChange={event => patch({ deviceId: event.target.value })}><option value="">{tr('系统默认麦克风')}</option>{devices.filter(item => item.deviceId).map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || tr('麦克风 {p0}', { p0: index + 1 })}</option>)}{preferences.deviceId && !devices.some(item => item.deviceId === preferences.deviceId) && <option value={preferences.deviceId}>{tr('录音设备已断开，请选择其他设备后重试。')}</option>}</select><button type="button" onClick={() => void listDevices()}>{tr('刷新录音设备')}</button></div></FieldRow>
      <FieldRow label={tr('识别语言')} htmlFor="voice-language"><select id="voice-language" value={preferences.language} onChange={event => patch({ language: event.target.value as VoicePreferences['language'] })}><option value="auto">{tr('自动识别')}</option><option value="zh">{tr('中文')}</option><option value="en">{tr('英语')}</option></select></FieldRow>
      <FieldRow label={tr('合成音色')} htmlFor="voice-speaker"><select id="voice-speaker" value={preferences.speaker} onChange={event => patch({ speaker: Number(event.target.value) })}>{VOICE_CHOICES.map(item => <option value={item.id} key={item.id}>{tr(item.label)} · {item.id}</option>)}</select></FieldRow>
      <FieldRow label={tr('朗读速度')} htmlFor="voice-speed"><input id="voice-speed" type="number" min={0.5} max={2} step={0.1} value={preferences.speed} onChange={event => patch({ speed: Number(event.target.value) })} /></FieldRow>
    </SettingsSection>
    {pendingDirectory && <p role="status">{tr('先保存目录设置，再管理模型。')}</p>}
    {(error || status?.error) && <p role="alert">{error || localizeAppError(status!.error!)}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {status?.job?.status === 'running' && <div className="voice-progress" role="status"><span>{localizeLabel(status.job.stage)}</span><progress max={1} value={status.job.progress} /><button type="button" onClick={() => void invoke({ op: 'voice.cancel', id: status.job!.id }).catch(reason => setError(localizeAppError(String(reason))))}>{tr('取消语音操作')}</button></div>}
    <div className="section-heading"><h2>{tr('离线模型管理')}</h2></div>
    <div className="voice-model-list">{VOICE_MODELS.map(model => { const installed = status?.models.find(item => item.id === model.id); return <article className="config-card" key={model.id}>
      <header><strong>{model.label}</strong><span>{tr(installed?.status === 'installed' ? '模型已安装' : installed?.status === 'corrupt' ? '模型需要修复' : '模型未安装')}</span></header>
      <p className="hint">{(model.bytes / 1048576).toFixed(1)} MiB{installed?.bytes ? ' / ' + (installed.bytes / 1048576).toFixed(1) + ' MiB' : ''}</p>
      <code title={model.sha256}>SHA-256 · {model.sha256}</code>{installed?.error && <p role="alert">{localizeAppError(installed.error)}</p>}
      <footer>{!installed || installed.status === 'missing' ? <><button type="button" disabled={!status || running || pendingDirectory} onClick={() => void action(model.id, 'download')}>{tr('下载模型')}</button><button type="button" disabled={!status || running || pendingDirectory} onClick={() => void action(model.id, 'import')}>{tr('导入模型')}</button></> : <><button type="button" disabled={running || pendingDirectory} onClick={() => void action(model.id, 'verify')}>{tr('校验模型')}</button><button type="button" disabled={running || pendingDirectory} onClick={() => setRemove(model.id)}>{tr('卸载模型')}</button></>}</footer>
    </article>; })}</div>
    {remove && <ConfirmDialog title={tr('卸载此离线模型？')} description={tr('只删除应用管理的模型文件；之后使用需要重新下载或导入。')} danger confirmLabel={tr('卸载模型')} onCancel={() => setRemove(undefined)} onConfirm={() => { const id = remove; setRemove(undefined); void action(id, 'remove'); }} />}
  </div>;
}
