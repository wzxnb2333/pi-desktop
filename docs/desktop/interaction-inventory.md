# Pi Desktop 交互清单（WP-R）

记录参考端（Codex Desktop 26.915.4065.0）各交互面的状态集合，供后续复刻工作包对齐。**每条断言都带 chunk 文件、字节偏移与读到的字节。** 偏移是压缩 chunk 的字节偏移（按原始字节读取），不是 pretty 文件行号；压缩代码的字符串使用反引号字面量，所以检索时反引号与引号都要匹配。

配套文件：`docs/desktop/capability-matrix.md`（哪些元素允许实现）。本文件只描述"有哪些状态、看起来怎样"，不判定可实现性。

## 证据边界（先读这段）

- 主证据：`manifest.json` 中 `category=js-desktop` 的 32 个 chunk（文件名匹配 `local-*` / `*.electron*`，共 1317368 字节），辅以 `js-named`（composer*、*settings*、automation*、code-diff、split-items-into-render-groups、command-menu-dialog、agent-menu、sidebar-*、background-terminal-*、tab-content-*）。
- **不可引用**：`app-shared-8f4fbb856ceb.js`（2531637 B）、`app-initial-6c4523b43a11.js`（12175081 B）、`app-primary-355549b35da9.js`（1991782 B）未抽取（字节数取自 `archive-file-list.json`）。侧栏主体、应用外壳、本地 composer 本体、inbox 与技能管理页的实现在这三个 bundle 内。
- 编译产物是 Tailwind v4 输出，无 source map，CSS module 类名被哈希（如 `_Toolbar_3yrz9_2`）。因此**精确 JSX 嵌套、逐组件断点、动画时长与缓动、条件渲染逻辑、截断策略、图标字形**基本不可恢复；下文逐条标 `未确立`。

## 跨面通用约定

| 主题 | 证据 | 说明 |
|---|---|---|
| 悬停态以指针能力门控 | `app-shared-11c21cbb0024.css:502205 → "@media (hover:hover){.group-hover\\:pointer-events-auto:is(:where(.group):hover *){pointer-events:auto}"` | hover 揭示的动作在不可 hover 的环境下不常驻显示 |
| 选中态驱动子元素可见 | `app-shared-11c21cbb0024.css:538430 → "aria-\\[selected\\=true\\]\\:visible:is(:where(.group)[aria-selected=true] *){visibility:visible}"` | 行内动作由所在 group 的 `aria-selected` 决定显隐 |
| 当前项用 aria-current | `local-remote-dropdown-546fbb1141bc.js:28625 → "(0,X.jsx)(Y.Item,{\"aria-current\":r?\`true\`:void 0,rightIconAsset:r?s:void 0"` | 菜单项选中不靠类名，靠 `aria-current` |
| 行内动作只在交互时出现 | `local-conversation-thread-666070b6dc20.js:30939 → "(0,Jy.jsx)($.ItemMeta,{variant:\`icon\`,visibility:\`interaction\`"` | 组件层用 `visibility:'interaction'` 表达同一意图 |
| cursor 走 token | `app-shared-11c21cbb0024.css:18458 → "--cursor-interaction:pointer"`；用法 `app-initial-19d25b9d212e.css:23680 → "._InlineMentionFocusRing_1szxf_623{cursor:var(--cursor-interaction)}"` | 可点元素统一 `cursor-interaction` |
| 工具条高度 token | `app-shared-11c21cbb0024.css:18485 → "--height-toolbar:46px;--height-toolbar-sm:36px;--height-toolbar-pane:40px"` | 三级高度；哪个面用哪一级 **未确立** |
| 侧栏宽度夹取 | `app-shared-11c21cbb0024.css:18690 → "--spacing-token-sidebar:clamp(240px, var(--codex-sidebar-preferred-width,275px), min(520px, calc(100vw - 320px)))"` | 已移植进 `contracts.ts:117` 的 `SIDEBAR_WIDTH` |
| 窗口 chrome 由 data 属性驱动 | `app-shared-11c21cbb0024.css:854311 → "[data-codex-window-type=electron]:not([data-codex-window-chrome=application-menu]) body{background:0 0}"` | `data-codex-window-type` 在该文件出现 475 次 |
| 拖拽区 / 按钮免拖 | `app-initial-19d25b9d212e.css:43070 → "._Toolbar_3yrz9_2{-webkit-app-region:drag;-webkit-user-select:none"`；`app-shared-11c21cbb0024.css:475753 → ".draggable button{-webkit-app-region:no-drag}"` | 拖动条与按钮分离 |
| 播报与错误语义 | `local-conversation-thread-666070b6dc20.js:222550 → "\`div\`,{\"aria-live\":\`polite\`,role:\`status\`"`；`:75371 → "className:\`text-danger\`,role:\`alert\`"` | 进度 polite/status，错误 alert |
| IME 守卫 | `command-menu-dialog-f4afbe0b2985.js:6346 → "e.metaKey||e.nativeEvent.isComposing)return!1;let n=e.currentTarget.closest(\`[cmdk-root]\`)"`；`artifact-session-tab-content.electron-4ca06bfed2f3.js:13988 → "e.key===\`Backspace\`&&!e.nativeEvent.isComposing"` | 合成期内不响应回车/退格 |
| 焦点样式 | `local-conversation-thread-666070b6dc20.js:45243`（同一 className 串内含 `hover:bg-primary-ghost-hover focus-visible:bg-primary-ghost-hover focus-visible:outline-offset-[-2px]`） | hover 与 focus-visible 共用底色，outline 负偏移 |
| 选中项的缩放动效值 | `tab-content-1eaf1dfbd620.js:37731 → "button\`,animate:{opacity:s?1:.34,scale:s?1.2:.95},\"aria-current\":s?\`true\`:void 0"` | 可读到 select/deselect 的 opacity 与 scale 目标值；**时长与缓动未确立** |

