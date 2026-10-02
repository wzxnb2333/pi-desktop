/**
 * The model-facing desktop surface: which tool family owns which action, whether it reads or writes,
 * and whether the `ask` policy gates it. The catalog is the single source for three consumers — the
 * worker's tool definitions, `get_harness section=desktop` (so the model can discover what exists
 * without a page of tool descriptions) and the guard test that keeps the permission plane unreachable.
 *
 * Boundaries live here on purpose: an action that could change the model's own permissions, the sandbox,
 * tool policies, approvals or credentials must not appear in this file at all.
 */

export const desktopToolFamilies = ['session', 'project', 'ui', 'message', 'review', 'git', 'worktree', 'terminal', 'file', 'browser', 'pr', 'resource', 'settings', 'skill', 'automation', 'inbox', 'mcp', 'window', 'artifact'] as const;
export type DesktopToolFamily = (typeof desktopToolFamilies)[number];

export interface DesktopToolAction {
  family: DesktopToolFamily;
  /** Tool that carries the action. */
  tool: string;
  /** Action id passed in the tool's `action` field. */
  action: string;
  /** One line the model reads in the catalog. */
  summary: string;
  mode: 'read' | 'write';
  /** `policy` means: approval card under the `ask` policy, no card under `auto`/`full`, refused under `deny`. */
  approval: 'none' | 'policy';
  /** Delivery wave from the plan; the guard test keeps implemented waves honest. */
  wave: number;
}

/** Waves already implemented in the worker/tool wiring. */
export const implementedDesktopWave = 5;

