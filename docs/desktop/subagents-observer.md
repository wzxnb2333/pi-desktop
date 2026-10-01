# 子智能体只读观察流程

## 本轮范围（2026-09-30）

- 主代理通过现有 manage_subtasks 工具创建、检查和停止子智能体；全局开关保持默认关闭。启用后委派本身不再逐次弹窗，文件和命令权限仍按既有沙箱、审批规则执行。
- 用户查看主消息流工作过程中的紧凑创建提示，摘要中的活动数量打开右侧纵向列表，每个子智能体有独立的只读会话标签。关闭标签不停止任务。
- 子会话不进入主导航、搜索及独立窗口，不能发消息、修改权限或重新委派；完成后仍保持只读。
- 本地共享目录只读；Worktree 最高为替我批准且不能超过主代理权限；不允许递归委派。降低父任务权限时停止已有子任务，避免保留更高权限。
- 原任务草稿、摘要和辅助栏并存；危险操作的用户审批不属于修改子任务指令，仍提供处理入口。

## 实施台账

| 项目 | 状态 | 验证 |
| --- | --- | --- |
| 主进程只读边界、权限收紧、主代理委派 | 已验证 | 38 项关联单元、7 项原生流程 |
| 委派卡片、摘要计数、纵向列表和会话标签 | 已验证 | 7 项 UI、原生委派与只读观察流程 |
| 导航隔离、双语、恢复、定向回归与缓存清理 | 已验证 | UI 双语/主题/尺寸、原生重启、临时目录清理断言 |

## 交互与权限

1. 主代理调用工具创建子任务，本轮工作过程显示小图标和“已创建 名称”。创建结果按子任务 ID 归属工具调用，旧记录保留轮次内回退。子任务活动期间过程展开，结束后随本轮过程折叠。
2. 右上角摘要显示活动数量，包含排队、准备和运行中；点击打开右侧纵向列表。已结束项放在可展开历史中。
3. 点击列表或创建提示打开对应的右侧会话标签。支持实时输出、多个子任务标签、切换后保留阅读位置和主聊天草稿。
4. 子任务没有输入框、手动创建、单独停止、重试、权限修改或结果追加按钮；不出现在主侧栏、聊天搜索、归档/回收站、自动化目标选择和独立窗口中。
5. 关闭观察标签不会停止子任务；停止主任务会取消其子任务。即使主任务本轮已经结束，收紧其权限也会取消仍在运行的子任务。
6. 完成的子会话仍受主进程只读限制，不能通过 Renderer IPC 恢复运行、改权限、写文件或操作其终端。自动化不能绕过此限制。
7. 文件/命令原有审批保留，摘要提供待审批子任务入口。审批只决定当前操作是否允许，不允许用户向子任务追加指令。

## 初始实现验证

以下命令均实际执行，最终退出码均为 0；原生场景分两组完成，共 7 个不同用例。没有执行整个桌面或整仓回归。

| 命令 | 工作目录 | 结果 |
| --- | --- | --- |
| npm run desktop:check | 仓库根目录 | 桌面类型检查通过 |
| node --import tsx --test test/subtask-observer.test.ts test/subtasks.test.ts test/subtask-persistence.test.ts test/panel-tabs.test.ts test/thread-list.test.ts test/window-state.test.ts | apps/desktop | 38 项通过 |
| npm run desktop:test:target -- subtasks --level ui | 仓库根目录 | 7 项通过 |
| 原生生命周期筛选（完整命令见下方） | 仓库根目录 | 3 项通过 |
| 原生观察与隔离筛选（完整命令见下方） | 仓库根目录 | 4 项通过 |
| node --test scripts/desktop-test-target.test.mjs | 仓库根目录 | 16 项选择器回归通过 |

原生两组完整命令：

~~~powershell
npm run desktop:test:target -- --file test/e2e/subtasks.nonvisual.spec.ts --grep 'model-owned child stop|parent permission reductions|failed durable delegation'
npm run desktop:test:target -- --file test/e2e/subtasks.nonvisual.spec.ts --grep 'parent model owns|completed children cannot|a real independent Worktree|closing observation tabs'
~~~

实际参数、开始结束时间与退出码见 [生命周期结果](../../.artifacts/subagents-observer/native-lifecycle.json) 和 [观察与隔离结果](../../.artifacts/subagents-observer/native-observer.json)；[最终 UI 结果](../../.artifacts/subagents-observer/ui.json) 保存本轮 7 项界面运行记录。

