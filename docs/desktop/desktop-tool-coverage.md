# 桌面 op 覆盖表

`src/shared/contracts.ts` 里每个 op（当前 142 个）在下表的处置：**已覆盖**（模型有对应动作，复用同一条 op）、
**待做**（排进 W4/W5）、**不做**（附理由）。守卫测试 `apps/desktop/test/desktop-tool-surface.test.ts`
保证已覆盖动作永远能被 worker 协议解析、且任何 schema 都不接受权限字段。

## 验证入口

| 用例 | 覆盖 |
| --- | --- |
| `test/desktop-tool-surface.test.ts` | 目录动作 ⇄ worker 协议一致；权限面探针全拒绝；设置白名单逐键断言（含拒绝理由）；动作目录无禁用 op |
| `test/session-context.test.ts` | 跨会话可见性（排除审查会话/子任务/临时侧聊/已删除）、分页与字符上限、跨会话搜索与截断 |
| `test/e2e/desktop-tools.nonvisual.spec.ts` | 真实 Worker/IPC：`read_sessions` 跨会话读且不泄露另一会话草稿；`send_to_session` 在 ask 策略下先弹审批、批准后才送达；`settings.apply` 拒绝 `policy`（状态不变、不消耗审批）而白名单键生效；`manage_ui` 的摘要与文件面板可见变化 |
| `test/e2e/harness-tools.nonvisual.spec.ts` | H-01…H-39 的回归（32 例） |
| `npm run desktop:check` | 类型检查（含新 schema 与工具装配） |

## 已覆盖（W1–W3 + 既有 harness 工具）

| op | 模型入口 |
| --- | --- |
| `thread.create` / `thread.update` / `thread.stop` / `thread.resume` / `thread.fork` / `thread.purge` / `thread.send` | `manage_sessions`（create/select/rename/pin/archive/markRead/stop/resume/fork/delete）、`send_to_session` |
| `thread.revise` | `manage_messages` / `messages.revise` |
| `sidechat.create` | `manage_messages` / `messages.createSidechat` |
| `project.add` / `project.trust` / `project.directoryAdd` / `project.directoryRemove` / `project.directoryUpdate` | `manage_projects`（`project.environment` 见「不做」） |
| `ui.update` / `ui.threadPatch` | `manage_ui`（折叠、摘要、面板、选文件、切目录） |
| `review.start` / `review.cancel` / `review.inspect` / `review.file` / `review.finding` / `review.locate` | `manage_review` |
| `git.status`/`inspect`/`diff`/`range`/`show`/`recoveries`/`processProblems`/`hunkVersion`/`action`/`commit`/`apply`/`revert`/`hunkRevert`/`hunkRestore`/`conflict`/`retryStop` | `manage_git` |
| `worktree.start` / `worktree.manage` / `worktree.recycle` / `worktree.recovery` / `worktree.creationRecovery` | `manage_worktrees` |
| `terminal.open` / `terminal.rename` / `terminal.close` / `terminal.inspect` | `manage_terminal`（open/rename/close）+ 既有 `read_terminal`（inspect） |
| `harness.inspect`、`operations.*`、`automations.*`、`subtasks.*`、`browser.action/open/select/tab/clear/clearCancel`、`attachment.add`、`thread.queueClear`、`artifact.*`（列表）、`memory.context`、`goal.*`、`project.action(s)` | 既有 H-01…H-39 工具与 `manage_operations`、`manage_automations`、`manage_subtasks`、`browser`、`add_draft_attachments`、`clear_queued_messages`、`list_artifacts`、`run_project_action` 等 |

## 待做

### W4 已完成

| op | 模型入口 | 说明 |
| --- | --- | --- |
| `settings.patch` / `settings.save` | `manage_settings` / `settings.apply` | 白名单键（外观与行为偏好）；权限面 14 个键逐键拒绝并说明理由 |
| `models.catalog` / `input.catalog` | `manage_settings` / `settings.models`·`settings.inputCatalog` | 只读目录，供模型知道有哪些模型与输入项 |
| `file.list` / `file.read` / `file.write` / `file.open` / `file.reveal` / `file.search` / `file.search.cancel` | `manage_files` | 写入按版本 CAS，路径受项目目录约束；`file.dirty` 是渲染层本地状态，不暴露 |
| `comment.add` / `comment.list` / `comment.remove` / `comment.locate` | `manage_comments` | 锚点版本过期即拒绝 |
| `git.cancel` / `terminal.resize` | `manage_git`·`manage_terminal` | 取消 Git 操作受审批；resize 只改视图 |

### W4 剩余

| op | 计划动作 | 备注 |
| --- | --- | --- |
| `theme.export` / `theme.import` | `manage_settings.theme` | 两者都要原生文件对话框（导出选保存位置、导入选文件），按策略不做；主题通过 `settings.apply` 的外观键实现 |
| `browser.find` 之外的浏览器数据面 | `manage_browser_data` | 已完成 history/downloads/download/find/annotation（W4c）；站点策略与数据清理见「不做」 |
| `mcp.test` / `mcp.testCancel` / `mcp.retry` / `mcp.resource` | `manage_mcp` | 已完成（W4c） |
| `resource.inspect` / `resource.refresh` / `resource.open` | `manage_resources` | 已完成（W4c）；`resource.create` 与 `resource.pick` 见下 |
| `pr.status` / `pr.start` | `manage_pr` | 已完成（W4c） |
| `thread.inWorktree` | `manage_sessions` 扩展 | 需要明确“在 worktree 里打开哪个路径”的语义，留到 W5 与窗口族一起做 |