## 1. 标题栏 / 窗口

- 常规：整条 toolbar 可拖（`app-initial-19d25b9d212e.css:43070`），其内按钮单独 `no-drag`（`app-shared-11c21cbb0024.css:475753`）。窗口类型与 chrome 形态由 `data-codex-window-type` / `data-codex-window-chrome` 切换（`app-shared-…css:854311`），可确认存在 `application-menu` 这一 chrome 取值。
- 空态 / 加载 / 错误 / 选中 / 菜单打开：`未确立`（标题栏文案与按钮实现在未抽取的 `app-initial-*.js`）。
- DOM 顺序：`未确立`；哈希类名 `_Toolbar_3yrz9_2` 只证明存在一个 Toolbar CSS module。

## 2. 侧栏

- 常规：任务行 + 分组，行内动作按交互显隐（`local-conversation-thread-666070b6dc20.js:30939`）。
- 选中：`[aria-selected=true]` group 让子元素 `visibility:visible`（`app-shared-…css:538430`）；另有 `aria-current` 用法（`local-remote-dropdown-546fbb1141bc.js:28625`）。
- 状态徽标集合（Running / Awaiting approval / Needs input / Unread / Error / Idle）：`local-conversation-page-79f603589f3e.js:31405 → "id:\`floatingComposer.chatStatusRunning\`,defaultMessage:\`Running\`"`；`:30703 → "…tingComposer.chatStatusApproval\`,defaultMessage:\`Awaiting approval\`"`（同组 id 在该 chunk 相邻字节连续定义）。
- 行菜单打开：`agent-menu-5e7e1da02597.js:769 → "A=m.formatMessage({id:\`workspaceAgents.index.moreActions\`,defaultMessage:\`More actions\`"`；菜单项形态为 `x.Item` + `LeftIcon`；写入过程中项 `disabled`，成功/失败走 toast（同 chunk 内 `linkCopied` / `pinFailed` 的 defineMessage 群）。
- 进行中 / 错误：同类行内动作在请求飞行中禁用并换 spinner 图标，失败提示 `local-conversation-thread-666070b6dc20.js:49629 → "…backgroundTerminals.cleanError\`,defaultMessage:\`Unable to stop background terminals\`"`。
- 首次引导清单：可折叠，`sidebar-onboarding-checklist.electron-9eac593dd974.js:24122 → "{id:\`sidebarOnboardingChecklist.collapseChecklist\`,defaultMessage:\`Collapse checklist\`"`。
- 空态与加载骨架、DOM 顺序、断点、动画：`未确立`。