export const desktopToolCatalog: readonly DesktopToolAction[] = [
  // Wave 1 — sessions, projects, the view, and cross-session context.
  { family: 'session', tool: 'read_sessions', action: 'sessions.list', summary: '列出工作区里的会话（可按项目、关键词、置顶、归档、更新时间过滤）', mode: 'read', approval: 'none', wave: 1 },
  { family: 'session', tool: 'read_sessions', action: 'sessions.read', summary: '读取指定会话的用户/助手消息（分页、角色过滤、字符上限）', mode: 'read', approval: 'none', wave: 1 },
  { family: 'session', tool: 'read_sessions', action: 'sessions.search', summary: '在工作区会话里做字面量搜索，返回命中片段与所在会话', mode: 'read', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.create', summary: '新建会话（可指定项目/附加目录/worktree）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.select', summary: '把工作台切换到某个会话（必要时打开它的窗口）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.rename', summary: '重命名会话', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.pin', summary: '置顶或取消置顶会话', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.archive', summary: '归档或恢复归档会话', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.markRead', summary: '把会话标记为已读或未读', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.stop', summary: '停止会话正在运行的任务', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.resume', summary: '继续（恢复）一个空闲会话', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.fork', summary: '从当前会话分叉（可指定条目与 worktree）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.delete', summary: '删除会话及其会话文件（沿用原生确认框）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.quickChat', summary: '新建一个不带项目的快速聊天', mode: 'write', approval: 'none', wave: 4 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.bindProject', summary: '把当前会话绑定到某个项目（可带附加目录）', mode: 'write', approval: 'none', wave: 4 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.keepSidechat', summary: '把临时侧聊保留成正式会话', mode: 'write', approval: 'none', wave: 4 },
  { family: 'session', tool: 'manage_sessions', action: 'sessions.appendSidechat', summary: '把侧聊里的一条内容追加回主会话草稿', mode: 'write', approval: 'none', wave: 4 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.openExternal', summary: '用系统浏览器打开 http(s) 链接（需审批）', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'session', tool: 'send_to_session', action: 'sessions.send', summary: '给任意会话发送消息（steer 或 followUp 排队语义）', mode: 'write', approval: 'policy', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.list', summary: '列出项目、信任状态与附加目录', mode: 'read', approval: 'none', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.add', summary: '添加本地项目（可带 path，缺省时让用户选目录）', mode: 'write', approval: 'policy', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.trust', summary: '设置项目信任状态（需要时走既有原生确认）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.directoryAdd', summary: '为项目添加附加目录（可带 path，缺省时让用户选目录）', mode: 'write', approval: 'policy', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.directoryRemove', summary: '移除项目的附加目录', mode: 'write', approval: 'policy', wave: 1 },
  { family: 'project', tool: 'manage_projects', action: 'projects.directoryUpdate', summary: '修改附加目录的信任状态或设为主目录', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.collapseProject', summary: '折叠或展开侧栏里的项目分组', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.summary', summary: '打开或隐藏右侧任务摘要', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.openPanel', summary: '打开辅助栏面板（变更/文件/浏览器/侧聊/审查/终端/子智能体）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.closePanel', summary: '关闭辅助栏', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.selectFile', summary: '在文件面板里选中一个文件（不修改编辑缓冲）', mode: 'write', approval: 'none', wave: 1 },
  { family: 'ui', tool: 'manage_ui', action: 'ui.selectDirectory', summary: '切换当前项目的附加目录上下文', mode: 'write', approval: 'none', wave: 1 },
  // Wave 2 — conversation controls of the caller's own chat (no threadId by construction).
  { family: 'message', tool: 'manage_messages', action: 'messages.copy', summary: '把当前会话里某条消息的正文复制到剪贴板', mode: 'write', approval: 'none', wave: 2 },
  { family: 'message', tool: 'manage_messages', action: 'messages.revise', summary: '编辑用户消息或重新生成（按 requestId 幂等，生成新会话并切换过去）', mode: 'write', approval: 'none', wave: 2 },
  { family: 'message', tool: 'manage_messages', action: 'messages.setModel', summary: '切换当前会话使用的模型', mode: 'write', approval: 'none', wave: 2 },
  { family: 'message', tool: 'manage_messages', action: 'messages.setThinking', summary: '切换当前会话的思考程度（必须是该模型允许的档位）', mode: 'write', approval: 'none', wave: 2 },
  { family: 'message', tool: 'manage_messages', action: 'messages.createSidechat', summary: '为当前会话创建临时侧聊（可指定起点消息）', mode: 'write', approval: 'none', wave: 2 },
  // Wave 3 — the workbench: review, git, worktrees, terminals.
  { family: 'review', tool: 'manage_review', action: 'review.start', summary: '对当前任务发起代码审查（uncommitted/branch/commit）', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'review', tool: 'manage_review', action: 'review.cancel', summary: '取消正在进行的代码审查', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'review', tool: 'manage_review', action: 'review.inspect', summary: '读取当前任务的审查运行状态与发现列表', mode: 'read', approval: 'none', wave: 3 },
  { family: 'review', tool: 'manage_review', action: 'review.read', summary: '读取被审查快照里的某个文件', mode: 'read', approval: 'none', wave: 3 },
  { family: 'review', tool: 'manage_review', action: 'review.finding', summary: '忽略或批注一条审查发现', mode: 'write', approval: 'none', wave: 3 },
  { family: 'review', tool: 'manage_review', action: 'review.locate', summary: '把窗口定位到某条审查发现', mode: 'write', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.status', summary: '查看当前目录的 Git 状态', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.inspect', summary: '查看分支、上游与进行中的操作', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.diff', summary: '查看工作区/暂存区差异', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.range', summary: '查看相对分支或本轮任务的差异', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.commitInfo', summary: '读取某个提交的信息', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.recoveries', summary: '列出可恢复的撤销记录', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.processProblems', summary: '查看 Git 后台进程的问题', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.hunkVersion', summary: '读取代码块的版本，供 hunkRevert 使用', mode: 'read', approval: 'none', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.run', summary: '执行 stage/branch/fetch/pull/push/merge/rebase 等 Git 动作', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.commit', summary: '提交指定路径', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.apply', summary: '把审查建议应用到工作区', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.revert', summary: '丢弃某个文件的未提交修改', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.hunkRevert', summary: '撤销一个代码块', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.hunkRestore', summary: '恢复最近撤销的代码块', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.conflict', summary: '把冲突文件交给外部工具处理', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'git', tool: 'manage_git', action: 'git.retryStop', summary: '停止一个 Git 后台进程', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.create', summary: '把当前任务放进新建的 git worktree', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.migrate', summary: '把当前任务迁移到 worktree', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.manage', summary: '归档/恢复/查看用量/清理一个 worktree', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.recycle', summary: '回收当前任务的 worktree', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.recovery', summary: '打开或重试一条 worktree 操作恢复记录', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'worktree', tool: 'manage_worktrees', action: 'worktrees.creationRecovery', summary: '刷新或打开 worktree 创建恢复记录', mode: 'write', approval: 'none', wave: 3 },
  { family: 'terminal', tool: 'manage_terminal', action: 'terminal.open', summary: '为当前任务打开一个集成终端', mode: 'write', approval: 'none', wave: 3 },
  { family: 'terminal', tool: 'manage_terminal', action: 'terminal.rename', summary: '重命名集成终端', mode: 'write', approval: 'none', wave: 3 },
  { family: 'terminal', tool: 'manage_terminal', action: 'terminal.close', summary: '关闭集成终端（可能中断命令）', mode: 'write', approval: 'policy', wave: 3 },
  { family: 'terminal', tool: 'manage_terminal', action: 'terminal.resize', summary: '调整终端视图尺寸', mode: 'write', approval: 'none', wave: 4 },
  { family: 'git', tool: 'manage_git', action: 'git.cancel', summary: '按 requestId 取消进行中的 Git 操作', mode: 'write', approval: 'policy', wave: 4 },
  // Wave 4b — files, search and code comments.
  { family: 'file', tool: 'manage_files', action: 'files.list', summary: '列出项目目录里的文件', mode: 'read', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.read', summary: '读取文件内容与版本', mode: 'read', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.write', summary: '按版本保存文件（版本过期即拒绝）', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.open', summary: '在工作台里打开文件', mode: 'write', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.reveal', summary: '在系统文件管理器里显示文件', mode: 'write', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.search', summary: '全文/文件名搜索（可带 cursor 翻页）', mode: 'read', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_files', action: 'files.searchCancel', summary: '取消进行中的搜索', mode: 'write', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_comments', action: 'comments.list', summary: '列出当前任务的代码批注', mode: 'read', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_comments', action: 'comments.add', summary: '在文件行区间添加批注（版本过期即拒绝）', mode: 'write', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_comments', action: 'comments.remove', summary: '删除一条批注', mode: 'write', approval: 'none', wave: 4 },
  { family: 'file', tool: 'manage_comments', action: 'comments.locate', summary: '把窗口定位到一条批注', mode: 'write', approval: 'none', wave: 4 },
  // Wave 4a — settings: reads plus a whitelisted patch (permission-plane keys are refused, never dropped).
  { family: 'settings', tool: 'manage_settings', action: 'settings.read', summary: '读取可修改的设置项与禁用键清单', mode: 'read', approval: 'none', wave: 4 },
  { family: 'settings', tool: 'manage_settings', action: 'settings.models', summary: '列出可用模型（供应商目录）', mode: 'read', approval: 'none', wave: 4 },
  { family: 'settings', tool: 'manage_settings', action: 'settings.inputCatalog', summary: '列出输入项目录（上下文与命令入口）', mode: 'read', approval: 'none', wave: 4 },
  { family: 'settings', tool: 'manage_settings', action: 'settings.apply', summary: '修改外观与行为偏好（白名单键，权限面拒绝）', mode: 'write', approval: 'policy', wave: 4 },
  // Wave 4c — browser data, pull requests, resources and MCP.
  { family: 'browser', tool: 'manage_browser_data', action: 'browser.history', summary: '查看浏览器历史（可搜索、分页）', mode: 'read', approval: 'none', wave: 4 },
  { family: 'browser', tool: 'manage_browser_data', action: 'browser.downloads', summary: '查看下载列表', mode: 'read', approval: 'none', wave: 4 },
  { family: 'browser', tool: 'manage_browser_data', action: 'browser.download', summary: '取消或在文件管理器里显示某个下载', mode: 'write', approval: 'none', wave: 4 },
  { family: 'browser', tool: 'manage_browser_data', action: 'browser.find', summary: '在本会话打开的标签页里查找文本', mode: 'read', approval: 'none', wave: 4 },
  { family: 'browser', tool: 'manage_browser_data', action: 'browser.annotation', summary: '读取/删除/引用一条浏览器批注', mode: 'write', approval: 'none', wave: 4 },
  { family: 'pr', tool: 'manage_pr', action: 'pr.status', summary: '查看当前任务的拉取请求状态', mode: 'read', approval: 'none', wave: 4 },
  { family: 'pr', tool: 'manage_pr', action: 'pr.start', summary: '打开 PR 视图或创建 PR（对外可见，需审批）', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'resource', tool: 'manage_resources', action: 'resources.inspect', summary: '查看技能与扩展及加载诊断', mode: 'read', approval: 'none', wave: 4 },
  { family: 'resource', tool: 'manage_resources', action: 'resources.refresh', summary: '重新扫描本地技能与扩展', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'resource', tool: 'manage_resources', action: 'resources.open', summary: '在编辑器或文件管理器里打开一个资源', mode: 'write', approval: 'none', wave: 4 },
  { family: 'mcp', tool: 'manage_mcp', action: 'mcp.list', summary: '列出本会话的 MCP 服务器、状态与工具名', mode: 'read', approval: 'none', wave: 4 },
  { family: 'mcp', tool: 'manage_mcp', action: 'mcp.test', summary: '测试一个 MCP 服务器连接（会启动进程，需审批）', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'mcp', tool: 'manage_mcp', action: 'mcp.testCancel', summary: '取消正在进行的 MCP 连接测试', mode: 'write', approval: 'none', wave: 4 },
  { family: 'mcp', tool: 'manage_mcp', action: 'mcp.retry', summary: '重试连接本会话断开的 MCP 服务器', mode: 'write', approval: 'policy', wave: 4 },
  { family: 'mcp', tool: 'manage_mcp', action: 'mcp.resource', summary: '按索引读取 MCP 服务器提供的资源', mode: 'read', approval: 'none', wave: 4 },
  // Wave 5 — windows and previews/artifacts.
  { family: 'window', tool: 'manage_windows', action: 'windows.open', summary: '打开新的任务窗口或快速聊天窗口', mode: 'write', approval: 'none', wave: 5 },
  { family: 'window', tool: 'manage_windows', action: 'windows.minimize', summary: '最小化当前窗口', mode: 'write', approval: 'none', wave: 5 },
  { family: 'window', tool: 'manage_windows', action: 'windows.maximize', summary: '最大化或还原当前窗口', mode: 'write', approval: 'none', wave: 5 },
  { family: 'window', tool: 'manage_windows', action: 'windows.close', summary: '关闭当前窗口（会隐藏聊天，需审批）', mode: 'write', approval: 'policy', wave: 5 },
  { family: 'window', tool: 'manage_windows', action: 'windows.retryShortcut', summary: '重试注册全局快捷键', mode: 'write', approval: 'none', wave: 5 },
  { family: 'window', tool: 'manage_windows', action: 'windows.revealWorktreePath', summary: '在 worktree 里打开或显示一个路径', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'previews.open', summary: '打开本地 http(s) 预览', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'previews.close', summary: '关闭当前预览', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'previews.refresh', summary: '刷新当前预览', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.open', summary: '把工件文件作为预览打开（会启动本地服务）', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.close', summary: '关闭一个工件预览', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.status', summary: '读取工件预览状态与地址', mode: 'read', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.stop', summary: '停止工件预览的本地服务', mode: 'write', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.capture', summary: '截取工件预览画面', mode: 'read', approval: 'none', wave: 5 },
  { family: 'artifact', tool: 'manage_preview', action: 'artifacts.annotation', summary: '读取/删除/引用预览上的批注', mode: 'write', approval: 'none', wave: 5 },
];

/** Actions the model may call once `families` are registered in this session. */
export function desktopToolCatalogFor(families: readonly DesktopToolFamily[], wave = implementedDesktopWave): DesktopToolAction[] {
  return desktopToolCatalog.filter(entry => entry.wave <= wave && families.includes(entry.family));
}

/**
 * The permission plane. Nothing in the model surface may carry these field names, and no catalog action
 * may map to these ops: they belong to the user alone.
 */
export const forbiddenDesktopFields = ['policy', 'planMode', 'sandbox', 'toolPolicies', 'mcpToolPolicies', 'permissions', 'approval', 'approved', 'secret', 'apiKey', 'apiKeyPlain', 'password', 'token'] as const;
export const forbiddenDesktopOps = ['approval.reply', 'provider.key', 'mcp.secret', 'plugin.start', 'plugin.pick', 'plugin.cancel', 'terminal.input'] as const;
