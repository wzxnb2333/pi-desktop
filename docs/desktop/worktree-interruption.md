# Worktree 强制退出与迁移记录恢复（2026-09-29）

继续 G-UX-04；真实 Goal 保持 active。本轮验证迁移中 Electron 主进程被强制结束后的文件与关联恢复，不代表断电、磁盘损坏、归档删除或恢复索引的全部故障边界已经完成。

## 实际修复

- 原生复现：第一个目标文件原子替换完成后结束主进程，重启仍留下 SOURCE_CHANGE，而聊天继续指向来源目录。失败证据为 repro-red.json。
- 恢复记录升级为版本 2，保存仓库身份、任务关联、来源工作区版本、操作 ID 和逐文件尝试清单。先写入并同步记录，再修改相应文件；成功保存任务关联时，在同一份 desktop.json 中保存 lastTransferId。
- 启动核对提交凭据。未提交只还原已尝试且内容仍匹配的文件，保留来源目录、两边原始索引、未尝试文件和用户草稿；已经提交只完成记录收尾，不回滚提交后的外部编辑，也不自动重跑初始化。
- 冲突、损坏记录、旧版缺少证据、链接或目录身份变化均保留数据并显示内联详情。可重试或打开恢复记录目录；问题处理前不重复迁移或回收有关 Worktree。重试沿用主进程操作、取消及仓库排他机制，拒绝与活动任务、终端和未保存编辑并发修改。
- 回滚和恢复使用同一组可追踪临时文件名。只清理本次记录的普通临时文件；独占创建临时文件发生同名冲突时，不删除其他写入者的文件。
- 原生另复现连续迁移问题：前次已经提交但最终记录更新失败，再迁移会替换唯一提交凭据，重启误报关联变化。新迁移、归档或恢复在更新关联前先完成前次记录；无法完成时保留原凭据并停止，见 receipt-chain-red.json 与 receipt-chain-green.json。
- 中文和英文共享内联恢复入口，保留路径、原始内容和草稿。没有增加模态弹窗或顶部常驻按钮。

主要文件：apps/desktop/src/main/worktree-transfer-journal.ts、worktree-transfer.ts、store.ts、application.ts，shared/worktrees.ts、contracts.ts，以及 renderer 的 panels/worktree-controls.tsx。

## 定向入口

在仓库根目录运行所需层级，不要求全部重复执行：

    npm run desktop:test:target -- worktree-interruption
    npm run desktop:test:target -- worktree-interruption --level native

默认只选 14 项相关单元和 1 项恢复 UI；native 选择 4 项强制退出/冲突流程及 1 项连续迁移回归。单个失败继续用 --file 与 --grep 缩小范围。既有 worktree-migration 的 native 现在有 6 项，历史文档的 5 项是当时数量。

## 本轮实际验证

报告位于 .artifacts/worktree-interruption/。下表保留实际命令与退出码，没有将失败整组改写为通过。

| 命令 | 退出码及结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/worktree-interruption.test.ts --file test/worktree-migration-persistence.test.ts --file test/worktree-transfer.test.ts | 0；当时 21 项通过 | unit-green.json |
| npm run desktop:test:target -- --file test/worktree-interruption.test.ts | 0；新增临时文件冲突后 9 项通过 | recovery-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-controls.spec.ts | 0；5 项 UI 通过 | ui-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-interruption.nonvisual.spec.ts | 1；前 2 项通过，冲突用例最后的英文按钮名称断言不匹配 | native-partial.json |
| npm run desktop:test:target -- --file test/e2e/worktree-interruption.nonvisual.spec.ts --grep 'external edit' | 0；提交后编辑和冲突重试 2 项通过 | native-conflict-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-interruption.nonvisual.spec.ts --grep 'partially copied' | 0；Local 与 Worktree 双向中断/重试 2 项通过 | native-bidirectional-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-migration-recovery.nonvisual.spec.ts --grep 'committed migration' | 0；最终记录失败、初始化失败、迟到取消 3 项通过 | commit-boundary-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-migration-recovery.nonvisual.spec.ts --grep 'another migration reconciles' | 修复前 1，修复后 0；连续迁移 1 项通过 | receipt-chain-red.json / receipt-chain-green.json |
| node --test scripts/desktop-test-target.test.mjs | 0；16 项选择器检查 | 本轮命令输出 |
| npm run desktop:check | 最终 0 | 本轮命令输出 |

去重后取得 22 项相关单元、5 项 UI、8 项真实 Electron 流程和 16 项选择器检查证据。没有全量桌面回归、整仓检查、提交、发布或 EXE 制作；只按原生 fixture 构建必要的开发代码。

其他失败：repro-harness-red.json 是早期强制退出测试超时及清理失败；改用 Electron 主进程实际 PID 后才得到 repro-red.json 的真实恢复断言失败。receipt-filter-red.json 为 Playwright 用例名称误加行首锚点而零匹配，退出 1，未计入通过。初次类型检查发现临时文件后缀被推断为 UUID 模板字面量，明确为 string 后通过。构建中现有 Zod 注释与 NO_COLOR 提示未作为本轮代码错误或新增依赖处理。

## 缓存及未完成项

后续原生用例均在结束后确认其数据目录已清理。早期超时用例遗留 D:/systemp/pi-acceptance-9NrmPU；已核对并结束其自有 Electron 进程。删除该确切目录的安全重试仍被自动审批拒绝，工具仅返回 blocked by policy，没有给出进一步原因。没有绕过拒绝或把残留登记为清理成功。

执行 node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-interruption.json，退出 0；只读审计显示 scanned=1、skipped=1。部分清理后的 Chromium 缓存缺少完整 fixture 标识，通用清理器不会仅凭 pi-* 名称删除。

下一轮继续归档删除、恢复索引与外部并发修改的中断处理，本轮没有把这些边界登记为通过。整机突然断电和文件系统损坏也未进行真实验证。
