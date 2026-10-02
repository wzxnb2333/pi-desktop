# Pi Desktop 渲染层接口约定（WP0 冻结）

拆分后每个工作包只允许改自己拥有的文件。本文件是跨包契约；`AppState` 的字段在 WP0 之后不得增删改签名，
需要新能力请写成跟进项交给 WP8，不要直接改 `state/app.tsx`。

## 字号阶梯（WP1 后澄清，勿再改动方向）

`styles/tokens.css` 的 `--font-{2xs,xs,sm,md,lg}` 是以 16px 根为基的 **rem 字面量**，刻意校准成复刻 Pi 原有的 px 字面值（`--font-xs` = .75rem = 12px、`--font-sm` = .875rem = 14px 等）。

**用户的「字号」设置从来不影响显式定字号的控件**：迁移前 `.composer-actions select{font-size:11px}`、`.badge{font-size:10px}` 都是硬编码 px，`--font-size` 只作用于无显式字号的继承文本。所以：

- 把阶梯改成 `calc(var(--font-size) * k)` 缩放**不是修复，而是回归**——会让一批从未响应过该设置的控件突然开始缩放。
- `Button`/`Menu` 用阶梯取字号是正确做法，迁移控件不构成行为变化。
- 若将来真要「字号影响全局」，那是一项独立的产品决定，需单独立项并同步 e2e 基线，不要顺手夹带。

## 已知遗留（WP1 交回协调者）

- **`--selected` 与 `--hover` 在浅色下都是 5% 强度**，两者不可分辨。WP1 已给 `.selected` 加 `box-shadow: var(--elevation-stroke)` 兜住选中态；但依赖 `--hover` 的 `.active` 态在浅色下仍与 hover 相同，分布在 `.icon-button.active`、`.terminal-tabs button.active`、`.composer-footer button.active`、`.settings-nav button.active`、`.review-tabs > button.active`——归 WP2/WP3/WP6/WP7 各自处理，不要都推给 WP8。
- **`design-tokens.json` 的 `themeOverrides.dark` 存的是未解析的 `var()` 引用**（如 `--color-text` 暗色写作 `var(--gray-850)`），按浅色值解析会得到 #1c1c1c 而真实暗色是 #dfdfdf。因此 **fidelity 报告第 1 层不得比对自定义属性的字符串值**：改为在真实元素上读 `getComputedStyle` 的**已用值**（如某元素的 `color`/`background-color`/`height`），由浏览器完成 var 链、`color-mix`、`oklch` 的解析；结构刻度（`46px`、`.25rem` 这类字面量）才做直接串比对。
- `--menu-separator-gutter` 已随阶梯落盘但无消费者（Pi 目前没有需要分隔线的菜单）；`--elevation-composer-inner` 浅色下必须是 `0 0 #0000` 而非 `none`（`none` 在逗号分隔的 box-shadow 列表里非法，会整条失效），组合写法 `box-shadow: var(--elevation-composer), var(--elevation-composer-inner)`。
- `.titlebar` 是 42px（`shell.css:61` 附近），`.toolbar` 是 51px；参考端 `--height-toolbar` = 46px 指的是哪一个尚未裁定，WP8 消费该 token 前必须先定案，否则会改错元素。
- **`IconButton` 的 `size` 是部分空转**（WP7 发现，已复核）：`utilities.css` 只有 `button.btn-icon.btn-{4xs,2xs}` 两条尺寸规则，`.icon-button{width:30px;height:30px}`（`shell.css:61`）对其它值兜底，所以 `size="sm"`/`"md"` 等**静默无效**。WP7 已改回不传 `size`。协调者在检查点补齐 3xs/xs/sm/md 阶梯或收窄该 prop 类型；在此之前各包不要依赖 `size` 取非 4xs/2xs 的尺寸。
- `utilities.css` 里为 FieldRow 的 `<span>` 辩护的注释已过时：它称「`management.css` 给 `label small` 定了样式」，而那条全局 `label` 泄漏样式已随 WP7 重写移除，现由 `.field-block small` 承担。检查点一并清掉该注释。
- 契约注释已同步：`contracts.ts` 关于 `settings.save` 的说法从「拆掉所有热 worker」改为「在 worker 可见组变化时拆」，与 WP7 的收窄一致。
- **`provider.key` 现在会在该模型的线程 running/waiting 时拒绝写 key**。这是 WP7 超出指派的安全决定，我认可并保留：`AgentHost.dispose()` 会杀掉 utility 进程并把线程标成 interrupted，为一个换 key 操作打断正在跑的任务，正是本次重构要避免的那类危害。

## 文件所有权（WP1 后更新）