## 3. Composer

- 常规：占位符随状态变化，worktree 建立中为 `local-conversation-thread-666070b6dc20.js:233330 → "…ingWorktree.composerPlaceholder\`"`（`Waiting for worktree setup`）。
- 空态：禁用发送的具体实现 `未确立`（本地 composer 在 `app-shared-*.js`）。可确认发送语义差异：`general-settings-f15dc60e0a6e.js:104359 → "defaultMessage:\`Queue follow-ups while {appName} runs or steer the current run."`。
- 进行中：紧凑浮动态主标题 `local-conversation-page-79f603589f3e.js:36349 → "id:\`quickChat.working\`,defaultMessage:\`Working\`"`；推理未出文时的副标题 id 为 `quickChat.thinking`，文案 "Thinking" 后接 UTF-8 省略号（`local-conversation-page-79f603589f3e.js:36777`）。新建任务未确认时 `local-conversation-thread-666070b6dc20.js:337931 → "id:\`localConversation.pendingProjectless.creating\`,defaultMessage:\`Starting your task\`"`。
- 错误：`local-conversation-thread-666070b6dc20.js:329781 → "id:\`composer.localTaskError.v2\`,defaultMessage:\`Error starting chat{br}{error}\`"`（toast）。
- 菜单打开：模型/推理下拉分区标题 `automation-dialog-d41aef19157b.js:12227 → "id:\`composer.intelligenceDropdown.title\`,defaultMessage:\`Reasoning\`"`；打开命令 `command-messages-8aed160be7f9.js:7115 → "\"codex.command.composer.openModelPicker\":{id:\`…\`,defaultMessage:\`Open mo…\`"`。
- 附件动作：`command-messages-8aed160be7f9.js:40623 → "defaultMessage:\`Attach files and folders to the active composer\`"`。
- hover / 选中、控件排列顺序：`未确立`。

## 4. 时间线（回合）

- 条目类型全集（渲染分组器的分支）：`split-items-into-render-groups-3d1292002a39.js:1246 → "r.type===\`turn-diff\`&&(u=r)"`；`:1274 → "r.type===\`todo-list\`"`；`:1302 → "r.type===\`proposed-plan\`"`；`:1792 → "r.type===\`permission-request\`"`；`:2315 → "(r.type===\`reasoning\`||r.type===\`automatic-approval-review\`"`。同一循环还分派 `remote-task-created`、`personality-changed`、`forked-from-conversation`、`model-changed`、`model-rerouted`、`plan-implementation`、`mcp-server-elicitation`、`generated-image`、`automation-update`、`auto-review-interruption-warning`、`subagent-activity`、`realtime-transcript`、`worktree-init`（均在上述偏移的同一字节窗口内）。
- 空态：临时会话空态卡 `local-conversation-thread-666070b6dc20.js:354882 → "title:(0,gj.jsx)(S,{id:\`localConversation.sideChat.empty.title\`,defaultMessage:\`Side chat\`"`。常规新会话空态 `未确立`。
- 常规：思考条目带可见性开关 `local-conversation-turn-da7740c9e58b.js:62161 → "Thinking:c}){return c?{type:\`thinking\`,isVisible"`；完成标题 `conversation-blocks-801b796bbe8f.js:235098 → "id:\`reasoningItem.thoughtWithElapsed\`,defaultMessage:\`Thought for {elapsed}\`"`。
- 进行中：折叠活动摘要 `conversation-blocks-801b796bbe8f.js:115092 → "id:\`localConversation.agentActivity.summary.readFiles.leading\`,defaultMessage:\`Read files\`"`；等待用户 `local-conversation-turn-da7740c9e58b.js:81741 → "id:\`localConversation.agentActivity.waitingForYourAnswer\`,defaultMessage:\`Waiting for your answer\`"`。
- 加载：历史载入向 AT 播报 `local-conversation-thread-666070b6dc20.js:231994 → "id:\`localConversation.loadingTask\`"`。
- 错误：单回合渲染失败 `:303659 → "id:\`localConversation.turnRenderError.title\`"`；更早历史载入失败 `:364634 → "id:\`localConversation.historyLoadFailed\`,defaultMessage:\`Couldn't load earlier messages\`"`；断流重连计数 `localConversation.streamError.reconnecting`（`conversation-blocks`）。
- 滚动跟随：贴底判定阈值 24px，`local-conversation-thread-666070b6dc20.js:307225 → "if(Math.abs(Nu(t)-e)<=24){V.current=!0;return}F.scrollToDistanceFromBottomPx(e,\`instant\`)"`；回到底部按钮以布局 prop 注入 `:366975 → "scrollToBottomButton:mt,remoteHostedPIPAnchorHostId:ht"`，其值在流式中携带 `isWorking` 标记 `:364179 → "mt=U?{isWorking:fe}:void 0"`。按钮文案与图标 `未确立`。
- DOM 顺序（用户消息 → 活动组 → 正文 → 计划 → 文件）：`未确立`；分组器只给出条目归类顺序，不给最终嵌套。

