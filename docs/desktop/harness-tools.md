# 模型 Harness 接口：状态查询、桌面视图与项目动作

沿用 Worker → 受校验 IPC → 主进程服务，不开放任意 Renderer IPC，也不新增用户干涉子会话的入口。

## 接口台账

| 编号 | 模型入口 | 实际行为 | 状态与证据 |
| --- | --- | --- | --- |
| H-01 | get_harness | 查询当前会话、权限、执行目录、上下文记录、计划/目标、队列数量、子任务问题数量及操作进度；返回实际可用工具名称 | 已验证：字段投影、目录隔离、只读模型调用 |
| H-02 | ask_parent | 仅子代理可用；问题持久化后通知所属主代理并等待答复 | 已验证：真实双 Worker 通信、只读观察、超时、取消、保存失败 |
| H-03 | manage_subtasks / subtasks.reply | 主代理按子任务和问题 ID 答复；先保存，再唤醒子代理 | 已验证：所属关系、相同答复幂等、不同答复拒绝、存储重试与重启 |
| H-04 | manage_subtasks / subtasks.wait | 首次取得游标，后续等待变化或超时；随主任务停止取消 | 已验证：事件唤醒、父任务隔离、原生取消、禁用新委派后的收尾 |
| H-05 | open_in_pi | 在当前聊天所属窗口打开文件树/项目文件、代码位置、已登记的 PDF/HTML 产物、变更、审查表单、子代理列表、指定子代理会话、终端、已有浏览器标签或独立摘要 | 已验证：窗口归属、路径/目录隔离、草稿与缓冲保护、终端/浏览器资源不重复创建；见 [视图接口记录](harness-views.md) |
| H-06 | read_terminal | 列出当前聊天终端、读取增量输出、等待输出/退出/关闭；取消等待不终止终端 | 已验证：真实 PTY、跨聊天/子代理隔离、取消、超时、退出码、重启及双语；见 [终端接口记录](harness-terminal.md) |
| H-07 | manage_operations | 查询当前聊天操作、事件等待进度与结果，仅允许取消本聊天项目动作 | 已验证：真实项目动作、退出/重启、等待取消、只读/计划/子代理隔离及保存边界；见 [操作接口记录](harness-operations.md) |
| H-08 | get_harness section=view | 查询当前窗口视图、摘要/辅助栏、活动面板标签、浏览器标签及选中文件；只返回当前聊天 UI 投影 | 已实现并通过协议单元；不返回草稿正文、其他聊天窗口或凭据 |
| H-09 | list_project_actions | 列出当前执行目录的初始化、清理和常用动作标识/名称及待审查命令正文 | 已验证：真实 Worker/IPC 只读调用及命令内容投影 |
| H-10 | run_project_action | 原样提交已列出的配置命令并启动项目动作，返回操作记录；后续用 manage_operations 等待 | 已验证：真实初始化/动作通路、退出码、目录边界、配置版本校验和权限模式 |
| H-11 | open_in_pi terminal/browser | 模型只切换当前聊天窗口的终端面板或已有浏览器标签；没有现有浏览器标签时返回 not_opened | 已实现并通过定向单元及原生 UI 流程；不启动终端、不导航网页、不创建标签 |
| H-12 | open_in_pi subtask | 模型按 subtaskId 打开当前主代理拥有的子代理会话标签；不允许跨主任务或直接编辑子代理 | 已验证：归属校验、只读标签选择、重启保留及真实主代理流程 |
| H-13 | open_in_pi files | 模型打开文件树并按 directoryId 选择当前项目目录，不自动打开文件或修改编辑缓冲 | 已验证：目录边界、路径不变、面板选择及真实窗口流程 |
| H-14 | open_in_pi sidechat | 模型打开当前主任务已有的临时侧聊；可按 sidechatId 选择，省略时复用当前选择或最近一项，不创建侧聊、不发送消息 | 已验证：主任务归属、只显示现有侧聊、面板标签选择及真实窗口流程 |
| H-15 | focus_in_pi | 模型将当前任务窗口定位到输入框、最新消息、待审批项或计划步骤；只移动阅读位置，不修改草稿、不发送消息、不改变权限 | 已验证：模型工具、主进程窗口归属、消息/计划/审批解析及输入框原生流程 |
| H-16 | list_pending_approvals | 查询当前任务仍在等待的审批投影，包含工具、类型、说明、选项及独立审查风险；不返回线程归属或审查模型身份 | 已实现：当前任务过滤、字段裁剪、原生 IPC 空列表流程；只读，不可替用户审批 |
| H-17 | open_in_pi artifact | 打开当前任务已登记的 PDF/HTML 产物，复用文件面板的隔离预览；路径必须属于产物清单，不允许借此浏览任意文件 | 已验证：真实写入产物登记、清单过滤、PDF/HTML 类型限制及原生隔离预览 |
| H-18 | list_artifacts | 读取当前任务已经登记的 PDF/HTML 产物元数据，供模型决定是否打开隔离预览；不读取文件内容 | 已验证：相对路径、类型、缺失/非法状态与大小上限投影；原生流程已覆盖 |
| H-19 | append_to_draft | 将模型生成的补充说明追加到当前主聊天草稿，保留用户已有文本、附件和引用；不发送、不覆盖、不用于子代理或临时侧聊 | 已实现：追加幂等、长度限制、草稿状态广播及真实 Electron 草稿恢复流程 |
| H-20 | add_context_to_draft | 将经过主进程校验的文件、文件夹、Skill、工具或消息引用加入当前主聊天上下文；不发送、不返回内容、不绕过目录和版本检查 | 已实现：引用校验、过期/越界拒绝、去重合并及真实 Electron 上下文流程 |
| H-21 | list_context_options | 查询当前 slash/at 上下文选择器中的命令、Skill、工具和匹配的项目文件/文件夹元数据；只读，不返回文件内容 | 已实现：查询过滤、元数据上限、项目目录隔离及真实 Electron 流程 |
| H-22 | list_message_options | 查询当前聊天中用户/助手消息的受限元数据和短预览，供模型定位消息并准备引用；排除工具输出、思考块、草稿及其他聊天 | 已实现：按查询过滤、预览与长度上限、消息范围隔离及真实 Electron 流程 |
| H-23 | read_message_context | 读取当前聊天用户/助手消息的受限精确片段，返回偏移、文本版本和正文，供 add_context_to_draft 构造稳定引用；拒绝工具输出和越界范围 | 已实现：消息归属、范围与长度校验、版本返回及真实 Electron 流程 |
| H-24 | focus_in_pi message | 将当前任务窗口定位到指定消息；只移动阅读位置，不修改草稿、权限或会话状态 | 已实现：消息归属校验、迟到窗口保护及真实 Electron 聚焦流程 |
| H-25 | quote_message_to_draft | 将当前聊天用户/助手消息的精确范围加入主聊天上下文；不发送、不覆盖正文，自动校验消息版本并保持引用幂等 | 已实现：主任务权限、消息范围、版本校验、去重合并及真实 Electron 流程 |
| H-26 | list_queued_messages | 查询当前聊天等待中的引导/排队消息元数据；返回有限预览、版本、附件数与引用数，不编辑、不删除、不发送 | 已实现：当前会话隔离、内容截断、队列类型与版本投影及真实 Electron 流程 |
| H-27 | manage_queued_message | 按 id 与 revision 编辑、删除或调整当前主聊天的引导/排队消息；不会发送消息、改变权限或触碰其他聊天 | 已实现：版本并发保护、附件/引用保留、真实队列变更及 Electron 流程 |
| H-28 | remove_context_from_draft | 从当前主聊天草稿中移除一个精确的文件、文件夹、Skill、工具或消息引用；不改正文、不删附件、不发送 | 已实现：稳定引用身份匹配、幂等未找到结果及真实 Electron 草稿流程 |
| H-29 | list_draft_context | 查询当前主聊天草稿中已附加的上下文引用元数据；不返回引用正文、文件内容或其他聊天 | 已实现：引用数量、稳定身份、版本/范围投影及真实 Electron 流程 |
| H-30 | list_draft_attachments | 查询当前主聊天草稿附件的安全元数据；返回项目相对路径、位置、存在状态和大小，不返回绝对根目录或文件内容 | 已实现：项目/外部路径脱敏、缺失与超限状态投影及真实 Electron 流程 |
| H-31 | remove_draft_attachment | 按 `list_draft_attachments` 返回的透明外 id 与 revision 移除当前草稿中的一个附件引用；不删除磁盘文件、不改正文、不发送消息 | 已实现：不透明身份、乐观 revision 校验、真实 Electron 草稿流程 |
| H-32 | preflight_draft | 预检当前主聊天草稿的可发送性、估算 token、上下文窗口与图片数量；只返回问题和计数，不返回草稿正文或文件内容 | 已实现：复用 ComposerService 真实预检、受限问题投影及真实 Electron 流程 |
| H-33 | get_draft_state | 查询当前主聊天草稿的内容无关状态和不透明 revision，供模型在连续 Harness 调用之间检测用户是否改动草稿 | 已实现：revision 不泄露正文、只读投影及真实 Electron 流程 |
| H-34 | browser close | 关闭当前任务已经打开的指定浏览器标签，不导航、不读取网页、不触碰其他标签 | 已实现：主进程按任务和 tabId 校验、原生浏览器流程及单标签隔离 |
| H-35 | add_draft_attachments | 从当前项目目录复制指定文件到主聊天草稿附件，需提交 list_draft_attachments 返回的 revision；不发送、不删除源文件、不修改正文或上下文 | 已实现：项目目录边界、普通文件与 10 MB 限制、附件 revision 并发保护、真实 Electron 流程 |
| H-36 | send_draft | 将当前主聊天草稿按 steer 或 followUp 排入运行中的主任务；需提交 get_draft_state 返回的 revision，成功且草稿未变化时才清空草稿 | 已实现：真实 preflight、策略校验、revision 并发保护、队列收据及真实 Electron 流程 |
| H-37 | replace_draft_text | 按 get_draft_state 返回的 revision 替换当前主聊天草稿正文，保留附件和上下文；允许传空文本清空草稿，不发送消息 | 已实现：revision 并发保护、正文长度上限、附件/上下文保留及真实 Electron 流程 |
| H-38 | clear_queued_messages | 按 list_queued_messages 返回的 opaque revision 尝试把当前主聊天等待中的消息撤回到草稿；队列已开始处理时拒绝，避免重复注入 | 已实现：revision 并发保护、Worker 队列一致性校验、成功路径复用 UI 撤回逻辑；真实 Electron 流程验证了处理开始后的保守拒绝 |
| H-39 | list_draft_history / restore_draft_history | 查看当前主聊天可恢复草稿版本的受限元数据，并按 snapshotId + get_draft_state revision 恢复正文、附件和上下文；重试幂等，不发送消息 | 已实现：历史元数据脱敏、revision 并发保护、重复恢复幂等、真实 Electron 流程 |
| H-40 | read_sessions / sessions.list | 列出工作区会话：项目、状态、置顶/归档/未读、更新时间、消息数，可按项目、关键词、置顶、归档、时间过滤，最多 50 条 | 已实现：与侧栏同一可见性规则（排除审查会话、子任务、临时侧聊、已删除）；单元覆盖过滤、上限与项目名 |
| H-41 | read_sessions / sessions.read | 读取指定会话的用户/助手正文，支持角色过滤、offset/limit 分页与单条字符上限，返回 total 与 truncated | 已实现：只投影正文，不含思考、工具参数、差异、草稿与凭据；单元覆盖分页、角色过滤与截断 |
| H-42 | read_sessions / sessions.search | 在工作区会话里做字面量搜索，返回命中会话、项目名、字段、命中位置与有界片段，最多 200 条 | 已实现：只搜用户/助手正文（与 H-41 同一字段面）；单元覆盖跨项目、projects 过滤与截断标记 |
| H-43 | manage_sessions | create/select/rename/pin/archive/markRead/stop/resume/fork/delete 十个动作，逐一复用用户点击时的同一条 op；delete 沿用原生确认框 | 已实现：会话归属与空闲校验、计划模式拒绝、窗口缺失时 select 会打开任务窗口；协议层由 desktop-tool-surface 单元看守 |
| H-44 | send_to_session / sessions.send | 给任意会话发送消息（运行中按 steer/followUp 排队，空闲会话起一轮）；这是唯一的跨会话写操作 | 已实现：`ask` 策略下先弹审批卡片（`auto`/`full` 直接发送、`deny` 与计划模式拒绝），正文上限 100000 字符 |
| H-45 | manage_projects | list/add/trust/directoryAdd/directoryRemove/directoryUpdate；add 与 directoryAdd 可带 path，缺省时仍走原生目录选择器 | 已实现：与 `project.*` op 同一校验路径（`addProjectPath` / `addProjectDirectory` 抽取自原实现），信任与目录变更沿用既有原生确认 |
| H-46 | manage_ui | collapseProject/summary/openPanel/closePanel/selectFile/selectDirectory，只写视图状态 | 已实现：复用 `ui.update` 与 `ui.threadPatch`（面板切换走 `panelSelectionPatch`、选文件走 `fileSelectionPatch`），不触碰草稿、消息或权限 |
| H-47 | get_harness section=desktop | 返回当前会话可用的桌面动作目录（工具、动作、读写、是否受 ask 审批），供模型发现能力而不必把说明塞进工具描述 | 已实现：目录来自 `shared/desktop-tools.ts`，与实际注册的族一致 |
| H-48 | manage_messages / messages.copy | 把当前会话里某条消息的正文写入剪贴板（用户消息取输入文本） | 已实现：消息归属校验；schema 无 threadId，只能作用于调用方自己的会话 |
| H-49 | manage_messages / messages.revise | 编辑用户消息或重新生成，生成修订会话并切换过去；requestId 幂等、空闲校验沿用 `thread.revise` | 已实现：复用 op 内既有的指纹比对与清理回滚，拿到新会话后打开其窗口 |
| H-50 | manage_messages / messages.setModel | 切换当前会话模型，模型必须存在于设置里 | 已实现：`findModel` 校验后走 `thread.update`；不触碰权限与凭据 |
| H-51 | manage_messages / messages.setThinking | 切换当前会话思考程度，必须是该模型允许的档位 | 已实现：`allowedThinkingLevels` 校验后走 `thread.update`，拒绝时报出允许档位 |
| H-52 | manage_messages / messages.createSidechat | 为当前会话创建临时侧聊（可指定起点消息）并打开其窗口 | 已实现：复用 `sidechat.create`（临时策略为 deny），锚点缺失时拒绝 |
| H-53 | manage_review | start/cancel/inspect/read/finding/locate：发起或取消审查、读取运行与发现、读被审查快照、忽略或批注发现、定位到发现 | 已实现：复用 `review.*` op；start/cancel 受 ask 审批（消耗模型额度），finding/locate 只写审查记录 |
| H-54 | manage_git | 只读 status/inspect/diff/range/commitInfo/recoveries/processProblems/hunkVersion；写入 run(stage/branch/fetch/pull/push/merge/rebase/…)、commit、apply、revert、hunkRevert、hunkRestore、conflict、retryStop | 已实现：全部写动作在 ask 策略下弹审批（full/auto 直接执行），hunkRevert 需先用 hunkVersion 取版本 |
| H-55 | manage_worktrees | create/migrate/manage(archive/restore/usage/cleanup)/recycle/recovery/creationRecovery | 已实现：`worktree.*` op 原样转发（requestId 幂等），archive/cleanup/recycle/retry 需审批，usage/refresh 免审批 |
| H-56 | manage_terminal | open/rename/close，输出仍用既有 read_terminal | 已实现：**不含 terminal.input**（输入永远由用户或沙箱命令工具发起）；close 需审批，因为可能中断正在运行的命令 |
| H-57 | manage_settings | settings.read（可改键 + 禁用键清单）、settings.models（供应商目录）、settings.inputCatalog、settings.apply（白名单修改） | 已实现：白名单只含外观与行为偏好；`deniedSettingsKeys` 里 14 个键（policy、modelProviders、mcpServers、pluginSources、memory、subtasksEnabled 等）逐键报错并附理由，单元测试逐键断言 |
| H-58 | manage_files | list/read/write/open/reveal/search/searchCancel | 已实现：复用 `file.*` op，写入必须带 read 返回的版本（CAS），路径仍受项目目录约束；write 受 ask 审批 |
| H-59 | manage_comments | list/add/remove/locate | 已实现：复用 `comment.*` op，批注锚点用 read 的文件版本，过期即拒绝 |
| H-60 | git.cancel / terminal.resize | 按 requestId 取消进行中的 Git 操作；调整终端视图尺寸 | 已实现：分别挂在 `manage_git` 与 `manage_terminal`；git.cancel 受审批，resize 只改视图 |
| H-61 | manage_browser_data | history/downloads/download(cancel·reveal)/find/annotation(read·remove·attach) | 已实现：`browser.find` 缺省只作用于本会话窗口的活动标签页；站点策略（`browser.site`）与数据清理（`browser.clear`）不在工具里 |
| H-62 | manage_pr | pr.status、pr.start(view/create) | 已实现：create 需要标题且对外可见，受 ask 审批；不代替用户推进分支或提供凭据 |
| H-63 | manage_resources | inspect/refresh/open；rescan 受审批 | 已实现：读发现结果与诊断，重新扫描本地代码要审批；启用与导入资源不可用 |
| H-64 | manage_mcp | list/test/testCancel/retry/resource（按索引读资源） | 已实现：test/retry 会启动进程，受审批；list 只返回用户已能看到的服务器 id、状态与工具名；`mcp.secret*`、`mcp.oauth*` 永不可达 |
| H-65 | sessions.quickChat / sessions.bindProject / ui.openExternal | 新建无项目快速聊天；把当前会话绑定到项目；用系统浏览器打开 http(s) 链接 | 已实现：绑定只作用于调用方自己的会话；openExternal 限 http(s) 且受 ask 审批 |
| H-66 | manage_windows | windows.open/minimize/maximize/close/retryShortcut/revealWorktreePath | 已实现：窗口控制作用于调用方所在窗口，close 受审批；不注册新快捷键，只重试既有全局快捷键的注册 |
| H-67 | manage_preview | previews.open/close/refresh、artifacts.open/close/status/stop/capture/annotation | 已实现：`previews.open` 只接受本地 http(s) 地址；工件预览会启动本地服务但可 stop；**`artifact.network`（站点放行）与 `artifact.bounds`/`preview.bounds`（几何）不在工具里** |

