# Pi Desktop 非视觉验收报告

源码基准：Windows 26.917.9434.0；归档应用 26.917.71314。Satang 捕获基准：26.915.4065.0 / app 26.915.31945；两版分别验证，不合并为一个整窗像素基准。
测试开始时间：2026-09-26T13:11:52.614Z。生成命令：node apps/desktop/scripts/fidelity-report.mjs --results-only。

## 实际结果

- 通过 404；失败 0；跳过 0；重试后通过 0。
- 读取已完成的机器结果，不重新运行用例。机器结果：.artifacts/desktop-nonvisual-results.json。
- 截图、视频、trace 均关闭；不加载旧 visual.spec.ts 或 desktop.spec.ts。

## 比较范围

参考侧使用原始 CSS、源码确定的桌面 DOM、宿主属性和白名单纯主题函数。Pi 侧加载实际 App 和实际样式；合同不读取 Pi 组件或 Pi 样式。
浅色、深色、system-light、system-dark × 1000×640、1280×800、1440×940，共 12 组。
26.917 合同继续比较工作栏、主区域矩形及对话输入框、发送按钮、设置行的 computed style。标题栏、侧栏、首页和 Review 条改用下述 Satang 捕获合同。26.917 被比较的 CSS px 和矩形属性容差为 0.5px，其他值精确比较。
Satang 保存 34 组独立 DOM 捕获：欢迎页4组、外壳/侧栏4组、命令面板4组、设置/终端/浏览器12组、Review4组、管理4组、workspace2组。除 workspace 为宽窗明暗样式外，其余均为浅色/深色 × 1440×940 / 1000×700。外壳与首页所列矩形容差0.5px；命令面板比较位置/宽度、输入行/结果行高度及所列样式；辅助面板比较条高与内边距，地址输入框另比较高度与所列样式；设置比较标题纵向位置、字体、容器宽度上限和卡片圆角，宽度允许1px滚动条差异。这里没有比较每页所有节点或完整页面高度。
22组样本使用pinned记录；命令面板的2组1000px及Review/管理/workspace的10组采用较早有效捕获。Review比较两行标题、过滤、文件头及右侧文件树；管理比较标题、搜索、分段过滤和空态；workspace比较气泡、通知、计划及正文间距，并验证有界计划可滚动到最后步骤。原始文件SHA-256、节点索引及矩形/样式保存在各satang-*-reference.json和satang-reference.json；命令、搜索结果、设置字段和管理功能仍使用Pi真实语义。
另有 84 组原始源码表面样本：菜单及选中/禁用行、Tooltip、确认框及按钮、用户消息气泡、助手正文、普通表格和默认代码块。逐节点比较矩形、字体、颜色、圆角、阴影、内外边距、溢出与状态；对话框另比较 hover、disabled 和 focus-visible。代码块复制失败恢复、键盘换行、表格列对齐及窄宿主滚动另作行为回归。
对话折叠另有 48 组独立源码样本：标题/正文、活动组、文件行、diff外框及文件头。比较所列节点的矩形与21项计算样式；原始折叠箭头路径、300ms过渡曲线、1000ms摘要节流及即时完成另作断言。diff内部使用Pi真实工具结果，不在厂商完整diff几何等同性范围。
审批与加载另有 8 组26.917源码补充样本，明确不冒充缺失的26.915现场捕获。审批比较宽/窄容器、明暗及跟随系统的卡片、文本、操作区和按钮样式；四种真实Pi回复类型另测IPC内容、重复提交、失败保留草稿与重试。加载比较居中容器、56px标识及间距，保留Pi品牌与状态/错误文本，并验证bootstrap完成和失败。
真实Electron另验证延迟工具调用、思考、审批、编辑diff、文件打开、停止/失败恢复，以及展开选择在任务切换、renderer重载和进程重启后恢复。见 conversation-folding.md。
另测组合面板、键盘及指针拖动、任务布局、实时系统主题、图标路径和提示浮层。Electron 以开发模式加载当前源码，使用临时项目、临时用户目录和假供应商。

## 边界

本报告不是整窗像素一致率。代码块合同不覆盖全部图标和语法高亮；表格合同不覆盖粘性表头和实验分支。字体栅格化、原版功能旗标及Pi专用表单没有端到端等同性证据。Satang pinned workspace/management实际显示旧会话加载失败，pinned review缺失；已用较早有效DOM和已有实现继续移植。workspace参考图可视区只有通知和diff，正文与计划的来源为屏外DOM。审批/加载使用独立26.917源码补充。本请求累计20/20次图像识别，逐次登记见satang-ui-image-ledger.json；全范围复核及限制见satang-completion-audit.md、satang-b09.md与remaining-differences.md。

## 用例