## 5. 审批

- 进行中：`conversation-blocks-801b796bbe8f.js:318760 → "id:\`localConversation.approvalRequest.inProgress\`,defaultMessage:\`Awaiting approval\`"`，容器 `className:\`text-text/30\``（弱化文字，见 `:318698` 同一窗口）。
- 提问态：`:278078 → "id:\`localConversation.userInputRequest.inProgress\`,defaultMessage:\`Asking {count, plural, one {question} other {questio…}\`"`。
- 加载（写入中）：`:142566 → "id:\`localConversation.automaticApprovalReview.approving\`,defaultMessage:\`Approving\`"`（后接 UTF-8 省略号字节）。
- 结果态历史行：`:212467 → "id:\`codex.patch.change.rejected-add\`,defaultMessage:\`Rejected\`"`；同族 `creating/created/editing/edited/deleted/stopped*`。
- 说明与错误：`:142130 → "id:\`localConversation.autoReviewDenial.approvalEffect\`,defaultMessage:\`Records approval for this action and allows one retr…\`"`。
- hover / 选中 / 菜单打开：`未确立`。
- 空态：抽取集内无"审批队列为空"的独立空态证据。

## 6. Review 面板（变更 / 文件 / 计划 / 来源 / 产物）

- 加载：`code-diff-5e1c8d057a0d.js:48563 → "className:\`sr-only\`,children:(0,$.jsx)(i,{id:\`codex.review.diff.loading\`,defaultMessage:\`Loading diff\`"` —— 载入提示只给读屏，不占视觉空间。
- 空态：空文件 `code-diff-…:6775 → "id:\`wham.diff.noContent\`,defaultMessage:\`No content\`"`；无改动 `conversation-blocks-801b796bbe8f.js:216677 → "id:\`codex.patch.change.noChanges\`,defaultMessage:\`No changes\`"`。
- 常规：文件头动作 `code-diff-…:30217 → "id:\`codex.diff.fileHeader.copyPath\`,defaultMessage:\`Copy path\`"`；按钮族 `:7651 → "…stageFile\`,defaultMessage:\`Stage file\`"`、`:8048 → "…revertFile\`,defaultMessage:\`Revert file\`"`、`:8242 → "…stageHunk\`,defaultMessage:\`Stage\`"`。
- 选中：`[aria-selected=true]` group 显隐（`app-shared-…css:538430`）+ `aria-current`（`local-remote-dropdown-546fbb1141bc.js:28625`）。
- 展开 / 折叠：`conversation-blocks-801b796bbe8f.js:220246 → "id:\`codex.patch.change.toggleDiff\`,defaultMessage:\`Toggle diff for {fileName}\`"`；` :269999 → "id:\`codex.unifiedDiff.collapseFiles\`,defaultMessage:\`Collapse files\`"`；回合末标题 `:264144 → "id:\`codex.unifiedDiff.editedFile\`,defaultMessage:\`Edited {filename}\`"`。
- 菜单打开（Review 源菜单）：`local-conversation-thread-666070b6dc20.js:106908 → "id:\`codex.localConversation.gitSummary.thisBranchLabel\`,defaultMessage:\`This branch\`"`。
- 错误：`code-diff-…:6098 → "id:\`codex.diff.renderFailed\`,defaultMessage:\`Diff failed to render\`"`；文件过大 `:47658 → "…openInEditorPrompt.singleLine\`,defaultMessage:\`This file is too large to display here.\`"`；二进制 `:6394 → "id:\`wham.diff.binaryFile\`,defaultMessage:\`Binary file not shown\`"`。
- 补丁结果分组：`conversation-blocks-801b796bbe8f.js:250222 → "defaultMessage:\`Applied cleanly ({count})\`"`（同族 `Skipped`、`Conflicts`）。
- 计划页签：`local-conversation-thread-666070b6dc20.js:180636 → "id:\`codex.localConversation.plan.title\`,defaultMessage:\`Plan\`"`；步骤状态文案 `未确立`。
- 来源页签：列表 aria 名 `local-conversation-sources-side-panel-tab-df9ad59a92b0.js:3746 → "id:\`codex.localConversation.sources.panel.listLabel\`,defaultMessage:\`Sources\`"`；行语义 `:10792 → "…panel.activity.read\`,defaultMessage:\`Read during the chat\`"`；文件来源说明 `:4637 → "…panel.fileAttached\`,defaultMessage:\`Attached to the conversation\`"`。
- 产物页签：空态 `local-conversation-thread-666070b6dc20.js:29409 → "…artifacts.empty\`,defaultMessage:\`No artifacts yet\`"`；卡片 `:30328 → "…artifacts.website\`,defaultMessage:\`Web preview\`"`；创建入口 `:34890 → "…artifacts.create\`,defaultMessage:\`Create a file or site\`"`。
- 面板断点与最小/最大宽度：`未确立`（只有 token 级证据）。

