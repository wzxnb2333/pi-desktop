# 桌面定向测试

日常流程：确定本轮改动 → 选择相关模块/用例 → 运行一次桌面类型检查及定向测试 → 只重跑失败或再次修改的部分。不要把此前迭代验证过的所有功能重新跑一遍。

聊天选文引用、未读点、上下文圆环与滚动条使用 `npm run desktop:test:target -- conversation-ui`，默认仅 11 项界面用例。真实引用校验、侧聊草稿与假供应商发送选择 `conversation-ui --level native`，仅 2 项原生流程。单独调整代码引用定位时使用 `--file test/e2e/conversation-ui.spec.ts --grep 'code selection|rendered selection'`；不附带完整输入框或浏览器回归，详见 [聊天 UI 验收](conversation-ui.md)。

设置布局使用 `npm run desktop:test:target -- settings-layout`：只跑 5 项八分类/双语/主题/尺寸及英文自定义接口界面用例，不启动 Electron。模型搜索、删除、错误定位和窄屏切换纳入 `models` 的 UI 范围；通用分组与外观预览纳入 `settings`。只有真实配置持久化流程变化才追加 `models --level native`；详见 [设置重构记录](settings-refactor.md)。

## 常用命令

末尾编辑预览和统一聊天入口使用 `npm run desktop:test:target -- turn-changes`，仅 6 项单元与 7 项界面用例；`--level native` 仅选真实写入/编辑及重启后的历史预览。独立聊天保留与恢复流程变化时，再选 `--file test/e2e/acceptance.spec.ts --grep 'standalone chats retain'`，不运行整个 acceptance 文件。见 [编辑预览验收](turn-changes.md)。

侧栏合集顺序、悬浮按钮和行位移使用 `npm run desktop:test:target -- sidebar`，14 项单元、12 项 UI。普通新建/无目录选择/统一搜索仅选 `--file test/e2e/turn-changes.spec.ts --grep 'new chat|header search'`；涉及真实快捷窗口才选 `--file test/e2e/acceptance.spec.ts --grep 'quick chat keeps'`。独立聊天当前仅隐藏 UI 入口，保留数据与恢复验证。完整本轮记录见 [侧栏导航验收](sidebar-navigation.md)。

从仓库根目录运行，下面是可选示例，不是一串必须全部执行的步骤：

```powershell
npm run desktop:check
npm run desktop:test:list
npm run desktop:test:target -- toolbar
npm run desktop:test:target -- settings
npm run desktop:test:target -- composer
npm run desktop:test:target -- tabs browser
npm run desktop:test:target -- browser --level native
npm run desktop:test:target -- toolbar --dry-run
```

顶部改动的默认 toolbar 选择只有 layout.test.ts 的 6 个单测和 summary.spec.ts 中的 2 个菜单/布局用例。不会连带跑模型、Git、Worktree、设置、全部摘要用例或整个原生桌面流程。本轮实测这 8 项约 5 秒，耗时随机器和代码变化。

精确到文件或用例：

```powershell
npm run desktop:test:target -- --file test/layout.test.ts
npm run desktop:test:target -- --file test/layout.test.ts --grep 'summary and tools'
npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'browser overflow'
npm run desktop:test:target -- --file test/e2e/settings.spec.ts --grep 'allowed thinking levels'
```

支持 test/...、apps/desktop/test/... 和绝对路径。--file 可重复，--grep 只能配合一个明确文件，避免不小心筛进相邻文件或无关模块。单测名称筛选使用 Node 的 test-name-pattern，界面用例使用 Playwright grep；没有匹配不能当作通过。

浏览历史与清理使用 `npm run desktop:test:target -- browser-history`，默认选择 8 项单元与 8 项面板 UI；实际历史落盘、Cookie/缓存和重启选 `browser-history --level native`，共 4 项原生用例。只复核磁盘失败时选 `--file test/e2e/browser-history.nonvisual.spec.ts --grep 'history disk failure'`，不连带网页工具、标注或 PDF/HTML；详见 [浏览历史恢复验收](browser-history-recovery.md)。