get_harness 的 availableTools 来自当前 Agent 的实际工具表，包括已启用的计划、Goal、自动化、浏览器及外部工具；查询不会自行启用能力。

## 调用约定

get_harness 参数 section 可选 all、session、workspace、operations、view、desktop，默认 all。权限信息始终返回，其余按 section 投影。上下文使用主进程已有测量记录，没有测量值时保持缺失，不当作零占用。view 只返回当前聊天的活动窗口状态和最多 20 个标签，不会把 UI 状态当成用户指令。desktop 只返回当前会话真正注册的族与动作目录。

**2026-10 桌面面扩展（H-40 起）**：模型可以按「用户用鼠标能做的事」调用桌面动作，唯一例外是权限面。
- 跨会话读取默认覆盖整个工作区的可见会话（用户已确认）；仍不接受原始 op、不接受权限参数，且不返回草稿、凭据、工具密钥或其他会话的运行状态。
- 跨会话写入只有发消息一种（H-44）；`ask` 策略逐次弹审批，`auto`/`full` 免审批，`deny` 与计划模式拒绝。
- 只读动作（list/read/search/projects.list）在任何主聊天与子代理里都可用；写动作只在主聊天注册（子任务、审查、临时侧聊不注册）。
- 权限面永远不可达：`policy`、`planMode`、工具策略、沙箱设置、审批结果、`provider.key`、`mcp.secret`、插件安装与 `terminal.input` 既不在工具 schema 里，也不在动作目录里（守卫见 `test/desktop-tool-surface.test.ts`）。