### W5 — 已完成

| op | 模型入口 | 说明 |
| --- | --- | --- |
| `window` / `window.open` / `window.shortcut` | `manage_windows` | 最小化/最大化/关闭当前窗口（close 受审批）、开新窗口、重试全局快捷键注册 |
| `thread.inWorktree` | `manage_windows` / `windows.revealWorktreePath` | 在 worktree 里打开或显示路径 |
| `preview.open` / `preview.close` / `preview.refresh` | `manage_preview` / `previews.*` | 只接受本地 http(s) 地址 |
| `artifact.open` / `close` / `status` / `stop` / `capture` / `annotation` | `manage_preview` / `artifacts.*` | 启动本地服务可 stop；annotation 支持 read/remove/attach |
| `bootstrap` | — | 内部初始化，永不暴露 |

### 仍未做（含理由）

| op | 理由 |
| --- | --- |
| `artifact.network` / `browser.site` / `browser.clear` / `browser.clearCancel` / `browser.action`(clearSite·clearAll·permissions) | 站点放行与数据清理是用户的安全决策；模型既不能放行来源也不能清空数据 |
| `artifact.bounds` / `preview.bounds` | 预览几何（屏幕坐标）对模型没有语义，用户拖拽即可 |
| `artifact.annotationSave` / `artifact.annotationDiscard` / `browser.annotationCapture` / `browser.annotationSave` / `browser.annotationDiscard` | 需要用户在画面上拖出选区，属于用户手势 |
| `resource.create` / `plugin.catalog` | 写入用户技能目录与插件目录只读视图，留待评估；插件安装（`plugin.start/pick/cancel`）永不做 |
| `theme.export` / `theme.import` / `thread.export` / `resource.pick` / `attachment.pick` | 原生文件或目录对话框是用户的动作 |
| `settings.save` | 整体写设置对象；模型只能用 `settings.apply` 的白名单逐键修改，整体写会让权限面字段有机会溜进来 |
| `browser.data` | 浏览器存储清单（含 cookie 与 localStorage），属于用户数据面 |
| `browser.action` 的 back/forward/reload/stop/close/focus/zoom | 已由既有 `browser` 工具覆盖（导航、标签、点击、输入、截图）；只有 clearSite/clearAll/permissions 不做 |
| `browser.select` | 已由既有 `browser` 工具的标签页动作覆盖 |
| `file.dirty` | 渲染层本地脏标记，没有跨进程语义 |
| `mcp.secret` / `mcp.secretStatus` / `mcp.oauthStart` / `mcp.oauthStatus` / `mcp.oauthCancel` / `provider.key` | 凭据与授权流程 |

### W5 — 窗口、预览、工件

| op | 计划动作 | 备注 |
| --- | --- | --- |
| `window` / `window.open` / `window.shortcut` | `manage_windows` | 开新窗口、聚焦、快捷键提示；`window.open` 已用于 W1/W2 的跳转 |
| `artifact.open` / `close` / `status` / `stop` / `bounds` / `network` / `capture` / `annotation*` | `manage_preview` | 预览工件的生命周期与网络放行 |
| `preview.open` / `close` / `refresh` / `bounds` | `manage_preview` | 与 `artifact.*` 同一族 |
| `bootstrap` | — | 内部初始化，永不暴露 |

## 不做（附理由）

| op | 理由 |
| --- | --- |
| `approval.reply` | 模型不能代替用户批准或拒绝审批，否则审批形同虚设 |
| `provider.key` | 凭据写入与读取 |
| `mcp.secret` / `mcp.secretStatus` / `mcp.oauthStart` / `mcp.oauthStatus` / `mcp.oauthCancel` | 凭据与授权流程；测试与重试（`mcp.test`/`mcp.retry`）仍可用 |
| `plugin.start` / `plugin.pick` / `plugin.cancel` | 安装并运行第三方代码，属于用户决策；`plugin.catalog` 只读目录留待 W4 评估后再定 |
| `terminal.input` | 终端输入等于绕过任务策略执行任意命令；命令一律走沙箱命令工具，受既有策略约束 |
| `attachment.pick` / `resource.pick` / `project.add`（无 path 时）/ `project.directoryAdd`（无 path 时）/ `theme.export` / `theme.import` / `thread.export` | 原生文件或目录对话框是用户的动作；模型可以带 path 请求，但不能替用户点选 |
| `file.dirty` | 渲染层本地编辑状态（脏标记），只影响窗口指示，没有跨进程语义 |
| `project.environment` | 需要渲染层构造的结构化配置（环境变量、动作表），模型没有合理来源；先只读呈现 |
| `thread.compact` | 压缩上下文会丢弃历史，属于破坏性且不可逆的用户决策，暂不开放 |
| `settings.patch` 里的权限字段 | 任何波次都不接受：`policy`、`planMode`、工具策略、沙箱、审批、凭据、插件开关 |
