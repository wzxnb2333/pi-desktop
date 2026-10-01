# 项目与配置任务创建恢复（2026-09-30）

本轮接续 G-UX-04，覆盖项目任务、创建 Worktree 的任务，以及自动化/产品子任务的配置回调。开发没有使用子代理；子任务测试使用本地假供应商。独立聊天和目录绑定的上一轮证据继续保留。

## 实际修复

- 原生复现：保存失败后新任务已经出现在公开列表，后续 UI 保存会把失败任务写回磁盘。现在任务、可选受管 Worktree 和自动化/子任务关联一起原子提交，落盘后才发布，旧排队快照不能撤销关联。
- 创建请求携带稳定 UUID；同帧点击合并，失败重试复用身份，本地任务与 Worktree 使用不同身份。迟到结果不抢走新导航，保留原任务草稿、附件及未保存表单保护。持相同请求身份重试可跨重启复用已保存任务；没有声称 Renderer 重启后会恢复尚未保存的请求身份。
- 提交前再次核对项目目录、取消信号、父任务状态和权限上限。已停止的自动化或子任务不能留下孤立聊天，权限不得超过父任务或本次委派要求。
- 新 Worktree 创建失败只移除仍干净的本次 checkout，并按原始提交值删除本次分支；外部修改会阻止自动移除，提示路径供用户从项目 Worktree 列表重新打开。重新打开时在同一次任务提交中保存真实 cwd、分支和基准。
- 本次新建的快照目录可以回收；已有恢复目录/文件保留，目录身份变化时拒绝清理，已提交快照释放清理所有权。检查发现早期清理实现会删除预先存在的同名快照文件，已补回失败用例并修复。清理错误区分 checkout 保留和分支/快照未清理，不声称已经消失的目录仍存在。
- 环境初始化在任务注册成功后启动。若启动失败，保留已创建任务并提示从项目动作重试；普通任务创建不调用对话模型。

## 主要文件

- apps/desktop/src/main/store.ts：私有候选、关联原子提交及过期快照保护。
- apps/desktop/src/main/application.ts：请求去重、创建取消、Worktree 准备/回收和配置回调。
- apps/desktop/src/main/round-snapshots.ts：准备目录的所有权、身份校验及释放。
- apps/desktop/src/shared/contracts.ts、chat-messages.ts：可校验请求身份和双语错误。
- apps/desktop/src/renderer/src/state/app.tsx：按创建目标保留失败请求身份及导航保护。
- test/task-creation-persistence.test.ts、test/e2e/task-creation.nonvisual.spec.ts、test/e2e/chat-recovery.spec.ts：受影响范围回归。

## 本轮实际验证

以下测试命令从仓库根目录执行，文件选择命令前缀均为 `npm run desktop:test:target --`。失败运行保留退出 1，不改写为通过。

| 命令后缀或命令 | 结果 | 证据 |
| --- | --- | --- |
| --file test/e2e/task-creation.nonvisual.spec.ts（首次） | 退出 1，复现幽灵任务 | .artifacts/task-creation/project-red.json |
| --file test/e2e/task-creation.nonvisual.spec.ts（初次修复） | 退出 0，1 项 | project-fixed.json |
| --file test/task-creation-persistence.test.ts（最初 5 项） | 退出 0 | unit-first-pass.json |
| task-creation --level unit | 退出 0，16 项关联单元 | unit-final.json |
| --file test/task-creation-persistence.test.ts --grep 'failed task cleanup\|snapshot cleanup' | 退出 0，新增 2 项所有权单元 | snapshot-unit-final.json |
| --file test/e2e/chat-recovery.spec.ts | 退出 0，6 项 UI | ui-final.json |
| --file test/e2e/form-navigation.spec.ts --grep 'new tasks are created only after' | 退出 0，1 项关联 UI | navigation-ui-final.json |
| --file test/e2e/task-creation.nonvisual.spec.ts（扩展后） | 退出 0，6 项原生流程 | native-first-pass.json |
| --file test/e2e/task-creation.nonvisual.spec.ts --grep 'baseline preparation'（保护旧数据的断言） | 退出 1，复现旧快照被删 | baseline-ownership-red.json |
| --file test/e2e/task-creation.nonvisual.spec.ts --grep 'baseline preparation\|reopening persists\|clean checkout' | 退出 0，3 项受修复影响的流程 | native-worktree-final.json |
| --file test/e2e/automation-queue.nonvisual.spec.ts --grep 'worktree automation waits' | 退出 0，1 项真实初始化关联 | automation-native.json |
| --file test/e2e/subtasks.nonvisual.spec.ts --grep 'a real independent Worktree' | 退出 0，1 项真实父子 Worktree 关联 | subtask-native.json |
| node --test scripts/desktop-test-target.test.mjs | 退出 0，16 项选择器测试 | selector-final.log |
| npm run desktop:check | 最终退出 0 | desktop-check.log |

未写全路径的证据均在 `.artifacts/task-creation/`。去重后本轮 18 项单元、7 项 UI、9 项原生流程通过，选择器另计 16 项。一次中途类型检查失败来自新增测试缺少 schema 要求的 reveal 字段，补齐 false 后类型检查和对应原生场景通过。baseline-before-ownership.json 中早期“删除已有文件”的不充分断言不作为旧数据保护证据。

日常选择：`npm run desktop:test:target -- task-creation` 默认 18 项单元及 4 项创建/导航 UI；`--level native` 仅选择 7 项创建流程及 2 项初始化关联。修复单一故障时用 --file/--grep；不自动运行完整桌面回归。启动：`npm run desktop:dev`。

## 边界与后续

- 夹具关闭后断言目录已删除；只读审计报告为 .artifacts/temp-cleanup/task-creation.json。没有截图、视频、trace、全套检查、提交、发布或 EXE。
- 本阶段验证普通失败、取消和持久化后的重启；尚未证明新 Worktree 在 Git 创建进程被强杀或应用硬退出时的全部恢复路径。既有 Worktree 迁移、归档的其他证据不能代替这项。
- 归档记录恢复时缺少原任务的关联创建、多目录配置的原子保存继续留在台账，不据此声称完整恢复。下一轮先处理新建 Worktree 的中断与恢复记录，再继续多目录配置。
- 真实 Goal 本轮查询为 active，不修改目标正文、不新增 token 预算、不标记整体完成。代审批语义仍见 approval-review.md，与持续 Goal 分开管理。

后续进展（2026-10-01，本地时间）：缺失归档任务的关联创建已单独修复并取得取消、硬退出及原生重试证据，见 [恢复关联聊天](worktree-owner-recovery.md)。本页原始验收记录保留；新建 Worktree 的 Git 创建中断及多目录配置原子性仍未完成。

后续进展（同日）：已经完成 checkout、尚未提交聊天关联的硬退出新增持久化收据和管理入口，保存失败、取消及重复恢复已有定向证据，见 [创建中断记录](worktree-creation-interruption.md)。未确认 Git 完成的阶段仍保留并拒绝自动接管，部分 checkout、fork 入口和多目录配置继续未完成。