**验证入口**：`test/desktop-tool-surface.test.ts`（目录与 worker 协议一致、权限面探针、设置白名单逐键断言）、`test/session-context.test.ts`（跨会话投影）、`test/e2e/desktop-tools.nonvisual.spec.ts`（真实 Worker：跨会话读取不泄露另一会话草稿、`ask` 策略下跨会话发消息先弹审批、设置拒绝权限键、视图动作可见变化）、`test/e2e/harness-tools.nonvisual.spec.ts`（H-01…H-39 回归）。

- 只查询调用者，不接受任意 threadId、原始 op 或权限修改参数。
- 不读取设置对象、供应商地址、凭据、未发送草稿或排队消息正文；跨会话内容只在 H-40…H-42 的只读投影里出现（用户/助手正文，不含思考、工具参数与差异）。
- 目录使用本轮捕获的执行目录；子代理仅看到自己的目录，不能枚举兄弟目录。
- 权限保留捕获值和当前值，报告更严格的权限；主代理答复不能提权。
- 操作仅返回当前会话最近 30 项的标识、种类、状态、阶段和时间，不返回输出或结果。
- list_project_actions 返回当前执行目录的目录标识、cwd、shell、配置状态及命令正文，让独立代审批模型可以检查将要运行的真实命令。
- run_project_action 要求先取得并原样提交 command；主进程会按 actionId/种类重新读取配置并做精确匹配，命令变化就拒绝。它不接收目录路径或 threadId，受当前任务计划模式、沙箱策略、目录信任和审批控制，返回后使用 manage_operations 读取最终状态。
- open_in_pi 的 terminal 只打开已有终端面板；browser 可按 tabId 或当前活动标签切换到已有浏览器标签。两者都不创建进程、标签、网页导航或权限变化。
- open_in_pi 的 subtask 必须提供当前主代理名下的 subtaskId，只打开右侧只读会话标签；不存在、已换主任务或归属不匹配时返回 not_opened，不启动子代理、不发送消息、不提供人工答复入口。
- open_in_pi 的 files 可带 directoryId 选择项目附加目录；只切换文件树面板，不打开文件、不改变草稿、不绕过目录权限。
- open_in_pi 的 sidechat 可带 sidechatId 选择当前主任务已有的临时侧聊；省略时复用当前选择或最近一项。它只显示右侧侧聊面板，不创建侧聊、不发送消息、不提供跨任务访问。
- open_in_pi 的 artifact 必须带 path，并且该路径已经由当前任务登记为产物；主进程按执行目录重新归一化并校验清单、文件类型和 50 MB 大小上限，只打开文件面板中的隔离 PDF/HTML 预览，不允许借此访问未登记文件。
- list_artifacts 只返回当前任务的相对路径、pdf/html/unknown 类型、ready/missing/invalid 状态及有上限的大小；不返回执行根目录、文件内容或其他任务产物。
- append_to_draft 只在主任务运行中追加模型提供的文本，保留已有附件和上下文引用；空白文本、超长草稿和子代理/审查/临时侧聊均拒绝，重复重试不会重复追加。
- add_context_to_draft 只在主任务运行中加入引用；主进程重新读取并校验目录、引用版本和消息原文，过期或越界引用整批拒绝，成功后只返回引用数量和受限元数据，不返回文件内容。
- list_context_options 复用当前输入选择器的命令、Skill、工具目录，并按查询补充项目文件/文件夹匹配；返回受限元数据，不启动扩展、不读取文件正文。
- list_message_options 只返回当前聊天的用户/助手消息 ID、角色、短预览、文本长度和可引用标志；不返回工具输出、思考块、草稿或其他聊天内容，可配合 add_context_to_draft 形成消息引用。
- read_message_context 只读取当前聊天用户/助手消息的精确范围；缺省范围最多返回 8000 字符，显式范围最多 40000 字符，并返回原文版本供引用再次校验，不修改 UI、草稿或权限。
- focus_in_pi 可按 H-22 返回的 messageId 定位指定消息；主进程确认消息仍属于当前聊天，Renderer 只滚动并聚焦现有消息节点，窗口不活动或消息不存在时返回 not_focused。
- focus_in_pi 只在当前聊天已有窗口中定位内容：composer 聚焦输入框，latest 定位最近消息，approval 可带 approvalId 定位待审批卡片，plan 带步骤 index 定位当前计划。找不到目标或任务窗口不在前台时返回 not_focused；不会打开窗口、写入草稿或替用户审批。
- list_pending_approvals 只返回调用者当前任务的待处理审批，不接受 threadId 或审批结果参数；说明、选项和独立审查原因均有长度上限，并剥离 threadId 与审查模型身份。它不会批准、拒绝、重试或改变策略；需要用户处理时配合 focus_in_pi 定位审批卡片。
- quote_message_to_draft 只在主任务运行中加入消息引用；显式 start/end 最多 40000 字符，缺省读取超出 8000 字符的消息会拒绝并要求先指定完整范围；主进程重新校验消息版本，成功后只返回受限引用元数据。
- list_queued_messages 只读取当前聊天的 steer/followUp 队列；返回 id、revision、类型、最多 1200 字符预览、正文长度、附件数和上下文引用数，不返回其他聊天队列，也不改变队列状态。
- manage_queued_message 只能作用于主聊天当前队列，必须先用 list_queued_messages 获取 id 与 revision；edit 需要 text，remove/up/down 不接受 text，revision 过期会拒绝，编辑会保留附件和上下文引用。
- remove_context_from_draft 只按 kind、id、directoryId 以及 range/quote 起止位置匹配当前主聊天上下文；移除不存在的引用返回 not_found，不读取文件正文、不修改草稿文字或附件。
- list_draft_context 只在主聊天运行中读取当前草稿上下文；返回 kind、id、label、directoryId、version、range 或 quote 起止和文本长度，最多 1000 条，不返回 quote 文本或文件内容。
- list_draft_attachments 只在主聊天运行中读取当前草稿附件；项目内返回相对路径，项目外只返回文件名和 external 标记，最多 1000 条，文件缺失、目录或超过 10 MB 时返回对应状态，不读取文件内容。
- remove_draft_attachment 只能提交 `list_draft_attachments` 返回的 id 与 revision；revision 过期会拒绝，成功后只移除草稿引用并返回新的附件元数据，不删除原文件。
- preflight_draft 只读取当前主聊天草稿，复用真实附件和上下文校验；返回 valid、受限 issues、estimatedTokens、contextWindow、images、正文长度、附件数和引用数，不发送、不修改草稿或权限。
- get_draft_state 只读取当前主聊天草稿的无内容元数据；返回不透明 revision、是否有非空正文、正文长度、附件数和引用数。revision 只用于检测连续调用之间的变化，不能反推出正文或路径。
- browser close 只作用于当前任务已经存在的浏览器标签；关闭前校验 tabId 归属，不请求网站授权、不读取页面内容，关闭后由现有页面生命周期同步 UI 标签列表。不存在的标签直接失败，不创建新标签。
- add_draft_attachments 只接受项目相对路径和可选 directoryId，先校验 list_draft_attachments 返回的附件 revision；主进程复制到任务私有附件目录，再原子保存草稿，失败时恢复 UI、允许列表并清理新批次。源文件保持不变，最多 10 个普通文件且单个不超过 10 MB；不会发送消息、返回文件内容或扩大权限。
- send_draft 只能作用于当前主聊天正在运行的任务，必须先用 get_draft_state 取得 revision，再提交 steer 或 followUp；主进程会复用正常 preflight 和策略校验，拒绝过期 revision、空闲/子代理/审查/临时侧聊。发送成功后仅当草稿仍保持同一 revision 才清空正文、附件和上下文；不接受模型自带任意文本，不绕过审批或权限。
- replace_draft_text 只能作用于当前主聊天正在运行的任务，必须先用 get_draft_state 取得 revision；它只替换正文，保留附件与上下文引用，允许空文本清空草稿。revision 过期、子代理/审查/临时侧聊或草稿过长时拒绝；不发送消息、不改变权限、不返回旧正文。
- clear_queued_messages 只能作用于当前主聊天正在运行的主任务，必须先用 list_queued_messages 取得 opaque revision；主进程和 Worker 都会再次比较队列版本与条目身份。队列已经被 SDK 取走、开始处理或发生任何变化时拒绝，避免把已经进入模型回合的内容再次写入草稿；成功时才把文本、附件和上下文引用恢复到草稿，不发送、不删除、不改权限。
- list_draft_history 只返回当前主聊天历史快照的 id、时间、正文长度、附件数量和引用数量，不返回历史正文、路径或引用内容。restore_draft_history 必须先用 get_draft_state 取得 revision；用户已编辑草稿时拒绝，目标快照已经在草稿中时返回 already_present，其他情况恢复到草稿供用户检查，不发送、不改变权限。