网站规则使用 `npm run desktop:test:target -- browser-sites`（7 项单元、8 项 UI）；`--level native` 仅选 3 项网站管理、撤销和保存恢复。若修改浏览器通用执行边界，可额外选 `--file test/e2e/browser-tools.nonvisual.spec.ts --grep 'native agent browser'`；表单修改不自动附带该长流程，详见 [网站规则恢复验收](browser-site-recovery.md)。

PDF/HTML 产物使用 `npm run desktop:test:target -- artifacts`，默认仅 5 项单元与 10 项恢复 UI；`--level native` 选择 6 项真实预览、隔离、磁盘故障、重启和超时流程。只改截图超时时用 `--file test/e2e/artifacts.nonvisual.spec.ts --grep 'HTML capture timeout'`；只改搜索交互则选 `--file test/e2e/artifact-recovery.spec.ts --grep 'PDF search'`，不附带整个浏览器或文件编辑回归。详见 [产物预览恢复验收](artifact-recovery.md)。

## 选择层级

独立代审批使用 `npm run desktop:test:target -- approval-review`，默认仅 10 项相关单元与 4 项审批卡 UI。真实沙箱执行、风险转人工、失败、停止和 30 秒超时选 `approval-review --level native`；只改超时时可用 `--file test/e2e/approval-review.nonvisual.spec.ts --grep 'independent review timeout'`，不用运行全套桌面测试。见 [代审批流程](approval-review.md)。

持续目标使用 `npm run desktop:test:target -- goals`（15 项单元、8 项 UI）；`--level native` 选择 8 项目标运行、编辑、磁盘失败、停止、归档与重启流程。仅复核存储故障下的停止时用 `--file test/e2e/goals.nonvisual.spec.ts --grep 'goal pause storage failure'`，不附带整套自动化、记忆或子任务。详见 [持续目标恢复验收](goal-recovery.md)。

自动化队列、启动记录及存储恢复使用 `npm run desktop:test:target -- automation-runtime`，默认仅 20 项单元；`--level native` 选择 8 项实际排队、定时器、权限、Worktree 和磁盘故障/重启流程。只复核结束保存失败时用 `--file test/e2e/automation-queue.nonvisual.spec.ts --grep 'automation completion storage failure'`，不附带管理表单或其他持续任务。详见 [自动化运行恢复验收](automation-runtime-recovery.md)。

跨会话记忆使用 `npm run desktop:test:target -- memory`（8 项单元、9 项 UI）；`--level native` 选择 6 项来源隔离、生成、取消、清除及存储故障/重启流程。只改准备阶段时使用 `--file test/e2e/memories.nonvisual.spec.ts --grep 'memory preparation'`，只改删除确认则使用 `--file test/e2e/memory-settings.spec.ts --grep 'memory deletion retains'`，不附带其他设置、Goal 或自动化。详见 [记忆运行恢复验收](memory-runtime-recovery.md)。

子智能体只读观察使用 `npm run desktop:test:target -- subtasks`（42 项关联单元、9 项 UI）；`--level native` 选择 7 项主代理委派、只读 IPC、Worktree 审批、停止与恢复。只检查委派保存失败时，用 `--file test/e2e/subtasks.nonvisual.spec.ts --grep 'failed durable delegation'`；只改面板则使用 `--level ui`，不连带整个自动化或 Goal。当前交互及证据见 [子智能体只读观察](subagents-observer.md)，此前记录保留在 [子任务恢复验收](subtask-recovery.md)。

只读侧聊使用 `npm run desktop:test:target -- sidechat`（8 项单元、8 项 UI）；`--level native` 选择 7 项真实只读运行、草稿、磁盘失败及退出/重启流程。只改退出清理时用 `--file test/e2e/sidechat-recovery.nonvisual.spec.ts --grep 'shutdown clears sidechats'`，只改输入框则选 `--level ui`，不连带其他多窗口或子任务。详见 [侧聊恢复验收](sidechat-recovery.md)。

