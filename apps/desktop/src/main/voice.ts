import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { VoiceModels } from './voice-models.ts';
import { voiceWorkerResultSchema, type VoiceJob, type VoiceModelId, type VoicePreferences, type VoiceStatus, type VoiceWorkerRequest, type VoiceWorkerResult } from '../shared/voice.ts';

/** Main-owned voice state. Audio is never written to desktop.json, logs, or temp files. */
export class VoiceService {
  private models?: VoiceModels;
  private worker?: UtilityProcess;
  private pending?: { id: string; resolve(value: NonNullable<VoiceWorkerResult['value']>): void; reject(error: Error): void; timer: NodeJS.Timeout };
  private job?: VoiceJob;
  private controller?: AbortController;
  private lastActivity = 0;
  private readonly timeout: NodeJS.Timeout;
  private closed = false;
  private executing = 0;
  private startupError?: string;
  constructor(private readonly storage: string, private readonly workerFile: string, private readonly preferences: () => VoicePreferences) {
    this.timeout = setInterval(() => { if (this.job?.status === 'running' && this.job.kind === 'capture' && Date.now() - this.lastActivity > 150000) this.cancel(this.job.ownerId, this.job.id); }, 10000);
  }
  directory(): string { return this.preferences().modelDirectory || join(this.storage, 'voice-models'); }
  private modelStore(): VoiceModels {
    const directory = this.directory(); if (!this.models || this.models.root !== directory) this.models = new VoiceModels(directory); return this.models;
  }
  async init(): Promise<void> { try { await this.modelStore().recover(); this.startupError = undefined; } catch { this.startupError = '离线模型目录不可用，请在设置中选择可写目录'; } }
  async status(): Promise<VoiceStatus> { return { directory: this.directory(), models: await this.modelStore().list(), job: this.job && { ...this.job }, error: this.startupError }; }
  busy(): boolean { return this.job?.status === 'running' || this.executing > 0; }
  allowsMicrophone(ownerId: number): boolean { return this.job?.ownerId === ownerId && this.job.kind === 'capture' && this.job.status === 'running'; }
  private start(ownerId: number, id: string, kind: VoiceJob['kind'], stage: string, threadId?: string): AbortSignal {
    if (this.closed) throw new Error('语音服务已关闭');
    if (this.busy()) throw new Error('语音服务正在使用，请先结束当前操作');
    this.job = { id, ownerId, kind, threadId, status: 'running', stage }; this.controller = new AbortController(); this.lastActivity = Date.now(); this.executing++; return this.controller.signal;
  }
  private check(ownerId: number, id: string, threadId?: string): VoiceJob {
    if (!this.job || this.job.id !== id || this.job.ownerId !== ownerId || threadId !== undefined && this.job.threadId !== threadId || this.job.status !== 'running') throw new Error('语音操作不属于此窗口或已结束');
    this.controller!.signal.throwIfAborted(); this.lastActivity = Date.now(); return this.job;
  }
  private finish(error?: unknown): void {
    if (!this.job) return;
    if (error) { this.job.status = this.controller?.signal.aborted ? 'cancelled' : 'failed'; this.job.error = error instanceof Error ? error.message : String(error); }
    else { this.job.status = 'succeeded'; this.job.progress = 1; }
  }
  private kill(error = new Error('语音操作已取消')): void {
    const pending = this.pending; this.pending = undefined; if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    const worker = this.worker; this.worker = undefined; worker?.kill();
  }
  private request(input: VoiceWorkerRequest): Promise<NonNullable<VoiceWorkerResult['value']>> {
    if (this.pending) return Promise.reject(new Error('请等待上一段语音处理完成'));
    if (!this.worker) {
      const worker = utilityProcess.fork(this.workerFile, [], { stdio: 'ignore', serviceName: 'Pi Offline Voice', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); this.worker = worker;
      worker.on('message', raw => {
        if (this.worker !== worker) return;
        const parsed = voiceWorkerResultSchema.safeParse(raw); if (!parsed.success) { this.kill(new Error('语音进程返回了无效响应')); return; }
        const result = parsed.data, pending = this.pending; if (!pending || result.id !== pending.id) return;
        if (result.progress !== undefined && this.job) this.job.progress = result.progress;
        if (result.done) { this.pending = undefined; clearTimeout(pending.timer); if (result.error) pending.reject(new Error(result.error)); else pending.resolve(result.value ?? {}); }
      });
      worker.on('exit', () => { if (this.worker === worker) { this.kill(new Error('离线语音进程退出，请检查模型后重试')); if (this.busy()) this.finish(new Error('离线语音进程退出，请检查模型后重试')); } });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.kill(new Error('离线语音处理超时，请重试')), input.kind === 'tts' ? 300000 : 120000);
      this.pending = { id: input.id, resolve, reject, timer };
      try { this.worker!.postMessage(input); } catch (error) { this.pending = undefined; clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async model(ownerId: number, id: string, model: VoiceModelId, action: 'download' | 'import' | 'remove' | 'verify', archive?: string): Promise<void> {
    const signal = this.start(ownerId, id, 'model', '准备离线模型'); this.kill();
    try {
      if (action === 'remove') await this.modelStore().remove(model);
      else if (action === 'verify') await this.modelStore().verify(model, signal, true);
      else { if (action === 'import' && !archive) throw new Error('请选择模型文件'); await this.modelStore().install(model, archive, signal, (stage, progress) => { if (this.job) { this.job.stage = stage; this.job.progress = progress; } }); }
      signal.throwIfAborted(); this.finish();
    } catch (error) { this.finish(error); throw error; } finally { this.executing--; }
  }
  async begin(ownerId: number, threadId: string, id: string, language: VoicePreferences['language']): Promise<void> {
    const signal = this.start(ownerId, id, 'capture', '正在加载离线识别', threadId);
    try {
      if ((await this.modelStore().inspect('sensevoice')).status === 'missing' || (await this.modelStore().inspect('silero')).status === 'missing') throw new Error('请先下载或导入识别与语音检测模型');
      await this.modelStore().verify('sensevoice', signal); await this.modelStore().verify('silero', signal); signal.throwIfAborted();
      await this.request({ kind: 'capture.begin', id, directory: this.directory(), language }); signal.throwIfAborted(); this.job!.stage = '正在录音'; this.lastActivity = Date.now();
    } catch (error) { this.kill(); this.finish(error); throw error; } finally { this.executing--; }
  }
  async push(ownerId: number, threadId: string, id: string, pcm: string) {
    this.check(ownerId, id, threadId); this.executing++;
    try { return await this.request({ kind: 'capture.push', id, pcm }); }
    catch (error) { this.kill(); this.finish(error); throw error; } finally { this.executing--; }
  }
  async recognize(ownerId: number, threadId: string, id: string): Promise<string> {
    const job = this.check(ownerId, id, threadId); job.stage = '正在离线识别'; this.executing++;
    try { const result = await this.request({ kind: 'capture.finish', id }); this.controller!.signal.throwIfAborted(); this.finish(); return result.text ?? ''; }
    catch (error) { this.kill(); this.finish(error); throw error; } finally { this.executing--; }
  }
  async speak(ownerId: number, threadId: string, id: string, text: string, speaker: number, speed: number): Promise<string> {
    const signal = this.start(ownerId, id, 'tts', '正在离线合成', threadId);
    try { if ((await this.modelStore().inspect('kokoro')).status === 'missing') throw new Error('请先下载或导入语音合成模型'); await this.modelStore().verify('kokoro', signal); signal.throwIfAborted(); const result = await this.request({ kind: 'tts', id, directory: this.directory(), text, speaker, speed }); signal.throwIfAborted(); this.finish(); return result.wav ?? ''; }
    catch (error) { this.kill(); this.finish(error); throw error; } finally { this.executing--; }
  }
  cancel(ownerId: number, id: string): void {
    if (!this.job || this.job.id !== id || this.job.ownerId !== ownerId) throw new Error('语音操作不属于此窗口或已结束');
    if (this.job.status !== 'running') return;
    this.controller?.abort(); this.job.status = 'cancelled'; this.job.stage = '语音操作已取消'; this.kill();
  }
  closeOwner(ownerId: number): void { if (this.job?.ownerId === ownerId && this.busy()) this.cancel(ownerId, this.job.id); }
  releaseModels(): void { if (this.busy()) throw new Error('语音服务正在使用，请先结束当前操作'); this.kill(); this.models = undefined; this.startupError = undefined; }
  async dispose(): Promise<void> { this.closed = true; clearInterval(this.timeout); this.controller?.abort(); this.kill(); while (this.executing) await new Promise(resolve => setTimeout(resolve, 25)); }
}