子代理提问：

~~~json
{ "question": "本次应该检查哪个入口文件？", "timeoutMs": 120000 }
~~~

主代理通过内部通知或 subtasks.list/read/wait 获得问题，调用 manage_subtasks：

~~~json
{ "action": "subtasks.reply", "id": "子任务 UUID", "questionId": "问题 UUID", "answer": "先检查 README.md 指向的入口。" }
~~~

等待变化：

~~~json
{ "action": "subtasks.wait" }
{ "action": "subtasks.wait", "cursor": "上次结果中的 cursor", "timeoutMs": 30000 }
~~~

无游标立即返回，有游标才等待。结果包含 cursor、changed、tasks、total、truncated。活动项优先，已结束项从新到旧，最多 100 项；结果预览最多 2000 字符、错误预览最多 1000 字符，完整结果继续用 subtasks.read。超时返回 changed: false，不能当作完成。

## 生命周期与界面

- 问题最大 4000 字符，答复最大 8000 字符；每个子任务最多 32 个问题，同时最多一个待答问题，最长等待 120 秒。
- 问题先保存再发布和通知，保存失败不产生幽灵问题；答复保存失败保留待答状态，支持重试。
- 运行中的主代理在模型消息边界收到内部引导通知，不打断执行中的工具。子代理文本明确标为数据，不能作为新的用户授权。
- 空闲主代理不会因提问自行启动模型轮次。主代理应在委派完成前继续处理或等待；问题超时返回 expired，不伪造答复。这是本轮明确边界。
- 停止主任务取消问题和子任务；退出或异常恢复将未完成问题标为 interrupted，不重放模型请求。已答复记录重启后仍可查看。
- 右侧只读列表/会话展示等待状态、问题和答复；待答展开、已答收起，无输入框或人工答复按钮。内部路由消息不重复出现在主消息流。
- 禁用全局子任务开关阻止新委派，已运行的主代理仍能读取、答复、停止已有子任务。