## 7. 终端

- 空态：`local-conversation-background-terminal-tab-5d43e1c97e43.js:1381 → "…groundTerminalTab.noOutput\`,defaultMessage:\`No output yet\`"`。
- 常规：页签标题取命令文本，回退标签 `local-conversation-thread-666070b6dc20.js:49284 → "id:\`codex.localConversation.backgroundTerminalTab.title\`,defaultMessage:\`Background terminal\`"`。
- 行结构与顺序（可确认）：`Item` → `ItemTrigger`（内含 `ItemLeading` 图标 → `ItemLabel` 命令文本）→ `ItemActions`（停止按钮，`visibility:\`interaction\``），见同 chunk `:30939` 的同一组件族调用形态。
- 进行中 / 错误：停止请求飞行中禁用、失败 toast `:49629`（同上第 2 节引用）。
- hover / active：xterm 容器靠属性选择器着色，`terminal-panel-e74d48fceaac.css` 首部含 `[data-codex-xterm] .xterm-viewport:hover,` 与 `[data-codex-xterm] .xterm-viewport:active` 两条 `scrollbar-color` 规则。
- IME：`xterm-window-zoom-c5f205b956c2.js` 含 `compositionstart` 与 `isComposing` 处理（该 chunk 无 i18n 串，只能证明存在处理逻辑）。
- 改名 / 分屏 / 每页签 cwd：`未确立`（抽取集内无对应元素）。

## 8. 浏览器预览

- 空态：`tab-content-9f89d8c9429a.js:48638 → "id:\`thread.browser.emptyState.title\`,defaultMessage:\`Start browsing\`"`（同窗口含 `"aria-hidden":!0` 的引导图标）。
- 常规：地址栏占位 `:243128 → "id:\`thread.browser.addressPlaceholder\`,defaultMessage:\`Search or enter a URL\`"`。
- 模式切换：批注模式提示 `:24196 → "id:\`thread.browser.commentMode\`,defaultMessage:\`Annotate this page\`"`。
- 菜单打开：扩展菜单标题 `:73276 → "id:\`thread.browser.extensions.titleWithCount\`,defaultMessage:\`Extensions ({count, number})\`"`；设备工具栏动作 `:124300 → "id:\`thread.browser.deviceToolbar.rotate\`,defaultMessage:\`Rotate viewport\`"`。
- 加载：`:74146 → "id:\`thread.browser.extensions.loading\`,defaultMessage:\`Loading extensions\`"`（后接 UTF-8 省略号）。
- 错误：`thread.browser.extensions.loadError` / `menuError` / `openError` / `pinError` 同族（同一 chunk 的相邻 defineMessage 群）。
- hover / 选中、页签条顺序：`未确立`。

## 9. 设置

