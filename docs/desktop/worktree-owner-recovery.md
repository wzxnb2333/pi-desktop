# Worktree 恢复关联聊天（2026-10-01，本地时间）

接续 G-UX-04 的缺失原任务恢复项。归档文件已恢复，但原任务已进回收站或永久删除时，重新建立可用的任务关联；不恢复已删除的会话历史，不自动运行模型。

## 修复与边界

- 原生复现：先创建本地任务、再更新 Worktree 关联的两次保存之间失败，会留下不完整任务。现在候选聊天、真实执行目录、分支、基准和 Worktree 所属关系在同一次原子提交后发布。
- 提交前重新检查取消、退出、调用聊天、目录配置、原所有者及 Worktree 记录。失败或取消不向公开列表插入任务；旧后台保存不能覆盖已提交的关联；重复恢复复用已有所有者。
- 保留原 snapshotThreadId，原任务已删除也能使用原恢复证据。仍然存在的原任务保留身份和草稿；已迁移到本地的原任务不会被这个关联方法强制搬回 Worktree。
- 文件恢复和聊天关联分阶段持久化。文件已经 ready 而聊天缺失时，管理面板显示双语说明和“恢复关联聊天”。重试不重放文件恢复，不改外部新增内容及 Git 暂存区。
- 对已恢复目录检查真实路径、所属仓库和原分支。被替换为外部 junction 或切换分支时拒绝关联，保留现有文件。完整恢复期间的 --no-checkout 嵌套目录尚未存在，因此真实执行目录校验仅用于 ready 分支；此处的初次回归失败已修复并保留证据。
- 强制退出测试在关联候选写入临时状态文件、正式发布之前杀死 Electron。重启不产生幽灵任务，不自动重放模型，用户主动重试后可以继续。这不证明“新建 Worktree 的 Git 创建进程被强杀”已经恢复，该项仍未完成。

## 主要文件

- apps/desktop/src/main/store.ts：restoreWorktreeOwner 私有候选、提交校验和过期快照保护。
- apps/desktop/src/main/application.ts：恢复操作调用原子关联，传递取消和退出校验。
- apps/desktop/src/main/worktree-archives.ts：ready 重试验证，不重复覆盖恢复文件。
- apps/desktop/src/renderer/src/components/shell/worktree-manager.tsx：缺失关联提示与恢复按钮。
- apps/desktop/src/shared/operation-messages.ts：中英文提示、错误和按钮。
- test/worktree-owner-persistence.test.ts、test/e2e/worktree-owner-recovery.nonvisual.spec.ts：原子关联、取消、并发、重启、路径保护和真实文件工具验证。

## 本轮验证

从仓库根目录运行。表内测试后缀的前缀为 npm run desktop:test:target --；报告位于 .artifacts/worktree-owner-recovery/。

| 命令或测试后缀 | 退出码 | 实际结果与证据 |
| --- | --- | --- |
| --file test/e2e/worktree-owner-recovery.nonvisual.spec.ts（修复前） | 1 | 复现残留任务，native-red.json |
| worktree-owner --level unit | 0 | 10 项，unit-final.json |
| --file test/worktree-owner-persistence.test.ts --grep retrying（加固前） | 1 | 复现分支和 junction 保护缺失，identity-red.json |
| --file test/worktree-owner-persistence.test.ts --grep retrying（最终） | 0 | 2 项，identity-final.json，包含在上述 10 项内 |
| worktree-owner --level native | 0 | 3 项新增原生流程及 1 项既有归档 UI，native-with-identity-checks.json |
| --file test/worktree-archives.test.ts --grep "complete nested checkout"（初次） | 1 | 提前校验未生成的嵌套目录，nested-guard-red.json |
| --file test/worktree-archives.test.ts --grep "complete nested checkout"（最终） | 0 | 嵌套 checkout、暂存、二进制及删除文件正常恢复，nested-final.json |
| --file test/e2e/worktree-owner-recovery.nonvisual.spec.ts --grep "failed restored owner linkage"（最终） | 0 | ready 路径校验调整后复核双语 UI、外部文件及原生 read 工具，native-final-retry.json |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项选择器检查；其预期故障子用例不代表最终失败 |
| npm run desktop:check | 0 | 最终桌面类型检查 |

按不同场景计数：11 项业务单元、4 项原生流程、16 项选择器检查。没有运行全套回归或真实线上供应商。原生开发构建仍有第三方 Zod 注释及终端颜色环境提示，不改依赖来掩盖提示。

## 缓存与日常验证

原生夹具关闭后逐项断言临时目录已删除；单元复用既有临时目录所有权机制。只读审计命令为 node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/worktree-owner-recovery/temp-audit.json，退出 0，仅保留不属于本轮的旧 pi-acceptance-9NrmPU，没有新增残留；没有执行删除命令。

worktree-owner 默认仅执行 10 项单元；--level native 仅选本页 4 项原生流程。只调整关联失败时可用 --file test/e2e/worktree-owner-recovery.nonvisual.spec.ts --grep "failed restored owner linkage"。修改归档路径校验需另选完整嵌套 checkout 的既有单元，不追加所有 Worktree 测试。

开发启动命令：npm run desktop:dev。没有提交、发布、EXE 打包或开发子代理；没有生成截图、视频、trace。整体 Goal 保持 active，新建 Worktree 硬退出恢复及多目录配置原子保存仍待推进。