## 定向验证

下表保留 H-01–H-04 的原始执行记录。H-05、H-06、H-07 各增加一个协议用例，H-15 增加聚焦解析断言，H-16 增加审批投影断言，H-17 增加产物预览断言，H-18 增加产物清单断言，H-19 增加草稿追加断言，H-21 增加上下文目录断言，H-22 增加消息目录断言，H-23 增加精确消息片段断言，H-24 增加指定消息聚焦断言，H-25 增加消息引用追加断言，H-26 增加排队消息读取断言，H-27 增加排队消息编辑断言，H-28 增加上下文引用移除断言，H-29 增加草稿上下文清单断言，H-30 增加草稿附件清单断言，H-31 增加草稿附件移除断言，H-32 增加草稿发送预检断言，H-33 增加草稿状态 revision 断言；当前 harness 快速入口为 36 项单元及 1 项 UI。browser close 本轮另增加 1 项浏览器单元和 1 项原生隔离场景。harness-views 当前为 14 项单元及三个原生场景，H-05 当轮执行的 12 项单元记录保留在 [H-05 验收](harness-views.md)。read_terminal 单独使用 harness-terminal（当前 16 项单元、3 项原生），分次证据见 [H-06 验收](harness-terminal.md)。manage_operations 使用 harness-operations（19 项单元、3 项原生），见 [H-07 验收](harness-operations.md)。当前入口数量不是这些历史模块已在本轮重跑的声明。新增入口不自动连带全套 Harness、子任务或终端回归。