- 常规：入口命令 `command-messages-8aed160be7f9.js:15808 → "\"codex.command.settings\":{id:\`codex.command.settings\`,defaultMessage:\`Settings\`"`；具体设置行示例 `agent-settings-e300d87c4341.js:22681 → "id:\`settings.agent.modelFeatures.reasoningEfforts.label\`,defaultMessage:\`Available reasoning efforts\`"`；权限模式开关行 `general-settings-f15dc60e0a6e.js:42330 → "id:\`settings.agent.permissionsMode.fullAccess.toggle\`,defaultMessage:\`Show Full access in the composer\`"`。
- 加载：有文案证据的加载态是快捷键页 `keyboard-shortcuts-settings-1cbab89b1766.js:14441 → "ttings.keyboardShortcuts.loading\`"`；`settings-loading-row` chunk 不含 i18n 串，骨架行结构 `未确立`。
- 空态 / 无匹配：`keyboard-shortcuts-settings-1cbab89b1766.js:14696 → "…keyboardShortcuts.noMatches\`,defaultMessage:\`No matching shortcuts\`"`。
- 交互：录制控件 `:15734 → "captureAriaLabel:i.formatMessage({id:\`settings.keyboardShortcuts.captureAriaLabel\`"`。
- 脏态 / 离开确认：`settings-unsaved-changes-dialog-9e83a59b7449.js:613 → "id:\`settings.unsavedChanges.discardTitle\`,defaultMessage:\`Discard changes?\`"`。
- 错误：账号安全类确认 `security-settings-8557ec6efc36.js:104322 → "id:\`settings.chatGpt.security.sessions.trustedTitle\`,defaultMessage:\`Log out and remove trusted device?\`"`；写入失败族 `settings.keyboardShortcuts.updateError`（同 chunk）。
- hover / 选中：走通用 `aria-selected` 与 `hover:` 工具类；逐组件配色 `未确立`。

## 10. Skills

- 常规：入口 `command-messages-8aed160be7f9.js:17379 → "id:\`codex.command.openSkills\`,defaultMessage:\`Go to skills\`"`；重载 `:17228 → "…forceReloadSkills\`,defaultMessage:\`Force reload skills\`"`。
- 回合内使用标记：`local-conversation-turn-da7740c9e58b.js:67983 → "id:\`assistantMessage.usedSkills.label\`,defaultMessage:\`Skills\`"`，来源标签为 System / Custom / Plugin 三态（同 chunk 的 `usedSkills.source` / `pluginSource`）。
- 错误：`composer-e6678c36fa14.js:2033 → "(0,\`span\`,{role:\`alert\`,children:(0,V.jsx)(t,{id:\`browserSkills.submissionFailed\`,defaultMessage:\`Selected skills couldn't be checked. Please try agai…\`"`。
- 空态 / 加载：`未确立`（技能管理页主体在未抽取 bundle）。

## 11. 自动化

- 常规：管理入口 `command-messages-8aed160be7f9.js:17057 → "id:\`codex.command.manageTasks\`,defaultMessage:\`Manage scheduled tasks\`"`；频率段 `automation-frequency-section-897535dc7d40.js:21286 → "id:\`inbox.automations.customInterval.label\`,defaultMessage:\`Every\`"`。
- 暂停 / 恢复：`automations-page-514a265389d9.js:32584 → "resume:{id:\`inbox.automations.resumeTooltip\`,defaultMessage:\`Resume\`"`（同对象含 `pause`）。
- 菜单打开：命令项形态 `local-conversation-thread-666070b6dc20.js:159639 → "id:\`resume-automation\`,enabled:!_,message:Ve({id:\`inbox.automations.resumeTooltip\`"` —— `enabled` 直接取反于当前状态。
- 删除确认：`automation-delete-confirmation-dialog-2c4cf06544c7.js:552 → "id:\`inbox.automations.deleteConfirm.title\`,defaultMessage:\`Delete {name}?\`"`（配套 `Cancel` / `Delete scheduled task` / 说明句）。
- 加载 / 错误：`automations-page-514a265389d9.js:50225 → "id:\`inbox.automations.cloud.loadError\`,defaultMessage:\`Cloud scheduled tasks could not be loaded\`"`；写入失败 `local-conversation-thread-666070b6dc20.js:157821 → "id:\`inbox.automations.updateError\`,defaultMessage:\`Could not update scheduled task\`"`。
- 本地列表空态：`未确立`。

