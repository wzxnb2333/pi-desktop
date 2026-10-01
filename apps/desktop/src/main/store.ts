import { createHash } from 'node:crypto';
import { renameSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DesktopData, type Project, type Settings, type Thread, dataSchema, defaultData, settingsPatchSchema, threadSchema, uiSchema, uiThreadSchema } from '../shared/contracts.ts';
import { projectDirectories } from '../shared/project-directories.ts';
import { migrateDesktopData, UnsupportedDataVersionError, type MigrationOptions, type ProviderKeyMove } from './data-migrations.ts';
import { pluginSchema, type Plugin } from '../shared/plugins.ts';
import type { LineComment } from '../shared/reviews.ts';
import { projectEnvironmentSchema, type ProjectEnvironment } from '../shared/project-environment.ts';
import { managedWorktreeSchema, type ManagedWorktree } from '../shared/worktrees.ts';
import { browserAnnotationSchema, type BrowserAnnotation } from '../shared/browser-annotations.ts';
import { artifactAnnotationSchema, type ArtifactAnnotation } from '../shared/artifacts.ts';
import { goalSchema, type Goal } from '../shared/goals.ts';
import { publishAutomationState } from './automation-state.ts';
import { subtaskSchema, type Subtask } from '../shared/subtasks.ts';
import { publishSubtasks } from './subtask-state.ts';

function threadWorkspace(thread: Thread) {
  return { cwd: thread.cwd, worktreeBranch: thread.worktreeBranch, baseCommit: thread.baseCommit, workspaceRevision: thread.workspaceRevision };
}
function worktreeBaselines(record: ManagedWorktree) {
  return { localBaseline: record.localBaseline, worktreeBaseline: record.worktreeBaseline, lastUsedAt: record.lastUsedAt, lastTransferId: record.lastTransferId };
}
function workspaceFiles(ui: DesktopData['ui']['threads'][string]) {
  return { selectedPath: ui.selectedPath, openFiles: ui.openFiles, fileLocation: ui.fileLocation, fileDirectory: ui.fileDirectory, expandedDirectories: ui.expandedDirectories };
}

export type ProjectDirectoryConfig = Pick<Project, 'path' | 'trusted' | 'primaryDirectoryId' | 'directories'>;
function projectDirectoryConfig(project: Project): ProjectDirectoryConfig {
  return { path: project.path, trusted: project.trusted, primaryDirectoryId: project.primaryDirectoryId, directories: structuredClone(project.directories) };
}

type ReviewAnnotationChange =
  | { kind: 'finding'; findingId: string; ignored?: boolean; feedback?: string }
  | { kind: 'commentAdd'; comment: LineComment }
  | { kind: 'commentRemove'; commentId: string };

