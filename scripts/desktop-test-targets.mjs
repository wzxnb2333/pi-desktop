// Small development selections. Full suites remain available through their original commands.
// ui = browser-only harness; native = Electron/main-process integration, explicitly requested.
export const targets = {
  sandbox: {
    label: '三档权限与沙箱', unit: ['sandbox-policy.test.ts'],
    ui: [{ file: 'composer.spec.ts', grep: '执行策略|permission modes|runtime controls' }],
    native: [{ file: 'permissions.nonvisual.spec.ts' }],
  },
  'approval-review': {
    label: '独立 LLM 代审批与人工回退', unit: ['action-review.test.ts', 'sandbox-policy.test.ts', 'mcp-tool-policy.test.ts'],
    ui: [{ file: 'reference-states.spec.ts', grep: 'independent approval review' }],
    native: [{ file: 'approval-review.nonvisual.spec.ts' }],
  },
  toolbar: {
    label: '顶部入口与摘要/辅助栏布局', unit: ['layout.test.ts'],
    ui: [{ file: 'summary.spec.ts', grep: 'compact toolbar|summary and tool pane' }],
    native: [{ file: 'browser.nonvisual.spec.ts', grep: 'summary stacks above' }],
  },
  summary: {
    label: '摘要内容与定位', unit: ['turn-plans.test.ts'],
    ui: [{ file: 'summary.spec.ts', grep: 'summary targets|summary Git|streaming prose|compact independent|empty new task' }],
    native: [{ file: 'summary.nonvisual.spec.ts' }],
  },
  sidebar: {
    label: '任务导航与侧栏', unit: ['thread-list.test.ts', 'layout.test.ts'],
    ui: [{ file: 'sidebar.spec.ts' }],
  },
  composer: {
    label: '输入、发送与中文输入法', unit: ['message-input.test.ts', 'composer-trigger.test.ts'],
    ui: [{ file: 'composer.spec.ts', grep: 'input grows|send needs|composing Enter|ctrl-enter|Shift[+]Enter|compact toolbar' }],
    native: [{ file: 'acceptance.spec.ts', grep: 'native Chromium composition|follow-up and steering' }],
  },
  context: {
    label: '/、@、技能与附件', unit: ['composer-trigger.test.ts', 'input-context.test.ts', 'attachment-import.test.ts'],
    ui: [{ file: 'composer.spec.ts', grep: 'slash plan|at mentions|suggestions respect|attachment strip' }],
    native: [{ file: 'acceptance.spec.ts', grep: 'context picker persists|drop and clipboard attachments' }],
  },
  'conversation-ui': {
    label: '选文引用、未读标记、上下文圆环和聊天滚动条',
    ui: [{ file: 'conversation-ui.spec.ts' }],
    native: [{ file: 'composer-enhancements.nonvisual.spec.ts', grep: 'quote selection|selection quote sidechat' }],
  },
  'turn-changes': {
    label: '轮次编辑预览与新建聊天入口', unit: ['turn-changes.test.ts'],
    ui: [{ file: 'turn-changes.spec.ts' }],
    native: [{ file: 'message-experience.nonvisual.spec.ts', grep: 'successful writes' }],
  },
  queue: {
    label: '输入框队列与草稿恢复', unit: ['composer-enhancements.test.ts'],
    ui: [{ file: 'composer-recovery.spec.ts' }],
    native: [{ file: 'composer-enhancements.nonvisual.spec.ts', grep: 'individually edit|identical queued text|lost acknowledgement' }],
  },
  settings: {
    label: '设置导航和保存', unit: ['settings-save.test.ts', 'settings-updates.test.ts'],
    ui: [{ file: 'settings.spec.ts', grep: 'settings page opens|category nav swaps|settings stay editable|settings groups distinguish' }],
    native: [{ file: 'acceptance.spec.ts', grep: 'saving settings and credentials preserves' }],
  },
  models: {
    label: '模型与思考程度', unit: ['model-configuration.test.ts'],
    ui: [{ file: 'settings.spec.ts', grep: 'built-in provider|custom mode|allowed thinking levels|mode selection|model collection|provider deletion|invalid hidden model|compact model picker' }, { file: 'provider-oauth-ui.spec.ts' }],
    native: [{ file: 'model-settings.nonvisual.spec.ts' }],
  },
  'settings-storage': {
    label: '设置与凭据保存失败恢复', unit: ['settings-persistence.test.ts', 'settings-save.test.ts', 'settings-updates.test.ts'],
    ui: [{ file: 'settings.spec.ts', grep: 'key drafts|failed key saves' }],
    native: [{ file: 'settings-persistence.nonvisual.spec.ts' }, { file: 'acceptance.spec.ts', grep: 'saving settings and credentials preserves' }, { file: 'data-recovery.nonvisual.spec.ts', grep: 'credentials' }],
  },
  'settings-layout': {
    label: '全部设置页布局、双语与自定义模型表单',
    ui: [{ file: 'form-navigation.spec.ts', grep: 'grouped settings|custom model editor' }],
  },
  appearance: {
    label: '主题、字体与设置外观', unit: ['appearance.test.ts'],
    ui: [{ file: 'settings.spec.ts', grep: 'appearance fonts|both connection forms' }],
    native: [{ file: 'acceptance.spec.ts', grep: 'theme files import' }],
  },
  shortcuts: {
    label: '快捷键与冲突', unit: ['quick-shortcut.test.ts'],
    ui: [{ file: 'settings.spec.ts', grep: 'keyboard overrides|shortcuts can be found' }],
  },
  locale: {
    label: '语言切换与持久化', unit: ['localization.test.ts'],
    native: [{ file: 'localization.nonvisual.spec.ts' }],
  },
  dialogs: {
    label: '菜单、弹窗、焦点与尺寸', ui: [{ file: 'primitives.spec.ts' }],
    native: [{ file: 'goals.nonvisual.spec.ts', grep: 'feature dialogs share|long goal forms' }],
  },
  tabs: {
    label: '混合工具标签与关闭', unit: ['panel-tabs.test.ts', 'ui-patches.test.ts'],
    ui: [{ file: 'panels.spec.ts', grep: 'tool tabs share|closing a tab' }],
    native: [{ file: 'browser.nonvisual.spec.ts', grep: 'each tab closes|tool tabs share|main-process sidechat' }],
  },
  browser: {
    label: '浏览器画面、菜单与地址', unit: ['browser-workbench.test.ts'],
    ui: [{ file: 'panels.spec.ts', grep: 'preview panel releases|pending browser tab creation' }],
    native: [{ file: 'browser.nonvisual.spec.ts', grep: 'browser overflow|address validation|empty browser' }],
  },
  'browser-find': {
    label: '网页查找', unit: ['browser-workbench.test.ts'],
    native: [{ file: 'browser.nonvisual.spec.ts', grep: 'native find reports|loading a new document|queries stay|browser find shortcuts' }],
  },
  'browser-tools': {
    label: '浏览器工具与权限', unit: ['browser-tools.test.ts'],
    ui: [{ file: 'activity.spec.ts', grep: 'browser feedback' }],
    native: [{ file: 'browser-tools.nonvisual.spec.ts' }],
  },
  'browser-control': {
    label: '浏览器协议、引用与等待条件', unit: ['browser-tools.test.ts'],
  },
  'browser-bridge': {
    label: 'Chrome 扩展 Loopback 桥接', unit: ['browser-bridge.test.ts', 'chrome-extension-input.test.mjs', 'chrome-extension-lifecycle.test.mjs'],
    ui: [{ file: 'browser-bridge.spec.ts' }],
    native: [{ file: 'browser-bridge.nonvisual.spec.ts' }],
  },
  'browser-history': {
    label: '浏览历史与清理', unit: ['browser-history.test.ts'],
    ui: [{ file: 'browser-history-recovery.spec.ts' }],
    native: [{ file: 'browser-history.nonvisual.spec.ts' }],
  },
  'browser-sites': {
    label: '网站规则、权限撤销与保存恢复', unit: ['browser-site-policy.test.ts', 'browser-tools.test.ts'],
    ui: [{ file: 'browser-sites-recovery.spec.ts' }],
    native: [{ file: 'browser-tools.nonvisual.spec.ts', grep: 'website' }],
  },
  annotations: {
    label: '网页标注', unit: ['browser-annotations.test.ts', 'browser-annotations-recovery.test.ts'],
    ui: [{ file: 'browser-annotations-recovery.spec.ts' }],
    native: [{ file: 'browser-annotations.nonvisual.spec.ts' }],
  },
  files: {
    label: '文件编辑与保存', unit: ['file-buffers.test.ts', 'file-save-verification.test.ts'],
    ui: [{ file: 'file-editor.spec.ts' }], native: [{ file: 'file-editor.nonvisual.spec.ts' }],
  },
  'file-search': {
    label: '文件树与内容搜索', unit: ['file-tree.test.ts', 'file-search.test.ts'],
    native: [{ file: 'file-navigation.nonvisual.spec.ts', grep: 'complete keyboard navigation|file search clears|search cancellation' }],
  },
  links: {
    label: '消息文件/网页链接', unit: ['message-links.test.ts'],
    native: [{ file: 'message-links.nonvisual.spec.ts' }],
  },
  terminal: {
    label: '终端会话、输出与查找', unit: ['terminal-workbench.test.ts'],
    ui: [{ file: 'panels.spec.ts', grep: 'hiding the pane|终止终端|switching tabs keeps|terminal preserves' }, { file: 'terminal-recovery.spec.ts' }],
    native: [{ file: 'terminal.nonvisual.spec.ts' }],
  },
  git: {
    label: 'Git 变更与暂存', unit: ['diff.test.ts', 'git-scope.test.ts', 'git-index-lock.test.ts'],
    ui: [{ file: 'git-panel.spec.ts' }], native: [{ file: 'git.nonvisual.spec.ts' }],
  },
  'git-cancellation': {
    label: 'Git 取消、进程清理与退出', unit: ['git-cancellation.test.ts'],
    native: [{ file: 'git.nonvisual.spec.ts', grep: 'Git cancellation|Git shutdown' }],
  },
  'git-commit': {
    label: '提交确认、迟到取消与暂存区保护', unit: ['git-commit-completion.test.ts'],
    ui: [{ file: 'git-panel.spec.ts', grep: 'commit completion preserves' }],
    native: [{ file: 'git.nonvisual.spec.ts', grep: 'Git late|Git post-commit' }],
  },
  'git-cancel-retry': {
    label: 'Git 停止失败反馈与退出重试', unit: ['git-cancel-retry.test.ts'],
    native: [{ file: 'git-cancel-retry.nonvisual.spec.ts' }],
  },
  'git-background': {
    label: 'Git 后台查询退出与超时恢复', unit: ['git-background.test.ts'],
    native: [{ file: 'git-background.nonvisual.spec.ts' }],
  },
  review: {
    label: '主动审查、版本与撤销', unit: ['review-snapshots.test.ts', 'review-persistence.test.ts', 'hunk-recovery.test.ts'],
    ui: [{ file: 'review-recovery.spec.ts' }],
    native: [{ file: 'review.nonvisual.spec.ts' }, { file: 'git-history.nonvisual.spec.ts' }],
  },
  worktree: {
    label: 'Worktree 迁移与恢复', unit: ['worktree-transfer.test.ts', 'worktree-archives.test.ts'],
    native: [{ file: 'worktree-lifecycle.nonvisual.spec.ts', grep: 'same chat migration|migration refuses|managed archive UI' }],
  },
  'worktree-cancellation': {
    label: 'Worktree 取消、停止失败与草稿恢复', unit: ['worktree-cancellation.test.ts'],
    ui: [{ file: 'worktree-controls.spec.ts' }],
    native: [{ file: 'worktree-cancellation.nonvisual.spec.ts' }],
  },
  'worktree-migration': {
    label: 'Worktree 迁移保存失败与关联恢复', unit: ['worktree-migration-persistence.test.ts', 'worktree-transfer.test.ts'],
    ui: [{ file: 'worktree-controls.spec.ts', grep: 'completed migrations' }],
    native: [{ file: 'worktree-migration-recovery.nonvisual.spec.ts' }],
  },
  'worktree-interruption': {
    label: 'Worktree 强制退出恢复与冲突重试', unit: ['worktree-interruption.test.ts', 'worktree-migration-persistence.test.ts'],
    ui: [{ file: 'worktree-controls.spec.ts', grep: 'migration recovery exposes' }],
    native: [{ file: 'worktree-interruption.nonvisual.spec.ts' }, { file: 'worktree-migration-recovery.nonvisual.spec.ts', grep: 'another migration reconciles' }],
  },
  'worktree-restore': {
    label: 'Worktree 恢复暂存区、锁与重启', unit: ['worktree-archives.test.ts'],
    native: [{ file: 'worktree-restore.nonvisual.spec.ts' }, { file: 'worktree-lifecycle.nonvisual.spec.ts', grep: 'managed archive UI' }],
  },
  'worktree-owner': {
    label: 'Worktree 恢复聊天关联、取消与重启', unit: ['worktree-owner-persistence.test.ts'],
    native: [{ file: 'worktree-owner-recovery.nonvisual.spec.ts' }, { file: 'worktree-lifecycle.nonvisual.spec.ts', grep: 'managed archive UI' }],
  },
  'worktree-creation-interruption': {
    label: 'Worktree 创建收据、硬退出与关联重试', unit: ['worktree-creations.test.ts', 'git-parent-cancellation.test.ts'],
    native: [{ file: 'worktree-creation-interruption.nonvisual.spec.ts' }],
  },
  'worktree-reclamation': {
    label: 'Worktree 归档中断、旧目录回收与恢复', unit: ['worktree-reclamation.test.ts'],
    native: [{ file: 'worktree-reclamation.nonvisual.spec.ts' }, { file: 'worktree-lifecycle.nonvisual.spec.ts', grep: 'managed archive UI' }],
  },
  'worktree-restore-files': {
    label: 'Worktree 文件恢复中断与临时目录重试', unit: ['worktree-restore-files.test.ts'],
    native: [{ file: 'worktree-restore-files.nonvisual.spec.ts' }, { file: 'worktree-restore.nonvisual.spec.ts', grep: 'state-save failure' }],
  },
  'worktree-index-preparation': {
    label: 'Worktree 索引准备中断与临时文件清理', unit: ['worktree-index-preparation.test.ts'],
    native: [{ file: 'worktree-restore.nonvisual.spec.ts', grep: 'preparation|state-save failure' }],
  },
  projects: {
    label: '项目目录与环境动作', unit: ['project-directories.test.ts', 'project-environment.test.ts'],
    native: [{ file: 'project-actions.nonvisual.spec.ts' }, { file: 'acceptance.spec.ts', grep: 'multiple directories isolate' }],
  },
  'project-actions': {
    label: '项目动作配置、执行与恢复', unit: ['project-environment.test.ts', 'project-environment-persistence.test.ts'],
    ui: [{ file: 'project-action-recovery.spec.ts' }],
    native: [{ file: 'project-actions.nonvisual.spec.ts' }, { file: 'project-action-recovery.nonvisual.spec.ts' }],
  },
  windows: {
    label: '独立窗口和快捷聊天', unit: ['window-state.test.ts'],
    native: [{ file: 'window-recovery.nonvisual.spec.ts' }, { file: 'acceptance.spec.ts', grep: 'separate task windows share|quick chat keeps' }],
  },
  chats: {
    label: '独立聊天创建、快捷聊天与目录绑定恢复', unit: ['chat-persistence.test.ts'],
    ui: [{ file: 'chat-recovery.spec.ts', grep: 'new chat|binding|folder picker' }, { file: 'form-navigation.spec.ts', grep: 'new tasks are created only after' }],
    native: [{ file: 'chat-recovery.nonvisual.spec.ts' }, { file: 'acceptance.spec.ts', grep: 'standalone chats retain isolated drafts|quick chat keeps' }],
  },
  'task-creation': {
    label: '项目、Worktree 与配置任务创建恢复', unit: ['task-creation-persistence.test.ts', 'automation-persistence.test.ts', 'subtask-persistence.test.ts'],
    ui: [{ file: 'chat-recovery.spec.ts', grep: 'new chat|project creation' }, { file: 'form-navigation.spec.ts', grep: 'new tasks are created only after' }],
    native: [{ file: 'task-creation.nonvisual.spec.ts' }, { file: 'automation-queue.nonvisual.spec.ts', grep: 'worktree automation waits' }, { file: 'subtasks.nonvisual.spec.ts', grep: 'a real independent Worktree' }],
  },
  'usage-stats': {
    label: '上下文占用的缓存命中率与输出速度', unit: ['usage-stats.test.ts'],
  },
  'tool-labels': {
    label: '桌面接口工具名与错误文案的多语言', unit: ['tool-labels.test.ts', 'error-translations.test.ts'],
    native: [{ file: 'localization.nonvisual.spec.ts', grep: 'tool names in the information stream stay localized' }],
  },
  'ask-user': {
    label: '向用户提问（计划与普通模式）', unit: ['ask-user-tool.test.ts'],
    native: [{ file: 'ask-user.nonvisual.spec.ts' }],
  },  goals: {
    label: '持续目标', unit: ['goals.test.ts', 'goal-persistence.test.ts'],
    ui: [{ file: 'goal-recovery.spec.ts' }],
    native: [{ file: 'goals.nonvisual.spec.ts', grep: 'goal UI persists|pause, stop, closing|real provider errors|long goal forms|goal disk failures|goal completion storage|archived goal rounds|goal pause storage failure' }],
  },
  subtasks: {
    label: '子智能体只读观察与权限', unit: ['subtasks.test.ts', 'subtask-persistence.test.ts', 'subtask-observer.test.ts', 'subtask-creations.test.ts', 'panel-tabs.test.ts', 'thread-list.test.ts', 'window-state.test.ts'],
    ui: [{ file: 'subtask-recovery.spec.ts' }], native: [{ file: 'subtasks.nonvisual.spec.ts' }],
  },
  harness: {
    label: '模型运行环境查询与主子代理通信', unit: ['harness-tools.test.ts', 'subtask-communication.test.ts', 'timeline.test.ts'],
    ui: [{ file: 'subtask-recovery.spec.ts', grep: 'parent questions' }],
    native: [{ file: 'harness-tools.nonvisual.spec.ts', grep: 'harness inspection|child asks and receives|stopping a parent|a parent can cancel' }],
  },
  'harness-views': {
    label: '模型打开文件与桌面视图', unit: ['desktop-views.test.ts', 'harness-tools.test.ts'],
    native: [{ file: 'harness-tools.nonvisual.spec.ts', grep: 'a model opens|desktop view tools|desktop view path' }],
  },
  'harness-terminal': {
    label: '模型读取终端、增量等待与任务隔离', unit: ['terminal-inspection.test.ts', 'harness-tools.test.ts'],
    native: [{ file: 'harness-terminal.nonvisual.spec.ts' }],
  },
  'harness-operations': {
    label: '模型操作查询、等待与项目动作取消', unit: ['operation-tools.test.ts', 'operations.test.ts', 'harness-tools.test.ts'],
    native: [{ file: 'harness-operations.nonvisual.spec.ts' }],
  },
  sidechat: {
    label: '只读侧聊与草稿恢复', unit: ['sidechat-context.test.ts', 'sidechat-persistence.test.ts'],
    ui: [{ file: 'sidechat-recovery.spec.ts' }],
    native: [{ file: 'sidechat-recovery.nonvisual.spec.ts' }, { file: 'acceptance.spec.ts', grep: 'side chat captures a selected point|temporary side chats keep panel drafts' }],
  },
  automation: {
    label: '自动化调度', unit: ['automation-state.test.ts', 'schedule.test.ts', 'scheduler.test.ts', 'automation-persistence.test.ts'],
    ui: [{ file: 'management.spec.ts', grep: 'automation' }, { file: 'form-navigation.spec.ts', grep: 'automation navigation' }],
    native: [{ file: 'automation-queue.nonvisual.spec.ts' }],
  },
  'automation-runtime': {
    label: '自动化队列与持久化恢复', unit: ['automation-state.test.ts', 'scheduler.test.ts', 'automation-persistence.test.ts'],
    native: [{ file: 'automation-queue.nonvisual.spec.ts' }],
  },
  plugins: {
    label: '插件生命周期', unit: ['plugins.test.ts'], native: [{ file: 'plugins.nonvisual.spec.ts' }],
    ui: [{ file: 'plugin-management.spec.ts' }],
  },
  mcp: {
    label: 'MCP 配置与工具策略', unit: ['mcp-configuration.test.ts', 'mcp-tool-policy.test.ts'],
    ui: [{ file: 'mcp-settings.spec.ts' }], native: [{ file: 'mcp-policies.nonvisual.spec.ts' }],
  },
  oauth: {
    label: 'MCP OAuth', unit: ['mcp-oauth.test.ts'], native: [{ file: 'mcp-oauth.nonvisual.spec.ts' }],
    ui: [{ file: 'mcp-settings.spec.ts', grep: 'OAuth' }],
  },
  'provider-oauth': {
    label: '模型提供商 OAuth 与凭据生命周期',
    unit: ['provider-oauth.test.ts', 'model-oauth-runtime.test.ts', 'model-configuration.test.ts', 'settings-save.test.ts', 'settings-persistence.test.ts'],
    ui: [{ file: 'provider-oauth-ui.spec.ts' }],
    native: [{ file: 'provider-oauth.nonvisual.spec.ts' }],
  },
  'mcp-connection': {
    label: 'MCP 连接测试进度、取消与恢复', unit: ['mcp.test.ts', 'operations.test.ts'],
    ui: [{ file: 'mcp-settings.spec.ts', grep: 'MCP saves once|MCP cancellation|tool policy discovery|MCP connection testing|MCP test progress' }],
    native: [{ file: 'mcp-test-cancellation.nonvisual.spec.ts' }],
  },
  'mcp-reconnect': {
    label: '任务 MCP 重连取消、进程清理与恢复', unit: ['agent-initialization.test.ts'],
    ui: [{ file: 'mcp-settings.spec.ts', grep: 'MCP task reconnect' }],
    native: [{ file: 'mcp-reconnect.nonvisual.spec.ts' }, { file: 'mcp.nonvisual.spec.ts' }],
  },
  'runtime-startup': {
    label: '会话初始化停止、草稿恢复与进程清理', unit: ['agent-initialization.test.ts'],
    native: [{ file: 'runtime-startup.nonvisual.spec.ts' },
      { file: 'acceptance.spec.ts', grep: 'follow-up and steering|interrupted sessions resume' },
      { file: 'mcp-reconnect.nonvisual.spec.ts', grep: 'approval cancellation' }],
  },
  artifacts: {
    label: 'PDF/HTML 产物', unit: ['artifact-files.test.ts', 'artifact-persistence.test.ts'], native: [{ file: 'artifacts.nonvisual.spec.ts' }],
    ui: [{ file: 'artifact-recovery.spec.ts' }],
  },
  memory: {
    label: '跨会话记忆', unit: ['memories.test.ts', 'memory-generation.test.ts'], native: [{ file: 'memories.nonvisual.spec.ts' }],
    ui: [{ file: 'memory-settings.spec.ts' }],
  },
  resources: {
    label: 'Skills 与扩展保存和恢复', unit: ['resource-persistence.test.ts', 'resource-inspection.test.ts'],
    ui: [{ file: 'resources.spec.ts' }, { file: 'form-navigation.spec.ts', grep: 'MCP secrets and a collapsed Skill' }],
    native: [{ file: 'skills.nonvisual.spec.ts' }],
  },
  storage: {
    label: '数据迁移、线程状态与恢复', unit: ['data-migrations.test.ts', 'thread-storage.test.ts'],
    native: [{ file: 'data-recovery.nonvisual.spec.ts' }],
  },
  cleanup: {
    label: '测试临时目录清理', unit: ['temporary-directories.test.ts', 'acceptance-temp-cleanup.test.ts', 'desktop-temp-cleanup.test.ts'],
    native: [{ file: 'acceptance.spec.ts', grep: 'fixture cleanup removes|initial launch failures' }],
  },
};