| 实际命令 | 工作目录 | 退出码 | 结果 |
| --- | --- | --- | --- |
| npm run desktop:check | 根目录 | 0 | 最终桌面类型检查 |
| npm run desktop:test:target -- --file test/harness-tools.test.ts | 根目录 | 0 | 16 项 Harness 协议/投影/视图解析单元 |
| node --import tsx --test test/harness-tools.test.ts test/subtask-communication.test.ts test/subtasks.test.ts test/subtask-persistence.test.ts | apps/desktop | 0 | 27 项接口、通信、关联生命周期/持久化单元，含最终参数拒绝断言 |
| npm run desktop:test:target -- harness --level native | 根目录 | 0 | 当时已有的 3 项原生流程：查询、通信/重启、父任务停止 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "a parent can cancel" | 根目录 | 0 | 后续新增第 4 项原生长等待取消 |
| node --test scripts/desktop-test-target.test.mjs | 根目录 | 0 | 16 项选择器检查 |
| node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/harness-tools/temp-audit-h19.json | 根目录 | 0 | 未发现新 Harness 产物目录；5 个无所有权证明的旧临时目录仍跳过回收 |

去重后：32 项业务单元、16 项选择器检查、1 项 UI、4 项原生流程。harness 原生入口现包含 4 项，本轮按 3 + 1 分次验证，不声称四项在同一次运行通过。

首次原生测试因点击已折叠的创建行而失败；通信已成功，修正测试为先展开工作过程及答复，再检查只读会话。产品自动折叠逻辑保持。最初类型和新增行为的失败已修复，最终证据如表。

原生验证使用本地假供应商、真实 Electron/Worker/IPC/磁盘和重启，没有线上模型联调。构建仍提示已有 Zod PURE 注释及 NO_COLOR 环境警告，本轮不修改依赖。各原生用例均断言自有临时目录删除；关闭截图、视频、trace，只保留 [原生三项记录](../../.artifacts/harness-tools/native.json)、[等待取消记录](../../.artifacts/harness-tools/native-wait-cancellation.json)、[目录审计](../../.artifacts/harness-tools/temp-audit.json)。

启动：根目录运行 npm run desktop:dev；重启开发应用加载本次接口。正在运行的模型轮次沿用已加载配置。

本轮补齐 H-32，不代表整个功能 Goal 完成；没有提交、发布、安装依赖或制作 EXE。
