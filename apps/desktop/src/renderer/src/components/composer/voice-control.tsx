import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, AudioLines, Volume2, Square, X } from 'lucide-react';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { VoicePlayback, VoiceRecorder } from '../../lib/voice-audio.ts';
import { IconButton } from '../primitives/icon-button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

type Phase = 'idle' | 'loading' | 'recording' | 'recognizing' | 'waiting' | 'synthesizing' | 'speaking';
const labels = { idle: '本地听写', loading: '正在加载离线识别', recording: '正在录音', recognizing: '正在离线识别', waiting: '等待模型回答', synthesizing: '正在离线合成', speaking: '正在朗读' } as const;

/** One explicit, cancellable voice session per mounted task. Never survives navigation or restart. */
export function VoiceControl({ disabled, target }: { disabled: boolean; target: HTMLDivElement | null }) {
  useLocale(); const app = useApp(), latest = useRef(app); latest.current = app;
  const [phase, setPhase] = useState<Phase>('idle'), [conversation, setConversation] = useState(false), [confirm, setConfirm] = useState(false), [feedback, setFeedback] = useState(''), [error, setError] = useState('');
  const startingItems = useRef(new Set<string>());
  const epoch = useRef(0), alive = useRef(true), id = useRef(''), talking = useRef(false), finishing = useRef(false), recorder = useRef<VoiceRecorder | undefined>(undefined), playback = useRef<VoicePlayback | undefined>(undefined), queue = useRef(Promise.resolve()), queued = useRef(0), received = useRef(false);
  const current = (token: number) => alive.current && epoch.current === token;
  const stop = () => {
    epoch.current++; talking.current = false; finishing.current = false;
    recorder.current?.dispose(); recorder.current = undefined; playback.current?.dispose(); playback.current = undefined;
    if (id.current) void latest.current.invoke({ op: 'voice.cancel', id: id.current }).catch(() => {}); id.current = '';
    if (alive.current) { setPhase('idle'); setConversation(false); }
  };
  useEffect(() => { alive.current = true; const close = () => stop(); window.addEventListener('beforeunload', close); return () => { alive.current = false; window.removeEventListener('beforeunload', close); stop(); }; }, []);
  const fail = (reason: unknown, token: number) => { if (!current(token)) return; stop(); setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); };
  const append = (value: string) => latest.current.updateDraft(app.activeId, draft => ({ ...draft, text: [draft.text, value].filter(Boolean).join('\n') }));
  const cleanDraft = () => !latest.current.text.trim() && !latest.current.attachments.length && !latest.current.threadUi.contextReferences?.length;

  const read = async (value: string, token: number) => {
    if (!current(token)) return;
    if (value.length > 12000) throw new Error(tr('朗读内容过长，请选择较短文本'));
    const operation = crypto.randomUUID(); id.current = operation; setPhase('synthesizing');
    const prefs = latest.current.data.settings.voice;
    const wav = await latest.current.invoke({ op: 'voice.speak', threadId: app.activeId, id: operation, text: value, speaker: prefs.speaker, speed: prefs.speed });
    if (!current(token)) return; id.current = ''; setPhase('speaking');
    const audio = new VoicePlayback(); playback.current = audio;
    try { await audio.play(String(wav)); } catch { throw new Error(tr('语音输出无法播放，请重试或检查音频设备。')); } finally { audio.dispose(); if (playback.current === audio) playback.current = undefined; }
  };
  const finish = async (token: number) => {
    if (!current(token) || finishing.current) return; finishing.current = true;
    const capture = recorder.current; recorder.current = undefined; setPhase('recognizing');
    try {
      await capture?.stop(); await queue.current; if (!current(token)) return;
      const value = String(await latest.current.invoke({ op: 'voice.capture.finish', threadId: app.activeId, id: id.current }));
      if (!current(token)) return; id.current = '';
      if (!talking.current || !cleanDraft() || latest.current.running || latest.current.thread?.items.some(item => item.role === 'user' && !startingItems.current.has(item.id))) { append(value); stop(); setFeedback(tr('听写已加入草稿')); return; }
      const before = new Set(latest.current.thread?.items.map(message => message.id));
      // Preserve recognized text on a rejected send; sending never clears concurrent user edits.
      try { await latest.current.invoke({ op: 'thread.send', id: app.activeId, text: value, attachments: [] }); }
      catch (reason) { append(value); throw reason; }
      if (!current(token)) return; setPhase('waiting'); latest.current.followRef.current = true;
      const deadline = Date.now() + 30 * 60000;
      while (current(token)) {
        const thread = latest.current.thread;
        if (!thread || thread.status === 'error' || thread.status === 'interrupted') { stop(); return; }
        const answer = thread.items.findLast(message => !before.has(message.id) && message.role === 'assistant' && message.state === 'done' && message.stopReason !== 'aborted' && message.text.trim());
        if (thread.items.some(message => !before.has(message.id) && message.stopReason === 'aborted')) { stop(); return; }
        if (answer && thread.status === 'idle') {
          await read(answer.text, token);
          if (current(token) && talking.current) {
            if (!cleanDraft()) { stop(); return; }
            await record(token);
          }
          return;
        }
        if (Date.now() > deadline) throw new Error(tr('语音等待已结束，任务继续运行。'));
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (reason) { fail(reason, token); }
  };
  const record = async (token: number) => {
    if (!current(token)) return; finishing.current = false; received.current = false; queued.current = 0; queue.current = Promise.resolve(); setPhase('loading');
    startingItems.current = new Set(latest.current.thread?.items.map(item => item.id));
    const operation = crypto.randomUUID(); id.current = operation;
    const prefs = latest.current.data.settings.voice;
    await latest.current.invoke({ op: 'voice.capture.begin', threadId: app.activeId, id: operation, language: prefs.language });
    if (!current(token)) return;
    const capture = new VoiceRecorder(pcm => {
      if (!current(token)) return;
      if (++queued.current > 10) { fail(new Error(tr('录音处理过慢，请结束其他语音操作后重试。')), token); return; }
      queue.current = queue.current.then(async () => {
        if (!current(token)) return;
        const result = await latest.current.invoke({ op: 'voice.capture.push', threadId: app.activeId, id: operation, pcm }) as { ended?: boolean; detected?: boolean; seconds?: number };
        if (!current(token)) return;
        received.current ||= !!result.detected;
        if ((talking.current && result.ended && received.current) || (result.seconds ?? 0) >= 119) void finish(token);
      }).catch(reason => fail(reason, token)).finally(() => { queued.current--; });
    }, () => fail(new Error(tr('录音设备已断开，请选择其他设备后重试。')), token));
    recorder.current = capture;
    try { await capture.start(prefs.deviceId); } catch { throw new Error(tr('麦克风不可用，请检查 Windows 隐私设置、设备连接和录音权限。')); }
    if (current(token)) setPhase('recording'); else capture.dispose();
  };
  const start = (chat: boolean) => {
    if (phase !== 'idle' || disabled) return;
    setError(''); setFeedback('');
    if (chat && !cleanDraft()) { setError(tr('请先处理草稿与附件，再开启语音对话。')); return; }
    talking.current = chat; setConversation(chat); const token = ++epoch.current;
    void record(token).catch(reason => fail(reason, token));
  };
  const answer = app.thread?.items.findLast(message => message.role === 'assistant' && message.state === 'done' && message.text.trim());
  if (!target) return null;
  return createPortal(<div className="voice-controls" data-voice-phase={phase}>
    <IconButton size="sm" label={tr('本地听写')} disabled={disabled || phase !== 'idle'} onClick={() => start(false)}><Mic size={16} /></IconButton>
    <IconButton size="sm" label={tr('语音对话')} disabled={disabled || app.running || !app.thread?.modelId || phase !== 'idle'} onClick={() => setConfirm(true)}><AudioLines size={16} /></IconButton>
    {!!answer && <IconButton size="sm" label={tr('朗读最近回答')} disabled={phase !== 'idle'} onClick={() => { setError(''); setFeedback(''); const token = ++epoch.current; void read(answer.text, token).then(() => { if (current(token)) stop(); }).catch(reason => fail(reason, token)); }}><Volume2 size={16} /></IconButton>}
    {(phase !== 'idle' || feedback || error) && <div className="voice-session" role="status">
      <span>{phase !== 'idle' ? tr(labels[phase]) : feedback}</span>
      {phase === 'recording' && <button type="button" onClick={() => void finish(epoch.current)}>{tr('停止录音并识别')}</button>}
      {phase !== 'idle' && <IconButton size="sm" label={tr(conversation ? '结束语音对话' : phase === 'speaking' || phase === 'synthesizing' ? '停止朗读' : '取消语音操作')} onClick={stop}><Square size={14} /></IconButton>}
      {error && <p role="alert">{error}</p>}
      {phase === 'idle' && <IconButton size="sm" label={tr('关闭')} onClick={() => { setError(''); setFeedback(''); }}><X size={14} /></IconButton>}
    </div>}
    {confirm && <ConfirmDialog title={tr('开始语音对话')} description={tr('语音对话会将识别文字自动发送到当前模型，并在回答后本地朗读，再录制下一轮。')} confirmLabel={tr('开始语音对话')} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); start(true); }} />}
  </div>, target);
}