多窗口使用 `npm run desktop:test:target -- windows`，默认仅 3 项所有权单元测试；`--level native` 选择 8 项打开/失败/重启恢复和 2 项既有任务窗口、快捷聊天流程。只改启动恢复时用 `--file test/e2e/window-recovery.nonvisual.spec.ts --grep 'one failed restored window'`；原生网页迁移另按需选择 browser.nonvisual.spec.ts 中的 browser pages move 场景，不随每次窗口修改运行整个浏览器。详见 [窗口恢复验收](window-recovery.md)。

独立聊天创建和目录绑定使用 `npm run desktop:test:target -- chats`，默认 7 项单元、5 项恢复 UI 和 1 项未保存表单导航。`chats --level native` 选择 7 项存储/并发/退出恢复及 2 项既有独立/快捷聊天流程。仅验证绑定期间的运行隔离时选 `--file test/e2e/chat-recovery.nonvisual.spec.ts --grep 'pending binding'`，不附带整个多窗口或自动化回归。详见 [聊天恢复验收](chat-recovery.md)。

项目、Worktree 与配置任务创建使用 `npm run desktop:test:target -- task-creation`，默认 18 项单元及 4 项创建/未保存导航 UI；`--level native` 仅选择 7 项创建恢复及 2 项自动化/子任务初始化关联。只修复快照清理时用 `--file test/e2e/task-creation.nonvisual.spec.ts --grep 'baseline preparation'`，不附带所有自动化和子任务用例。详见 [任务创建恢复验收](task-creation-recovery.md)。

| 层级 | 内容 | 适用改动 |
| --- | --- | --- |
| quick（默认） | 所选模块的 unit + ui；没有 ui 的模块只跑单测 | 纯计算、组件、样式、菜单 |
| unit | 仅相关单元测试 | 纯逻辑、schema、状态转换 |
| ui | 仅浏览器 UI 测试，不启动 Electron | 布局、焦点、交互及渲染 |
| native | 仅对应 Electron 用例 | 主进程、IPC、原生浏览器/终端、实际持久化 |
| all | 所选模块的所有层级 | 单个模块的完整复核；不是整仓验收 |

quick 的通过不代表原生能力已验证。改动实际涉及主进程、文件系统、窗口或 IPC 时，补充该模块的 native，或使用 --file + --grep 选择最小相关流程。UI 修复不自动追加全部原生场景。

## Harness 接口

新建 Worktree 的完成检查点及硬退出关联恢复使用 `npm run desktop:test:target -- worktree-creation-interruption`，默认仅 12 项单元；`--level native` 仅 4 项创建/恢复原生流程。仅修改父子取消时选 `--file test/git-parent-cancellation.test.ts`，并按影响补充 `worktree-cancellation.nonvisual.spec.ts` 的停止/退出用例，不自动连带全套 Git 或迁移回归。未完成 checkout 保守拒绝，不计为完整恢复通过。见 [创建中断记录](worktree-creation-interruption.md)。

归档 Worktree 缺少原聊天时的关联恢复使用 npm run desktop:test:target -- worktree-owner，默认仅 10 项单元；--level native 选择 3 项关联恢复、取消、硬退出流程和 1 项原有归档 UI。只修改恢复按钮时选 --file test/e2e/worktree-owner-recovery.nonvisual.spec.ts --grep "failed restored owner linkage"；涉及归档目录校验时另选 worktree-archives.test.ts 的 complete nested checkout，不自动扩展至所有创建、迁移或 Git 测试。详见 [恢复关联聊天](worktree-owner-recovery.md)。