| 包 | 唯一可改文件 |
|---|---|
| WP1 | **已完成**：`styles/{tokens,base,utilities,index,highlight}.css`、`components/primitives/*`、`test/e2e/{primitives.spec.ts,fixtures/primitives-harness.tsx}`。按协调者指示另改了 `components/timeline/message.tsx`（接 rehype-highlight）、`components/panels/review-panel.tsx`（换 Tabs）、`styles/index.css`（导入 highlight.css）——这三处原列 WP4/WP5/WP8，现已由 WP1 落地，后续包改它们前须先读现状 |
| WP2 | `components/sidebar/*`、`styles/sidebar.css`、`hooks/use-thread-list.ts`、`test/thread-list.test.ts` |
| WP3 | `components/composer/*`、`styles/composer.css` |
| WP4 | `lib/timeline-groups.ts`、`components/timeline/*`、`styles/timeline.css`、`test/timeline-groups.test.ts`、`src/main/application.ts` 的通知归并一处 |
| WP5 | `lib/diff.ts`、`components/panels/{diff,review-panel}.tsx`、`styles/panels.css`、`test/diff.test.ts` |
| WP6 | `components/panels/{terminal-section,preview-panel}.tsx`、`TerminalPanel.tsx`、`styles/{terminal,preview}.css` |
| WP7 | `Settings.tsx`、`components/management/*`、`styles/{settings,management}.css`、`src/main/application.ts` 的 settings.save/provider.key |
| WP8 | 以上全部 + `App.tsx`、`state/app.tsx`、`styles/index.css`、`test/e2e/*` |

禁止触碰：别人的样式表、`App.tsx`、`state/app.tsx`、`styles/index.css`、`src/shared/contracts.ts`、`src/main/*`（除上表列明者）。
各包不要跑 `desktop:check`（它覆盖整个 workspace，会因别包在途文件报错）；纯模块跑自己的 `node:test`，UI 包跑自己的 e2e 文件。

## `useApp()` — `state/app.tsx`

单一状态源。持久化布局**只**存在于 `data.ui`，渲染层不再保存第二份副本；setter 发 IPC，主进程 40ms 内回声
`{type:'state'}` 后 `data` 更新。因此 setter 之后**同一帧内读不到新值**，需要连续写时用一次调用带多个字段
（见 `selectThread` 同时写 `activeThreadId` 与 `view`）。

```ts
data: DesktopData;              ui: UiState;              ready: boolean;
approvals: Approval[];          terminals: TerminalInfo[];
error: string;  setError(e: string): void;
invoke(req: DesktopRequest): Promise<unknown>;   // 失败时写 error 并抛出
act(req: DesktopRequest): void;                  // fire-and-forget，错误仍进 error
thread?: Thread;  project?: Project;  activeId: string;  running: boolean;
projectId: string;  setProjectId(id: string): void;             // 会话级，不持久化
selectThread(t: Thread): void;                  // 写 activeThreadId+view='thread'，清 text/附件，重置跟随滚动
createThread(projectId?, worktree?): Promise<Thread|undefined>;
addProject(): Promise<void>;
upsertTerminal(t: TerminalInfo): void;          // 见下方“终端标题”

view / setView            持久化   'thread'|'settings'|'skills'|'automations'|'inbox'
sidebarOpen / setSidebarOpen   持久化
reviewOpen  / setReviewOpen    持久化
showArchived / setShowArchived 持久化
diffSplit   / setDiffSplit     持久化   统一/并排差异视图
setActiveThread(id: string)    持久化
reviewTab / setReviewTab       持久化(按任务)  'changes'|'files'|'plan'|'artifacts'
terminalOpen / setTerminalOpen 持久化(按任务)
selectedPath / setSelectedPath 持久化(按任务)

text / setText;  attachments / setAttachments;              // 会话级
search / setSearch;  searchOpen / setSearchOpen;            // 会话级（Ctrl+K 需要，见下）
composerRef;  timelineRef;  previewSurfaceRef;  followRef;  // followRef 即原 autoScroll
```

`terminalOpen`/`reviewTab`/`selectedPath` 是**按任务**的：读 `data.ui.threads[activeId]`，缺省
`{reviewTab:'changes', terminalOpen:false, selectedPath:''}`。宽度/显隐是**全局**的，不要按任务存。

## 持久化契约 — `src/shared/contracts.ts`

```
ui: sidebarWidth 240..520 默认 275 | reviewWidth 280..760 默认 390 | terminalHeight 120..800 默认 240
    sidebarOpen reviewOpen view activeThreadId showArchived diffSplit
    threads: Record<threadId, {reviewTab, terminalOpen, selectedPath}>
```
两个 op（zod 4 的 discriminatedUnion 不允许重复判别值，所以不能合成一个 `ui.update`）：
`{op:'ui.update', ui}` 整棵全局树替换（主进程保留 `threads` 并集）；
`{op:'ui.threadUpdate', threadId, thread}` 整棵任务子树替换。都不碰 worker。
`dataSchema.version` 仍是 `1`：所有字段带默认值，旧 `desktop.json` 直接解析出默认布局。