- UI 检查覆盖深浅主题、中英文、1440×940、1280×800、1000×700，以及语言切换后保留草稿；1440×940 深浅主题另保存并查看实际渲染图。
- 原生检查使用本地假供应商协议、真实 Electron IPC、Git Worktree、审批、磁盘保存失败和重启。验证共享目录只读、独立 Worktree 审批后写入、父任务权限上限、不递归和已完成子任务不能提权。
- 假供应商原先会把父代理预定的停止工具调用交给先发请求的子代理；改为按用户提示匹配工具调用，并等子任务真实进入流式状态后验证停止和重启。没有用修改产品权限来掩盖夹具竞态。
- 最后一项自动化目标断言初次使用精确标签，但既有字段的可访问名称包含说明，导致定位不到控件；已改为按实际可访问名称定位，并精确核对子选项不在目标列表。初始失败记录保留。
- 本轮原生测试均检查夹具目录删除，UI 和图片捕获复用现有临时目录所有权机制。只保留必要的两张截图和小型执行记录，不保存视频或 trace。
- 结束时只读审计没有本轮临时目录残留，旧 pi-acceptance-9NrmPU 保留；三个本轮一次性辅助脚本已删除。

## 文件与界面证据

- 只读 IPC 边界：apps/desktop/src/main/subtask-observer.ts；运行权限及窗口隔离：main/application.ts、main/window-state.ts。
- 子任务消息、摘要和面板：renderer/src/components/timeline/turn.tsx、panels/task-summary.tsx、panels/subtask-panel.tsx；导航：renderer/src/hooks/use-subtask-navigation.ts。
- [浅色纵向列表](../../.artifacts/subagents-observer/light.png) · [深色只读会话标签](../../.artifacts/subagents-observer/dark.png)。截图使用本地测试数据，不作为严格像素一致性证明。

开发启动：在仓库根目录运行 npm run desktop:dev。全局子智能体开关默认关闭，启用后由主代理按明确委派管理。

## 后续 UI 收紧：状态点与过程内创建提示

- 最近任务此前分别渲染状态点和未读点；现在最近任务与项目列表复用一个右对齐指示器。未读/运行状态使用蓝色，错误仍保留红色提示，已读空闲项不显示点。悬浮不改变位置。
- 消息中的大卡片改为 14px 图标、13px 文字、24px 高的创建行，放在 manage_subtasks 对应工作过程位置。读取/列举子任务不重复生成创建提示，同名子任务按实际返回 ID 区分。
- 子任务仍在排队、准备或运行时保持过程展开；结束后与其他工作过程一起折叠。展开历史后仍能点击提示打开只读标签，右侧列表保持原有信息密度。

本次实际运行：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 桌面类型检查 |
| node --import tsx --test test/subtask-creations.test.ts（apps/desktop 内） | 0 | 4 项创建归属单元测试 |
| npm run desktop:test:target -- --file test/e2e/sidebar.spec.ts | 0 | 12 项侧栏 UI |
| npm run desktop:test:target -- subtasks --level ui | 0 | 9 项只读观察、过程折叠、双语与布局 UI |
| npm run desktop:test:target -- --file test/e2e/subtasks.nonvisual.spec.ts --grep 'parent model owns' | 0 | 1 项真实委派、过程提示、标签及重启 |
| npm run desktop:test:target -- --file test/e2e/conversation-ui.spec.ts --grep 'conversation chrome aligns unread dots' | 1 | 5 项通过，末用例的 afterAll 清理超时 |
| npm run desktop:test:target -- --file test/e2e/conversation-ui.spec.ts --grep 'conversation chrome aligns unread dots, context ring and edge scrollbar dark 1000' | 0 | 末用例单独复跑通过 |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项选择器检查 |

首次定向断言复现“一个任务两枚点”和“子任务活动时过程已折叠”，修复后通过。浏览器退出曾超时，不能把那一整次运行记为成功；末用例单独复跑完成，两个已退出测试进程的遗留目录经固定路径、所有权、进程退出及文件白名单核验后删除，见 [清理记录](../../.artifacts/subagents-process/cleanup.json)。

本次只验证受影响范围，不重跑原先完整子任务权限套件。[侧栏结果](../../.artifacts/subagents-process/sidebar.json)、[过程 UI 结果](../../.artifacts/subagents-process/ui.json)、[原生结果](../../.artifacts/subagents-process/native.json)、[退出超时记录](../../.artifacts/subagents-process/chrome-initial.json)、[末用例复跑](../../.artifacts/subagents-process/chrome-retry.json) 与 [实际渲染图](../../.artifacts/subagents-process/process.png) 保留为证据。

本轮不代表整个持续功能 Goal 完成；不提交、发布或制作安装包。

## 后续：主子代理提问与答复

子代理现在通过 ask_parent 向所属主代理提问，主代理通过 manage_subtasks 的 subtasks.reply 答复、subtasks.wait 等待变化。主进程持久化问题和答复，用户在既有只读会话查看。主代理运行时收到内部通知，空闲时不自动重启。停止、超时、存储失败和重启处理及定向证据见 [Harness 接口记录](harness-tools.md)。本轮没有恢复子会话编辑或人工答复入口。