模型运行环境查询、主子代理提问与答复使用 npm run desktop:test:target -- harness（18 项单元、1 项双语只读 UI）；--level native 仅选 4 项真实模型工具/IPC、答复保存、停止/重启和游标等待取消。只改等待取消时选 --file test/e2e/harness-tools.nonvisual.spec.ts --grep "a parent can cancel"，不附带整个子任务、浏览器或自动化。接口与分次证据见 [Harness 接口记录](harness-tools.md)。共享观察面板的 subtasks UI 当前共 10 项，新增提问用例单独归入 harness 快速范围。

模型读取当前 UI 并启动已配置项目动作时，选取 
pm run desktop:test:target -- harness-operations --level native；该文件当前 4 项原生流程，新增动作入口覆盖清单、启动、终端退出码和命令内容隔离。只改协议时用 --file test/harness-tools.test.ts，不连带完整项目动作配置或 Worktree。

模型打开文件、定位代码和展示桌面面板使用 npm run desktop:test:target -- harness-views，默认仅 14 项单元；--level native 仅选 3 项文件/缓冲/重启、多窗口归属及越界拒绝流程。仅改文件定位时选 --file test/e2e/harness-tools.nonvisual.spec.ts --grep "a model opens"，不连带完整文件、浏览器或子任务回归。边界、分次结果及缓存核对见 [桌面视图接口](harness-views.md)。

模型读取终端及增量等待使用 npm run desktop:test:target -- harness-terminal，默认仅 16 项单元；--level native 选择 3 项真实读取/退出/重启、等待/取消/关闭和跨聊天隔离。只改取消等待时选 --file test/e2e/harness-terminal.nonvisual.spec.ts --grep "model terminal waits"。涉及 TerminalService 输出事件时，再按需选原有 terminal.nonvisual.spec.ts 的 large output survives，不附带所有终端或子任务场景。见 [终端读取接口](harness-terminal.md)。

模型操作查询与取消使用 npm run desktop:test:target -- harness-operations，默认 19 项单元；--level native 仅选择 3 项真实项目动作的退出/重启、等待/取消和权限隔离。只改等待时用 --file test/e2e/harness-operations.nonvisual.spec.ts --grep "model wait timeout"。涉及角色注册再单独选择 harness-tools.nonvisual.spec.ts 的 child asks and receives，不自动运行所有项目动作、Worktree 或子任务。见 [操作接口记录](harness-operations.md)。

## 模块清单

`npm run desktop:test:list` 是可执行清单，显示中文说明及可用层级。当前覆盖：

- 外壳：toolbar、summary、sidebar、dialogs、tabs、conversation-ui、turn-changes。
- 输入与设置：composer、context、queue、chats、task-creation、settings、settings-storage、models、appearance、shortcuts、locale。
- 浏览器：browser、browser-find、browser-tools、browser-history、browser-sites、annotations。
- 文件与工作区：files、file-search、links、terminal、git、git-cancellation、git-cancel-retry、git-background、git-commit、review、worktree、worktree-cancellation、worktree-migration、worktree-interruption、worktree-restore、worktree-owner、worktree-restore-files、worktree-index-preparation、worktree-reclamation、projects、project-actions、windows。
- 持续任务与扩展：goals、subtasks、harness、harness-views、harness-terminal、harness-operations、sidechat、automation、automation-runtime、plugins、mcp、mcp-connection、mcp-reconnect、runtime-startup、oauth、artifacts、memory、resources、storage、cleanup。

Skills 与扩展使用 `npm run desktop:test:target -- resources`（资源单测、管理 UI 和一个未保存导航场景）；涉及真实读写、审批或重启恢复时，再选 `resources --level native`。不会启动其他模块的原生用例。

设置和凭据写入失败使用 `npm run desktop:test:target -- settings-storage`；真实 JSON/密钥写入、运行中隔离与启动恢复选择 `settings-storage --level native`。连接模式与思考程度另选 `models --level native`，不随每次外观或设置导航修改重复运行。