export class StoreRecoveryError extends Error {
  constructor(readonly directory: string, readonly reason: 'invalid' | 'future' | 'credentials') {
    super(reason === 'credentials' ? '凭据存储无法恢复，原文件和恢复记录已保留。请检查数据目录后重试。' : reason === 'future' ? '数据由更新版本的 Pi Desktop 创建，请使用相应版本打开。' : '桌面数据及备份无法读取，原文件已保留。请检查数据目录后重试。');
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
export class JsonStore {
  data: DesktopData = defaultData();
  readonly dir: string;
  recoveredFromBackup = false;
  /** Credentials that followed a legacy model into a merged provider; replayed once by the vault. */
  providerKeyMoves: ProviderKeyMove[] = [];
  private loadFailure?: StoreRecoveryError;
  private writing = Promise.resolve();
  private settingsRevision = 0;
  private pluginsRevision = 0;
  private automationRevision = 0;
  private subtaskRevision = 0;
  private draftRevisions = new Map<string, number>();
  private sidechatRevisions = new Map<string, number>();
  private sidechatSelectionRevisions = new Map<string, number>();
  private chatRevisions = new Map<string, number>();
  private quickChatRevision = 0;
  private taskLinkRevision = 0;
  private worktreeRegistrationRevisions = new Map<string, number>();
  private annotationRevisions = new Map<string, number>();
  private browserAnnotationRevisions = new Map<string, number>();
  private artifactAnnotationRevisions = new Map<string, number>();
  private goalRevisions = new Map<string, number>();
  private environmentRevisions = new Map<string, number>();
  private projectDirectoryRevisions = new Map<string, number>();
  private workspaceRevisions = new Map<string, number>();
  constructor(dir: string) {
    this.dir = dir;
  }
  async load(options: MigrationOptions = {}): Promise<void> {
    await this.writing;
    this.annotationRevisions.clear();
    this.browserAnnotationRevisions.clear();
    this.artifactAnnotationRevisions.clear();
    this.goalRevisions.clear();
    this.environmentRevisions.clear();
    this.projectDirectoryRevisions.clear();
    this.workspaceRevisions.clear();
    this.draftRevisions.clear();
    this.sidechatRevisions.clear(); this.sidechatSelectionRevisions.clear();
    this.chatRevisions.clear(); this.quickChatRevision = 0;
    this.taskLinkRevision = 0; this.worktreeRegistrationRevisions.clear();
    await mkdir(this.dir, { recursive: true });
    this.recoveredFromBackup = false;
    this.providerKeyMoves = [];
    let found = false;
    let damagedPrimary: string | undefined;
    for (const filename of ['desktop.json', 'desktop.json.bak']) {
      let raw: string;
      try {
        raw = await readFile(join(this.dir, filename), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') found = true;
        continue;
      }
      found = true;
      let migrated: ReturnType<typeof migrateDesktopData>;
      try {
        migrated = migrateDesktopData(JSON.parse(raw), options);
      } catch (error) {
        if (error instanceof UnsupportedDataVersionError) {
          this.loadFailure = new StoreRecoveryError(this.dir, 'future');
          throw this.loadFailure;
        }
        if (filename === 'desktop.json') damagedPrimary = raw;
        continue;
      }
      // Preserve the exact source before replacing anything. Hashes make retries idempotent.
      const preserve = async (content: string, label: string) => {
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        await writeFile(join(this.dir, `desktop.${label}-${hash}.json`), content, { flag: 'wx' }).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        });
      };
      if (migrated.fromVersion !== undefined) await preserve(raw, `pre-migration-v${migrated.fromVersion}`);
      if (damagedPrimary !== undefined) await preserve(damagedPrimary, 'corrupt');
      if (migrated.fromVersion !== undefined || filename !== 'desktop.json') {
        await writeFile(join(this.dir, 'desktop.json.tmp'), JSON.stringify(migrated.data));
        await rename(join(this.dir, 'desktop.json.tmp'), join(this.dir, 'desktop.json'));
      }
      this.data = migrated.data;
      this.providerKeyMoves = migrated.providerKeyMoves ?? [];
      this.loadFailure = undefined;
      this.recoveredFromBackup = filename !== 'desktop.json';
      return;
    }
    if (found) {
      this.loadFailure = new StoreRecoveryError(this.dir, 'invalid');
      throw this.loadFailure;
    }
    this.data = defaultData();
    this.loadFailure = undefined;
  }
  save(): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const snapshot = dataSchema.parse(this.data);
    const settingsRevision = this.settingsRevision;
    const pluginsRevision = this.pluginsRevision;
    const automationRevision = this.automationRevision;
    const subtaskRevision = this.subtaskRevision;
    const draftRevisions = new Map(this.draftRevisions);
    const sidechatRevisions = new Map(this.sidechatRevisions), sidechatSelectionRevisions = new Map(this.sidechatSelectionRevisions);
    const chatRevisions = new Map(this.chatRevisions), quickChatRevision = this.quickChatRevision;
    const worktreeRegistrationRevisions = new Map(this.worktreeRegistrationRevisions);
    const annotationRevisions = new Map(this.annotationRevisions);
    const browserAnnotationRevisions = new Map(this.browserAnnotationRevisions);
    const artifactAnnotationRevisions = new Map(this.artifactAnnotationRevisions);
    const goalRevisions = new Map(this.goalRevisions);
    const environmentRevisions = new Map(this.environmentRevisions);
    const projectDirectoryRevisions = new Map(this.projectDirectoryRevisions);
    const workspaceRevisions = new Map(this.workspaceRevisions);
    const write = async () => {
      // A delayed UI/session snapshot must not undo settings committed ahead of it.
      if (settingsRevision !== this.settingsRevision) {
        snapshot.settings = structuredClone(this.data.settings);
      }
      if (pluginsRevision !== this.pluginsRevision) snapshot.plugins = structuredClone(this.data.plugins);
      if (subtaskRevision !== this.subtaskRevision) snapshot.subtasks = structuredClone(this.data.subtasks);
      for (const [id, revision] of this.chatRevisions) {
        if (chatRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id), saved = snapshot.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        if (saved) Object.assign(saved, { projectId: current.projectId, directoryId: current.directoryId, cwd: current.cwd });
        else snapshot.threads.unshift(structuredClone(current));
        const ui = snapshot.ui.threads[id] ??= uiThreadSchema.parse({}); ui.directoryId = this.data.ui.threads[id]?.directoryId;
      }
      if (quickChatRevision !== this.quickChatRevision) { snapshot.windows ??= {}; if (this.data.windows?.quick) snapshot.windows.quick = structuredClone(this.data.windows.quick); }
      for (const [id, revision] of this.worktreeRegistrationRevisions) {
        if (worktreeRegistrationRevisions.get(id) === revision) continue;
        const current = this.data.worktrees.find(record => record.id === id);
        snapshot.worktrees = snapshot.worktrees.filter(record => record.id !== id);
        if (current) snapshot.worktrees.push(structuredClone(current));
      }
      for (const [id, revision] of this.sidechatRevisions) {
        if (sidechatRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id), saved = snapshot.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        if (saved) saved.sidechat = structuredClone(current.sidechat); else snapshot.threads.unshift(structuredClone(current));
      }
      for (const [id, revision] of this.sidechatSelectionRevisions) {
        if (sidechatSelectionRevisions.get(id) === revision) continue;
        const ui = snapshot.ui.threads[id] ??= uiThreadSchema.parse({}), current = this.data.ui.threads[id];
        ui.sidechatId = current?.sidechatId; ui.reviewTab = current?.reviewTab ?? 'changes';
      }
      for (const [id, revision] of this.draftRevisions) {
        if (draftRevisions.get(id) === revision) continue;
        const ui = snapshot.ui.threads[id] ??= uiThreadSchema.parse({});
        ui.draft = structuredClone(this.data.ui.threads[id]?.draft);
      }
      if (automationRevision !== this.automationRevision) {
        snapshot.automations = structuredClone(this.data.automations);
        snapshot.automationRuns = structuredClone(this.data.automationRuns);
      }
      for (const [id, revision] of this.environmentRevisions) {
        if (environmentRevisions.get(id) === revision) continue;
        const current = this.data.projects.find(project => project.id === id);
        if (!current) { snapshot.projects = snapshot.projects.filter(project => project.id !== id); continue; }
        const project = snapshot.projects.find(project => project.id === id);
        if (project) project.environment = structuredClone(current.environment);
      }
      for (const [id, revision] of this.projectDirectoryRevisions) {
        if (projectDirectoryRevisions.get(id) === revision) continue;
        const current = this.data.projects.find(project => project.id === id);
        if (!current) { snapshot.projects = snapshot.projects.filter(project => project.id !== id); continue; }
        const project = snapshot.projects.find(project => project.id === id);
        if (project) Object.assign(project, projectDirectoryConfig(current));
      }
      // Background saves can be queued before an annotation commit finishes.
      // Merge only annotations so newer runtime fields in this snapshot stay intact.
      for (const [id, revision] of this.annotationRevisions) {
        if (annotationRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        const thread = snapshot.threads.find(thread => thread.id === id);
        if (!thread) continue;
        thread.comments = structuredClone(current.comments);
        for (const finding of thread.review?.findings ?? []) {
          const latest = current.review?.findings.find(item => item.id === finding.id);
          if (latest) { finding.ignored = latest.ignored; finding.feedback = [...latest.feedback]; }
        }
      }
      for (const [id, revision] of this.browserAnnotationRevisions) {
        if (browserAnnotationRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        const thread = snapshot.threads.find(thread => thread.id === id);
        if (thread) thread.browserAnnotations = structuredClone(current.browserAnnotations);
      }
      for (const [id, revision] of this.artifactAnnotationRevisions) {
        if (artifactAnnotationRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        const thread = snapshot.threads.find(thread => thread.id === id);
        if (thread) thread.artifactAnnotations = structuredClone(current.artifactAnnotations);
      }
      for (const [id, revision] of this.goalRevisions) {
        if (goalRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        const thread = snapshot.threads.find(thread => thread.id === id);
        if (thread) thread.goal = structuredClone(current.goal);
      }
      for (const [id, revision] of this.workspaceRevisions) {
        if (workspaceRevisions.get(id) === revision) continue;
        const current = this.data.threads.find(thread => thread.id === id);
        if (!current) { snapshot.threads = snapshot.threads.filter(thread => thread.id !== id); continue; }
        const thread = snapshot.threads.find(thread => thread.id === id);
        if (thread) Object.assign(thread, threadWorkspace(current));
        for (const latest of this.data.worktrees.filter(record => record.threadId === id)) {
          const record = snapshot.worktrees.find(record => record.id === latest.id);
          if (record) Object.assign(record, worktreeBaselines(latest));
        }
        const ui = snapshot.ui.threads[id], currentUi = this.data.ui.threads[id];
        if (ui && currentUi) Object.assign(ui, structuredClone(workspaceFiles(currentUi)));
      }
      await this.write(snapshot);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveResources(next: Pick<Settings, 'resources' | 'ignoredSkillPaths'>): Promise<void> {
    return this.saveSettings({ resources: next.resources, ignoredSkillPaths: next.ignoredSkillPaths });
  }
  async settled(): Promise<void> { await this.writing.catch(() => {}); }
  createChat(candidate: Thread, quick: boolean, validate: () => void): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = threadSchema.parse(candidate);
    const write = async () => {
      validate();
      const existing = this.data.threads.find(thread => thread.id === next.id);
      if (existing) {
        if (existing.projectId || existing.sidechat || existing.review || existing.deletedAt) throw new Error('聊天请求标识已被使用，请重新创建聊天');
        return existing;
      }
      if (next.projectId || next.sidechat || next.review) throw new Error('只能通过此入口创建独立聊天');
      const snapshot = dataSchema.parse(this.data); snapshot.threads.unshift(next);
      if (quick) {
        const { threads: _threads, locale: _locale, ...frame } = uiSchema.parse({ sidebarOpen: false, summaryOpen: false });
        snapshot.windows ??= {};
        snapshot.windows.quick = { ...snapshot.windows.quick, kind: 'quick', open: false, frame: { ...frame, ...snapshot.windows.quick?.frame, activeThreadId: next.id, view: 'thread' } };
      }
      await this.write(snapshot, { validate, publish: () => {
        this.data.threads.unshift(next); this.chatRevisions.set(next.id, (this.chatRevisions.get(next.id) ?? 0) + 1);
        if (quick) { this.data.windows ??= {}; this.data.windows.quick = snapshot.windows!.quick; this.quickChatRevision++; }
      } });
      return next;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  bindChat(id: string, target: { projectId: string; directoryId: string; cwd: string }, validateRuntime: () => void): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const write = async () => {
      const thread = this.data.threads.find(thread => thread.id === id);
      if (!thread || thread.deletedAt || thread.archived || thread.sidechat || thread.review) throw new Error('此聊天当前不能绑定项目');
      if (thread.projectId) {
        if (thread.projectId === target.projectId && thread.directoryId === target.directoryId && thread.cwd === target.cwd) return thread;
        throw new Error('此聊天已绑定其他目录，请重新打开聊天后确认');
      }
      const previous = thread.cwd;
      const validate = () => {
        validateRuntime();
        const project = this.data.projects.find(project => project.id === target.projectId);
        if (!project || !projectDirectories(project).some(directory => directory.id === target.directoryId && directory.path === target.cwd)) throw new Error('项目目录已变化，请重新选择后绑定');
        if (!this.data.threads.includes(thread) || thread.deletedAt || thread.archived || thread.projectId || thread.cwd !== previous) throw new Error('此聊天当前不能绑定项目');
      };
      validate();
      const snapshot = dataSchema.parse(this.data); Object.assign(snapshot.threads.find(item => item.id === id)!, target);
      const ui = snapshot.ui.threads[id] ??= uiThreadSchema.parse({}); ui.directoryId = target.directoryId;
      await this.write(snapshot, { validate, publish: () => {
        Object.assign(thread, target); const current = this.data.ui.threads[id] ??= uiThreadSchema.parse({}); current.directoryId = target.directoryId;
        this.chatRevisions.set(id, (this.chatRevisions.get(id) ?? 0) + 1);
      } });
      return thread;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  createTask(candidate: Thread, managed: ManagedWorktree | undefined, validateRuntime: () => void): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = threadSchema.parse(candidate), worktree = managed && managedWorktreeSchema.parse(managed);
    const write = async () => {
      const run = next.automationRunId ? this.data.automationRuns.find(run => run.id === next.automationRunId) : undefined;
      const subtask = next.subtaskId ? this.data.subtasks.find(record => record.id === next.subtaskId) : undefined;
      const validate = () => {
        validateRuntime();
        if (this.data.threads.some(thread => thread.id === next.id)) throw new Error('任务创建请求已被使用，请重新创建任务');
        if (next.automationRunId && (!run || !this.data.automationRuns.includes(run) || run.status !== 'preparing' || run.threadId || run.automationId !== next.automationId)) throw new Error('自动化运行已失效');
        if (next.subtaskId) {
          const parent = this.data.threads.find(thread => thread.id === subtask?.parentThreadId);
          if (!subtask || !this.data.subtasks.includes(subtask) || subtask.status !== 'preparing' || subtask.childThreadId || !parent || parent.deletedAt || parent.archived) throw new Error('父任务不可用');
          if (next.policy === 'full' || (parent.planMode || parent.policy === 'deny' || subtask.definition.policy === 'deny') && next.policy !== 'deny' || (parent.policy === 'ask' || subtask.definition.policy === 'ask') && next.policy === 'auto') throw new Error('子任务不能扩大父任务的权限');
          if (subtask.definition.environment === 'local' && (parent.cwd !== next.cwd || parent.projectId !== next.projectId)) throw new Error('项目目录已变化，请重新选择后创建任务');
        }
        if (worktree && (worktree.threadId !== next.id || worktree.path !== next.cwd || this.data.worktrees.some(record => record.id === worktree.id))) throw new Error('Worktree 注册信息已变化，请重新创建任务');
      };
      validate();
      const snapshot = dataSchema.parse(this.data); snapshot.threads.unshift(next);
      if (worktree) snapshot.worktrees.push(worktree);
      if (run) snapshot.automationRuns.find(item => item.id === run.id)!.threadId = next.id;
      if (subtask) snapshot.subtasks.find(item => item.id === subtask.id)!.childThreadId = next.id;
      await this.write(snapshot, { validate, publish: () => {
        this.data.threads.unshift(next); this.chatRevisions.set(next.id, (this.chatRevisions.get(next.id) ?? 0) + 1);
        if (worktree) { this.data.worktrees.push(worktree); this.worktreeRegistrationRevisions.set(worktree.id, (this.worktreeRegistrationRevisions.get(worktree.id) ?? 0) + 1); }
        if (run) { run.threadId = next.id; this.automationRevision++; }
        if (subtask) { subtask.childThreadId = next.id; this.subtaskRevision++; }
        this.taskLinkRevision++;
      } });
      return next;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  restoreWorktreeOwner(worktreeId: string, candidate: Thread, validateRuntime: () => void): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = threadSchema.parse(candidate);
    const write = async () => {
      validateRuntime();
      const record = this.data.worktrees.find(item => item.id === worktreeId);
      if (!record || record.status !== 'ready' || record.restoreInProgress || record.archiveRemoval) throw new Error('Worktree 关联已变化，请重新打开管理面板后重试');
      const owner = this.data.threads.find(thread => thread.id === record.threadId && !thread.deletedAt);
      if (owner) {
        if (owner.projectId !== record.projectId) throw new Error('Worktree 关联已变化，请重新打开管理面板后重试');
        return owner;
      }
      const previous = JSON.stringify(record);
      const validate = () => {
        validateRuntime();
        const project = this.data.projects.find(project => project.id === record.projectId);
        if (!project || !projectDirectories(project).some(directory => directory.id === record.directoryId && directory.path === record.localPath)) throw new Error('项目目录已变化，请重新选择后创建任务');
        if (!this.data.worktrees.includes(record) || JSON.stringify(record) !== previous || this.data.threads.some(thread => thread.id === record.threadId && !thread.deletedAt)) throw new Error('Worktree 关联已变化，请重新打开管理面板后重试');
        if (this.data.threads.some(thread => thread.id === next.id) || next.projectId !== record.projectId || next.directoryId !== record.directoryId || next.cwd !== record.path || next.worktreeBranch !== record.branch || next.baseCommit !== record.baseCommit || next.deletedAt || next.archived || next.sidechat || next.review || next.subtaskId || next.automationId || next.automationRunId) throw new Error('恢复聊天的信息与 Worktree 不匹配');
      };
      validate();
      const snapshot = dataSchema.parse(this.data), saved = snapshot.worktrees.find(item => item.id === worktreeId)!;
      saved.snapshotThreadId ??= record.threadId; saved.threadId = next.id; snapshot.threads.unshift(next);
      await this.write(snapshot, { validate, publish: () => {
        this.data.threads.unshift(next); record.snapshotThreadId = saved.snapshotThreadId; record.threadId = next.id;
        this.chatRevisions.set(next.id, (this.chatRevisions.get(next.id) ?? 0) + 1);
        this.worktreeRegistrationRevisions.set(record.id, (this.worktreeRegistrationRevisions.get(record.id) ?? 0) + 1);
      } });
      return next;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  saveSubtasks(records: Subtask[]): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = subtaskSchema.array().parse(records);
    const links = this.taskLinkRevision;
    const write = async () => {
      if (links !== this.taskLinkRevision) for (const record of next) {
        const current = this.data.subtasks.find(item => item.id === record.id);
        if (current?.childThreadId) record.childThreadId = current.childThreadId;
      }
      await this.write(dataSchema.parse({ ...this.data, subtasks: next }));
      publishSubtasks(this.data.subtasks, next); this.subtaskRevision++;
    };
    this.writing = this.writing.then(write, write); return this.writing;
  }
  createSidechat(candidate: Thread): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = threadSchema.parse(candidate);
    const write = async () => {
      const parent = this.data.threads.find(thread => thread.id === next.sidechat?.parentThreadId);
      const validate = () => { if (!parent || !this.data.threads.includes(parent) || parent.deletedAt || parent.archived || parent.sidechat?.temporary) throw new Error('此任务不能创建侧聊'); };
      validate();
      const existing = this.data.threads.find(thread => thread.id === next.id);
      if (existing) {
        if (existing.sidechat?.parentThreadId !== parent!.id) throw new Error('侧聊标识已被使用');
        return existing;
      }
      const snapshot = dataSchema.parse(this.data); snapshot.threads.unshift(next);
      const ui = snapshot.ui.threads[parent!.id] ??= uiThreadSchema.parse({}); ui.sidechatId = next.id; ui.reviewTab = 'sidechat';
      await this.write(snapshot, { validate, publish: () => {
        this.data.threads.unshift(next); this.sidechatRevisions.set(next.id, (this.sidechatRevisions.get(next.id) ?? 0) + 1);
        const current = this.data.ui.threads[parent!.id] ??= uiThreadSchema.parse({}); current.sidechatId = next.id; current.reviewTab = 'sidechat';
        this.sidechatSelectionRevisions.set(parent!.id, (this.sidechatSelectionRevisions.get(parent!.id) ?? 0) + 1);
      } });
      return next;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  keepSidechat(id: string): Promise<Thread> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const write = async () => {
      const thread = this.data.threads.find(thread => thread.id === id);
      if (!thread?.sidechat) throw new Error('此任务不是临时侧聊');
      if (!thread.sidechat.temporary) return thread;
      const parent = this.data.threads.find(parent => parent.id === thread.sidechat!.parentThreadId);
      const validate = () => { if (!this.data.threads.includes(thread) || thread.deletedAt || !parent || parent.deletedAt) throw new Error('此任务不是临时侧聊'); };
      validate();
      const snapshot = dataSchema.parse(this.data), next = { ...thread.sidechat, temporary: false }, parentId = next.parentThreadId;
      snapshot.threads.find(thread => thread.id === id)!.sidechat = next;
      if (snapshot.ui.threads[parentId]?.sidechatId === id) snapshot.ui.threads[parentId].sidechatId = '';
      await this.write(snapshot, { validate, publish: () => {
        thread.sidechat = next; this.sidechatRevisions.set(id, (this.sidechatRevisions.get(id) ?? 0) + 1);
        if (this.data.ui.threads[parentId]?.sidechatId === id) this.data.ui.threads[parentId].sidechatId = '';
        this.sidechatSelectionRevisions.set(parentId, (this.sidechatSelectionRevisions.get(parentId) ?? 0) + 1);
      } });
      return thread;
    };
    const result = this.writing.then(write, write); this.writing = result.then(() => {}, () => {}); return result;
  }
  appendSidechat(id: string, itemId: string): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const write = async () => {
      const thread = this.data.threads.find(thread => thread.id === id);
      if (!thread?.sidechat || thread.deletedAt) throw new Error('此任务不是侧聊');
      const parent = this.data.threads.find(parent => parent.id === thread.sidechat!.parentThreadId && !parent.deletedAt);
      if (!parent) throw new Error('主任务已删除，无法追加草稿');
      if (thread.sidechat.appendedItemIds?.includes(itemId)) return;
      const item = thread.items.find(item => item.id === itemId && item.role === 'assistant' && item.state === 'done');
      if (!item?.text) throw new Error('请等待侧聊回答完成');
      const snapshot = dataSchema.parse(this.data), ui = snapshot.ui.threads[parent.id] ??= uiThreadSchema.parse({});
      const previous = JSON.stringify(ui.draft), text = [ui.draft?.text, item.text].filter(Boolean).join('\n\n');
      if (text.length > 1000000) throw new Error('草稿过长，请先处理主任务草稿');
      const draft = { text, attachments: ui.draft?.attachments ?? [] }, next = { ...thread.sidechat, appendedItemIds: [...(thread.sidechat.appendedItemIds ?? []), itemId] };
      ui.draft = draft; snapshot.threads.find(thread => thread.id === id)!.sidechat = next;
      await this.write(snapshot, {
        validate: () => {
          if (!this.data.threads.includes(parent) || parent.deletedAt || !this.data.threads.includes(thread) || thread.deletedAt) throw new Error('主任务已删除，无法追加草稿');
          if (JSON.stringify(this.data.ui.threads[parent.id]?.draft) !== previous) throw new Error('主任务草稿已变化，请重新追加侧聊回答');
        },
        publish: () => {
          const current = this.data.ui.threads[parent.id] ??= uiThreadSchema.parse({}); current.draft = structuredClone(draft); thread.sidechat = next;
          this.draftRevisions.set(parent.id, (this.draftRevisions.get(parent.id) ?? 0) + 1); this.sidechatRevisions.set(id, (this.sidechatRevisions.get(id) ?? 0) + 1);
        },
      });
    };
    this.writing = this.writing.then(write, write); return this.writing;
  }
  deliverSubtask(parentId: string, id: string): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const write = async () => {
      const parent = this.data.threads.find(thread => thread.id === parentId);
      if (!parent || parent.deletedAt || parent.archived) throw new Error('父任务不可用');
      const record = this.data.subtasks.find(item => item.id === id && item.parentThreadId === parentId);
      if (!record) throw new Error('子任务不属于此父任务');
      if (record.deliveredAt) return;
      if (record.status !== 'succeeded' || !record.result) throw new Error('子任务结果尚未可用');
      const snapshot = dataSchema.parse(this.data), ui = snapshot.ui.threads[parentId] ??= uiThreadSchema.parse({});
      const previous = JSON.stringify(ui.draft);
      const text = [ui.draft?.text, record.definition.title + '\n' + record.result].filter(Boolean).join('\n\n');
      if (text.length > 1000000) throw new Error('草稿过长，请先处理现有草稿');
      const draft = { ...ui.draft, text, attachments: ui.draft?.attachments ?? [] }, at = Date.now();
      ui.draft = draft; snapshot.subtasks.find(item => item.id === id)!.deliveredAt = at;
      await this.write(snapshot, {
        validate: () => {
          if (!this.data.threads.includes(parent) || parent.deletedAt || parent.archived) throw new Error('父任务不可用');
          if (JSON.stringify(this.data.ui.threads[parentId]?.draft) !== previous) throw new Error('父任务草稿已变化，请重新追加子任务结果');
        },
        publish: () => {
          const current = this.data.ui.threads[parentId] ??= uiThreadSchema.parse({});
          current.draft = structuredClone(draft); record.deliveredAt = at;
          this.subtaskRevision++; this.draftRevisions.set(parentId, (this.draftRevisions.get(parentId) ?? 0) + 1);
        },
      });
    };
    this.writing = this.writing.then(write, write); return this.writing;
  }
  saveWorkspaceMigration(input: { threadId: string; worktreeId: string; sourcePath: string; sourceRevision: number; destination: 'local' | 'worktree'; sourceTree: string; targetTree: string; transferId?: string }, signal?: AbortSignal): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const request = { ...input };
    const write = async () => {
      signal?.throwIfAborted();
      const current = this.data.threads.find(thread => thread.id === request.threadId && !thread.deletedAt);
      if (!current) throw new Error('任务不存在');
      const managed = this.data.worktrees.find(record => record.id === request.worktreeId && record.threadId === current.id && record.status === 'ready');
      if (!managed || current.cwd !== request.sourcePath || (current.workspaceRevision ?? 0) !== request.sourceRevision) throw new Error('迁移期间任务工作区已变化，请重新检查后重试');
      const snapshot = dataSchema.parse(this.data);
      const thread = snapshot.threads.find(thread => thread.id === current.id)!;
      const record = snapshot.worktrees.find(record => record.id === managed.id)!;
      const local = request.destination === 'local';
      record.localBaseline = local ? request.targetTree : request.sourceTree;
      record.worktreeBaseline = local ? request.sourceTree : request.targetTree;
      record.lastUsedAt = Date.now();
      if (request.transferId) record.lastTransferId = request.transferId;
      thread.cwd = local ? record.localPath : record.path;
      thread.worktreeBranch = local ? undefined : record.branch;
      thread.baseCommit = local ? undefined : record.baseCommit;
      thread.workspaceRevision = request.sourceRevision + 1;
      const ui = snapshot.ui.threads[thread.id];
      if (ui) Object.assign(ui, { selectedPath: '', openFiles: [], fileLocation: undefined, fileDirectory: '', expandedDirectories: [] });
      signal?.throwIfAborted();
      await this.write(snapshot);
      // The atomic state rename is the commit point. Do not throw for late cancellation:
      // the transfer must retain files now referenced by persisted task configuration.
      if (this.data.threads.includes(current)) Object.assign(current, threadWorkspace(thread));
      if (this.data.worktrees.includes(managed)) Object.assign(managed, worktreeBaselines(record));
      const liveUi = this.data.ui.threads[thread.id];
      if (liveUi && ui) Object.assign(liveUi, structuredClone(workspaceFiles(ui)));
      this.workspaceRevisions.set(current.id, (this.workspaceRevisions.get(current.id) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveProjectEnvironment(projectId: string, environment: ProjectEnvironment, base: ProjectEnvironment): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = projectEnvironmentSchema.parse(environment), expected = projectEnvironmentSchema.parse(base);
    const write = async () => {
      const current = this.data.projects.find(project => project.id === projectId);
      if (!current) throw new Error('项目不存在');
      if (JSON.stringify(projectEnvironmentSchema.parse(current.environment ?? {})) !== JSON.stringify(expected)) throw new Error('项目环境已在其他窗口修改，请重新打开后保存');
      const snapshot = dataSchema.parse(this.data);
      snapshot.projects.find(project => project.id === projectId)!.environment = next;
      await this.write(snapshot);
      // Failed persistence must not change which command a new action will run.
      if (this.data.projects.includes(current)) current.environment = next;
      this.environmentRevisions.set(projectId, (this.environmentRevisions.get(projectId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveProjectDirectories(projectId: string, directories: ProjectDirectoryConfig, base: ProjectDirectoryConfig): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = structuredClone(directories), expected = structuredClone(base);
    const write = async () => {
      const current = this.data.projects.find(project => project.id === projectId);
      if (!current) throw new Error('项目不存在');
      if (JSON.stringify(projectDirectoryConfig(current)) !== JSON.stringify(expected)) throw new Error('项目目录已在其他窗口修改，请重新打开后保存');
      const snapshot = dataSchema.parse(this.data), saved = snapshot.projects.find(project => project.id === projectId)!;
      Object.assign(saved, next);
      await this.write(snapshot);
      if (this.data.projects.includes(current)) Object.assign(current, structuredClone(next));
      this.projectDirectoryRevisions.set(projectId, (this.projectDirectoryRevisions.get(projectId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveReviewAnnotation(threadId: string, change: ReviewAnnotationChange): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const mutation = structuredClone(change);
    const write = async () => {
      const current = this.data.threads.find(thread => thread.id === threadId);
      if (!current) throw new Error('任务不存在');
      if (current.deletedAt) throw new Error('请先从回收站恢复任务');
      const snapshot = dataSchema.parse(this.data);
      const thread = snapshot.threads.find(thread => thread.id === threadId)!;
      if (mutation.kind === 'finding') {
        const finding = thread.review?.findings.find(item => item.id === mutation.findingId);
        if (!finding) throw new Error('审查发现不存在');
        if (mutation.ignored !== undefined) finding.ignored = mutation.ignored;
        if (mutation.feedback) finding.feedback.push(mutation.feedback);
      } else if (mutation.kind === 'commentAdd') thread.comments = [...(thread.comments ?? []), mutation.comment];
      else thread.comments = thread.comments?.filter(comment => comment.id !== mutation.commentId);
      await this.write(dataSchema.parse(snapshot));
      // Keep the live thread/review objects held by workers. Publish only the
      // committed fields; a failed write never exposes or autosaves the mutation.
      if (this.data.threads.includes(current)) {
        if (mutation.kind === 'finding') {
          const finding = current.review?.findings.find(item => item.id === mutation.findingId);
          const saved = thread.review!.findings.find(item => item.id === mutation.findingId)!;
          if (finding) { finding.ignored = saved.ignored; finding.feedback = [...saved.feedback]; }
        } else current.comments = structuredClone(thread.comments);
      }
      this.annotationRevisions.set(threadId, (this.annotationRevisions.get(threadId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveBrowserAnnotations(threadId: string, annotations: BrowserAnnotation[]): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = browserAnnotationSchema.array().max(200).parse(annotations);
    const write = async () => {
      const current = this.data.threads.find(thread => thread.id === threadId && !thread.deletedAt);
      if (!current) throw new Error('任务不存在');
      const snapshot = dataSchema.parse(this.data);
      snapshot.threads.find(thread => thread.id === threadId)!.browserAnnotations = next;
      await this.write(snapshot);
      if (this.data.threads.includes(current)) current.browserAnnotations = structuredClone(next);
      this.browserAnnotationRevisions.set(threadId, (this.browserAnnotationRevisions.get(threadId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveArtifactAnnotations(threadId: string, annotations: ArtifactAnnotation[]): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = artifactAnnotationSchema.array().max(200).parse(annotations);
    const write = async () => {
      const current = this.data.threads.find(thread => thread.id === threadId && !thread.deletedAt);
      if (!current) throw new Error('任务不存在');
      const snapshot = dataSchema.parse(this.data);
      snapshot.threads.find(thread => thread.id === threadId)!.artifactAnnotations = next;
      await this.write(snapshot);
      if (this.data.threads.includes(current)) current.artifactAnnotations = structuredClone(next);
      this.artifactAnnotationRevisions.set(threadId, (this.artifactAnnotationRevisions.get(threadId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveAutomationState(state: Pick<DesktopData, 'automations' | 'automationRuns'>): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = dataSchema.pick({ automations: true, automationRuns: true }).parse(state);
    const links = this.taskLinkRevision;
    const write = async () => {
      if (links !== this.taskLinkRevision) for (const run of next.automationRuns) {
        const current = this.data.automationRuns.find(item => item.id === run.id);
        if (current?.threadId) run.threadId = current.threadId;
      }
      await this.write(dataSchema.parse({ ...this.data, ...next }));
      publishAutomationState(this.data, next);
      this.automationRevision++;
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveGoal(threadId: string, goal: Goal | undefined, expected?: Pick<Goal, 'id' | 'revision'>): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = goal === undefined ? undefined : goalSchema.parse(goal), base = expected && { ...expected };
    const write = async () => {
      const current = this.data.threads.find(thread => thread.id === threadId);
      if (!current) throw new Error('任务不存在');
      if (current.goal?.id !== base?.id || current.goal?.revision !== base?.revision) throw new Error('目标已更新，请重新读取后再操作');
      const snapshot = dataSchema.parse(this.data);
      snapshot.threads.find(thread => thread.id === threadId)!.goal = next;
      await this.write(snapshot);
      // Publish only the committed goal; preserve the live thread held by workers.
      if (this.data.threads.includes(current)) current.goal = structuredClone(next);
      this.goalRevisions.set(threadId, (this.goalRevisions.get(threadId) ?? 0) + 1);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  savePlugins(plugins: Plugin[]): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const next = pluginSchema.array().parse(plugins);
    const write = async () => {
      await this.write(dataSchema.parse({ ...this.data, plugins: next }));
      this.data.plugins = next;
      this.pluginsRevision++;
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  saveSettings(patch: Partial<Settings>): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure);
    const changes = settingsPatchSchema.parse(patch);
    const write = async () => {
      const snapshot = dataSchema.parse({ ...this.data, settings: { ...this.data.settings, ...changes } });
      await this.write(snapshot);
      // Publish only after the atomic rename succeeds; failures leave live settings intact.
      Object.assign(this.data.settings, changes);
      this.settingsRevision++;
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }
  private async write(data: DesktopData, commit?: { validate(): void; publish(): void }): Promise<void> {
    const content = JSON.stringify(data);
    const path = join(this.dir, 'desktop.json');
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${path}.tmp`, content, 'utf8');
    await copyFile(path, `${path}.bak`).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (commit) {
      // Keep the final draft version check, atomic replacement and publication in
      // one event-loop turn so a keystroke cannot land between them. Bulk I/O above remains async.
      commit.validate(); renameSync(`${path}.tmp`, path); commit.publish();
    } else await rename(`${path}.tmp`, path);
  }
}
export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export class SecretVault {
  private readonly path: string;
  private readonly removalPath: string;
  private readonly encryption: Encryption;
  private readonly isReferenced: (id: string) => boolean | string;
  private queue = Promise.resolve();
  constructor(dir: string, encryption: Encryption, isReferenced: (id: string) => boolean | string = () => true) {
    this.path = join(dir, 'secrets.json');
    this.removalPath = join(dir, 'secrets-removal.json');
    this.encryption = encryption;
    this.isReferenced = isReferenced;
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    // The caller sees its failure, but it must not poison subsequent reads or retries.
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  private async read(): Promise<Record<string, string>> {
    try {
      const value = await readJson(this.path);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.values(value).some((v) => typeof v !== 'string')
      )
        throw new Error('密钥存储已损坏');
      return value as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  get(id: string): Promise<string | undefined> {
    return this.enqueue(async () => {
      await this.recoverPending();
      const data = await this.read();
      if (!data[id]) return undefined;
      if (!this.encryption.isEncryptionAvailable()) throw new Error('系统加密存储不可用');
      return this.encryption.decryptString(Buffer.from(data[id], 'base64'));
    });
  }
  has(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.recoverPending();
      return !!(await this.read())[id];
    });
  }
  set(id: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      await this.recoverPending();
      if (!this.encryption.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未保存密钥');
      const data = await this.read();
      if (value) data[id] = this.encryption.encryptString(value).toString('base64');
      else delete data[id];
      await this.write(data);
    });
  }
  recover(): Promise<void> {
    return this.enqueue(() => this.recoverPending());
  }
  /**
   * SHA-256 of every readable `provider:` credential, keyed by its full vault id. Migrations use the
   * hashes to tell identical keys apart from different ones without ever exposing the plaintext.
   *
   * Deliberately does not replay a pending removal journal: `recover()` decides what to restore from
   * the saved configuration, so it must run after `store.load()`, never before it.
   */
  providerFingerprints(): Promise<Record<string, string>> {
    return this.enqueue(async () => {
      const data = await this.read();
      const result: Record<string, string> = {};
      for (const [id, value] of Object.entries(data)) {
        if (!id.startsWith('provider:') || !this.encryption.isEncryptionAvailable()) continue;
        try { result[id] = createHash('sha256').update(this.encryption.decryptString(Buffer.from(value, 'base64'))).digest('hex'); }
        catch { /* An unreadable credential compares as unknown and never merges a second key. */ }
      }
      return result;
    });
  }
  /** Replay a merge: copy ciphertext onto the surviving provider id, then drop the old entry. */
  moveProviderKeys(moves: readonly ProviderKeyMove[]): Promise<void> {
    if (!moves.length) return Promise.resolve();
    return this.enqueue(async () => {
      await this.recoverPending();
      const data = await this.read();
      let changed = false;
      for (const move of moves) {
        // A self-move would delete the only copy.
        if (move.from === move.to) continue;
        const value = data[move.from];
        if (!value) continue;
        data[move.to] ??= value;
        delete data[move.from];
        changed = true;
      }
      if (changed) await this.write(data);
    });
  }
  pruneMcp(): Promise<number> {
    return this.enqueue(async () => {
      await this.recoverPending();
      const data = await this.read();
      const obsolete = Object.keys(data).filter(id => /^(?:mcp:.+|mcp-oauth:[a-f0-9]{64})$/.test(id) && !this.isReferenced(id));
      for (const id of obsolete) delete data[id];
      if (obsolete.length) await this.write(data);
      return obsolete.length;
    });
  }
  removeForSettings(ids: string[], commit: () => Promise<void>): Promise<string | undefined> {
    return this.enqueue(async () => {
      await this.recoverPending();
      const data = await this.read();
      const entries = Object.fromEntries(ids.filter(id => data[id]).map(id => [id, data[id]]));
      if (!Object.keys(entries).length) { await commit(); return; }
      // Ciphertext only. A restart decides rollback/cleanup from the persisted configuration.
      const references = Object.fromEntries(Object.keys(entries).map(id => [id, this.isReferenced(id)]));
      await writeFile(`${this.removalPath}.tmp`, JSON.stringify({ version: 1, entries, references }), { mode: 0o600 });
      await rename(`${this.removalPath}.tmp`, this.removalPath);
      for (const id of Object.keys(entries)) delete data[id];
      try {
        await this.write(data);
        await commit();
      } catch (error) {
        try { await this.recoverPending(); }
        catch { throw new Error('设置未保存，凭据恢复尚未完成。原始加密记录已保留，请排除存储问题后重试。', { cause: error }); }
        throw error;
      }
      try { await unlink(this.removalPath); }
      catch { return '设置已保存，凭据恢复记录暂未清理，将在下次访问时重试。'; }
    });
  }
  private async write(data: Record<string, string>): Promise<void> {
    await writeFile(`${this.path}.tmp`, JSON.stringify(data), { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }
  private async recoverPending(): Promise<void> {
    let raw: unknown;
    try { raw = await readJson(this.removalPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('凭据恢复记录无法读取，原文件已保留。', { cause: error });
    }
    if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('entries' in raw) || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries) ||
      Object.entries(raw.entries).some(([id, value]) => !/^(?:(?:provider|mcp):.+|mcp-oauth:[a-f0-9]{64})$/.test(id) || typeof value !== 'string' || !value))
      throw new Error('凭据恢复记录无法读取，原文件已保留。');
    const references = 'references' in raw ? raw.references : undefined;
    if (references !== undefined && (!references || typeof references !== 'object' || Array.isArray(references) ||
      Object.keys(references).length !== Object.keys(raw.entries).length ||
      Object.entries(references).some(([id, value]) => !Object.hasOwn(raw.entries!, id) || (typeof value !== 'boolean' && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))))))
      throw new Error('凭据恢复记录无法读取，原文件已保留。');
    const data = await this.read();
    let changed = false;
    for (const [id, value] of Object.entries(raw.entries) as [string, string][]) {
      const reference = this.isReferenced(id);
      if (reference && (references === undefined || reference === (references as Record<string, string | boolean>)[id])) {
        if (!data[id]) { data[id] = value; changed = true; }
      } else if (data[id] === value) { delete data[id]; changed = true; }
    }
    // Do not replace a newer externally written credential with the recovery copy.
    if (changed) await this.write(data);
    await unlink(this.removalPath);
  }
}