## 12. Inbox

- 常规：行菜单项 `automations-page-514a265389d9.js:16521 → "{id:\`inbox.contextMenu.markRead\`,defaultMessage:\`Mark as read\`"`（同族 `markUnread`；菜单数组按条件拼接，见同一字节窗口的 `n?{...}:[]` 形态）。
- 状态：任务态标签集见第 2 节（`chatStatusApproval` / `chatStatusRunning` / `chatStatusUnread`）。
- 空态 / 加载 / 错误：`未确立`（页面主体未抽取）；可确认错误族是第 11 节的 `inbox.automations.*Error`。

## 13. 状态栏

- 抽取集内**未找到**与 Pi 状态栏同位的常驻底栏元素。可见的邻近元素是停靠面板开关 `command-messages-8aed160be7f9.js:17827 → "…toggleBottomPanel\`,defaultMessage:\`Toggle bottom panel\`"` 与浮动态 `quickChat.working`（第 3 节）。整节 `未确立`。

## 14. 对话框

- 确认类：删除 `automation-delete-confirmation-dialog-2c4cf06544c7.js:552`；丢弃改动 `settings-unsaved-changes-dialog-9e83a59b7449.js:613`；重跑确认 `local-conversation-thread-666070b6dc20.js:215707 → "…retryDialogConfirm\`,defaultMessage:\`Stop and retry\`"`（同群含 `retryDialogTitle`、`retryDialogKeepWaiting`）。
- 命令面板（亦为对话框）：标题 `command-menu-dialog-f4afbe0b2985.js:38685 → "dialogTitle:{id:\`codex.commandMenu.title\`,defaultMessage:\`Command menu\`"`；分组标题 `:37901 → "panels:{id:\`codex.commandGroup.panels\`,defaultMessage:\`Panels\`"`（该 dialog 定义 app / configure / navigation / panels / skills / thread / workspace 共 7 组）；加载 `:28904 → "…role:\`status\`,children:(0,Q.jsx)(p,{id:\`codex.commandMenu.loadingChats\`"`；无结果 `:16897 → "…commandMenu.noResults\`,defaultMessage:\`No matches\`"`；会话搜索占位 `:38874 → "…chatSearchPlaceholder\`,defaultMessage:\`Search chats\`"`；空列表 `:27498 → "defaultMessage:\`Create a chat to get started!\`"`。DOM 靠 cmdk 契约属性组织（`:6346 → "closest(\`[cmdk-root]\`)"`）。
- 遮罩、层级、进出场动画：`未确立`（Dialog 基元在未抽取 bundle，只见 `height:\`content\`` 之类 prop 痕迹）。

## 汇总：不可声称保真的项目

1. 精确 JSX 嵌套与元素顺序（例外：第 6 节文件行/按钮族的调用形态、第 7 节终端行的 `Item` 组合顺序、第 4 节的条目分类顺序）。
2. 逐组件断点与响应式行为（只有 token：`--height-toolbar*`、`--spacing-token-sidebar`）。
3. 动画时长与缓动（第 0 节 `tab-content-1eaf1dfbd620.js:37731` 给出 opacity/scale 目标值，但未给出 duration/easing）。
4. 条件渲染逻辑（memo 缓存槽 `t[N]===x?y=t[N+1]:(…)` 是 React 编译产物形态，不证明业务条件）。
5. 截断与换行策略（个别 `truncate` / `whitespace-pre-wrap` 类名可见，逐组件规则不可归因）。
6. 图标字形（`manifest.json` 登记跳过 `*.svg`；只见 `LeftIcon` / `leadingVisual` 等 prop 名）。
7. 侧栏、应用外壳、本地 composer、inbox 页、技能管理页的完整状态集：主体在未抽取的 `app-shared-*.js` / `app-initial-*.js` / `app-primary-*.js`。
8. 终端改名 / 分屏 / 每页签 cwd、diff 额外上下文展开、浏览器 devtools 与元素选择器：抽取集内未找到对应元素（既不能说存在，也不能说参考端没有）。