连接测试的进度、取消和恢复使用 `npm run desktop:test:target -- mcp-connection`；只检查界面可加 `--level ui`，真实进程、IPC 和重启使用 `--level native`。不随一次连接按钮修改运行整个 OAuth 或插件生命周期。

任务内“重新连接任务工具”使用 `npm run desktop:test:target -- mcp-reconnect`；默认只选初始化生命周期的 3 项单测与重连 UI 的 3 项用例。`--level native` 才执行 4 项重连取消/隔离用例和 2 项既有工具恢复流程；某一用例失败后优先用 `--file` 和 `--grep` 重跑受修复影响的范围。

首次发送/恢复会话的启动停止使用 `npm run desktop:test:target -- runtime-startup`，默认只选生命周期的 3 项单测。主进程初始化、发送确认或退出落盘有变化时，使用 `runtime-startup --level native`：5 项启动/草稿/隔离流程，加既有发送队列、会话恢复和重连审批的 3 项关联回归。定位单个失败时仍用 `--file test/e2e/runtime-startup.nonvisual.spec.ts --grep '具体用例名称'`，不连带完整 MCP、插件或设置测试。

终端 `terminal` 的 quick 包含输出/查找单测、4 项既有面板和 12 项操作恢复 UI；`--level native` 选择 4 项真实 PTY 流程。仅改创建、重命名或错误提示时，优先 `--file test/e2e/terminal-recovery.spec.ts --grep '具体用例名称'`，不自动追加全部原生终端流程。

模块定义位于 scripts/desktop-test-targets.mjs。新增用例时先加入对应的小模块；一个大的 spec 文件可只选具体名称，无须复制测试代码或降低断言。新的 spec 文件还需加入现有非视觉配置。脚本自测会校验路径、层级以及已配置名称筛选是否仍存在。

文件编辑的 `files` 包含缓冲/磁盘保存单测及 17 项 UI；`--level native` 执行 2 项真实文件读写流程。仅修改重新加载时，使用 `--file test/e2e/file-editor.spec.ts --grep 'reload'`；涉及主进程版本校验时，再选 `--file test/e2e/file-editor.nonvisual.spec.ts --grep 'external modification'`。不连带全文搜索或 PDF/HTML 预览测试。

审查 `review --level ui` 选择 12 项面板恢复用例；只改某个按钮时用 `--file test/e2e/review-recovery.spec.ts --grep 'feedback submissions'` 等具体名称。真实只读权限、评论版本与重启选择 `--file test/e2e/review.nonvisual.spec.ts`，不因为面板修改自动执行整个 Git/差异块恢复。

审查反馈、忽略状态和行评论的落盘恢复使用 `--file test/review-persistence.test.ts`；真实磁盘失败及界面重试使用 `--file test/e2e/review.nonvisual.spec.ts --grep 'disk failures'`。两个新增原生场景只使用本地假供应商，并在结束后确认测试目录清理。

Git 面板 `git --level ui` 选择 23 项用例；仅改操作状态时可用 `--file test/e2e/git-panel.spec.ts --grep 'Git actions remain pending'`，差异块准备与取消使用 `--grep 'hunk preflight'`。真实暂存、提交、冲突及多目录隔离使用 `--file test/e2e/git.nonvisual.spec.ts`，现有 3 项工作流、2 项提交前取消/退出和 3 项提交后恢复流程；只复核正常撤销恢复则用 `--file test/e2e/git-history.nonvisual.spec.ts --grep 'hunk revert and recovery'`。不自动追加整个 Worktree 或 GitHub 流程，具体证据见 [Git 恢复验收](git-recovery.md)。

Git 进程取消使用 `npm run desktop:test:target -- git-cancellation`，默认仅执行 10 项单测。实际面板取消、应用退出和重启使用 `git-cancellation --level native`，只选择上述原生文件中的 2 项相关流程。该入口不连带其余 Git 面板、分支、Worktree 或审查；详见 [取消与退出验收](git-cancellation.md)。