## 布局夹取 — `lib/layout.ts`

`layoutBounds(key, viewportWidth)`、`clampLayout(key, value, viewportWidth)`、`resizeStep(...)`。
侧栏上限是 `min(520, viewport - 320)`，与参考端
`clamp(240px, var(--codex-sidebar-preferred-width,275px), min(520px, calc(100vw - 320px)))` 一致。
**不要**再写 `@media` 里的宽度 `!important`：它会压过内联尺寸，让持久化布局静默失效（这正是原来 1100px 断点的毛病）。

## 字号基准（已定案，勿改）

`:root{font-size:16px}`，`body{font-size:var(--font-size)}`。参考端所有 rem token 以 16px 为基，
用户的“字号”设置（12–20，默认 14）作用在 body 上。已用 e2e 基线证明该改动像素中性。
新增文字尺寸请走 `--font-text-*` token，不要混用 px 与 rem。

## 组件签名

```
<Sidebar width={number} />
<Composer />                                   // 无 props，全部走 useApp
<Timeline />                                   // 含欢迎页、回合渲染、审批卡、运行中提示
<ReviewPanel width={number} />                 // 内部持有 git/diff/file/files 状态
<TerminalSection height={number} />            // focused 页签为会话级
<PreviewPanel onClose():void />                // 卸载时自动 preview.close
<InboxPage/> <SkillsPage/> <AutomationsPage/>
<Toolbar previewOpen={boolean} setPreviewOpen(open:boolean):void />
<Titlebar/> <StatusBar/> <ErrorBanner/>
<Resizer label axis:'horizontal'|'vertical' keyName:ResizeKey value invert? onDrag onCommit />
<IconButton label onClick active? disabled? />
<Diff text split />                            // WP5 替换其实现，保留 .diff 类名与 '+xxx' 文本
<FilePreview file />
```

## 必须保持的行为（e2e 依赖，改了就破测）

- 可访问名：`向 Pi 发送消息`、`待审批操作`、`允许这一次`、`拒绝`、`刷新 Git`、`集成终端`、`新建终端`、
  `终止终端`、`隐藏终端`、`浏览器预览`、`预览地址`、`关闭预览`、`搜索任务`、`归档任务`/`恢复任务`、
  `打开编辑器`、`切换侧栏`、`切换 Review 面板`、`关闭错误提示`、`添加项目`、`复制地址`、`在浏览器打开`、`刷新预览`。
- 类名：`.thread-row`、`.terminal-tabs`、`.diff`、`.statusbar`（e2e 用它做遮罩）。
- 终端标题：`terminal.open` 的返回值带真实标题（PowerShell/命令提示符/Git Bash），事件流里是占位 `终端`。
  新建后必须 `upsertTerminal(result)`，否则页签文字断言失败——WP0 就踩过这个坑。
- 快捷键 `Ctrl+N/K/,/J` 与 `Escape` 关预览由 `components/shell/workspace.tsx` 统一注册；
  `searchOpen` 之所以在 provider 而不是 Sidebar 内部，是因为侧栏折叠时该组件根本没挂载，Ctrl+K 必须仍能展开它。
- `selectThread` 必须同时把视图切回 `thread` 并清理草稿与跟随滚动。
- 切换任务时 Review 面板要清掉上一个任务的 diff/文件预览（`review-panel.tsx` 里按 `activeId` 的 effect）。

## 不变的能力边界

`src/shared/contracts.ts` 的 39 个 op 加 `ui.update`/`ui.threadUpdate` 是渲染层唯一出口；
`src/shared/worker-protocol.ts` 的 8 个事件是时间线唯一事实源。任何需要新 op/字段/事件的参考端界面，
按 `docs/desktop/capability-matrix.md` 判 OMIT，不要伪造数据或加空壳功能。

模型侧边界（2026-10 扩展，取代此前「不读取其他会话内容」的表述）：

- 模型可以读工作区任意会话的用户/助手正文（`read_sessions`），搜索同一字段面；不返回思考、工具参数、
  差异、草稿、凭据或其他会话的运行状态，结果有上限并按侧栏可见性过滤（排除审查会话、子任务、临时侧聊、已删除）。
- 跨会话写入只有「发消息」一种（`send_to_session`）：`ask` 策略弹审批，`auto`/`full` 直接发送，`deny` 与计划模式拒绝。
- 模型永远不能改写自己的权限面：`policy`、`planMode`、工具策略、沙箱设置、审批结果、`provider.key`、
  `mcp.secret`、插件安装与 `terminal.input` 都不在工具 schema 与目录里（`src/shared/desktop-tools.ts`
  的 `forbiddenDesktopFields`/`forbiddenDesktopOps` 由 `test/desktop-tool-surface.test.ts` 看守）。