| 用例 | 结果 |
| --- | --- |
| Skills create, import, disable, re-enable and remove through the real desktop | 通过 |
| MCP settings test stdio transport, encrypt secrets and preserve controls after restart | 通过 |
| resource creation and MCP secret changes obey running-task guards | 通过 |
| automation UI creates, pauses, resumes, runs, reviews and removes a job | 通过 |
| simultaneous automation runs create one active task | 通过 |
| provider error recovers and stop aborts streaming without blocking later turns | 通过 |
| follow-up and steering queues run exactly once | 通过 |
| interrupted sessions resume after restart and worker termination | 通过 |
| fifty sequential turns preserve history and keep one worker | 通过 |
| file operations, approved rollback and worktree application preserve the parent project | 通过 |
| ordinary settings save validates and encrypts MCP secrets before restart | 通过 |
| close exits when tray persistence is disabled | 通过 |
| close hides with tray persistence enabled and second-instance restores the window | 通过 |
| renderer termination reloads persisted conversation without losing the worker | 通过 |
| extension confirmation, selection and input resolve through real approval cards | 通过 |
| text attachments enter the model context and invalid attachments fail before network access | 通过 |
| native Chromium composition commits Chinese text without sending candidate Enter | 通过 |
| running and completed defaults respect explicit nested choices and unknown thinking time | 通过 |
| completed thinking keeps its measured duration and post-answer notices remain outside the folded process | 通过 |
| folding preserves a reader anchor and follows new output only while pinned | 通过 |
| disclosure uses source transition duration and removes collapsed interactive content | 通过 |
| light 1000x640 row source activity | 通过 |
| light 1000x640 group source activity | 通过 |
| light 1000x640 file source activity | 通过 |
| light 1000x640 diff source activity | 通过 |
| dark 1000x640 row source activity | 通过 |
| dark 1000x640 group source activity | 通过 |
| dark 1000x640 file source activity | 通过 |
| dark 1000x640 diff source activity | 通过 |
| system-light 1000x640 row source activity | 通过 |
| system-light 1000x640 group source activity | 通过 |
| system-light 1000x640 file source activity | 通过 |
| system-light 1000x640 diff source activity | 通过 |
| system-dark 1000x640 row source activity | 通过 |
| system-dark 1000x640 group source activity | 通过 |
| system-dark 1000x640 file source activity | 通过 |
| system-dark 1000x640 diff source activity | 通过 |
| light 1280x800 row source activity | 通过 |
| light 1280x800 group source activity | 通过 |
| light 1280x800 file source activity | 通过 |
| light 1280x800 diff source activity | 通过 |
| dark 1280x800 row source activity | 通过 |
| dark 1280x800 group source activity | 通过 |
| dark 1280x800 file source activity | 通过 |
| dark 1280x800 diff source activity | 通过 |
| system-light 1280x800 row source activity | 通过 |
| system-light 1280x800 group source activity | 通过 |
| system-light 1280x800 file source activity | 通过 |
| system-light 1280x800 diff source activity | 通过 |
| system-dark 1280x800 row source activity | 通过 |
| system-dark 1280x800 group source activity | 通过 |
| system-dark 1280x800 file source activity | 通过 |
| system-dark 1280x800 diff source activity | 通过 |
| light 1440x940 row source activity | 通过 |
| light 1440x940 group source activity | 通过 |
| light 1440x940 file source activity | 通过 |
| light 1440x940 diff source activity | 通过 |
| dark 1440x940 row source activity | 通过 |
| dark 1440x940 group source activity | 通过 |
| dark 1440x940 file source activity | 通过 |
| dark 1440x940 diff source activity | 通过 |
| system-light 1440x940 row source activity | 通过 |
| system-light 1440x940 group source activity | 通过 |
| system-light 1440x940 file source activity | 通过 |
| system-light 1440x940 diff source activity | 通过 |
| system-dark 1440x940 row source activity | 通过 |
| system-dark 1440x940 group source activity | 通过 |
| system-dark 1440x940 file source activity | 通过 |
| system-dark 1440x940 diff source activity | 通过 |
| disclosure keeps independent explicit choices after remount and excludes hidden focus targets | 通过 |
| active summary changes are throttled but completion is immediate | 通过 |
| native find reports ordinals, cycles both directions and rejects stale results and IME intermediates | 通过 |
| loading a new document defers the latest query until its content arrives | 通过 |
| queries stay with their native tab through navigation, tasks, panel hide and renderer reload | 通过 |
| address validation is local, drafts survive tab navigation and copying uses the loaded page | 通过 |
| browser find shortcuts save through settings and controls fit all three workbench widths | 通过 |
| the input grows with the content and caps out at ten lines | 通过 |
| the composer keeps the ported 22px radius while it grows | 通过 |
| the composer controls share the ported 28px size | 通过 |
| runtime controls are disabled while the task runs, and a send queues | 通过 |
| send needs both text and a provider | 通过 |
| a composing Enter reaches the handler without sending | 通过 |
| ctrl-enter mode ignores a bare Enter | 通过 |
| Shift+Enter inserts a newline instead of sending | 通过 |
| the attachment strip lists picks and removes one | 通过 |
| the menus open upward, out of the bottom-anchored composer | 通过 |
| plan mode is told apart from hover by a stroke and a weight, not by a fill | 通过 |
| a click opens with the current row focused and checked | 通过 |
| ArrowDown on the closed trigger opens it and focuses the first row | 通过 |
| Enter writes through thread.update and returns focus to the trigger | 通过 |
| Escape closes without selecting and restores focus | 通过 |
| a pointerdown outside closes without selecting | 通过 |
| a click opens with the current row focused and checked | 通过 |
| ArrowDown on the closed trigger opens it and focuses the first row | 通过 |
| Enter writes through thread.update and returns focus to the trigger | 通过 |
| Escape closes without selecting and restores focus | 通过 |
| a pointerdown outside closes without selecting | 通过 |
| a click opens with the current row focused and checked | 通过 |
| ArrowDown on the closed trigger opens it and focuses the first row | 通过 |
| Enter writes through thread.update and returns focus to the trigger | 通过 |
| Escape closes without selecting and restores focus | 通过 |
| a pointerdown outside closes without selecting | 通过 |
| late tool calls preserve provisional prose and final collapse; choices survive task changes, reload and restart | 通过 |
| edit waits for approval and shows real diff; write reports no invented additions | 通过 |
| stopping and provider failures leave process visible and recovery creates a new final answer | 通过 |
| Windows desktop: streaming, approvals, review, terminals, preview, themes and restart | 通过 |
| first run registers a project and saves a model key through Windows encryption | 通过 |
| file tree supports one tab stop, complete keyboard navigation, typeahead and composition guards | 通过 |
| directory expansion and breadcrumb scope survive refresh, task changes and application restart | 通过 |
| directory failures offer retry, empty folders are explicit and removed focus falls back to its parent | 通过 |
| Unicode directory names with spaces retain valid accessibility references and an empty tree stays focusable | 通过 |
| file search clears obsolete results, defers Chinese composition and opens actual content locations | 通过 |
| search failures remain actionable and configured tree shortcuts persist without intercepting text editing | 通过 |
| search paginates beyond two hundred matches, retains previous pages and opens the selected line | 通过 |
| search cancellation keeps the interface responsive and obsolete requests cannot overwrite another query or task | 通过 |
| content search reports unsupported files and finds content beyond the editor preview limit | 通过 |
| an exactly full final page keeps keyboard focus and disabled pagination cannot restart scanning | 通过 |
| Git history discards late selections, retries reads and restores keyboard focus | 通过 |
| Git file and conflict reads stay attached to the selected path and range | 通过 |
| Git inspection, diff and conflict failures have independent retry controls | 通过 |
| Git status refresh ignores superseded responses and surfaces recovery | 通过 |
| remote tracking and upstream use the selected remote reference and separate local name | 通过 |
| Review filters live files, preserves the selected diff and exposes Git controls from the header | 通过 |
| Git workbench fetches real remote branches, tracks an explicit name and preserves active task directories | 通过 |
| Git workbench shows real conflict versions, edits a resolution and continues the merge | 通过 |
| automation edits preserve authoritative runtime history across an active run and restart | 通过 |
| review actions reject active and approval-waiting tasks and new results return to pending | 通过 |
| inbox batch review persists, retries failed jobs and preserves results after deleting a schedule | 通过 |
| review selection is scoped to the visible filter and drops tasks that become active | 通过 |
| batch review preserves partial failures and retries only unfinished visible tasks | 通过 |
| automation form validates fields, serializes submits and retains the draft after a failed save | 通过 |
| automation history and deletion support keyboard dismissal and focus restoration | 通过 |
| management search combines with status filters and scopes review selection | 通过 |
| automation list filters real schedules and returns focus after cancelling an edit | 通过 |
| MCP validates fields before saving and preserves explicit empty argument values | 通过 |
| MCP saves once, ignores edited configuration results and validates test responses | 通过 |
| MCP cancellation and unmount discard obsolete responses and running tasks disable tests | 通过 |
| MCP task reconnect shows failures, retries once and requires saving edited settings | 通过 |
| MCP long tool names, errors and endpoints remain contained in supported themes and sizes | 通过 |
| MCP task tools recover after service exit, worker exit and application restart | 通过 |
| MCP rejected tool discovery recovers from saved configuration and running guards remain enforced | 通过 |
| assistant file links support line columns, repeated keyboard navigation, dirty buffers and restart | 通过 |
| unavailable links are not dead controls and file links retain the main-process path boundary | 通过 |
| rapid conversation and summary links append native tabs without replacing the conversation or existing pages | 通过 |
| file links preserve independent task locations and restore them after task switches | 通过 |
| modified link activation keeps external browser and editor actions available without internal tab side effects | 通过 |
| exclusive connection modes persist across Electron restarts and reach only the fake provider | 通过 |
| allowed thinking levels reach the provider and persist through model changes and Electron restart | 通过 |
| pane headers preserve their captured Review and terminal strip heights | 通过 |
| hiding the pane keeps the pty and the xterm, killing does not | 通过 |
| closing a tab deselects without touching the process | 通过 |
| 终止终端 is the only control that reaches the process | 通过 |
| the terminal follows data-theme instead of a hard-coded colour | 通过 |
| switching tabs keeps each terminal its own screen and its own stdin | 通过 |
| the preview panel releases the native view when it unmounts | 通过 |
| opening a menu focuses the selected row and advertises the expanded state | 通过 |
| arrow keys move focus, wrap at both ends, and skip disabled rows | 通过 |
| Enter selects the focused row and returns focus to the trigger | 通过 |
| Space selects the focused row | 通过 |
| Escape closes the menu and restores focus to the trigger | 通过 |
| a pointerdown outside the menu closes it without selecting | 通过 |
| approval pinned source light card 736 | 通过 |
| approval pinned source light card 736 system | 通过 |
| approval pinned source light card 320 | 通过 |
| approval pinned source light card 320 system | 通过 |
| approval pinned source dark card 736 | 通过 |
| approval pinned source dark card 736 system | 通过 |
| approval pinned source dark card 320 | 通过 |
| approval pinned source dark card 320 system | 通过 |
| approval action preserves reply data, suppresses duplicate submits and recovers failure | 通过 |
| approval confirm preserves reply data, suppresses duplicate submits and recovers failure | 通过 |
| approval input preserves reply data, suppresses duplicate submits and recovers failure | 通过 |
| approval select preserves reply data, suppresses duplicate submits and recovers failure | 通过 |
| long approval remains readable and keyboard-scrollable in a compact window | 通过 |
| loading light 1000 uses pinned container and reaches real workspace | 通过 |
| loading light 1440 uses pinned container and reaches real workspace | 通过 |
| loading dark 1000 uses pinned container and reaches real workspace | 通过 |
| loading dark 1440 uses pinned container and reaches real workspace | 通过 |
| bootstrap failure exposes its full message without remaining busy or overflowing | 通过 |
| Satang project home light 1440×940 captured geometry | 通过 |
| Satang project home light 1000×700 captured geometry | 通过 |
| Satang project home dark 1440×940 captured geometry | 通过 |
| Satang project home dark 1000×700 captured geometry | 通过 |
| Satang home keeps project switching, suggestions, plan mode and draft restoration live | 通过 |
| Satang home retains model setup and global onboarding instead of copying Windows setup state | 通过 |
| Satang home long project names and expanding drafts stay usable in a narrow pane | 通过 |
| combined wide saved panes fit a 1000×640 window without losing controls | 通过 |
| splitter pointer and keyboard writes persist across task switches | 通过 |
| system theme follows live OS changes and settings use contextual navigation | 通过 |
| source icon paths and portal tooltips survive the clipped desktop surface | 通过 |
| a resize merges with pending navigation instead of restoring a stale layout | 通过 |
| Satang shell light 1440 captured geometry | 通过 |
| Satang shell light 1000 captured geometry | 通过 |
| Satang shell dark 1440 captured geometry | 通过 |
| Satang shell dark 1000 captured geometry | 通过 |
| titlebar navigation restores actual tasks and skips deleted destinations | 通过 |
| titlebar menus invoke existing search, panel and local information actions | 通过 |
| light 1000×640 original source contract | 通过 |
| dark 1000×640 original source contract | 通过 |
| system-light 1000×640 original source contract | 通过 |
| system-dark 1000×640 original source contract | 通过 |
| light 1280×800 original source contract | 通过 |
| dark 1280×800 original source contract | 通过 |
| system-light 1280×800 original source contract | 通过 |
| system-dark 1280×800 original source contract | 通过 |
| light 1440×940 original source contract | 通过 |
| dark 1440×940 original source contract | 通过 |
| system-light 1440×940 original source contract | 通过 |
| system-dark 1440×940 original source contract | 通过 |
| resource details ignore late success and failures after another selection or closing | 通过 |
| resource details retry failures, keep keyboard focus and protect composition dismissal | 通过 |
| creation submits once and keeps the draft after failure while mutations honor running tasks | 通过 |
| source inspection isolates stale responses, retries failures and avoids streaming refresh loops | 通过 |
| resource search, long source paths and details stay usable across themes and window sizes | 通过 |
| Satang workspace light 1440 source styles and accessible plans | 通过 |
| Satang workspace light 1440 system source styles and accessible plans | 通过 |
| Satang workspace light 1000 source styles and accessible plans | 通过 |
| Satang workspace light 1000 system source styles and accessible plans | 通过 |
| Satang workspace dark 1440 source styles and accessible plans | 通过 |
| Satang workspace dark 1440 system source styles and accessible plans | 通过 |
| Satang workspace dark 1000 source styles and accessible plans | 通过 |
| Satang workspace dark 1000 system source styles and accessible plans | 通过 |
| Satang palette light 1440 captured positioning and styles | 通过 |
| Satang palette light 1000 captured positioning and styles | 通过 |
| Satang palette dark 1440 captured positioning and styles | 通过 |
| Satang palette dark 1000 captured positioning and styles | 通过 |
| palette remains usable in short windows, with composition and keyboard selection | 通过 |
| Satang Review light 1440 captured structure with live Pi diff | 通过 |
| Satang Review light 1000 captured structure with live Pi diff | 通过 |
| Satang Review dark 1440 captured structure with live Pi diff | 通过 |
| Satang Review dark 1000 captured structure with live Pi diff | 通过 |
| Satang management 自动化 light 1440 captured layout with Pi controls | 通过 |
| Satang management 待审阅 light 1440 captured layout with Pi controls | 通过 |
| Satang management 自动化 light 1000 captured layout with Pi controls | 通过 |
| Satang management 待审阅 light 1000 captured layout with Pi controls | 通过 |
| Satang management 自动化 dark 1440 captured layout with Pi controls | 通过 |
| Satang management 待审阅 dark 1440 captured layout with Pi controls | 通过 |
| Satang management 自动化 dark 1000 captured layout with Pi controls | 通过 |
| Satang management 待审阅 dark 1000 captured layout with Pi controls | 通过 |
| Satang settings light 1440 captured geometry | 通过 |
| Satang settings light 1000 captured geometry | 通过 |
| Satang settings dark 1440 captured geometry | 通过 |
| Satang settings dark 1000 captured geometry | 通过 |
| Satang terminal light 1440 captured geometry | 通过 |
| Satang terminal light 1000 captured geometry | 通过 |
| Satang terminal dark 1440 captured geometry | 通过 |
| Satang terminal dark 1000 captured geometry | 通过 |
| Satang preview light 1440 captured geometry | 通过 |
| Satang preview light 1000 captured geometry | 通过 |
| Satang preview dark 1440 captured geometry | 通过 |
| Satang preview dark 1000 captured geometry | 通过 |
| conversation search reveals nested output, exact occurrences and thinking with reduced motion=false | 通过 |
| conversation search reveals nested output, exact occurrences and thinking with reduced motion=true | 通过 |
| search keyboard selection respects composition, empty results, literal queries and focus restoration | 通过 |
| edit differences can be found and opened without expanding raw arguments | 通过 |
| command palette navigates tasks, honors custom shortcuts and skips deleted closed tabs | 通过 |
| sidebar finds reasoning and reveals matched collapsed projects without changing preferences | 通过 |
| large search results remain reachable through pages and keep global occurrence indexes | 通过 |
| the settings page opens on the model category with a labelled row per field | 通过 |
| the category nav swaps one panel and keeps every control where it is | 通过 |
| keyboard overrides persist, reject conflicts and restore defaults | 通过 |
| saving reports success and refusal in the same status line | 通过 |
| built-in provider changes select a matching model and save no endpoint override | 通过 |
| custom mode has no provider input, keeps independent drafts, and survives settings remount | 通过 |
| missing and invalid custom URLs prevent a save and numeric capabilities are validated | 通过 |
| legacy endpoint overrides retain their original semantics until explicit conversion | 通过 |
| unlisted models are identified without silently changing the configured model | 通过 |
| catalog failures support retry and do not block a custom connection | 通过 |
| mode selection supports native keyboard navigation and removes hidden controls from focus | 通过 |
| allowed thinking levels support keyboard changes, validation, mode drafts and remount | 通过 |
| both connection forms stay within their columns across themes and window sizes | 通过 |
| rows carry the pinned Satang metrics: 30px high, 12.5px corner, 14px visible text | 通过 |
| the pane width follows the inline size instead of a CSS clamp | 通过 |
| selected and active rows use the captured fill without a synthetic outline | 通过 |
| row actions wait for the row, and stay reachable from the keyboard | 通过 |
| tasks sort newest-first under their own project | 通过 |
| the search row reveals a focused field and the filter releases when it closes | 通过 |
| archiving and restoring round-trips through thread.update | 通过 |
| no sidebar label lands on a name another surface resolves | 通过 |
| a project collapses without touching its neighbours | 通过 |
| recent tasks share live selection and project filtering while the footer stays reachable | 通过 |
| shared user skills are discovered, readable, disableable and restored after restart | 通过 |
| new skills use the shared directory and removal persists without changing shared files | 通过 |
| shared discovery diagnostics recover after repair and actual extension failures survive restart | 通过 |
| resource source details retry missing files and preserve shared files after removing configuration | 通过 |
| summary navigates real round plans and restores the chosen fold and reading anchor after restart | 通过 |
| summary approval opens the actual control and completed edits refresh real changes and artifacts | 通过 |
| summary plan navigation keeps its real round and reading position: light 1000 | 通过 |
| summary plan navigation keeps its real round and reading position: dark 1000 | 通过 |
| summary plan navigation keeps its real round and reading position: system-light 1000 | 通过 |
| summary plan navigation keeps its real round and reading position: system-dark 1000 | 通过 |
| summary plan navigation keeps its real round and reading position: light 1280 | 通过 |
| summary plan navigation keeps its real round and reading position: dark 1280 | 通过 |
| summary plan navigation keeps its real round and reading position: system-light 1280 | 通过 |
| summary plan navigation keeps its real round and reading position: system-dark 1280 | 通过 |
| summary plan navigation keeps its real round and reading position: light 1440 | 通过 |
| summary plan navigation keeps its real round and reading position: dark 1440 | 通过 |
| summary plan navigation keeps its real round and reading position: system-light 1440 | 通过 |
| summary plan navigation keeps its real round and reading position: system-dark 1440 | 通过 |
| summary targets the selected approval by id, including duplicate tools and another task | 通过 |
| summary Git loading and retries isolate stale success and errors across selections | 通过 |
| plan navigation is cancelled by new user input and cannot steal focus after switching tasks | 通过 |
| streaming prose does not poll Git or replace the summary plan and cleared plans stay hidden | 通过 |
| light 1000×640 menu source surface | 通过 |
| light 1000×640 tooltip source surface | 通过 |
| light 1000×640 dialog source surface | 通过 |
| light 1000×640 user source surface | 通过 |
| light 1000×640 prose source surface | 通过 |
| light 1000×640 table source surface | 通过 |
| light 1000×640 code source surface | 通过 |
| dark 1000×640 menu source surface | 通过 |
| dark 1000×640 tooltip source surface | 通过 |
| dark 1000×640 dialog source surface | 通过 |
| dark 1000×640 user source surface | 通过 |
| dark 1000×640 prose source surface | 通过 |
| dark 1000×640 table source surface | 通过 |
| dark 1000×640 code source surface | 通过 |
| system-light 1000×640 menu source surface | 通过 |
| system-light 1000×640 tooltip source surface | 通过 |
| system-light 1000×640 dialog source surface | 通过 |
| system-light 1000×640 user source surface | 通过 |
| system-light 1000×640 prose source surface | 通过 |
| system-light 1000×640 table source surface | 通过 |
| system-light 1000×640 code source surface | 通过 |
| system-dark 1000×640 menu source surface | 通过 |
| system-dark 1000×640 tooltip source surface | 通过 |
| system-dark 1000×640 dialog source surface | 通过 |
| system-dark 1000×640 user source surface | 通过 |
| system-dark 1000×640 prose source surface | 通过 |
| system-dark 1000×640 table source surface | 通过 |
| system-dark 1000×640 code source surface | 通过 |
| light 1280×800 menu source surface | 通过 |
| light 1280×800 tooltip source surface | 通过 |
| light 1280×800 dialog source surface | 通过 |
| light 1280×800 user source surface | 通过 |
| light 1280×800 prose source surface | 通过 |
| light 1280×800 table source surface | 通过 |
| light 1280×800 code source surface | 通过 |
| dark 1280×800 menu source surface | 通过 |
| dark 1280×800 tooltip source surface | 通过 |
| dark 1280×800 dialog source surface | 通过 |
| dark 1280×800 user source surface | 通过 |
| dark 1280×800 prose source surface | 通过 |
| dark 1280×800 table source surface | 通过 |
| dark 1280×800 code source surface | 通过 |
| system-light 1280×800 menu source surface | 通过 |
| system-light 1280×800 tooltip source surface | 通过 |
| system-light 1280×800 dialog source surface | 通过 |
| system-light 1280×800 user source surface | 通过 |
| system-light 1280×800 prose source surface | 通过 |
| system-light 1280×800 table source surface | 通过 |
| system-light 1280×800 code source surface | 通过 |
| system-dark 1280×800 menu source surface | 通过 |
| system-dark 1280×800 tooltip source surface | 通过 |
| system-dark 1280×800 dialog source surface | 通过 |
| system-dark 1280×800 user source surface | 通过 |
| system-dark 1280×800 prose source surface | 通过 |
| system-dark 1280×800 table source surface | 通过 |
| system-dark 1280×800 code source surface | 通过 |
| light 1440×940 menu source surface | 通过 |
| light 1440×940 tooltip source surface | 通过 |
| light 1440×940 dialog source surface | 通过 |
| light 1440×940 user source surface | 通过 |
| light 1440×940 prose source surface | 通过 |
| light 1440×940 table source surface | 通过 |
| light 1440×940 code source surface | 通过 |
| dark 1440×940 menu source surface | 通过 |
| dark 1440×940 tooltip source surface | 通过 |
| dark 1440×940 dialog source surface | 通过 |
| dark 1440×940 user source surface | 通过 |
| dark 1440×940 prose source surface | 通过 |
| dark 1440×940 table source surface | 通过 |
| dark 1440×940 code source surface | 通过 |
| system-light 1440×940 menu source surface | 通过 |
| system-light 1440×940 tooltip source surface | 通过 |
| system-light 1440×940 dialog source surface | 通过 |
| system-light 1440×940 user source surface | 通过 |
| system-light 1440×940 prose source surface | 通过 |
| system-light 1440×940 table source surface | 通过 |
| system-light 1440×940 code source surface | 通过 |
| system-dark 1440×940 menu source surface | 通过 |
| system-dark 1440×940 tooltip source surface | 通过 |
| system-dark 1440×940 dialog source surface | 通过 |
| system-dark 1440×940 user source surface | 通过 |
| system-dark 1440×940 prose source surface | 通过 |
| system-dark 1440×940 table source surface | 通过 |
| system-dark 1440×940 code source surface | 通过 |
| tooltip follows keyboard, delay, click, escape and window blur states | 通过 |
| dialog traps keyboard focus, closes through each real action and restores its trigger | 通过 |
| menu flips at the bottom edge and follows resized trigger geometry | 通过 |
| tooltip flips near the titlebar and follows multiline content resizing | 通过 |
| code copy keeps literal text, reports clipboard errors and allows retry | 通过 |
| long code scrolls within the block and keyboard wrapping preserves its content | 通过 |
| wide tables preserve column alignment and scroll without widening the conversation | 通过 |
| large output survives rename, parked output, renderer reload and real process exit | 通过 |
| real terminal search handles wide text, wrapping, cyclic previous results, IME and active-tab copy | 通过 |
| custom terminal navigation bindings save and hydrate after restart without sending shell input | 通过 |
| workbench drafts, queue withdrawal, per-turn plans and terminal profiles survive restart | 通过 |
| workbench context menus, closed tabs, recycle bin, export and message fork use real operations | 通过 |
| workbench reading anchors flush on rapid task switches and survive restart without following new content | 通过 |
| workbench editor preserves stale buffers, confirms unsaved close and stages only chosen files | 通过 |
| workbench calendar editing keeps timezone and notification preferences across restart | 通过 |
| workbench browser keeps cookies, native tabs and downloads separate from desktop IPC | 通过 |
| expanded skill queue withdrawal restores the original command and attachments | 通过 |