提交已经生效后的确认与恢复使用 `npm run desktop:test:target -- git-commit`（8 项单测、1 项草稿 UI）。`git-commit --level native` 仅选择 3 项迟到取消、索引失败和退出/重启流程；不自动带上提交前取消、分支与远端场景。详见 [提交确认验收](git-commit-completion.md)。

Git 终止器失败后的取消/退出重试使用 `npm run desktop:test:target -- git-cancel-retry`（仅 2 项单测）；`--level native` 选择 2 项真实 IPC 与最后窗口恢复流程。修改退出提示后可用 `--file test/e2e/git-cancel-retry.nonvisual.spec.ts --grep 'Git shutdown failure'` 单独复核，不连带所有 Git 功能；详见 [停止失败恢复验收](git-cancel-retry.md)。

后台状态/差异查询及自动超时的停止恢复使用 `npm run desktop:test:target -- git-background`（仅 4 项单测）；`--level native` 选择 2 项实际进程、目录隔离、双语键盘恢复与最后窗口退出流程。不会附带提交、远端或 Worktree；详见 [后台查询恢复验收](git-background-recovery.md)。

项目环境配置及动作恢复使用 `npm run desktop:test:target -- project-actions`（8 项单测、6 项 UI）；`--level native` 选择 4 项真实命令、持久化及取消/退出流程。只改草稿或提示时，可用 `--file test/e2e/project-action-recovery.spec.ts --grep 'stale environment'` 等精确场景，不附带整个 Worktree 或终端回归；详见 [项目动作恢复验收](project-action-recovery.md)。

Worktree 的快照取消、停止失败重试及起始引用草稿使用 `npm run desktop:test:target -- worktree-cancellation`（5 项单测、3 项 UI）；`--level native` 只选 2 项 Windows 真进程场景。正常迁移/归档流程继续独立使用 `worktree --level native`，不会随表单改动自动追加。详见 [Worktree 取消验收](worktree-cancellation.md)。

差异块记录落盘和中断恢复使用 `--file test/hunk-recovery.test.ts` 的 12 项单测；仅改错误列表和状态按钮，选择 `--file test/e2e/git-panel.spec.ts --grep 'recovery history'` 的 2 项 UI。需要实际 IPC、磁盘故障及重启证据时，再使用 `--file test/e2e/git-history.nonvisual.spec.ts --grep 'hunk'` 的 3 项原生流程，不连带最近一轮快照或其他 Git 操作。

## 执行和产物

网页标注使用 `npm run desktop:test:target -- annotations`，仅选择 13 项相关单元（含生命周期子场景）与 9 项 UI；`--level native` 选择 4 项截图、草稿、保存、删除和重启流程。只修改删除重试时用 `--file test/e2e/browser-annotations.nonvisual.spec.ts --grep 'screenshot deletion failures'`，不附带其他浏览器功能或产物预览。详见 [网页标注恢复验收](annotation-recovery.md)。

迁移文件后保存任务关联失败、完成提示和初始化重试使用 `npm run desktop:test:target -- worktree-migration`（13 项单元、1 项 UI）。`--level native` 选择 6 项真实 Electron 保存失败、重启、连续迁移和迟到取消流程。更小的保存队列验证可只运行 `--file test/worktree-migration-persistence.test.ts`，不启动 Git 或 Electron；详见 [迁移关联恢复](worktree-migration-recovery.md)。

迁移中主进程强制退出、记录损坏或外部冲突重试使用 `npm run desktop:test:target -- worktree-interruption`（14 项相关单元、1 项恢复 UI）；`--level native` 只选 4 项实际中断/重启与冲突流程和 1 项连续迁移回归。不附带归档索引、终端或全部 Git 测试；详见 [强制退出恢复验收](worktree-interruption.md)。

恢复暂存区的外部修改、索引锁、配置保存失败与重启使用 `npm run desktop:test:target -- worktree-restore`（15 项归档/恢复单元）；`--level native` 选择 6 项故障恢复和 1 项既有正常归档流程。只修改保存重试时可用 `--file test/e2e/worktree-restore.nonvisual.spec.ts --grep 'state-save failure'`，不连带全部迁移测试；初始验收见 [恢复暂存区验收](worktree-restore-recovery.md)，新增准备阶段证据见 [索引准备验收](worktree-index-preparation.md)。

归档移动意图、部分删除、外部变更及旧目录继续回收使用 `npm run desktop:test:target -- worktree-reclamation`，默认仅 8 项单元；`--level native` 选择 3 项中断/取消流程和 1 项正常归档回归。只修改回收取消时可用 `--file test/e2e/worktree-reclamation.nonvisual.spec.ts --grep 'archive cancellation'`，不附带普通恢复索引或全套迁移；详见 [归档回收验收](worktree-reclamation.md)。

恢复普通文件的部分写入、排他发布及临时目录重试使用 `npm run desktop:test:target -- worktree-restore-files`，默认仅 10 项单元；`--level native` 选择 3 项文件恢复/界面流程和 1 项状态保存回归。只改清理反馈可用 `--file test/e2e/worktree-restore-files.nonvisual.spec.ts --grep 'cleanup failure'`；不附带全部恢复索引或迁移场景，详见 [文件恢复验收](worktree-restore-files.md)。

索引准备阶段的中断、取消和临时文件回收使用 `npm run desktop:test:target -- worktree-index-preparation`，默认仅 11 项单元；`--level native` 选择 2 项准备阶段中断和 1 项状态保存场景。更小范围可用 `--file test/worktree-index-preparation.test.ts --grep 'cleanup failure'`，不附带全部归档或文件恢复，详见 [索引准备验收](worktree-index-preparation.md)。

- 直接调用已安装的 Node/Playwright，不安装依赖，不运行 npm build，不使用旧打包产物。原生用例按现有 fixture 构建必要的 main/preload。
- 多模块选择对重复文件去重；同文件的名称过滤合并，不把各文件筛选串成全局大正则。
- 首次失败停止后续阶段、保留原始退出码；不自动重试，不扩大范围。无参数、拼写错误、空层级和零匹配均不能变成全套运行或假通过。
- 关闭截图、视频、trace 及测试特有的截图环境开关；沿用临时目录所有权和清理机制。
- 固定输出目录 .artifacts/desktop-targeted/output；最近一次记录 .artifacts/desktop-targeted/last-run.json 包含实际命令、阶段、耗时和退出码。覆盖更新，不为每次运行新增缓存目录。
- 原有 desktop:test / desktop:test:nonvisual 保留，用于 CI 或明确要求的完整验收；没有改动原有覆盖范围。

## 测试入口维护

修改定向脚本后，只需要脚本自测、一个代表性模块以及受改动影响的单文件/原生启动路径。不要运行所有模块验证“分组”。

```powershell
node --test scripts/desktop-test-target.test.mjs
npm run desktop:test:target -- toolbar
```

依赖、锁文件和共享包边界检查仍按其实际改动处理；新增一个桌面测试入口不单独触发整仓完整检查。

## 本轮验证

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项脚本回归通过，包含零匹配、退出码和实际子进程执行 |
| npm run desktop:test:target -- toolbar | 0 | 6 项单测 + 2 项 UI，通过，约 5 秒 |
| npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'browser overflow' | 0 | 仅执行 1 项原生浏览器回归，通过 |
| npm run desktop:check | 0 | 桌面类型检查通过 |
| npm run desktop:test:list | 0 | 正常列出 37 个模块及可用层级 |

临时目录清理脚本对 D:/systemp 的只读审计退出码为 0，未发现匹配的遗留测试目录。本轮没有运行全量桌面或整仓测试；模块映射经过静态检查，不代表全部模块的功能重新验收。