## 参考来源

| 归档路径 | SHA-256 |
| --- | --- |
| webview/assets/app-shared-fa570b9eb9dd.css | fda42cbba7c23433a1a378dac6dadcab9f871dba202d38d95b10cfb7bfca2c4e |
| webview/assets/app-initial-e8ceb32eb626.css | bed402435099ec86490a975ac518b361fb508489d3fbb71a5b037a8348c20fb1 |
| webview/assets/app-primary-484df789f2f5.css | dc89ef12249eff543381bc5932386824ec3c732901b0ce12bbe88ecf54c4ed65 |
| webview/assets/app-initial-fc9a33fdda88.js | 34a60939a5f44634a65c956b7904d63236178e6d45a049717358fc163ecffe88 |
| webview/assets/app-primary-a7ff54c980af.js | e8ac507e0a621099a2b82b9ae17b1d1930ab971b1d088fe4fb81f5437648d043 |
| webview/assets/local-conversation-thread-d221045ad324.js | ad26a5d9d8778249035e6dd91beb70e11294196c2933aa4a565d539cd63595c7 |
| webview/assets/sidebar-left-59ba729cde31.svg | 6492fceab1cfdb9cf9ae6e276a3fc90997cb642ce541a08e681b3f1e5881386a |
| webview/assets/user-message-8b0705662651.css | bdae837310efb2de763f5a5e9b176b686a9e14b51b38802800e9c68335cad1f5 |
| webview/assets/app-shared-dc8f183e4945.js | 455bb17802e1a2c3163d691d6d8a7b99d871adabfa45d96867a866e3ffe5732f |
| webview/assets/user-message-70f58cab2b4c.js | 21105cf3a6cb360e51841d9a9042517ab97649511ed0c40557dde2a4510876a9 |
| webview/assets/automation-delete-confirmation-dialog-d80f40edba25.js | b8b70832fed16fd74e29db42b4574156ca20a02b57e39f958d4049acfadcc495 |
| webview/assets/conversation-blocks-dbf9cc487eb4.js | e307f987590831251bfb5b483259be500289565fa825b43e0245a1dbef23e382 |
| webview/assets/agent-activity-units-ebdc48135dc2.js | e520bbd9b6b7c7e6b6ba8d92f74ce2a70f3350eef768671a885f7fdfd3f09a70 |
| webview/assets/tool-activity-disclosure-65375d723bb8.js | a05480b5a7886954489183d7b4143f4c27ec6ddb6b4403a037e632e0d4ff7bfe |
| satang_code/docs/parity/reference-status.md | 50221abcdd91437dccee7ee326a582e88fa87d7193e1286e13a348108531efb8 |
| satang_code/src/renderer/src/styles/welcome.css | 732ba729e4ade1e7d3c2ebdd3430c7863aa3d85ca4fa9880e898eaf7fced807c |
| satang_code/src/renderer/src/surfaces/welcome/styles/tokens.css | ba51431ea248bb50053b4a9ad35eb09df68338ec3aae9e78c820cfa8e762c17f |
| satang_code/src/renderer/src/surfaces/welcome/index.tsx | 51ad4210c9f9699a5ee54b08d331a6e318fe641a07ecb30791f175f29faa04d0 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/welcome/light/1440x940.dom-styles.json | c431d8963277a8e179d47497209d9f663fdb1d2daf4abfecd048ff523d012b31 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/welcome/light/1000x700.dom-styles.json | 7779396262b989788df84b301f922177c3aaf287e417218f93e01596a54e0253 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/welcome/dark/1440x940.dom-styles.json | 5f31b679711469771718b277ac20438dd31f8a69eee86ebc747dea83f30a2452 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/welcome/dark/1000x700.dom-styles.json | 75bef3b323c67bf73cf9a54db6f7c0659b250c2225e145930535c2ea6824d2d5 |
| satang_code/src/renderer/src/shell/MenuBar.tsx | d92621597698518ab80e105862844dc0bbe0649230b1ac50a848235144574bc1 |
| satang_code/src/renderer/src/shell/LeftPanelHeader.tsx | 946036587e34e1c76872d65c6b91b1172796b35b4f1b30d698cacd50ecf4f0a7 |
| satang_code/src/renderer/src/surfaces/sidebar/index.tsx | a00b0261cb469e57a3926da4bf0c321136886dc9fdf3063cf6c7926c076ae9b4 |
| satang_code/src/renderer/src/styles/sidebar.css | 5623a7108e0f20f6d605ff450819f380ef0a3ff13ca5e65c848a46032845dc96 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/sidebar/light/1440x940.dom-styles.json | cfe2aa215b117b9a611b4517dbc8473fbff39d17b80f7515cd500dd40c458ec7 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/sidebar/light/1000x700.dom-styles.json | 719ee67be07a3343946637865ae2c254a15ddc332cee2179aebf413377b6d1cd |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/sidebar/dark2/1440x940.dom-styles.json | cdcc7256a9fe50514a00866d2a483b53fa9b0bf50ca0d57b4380a195a0876c83 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/sidebar/dark2/1000x700.dom-styles.json | e09f48da972167acccb285d045d38e374387fb1cd8bfcc57c0d1139242f12452 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/palette/light/1440x940.dom-styles.json | 841a4485527f14bba67f708b2749dd3e088e0a7e7f3c0ce12bc60e26b7145627 |
| satang_code/.artifacts/reference/26.915.4065.0/palette/light-1000x700.dom-styles.json | 0433f758b8b880ab6ae1acaeb4a51813fb9d3043f202cca8017517e617117d0d |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/palette/dark2/1440x940.dom-styles.json | de9ac2a5a3d7369c78ca1fadb92952bea8f7b8669f3dd6c2a070297c9c3797eb |
| satang_code/.artifacts/reference/26.915.4065.0/palette/dark-1000x700.dom-styles.json | 359ba695cda5d9721195a5adeecb3bff0b22f09c74c0eaa05ea6cb76f57762cd |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/settings/light/1440x940.dom-styles.json | e255a14fc7da3191314d808bb5c56b48ffff2b31fc4e064d4664527017f197a6 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/settings/light/1000x700.dom-styles.json | b5b9149dcf839d3418ac04a814e6bb5822dc7120f0d8a8aec20bb51e1c23e325 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/settings/dark2/1440x940.dom-styles.json | 9af7b1b939a2eabc4f1c536ccdd4fa173f6466a411c7ceaab0fd9c40d77fe5c4 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/settings/dark2/1000x700.dom-styles.json | 9a72f51cefed5ec802ecc61339a6a41a98174587de3cec8d0ae27c2cab38e5ea |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/terminal/light/1440x940.dom-styles.json | c1414110a0cc4486a7bcafcf18fe5d6cf5d07c5c331d386a0486a6a133bb8256 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/terminal/light/1000x700.dom-styles.json | 6d220fcaadf07d12df52c8fe6ef52bda031c766a208ddcbeccb0a1e9acb51496 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/terminal/dark2/1440x940.dom-styles.json | 42681bf26099eaa31a628a3490aa752bd81840b6cfb990f39fcbb32968310539 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/terminal/dark2/1000x700.dom-styles.json | 5f2315f82ff4d8b53cc967f66bec5d8f2808660c1802d818a6cd319abdb3667e |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/preview/light/1440x940.dom-styles.json | 265690e946c736e2b88810b357246d8a9ffff3a12f0849616251c5ccd6dc54c8 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/preview/light/1000x700.dom-styles.json | 5c8838a98cf1dbf80d5d2099770ae3c15d56ebee4e6c55b241cae664c8b81812 |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/preview/dark2/1440x940.dom-styles.json | fbc4605ce81a52cbe9cc3c43750697f21e16dd5d258ea255df98b8f6b5dd85bb |
| satang_code/.artifacts/reference/26.915.4065.0/pinned/preview/dark2/1000x700.dom-styles.json | 90d1986b90b8890c2c0106184bc0cd55e9eef8a4d93521ad0c6b626d08d2d5f1 |
| satang_code/src/renderer/src/surfaces/review/index.tsx | e60f1d5a9bcbde00bb8daf03b29047b5722cf91f25efa17c490f7d6d2906f0e1 |
| satang_code/src/renderer/src/surfaces/review/styles/tokens.css | 344dd37bdd9fde3f73f77541216868a5cc5d724f35b5730ef5ae274e271a1440 |
| satang_code/src/renderer/src/styles/review.css | 176575573f52b25d44f603f149154dbb7ed46b6336f662878808ff3442dd4057 |
| satang_code/.artifacts/reference/26.915.4065.0/review/light-1440x940.dom-styles.json | f67422bfb10c8b707768162e804f5f37c933d079141ca937600d88c5170cc0c2 |
| satang_code/.artifacts/reference/26.915.4065.0/review/light-1000x700.dom-styles.json | 4006202691015e85cced4c2ec34ddc146f157b16c3d48b8fce9e56104e2b719f |
| satang_code/.artifacts/reference/26.915.4065.0/review/dark-1440x940.dom-styles.json | f3717509f3c500034dd1f3e194252c630dc78a3a8209f86565f0d83d81bad1ca |
| satang_code/.artifacts/reference/26.915.4065.0/review/dark-1000x700.dom-styles.json | c31712ad13096e1476f54ae98c54f8a588c7d0c43a9d3282dd1d77f782174225 |
| satang_code/src/renderer/src/surfaces/management/sites.tsx | 12f2caeab9bc7b4e43248ab6f324c28e7ffa801c301abb11d06b9cd48964e474 |
| satang_code/src/renderer/src/surfaces/management/measured.ts | 900dbcbd302ac0dbe02f963f446c627366280a1be01f80062c5d93344663c3aa |
| satang_code/src/renderer/src/styles/management.css | c0b260e57addee133922cab00c13b1d1339c892e7e2819c193db69a616c92990 |
| satang_code/.artifacts/reference/26.915.4065.0/management/light-1440x940.dom-styles.json | e8df1f3e1722b1cc99e74b113f9634043dc354c0b743264809f9aefc9eb2e04b |
| satang_code/.artifacts/reference/26.915.4065.0/management/light-1000x700.dom-styles.json | 2f91795f885b5e3680c4b83fe7dae795025ff0ce340fedaf9b4de16b689e88d5 |
| satang_code/.artifacts/reference/26.915.4065.0/management/dark-1440x940.dom-styles.json | 1bf6f96f42a563c5d3d8c68629b33d82096cf424d761873f6295cb837ccc3229 |
| satang_code/.artifacts/reference/26.915.4065.0/management/dark-1000x700.dom-styles.json | e680d60af7115dc9449f7de4ffd2c09e48d231d80b3fff82142fc4fab0927db3 |
| satang_code/src/renderer/src/surfaces/workspace/index.tsx | 29e6a79deac895614af132ccc65e60da9f2958bc16fe99fdae6006697a0a32ef |
| satang_code/src/renderer/src/surfaces/workspace/parts.tsx | 3cde65b01f5533cda195fdbedf9ec8667aff68ec6fc626cfdba57121325fb31f |
| satang_code/src/renderer/src/styles/workspace.css | 4c62efe58c27cd5c63ef161ef5f12baab24a4a9ef93f989711996c47d567da12 |
| satang_code/src/renderer/src/surfaces/approval/index.tsx | ad9739df5649e4244e9b34d2d4dc364993122de17d52a53a1a26f120ef0adcc2 |
| satang_code/src/renderer/src/surfaces/emptyloading/index.tsx | 149741b34100637bc24252cfe1e21366db872776ac0d4df44b497153540a7739 |
| satang_code/.artifacts/reference/26.915.4065.0/workspace/light-1440x940.dom-styles.json | a19846e54f81067b46928a3ac5bf2800e8036895a4c9c9e2c022f724c80969c5 |
| satang_code/.artifacts/reference/26.915.4065.0/workspace/dark-1440x940.dom-styles.json | fa3ab65c9eddd258d893a5e29f9444d353ac5c9290371209719525aad1ebbb16 |
