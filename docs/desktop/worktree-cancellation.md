# Worktree 取消与停止失败恢复（2026-09-29）

本轮继续 G-UX-04，完成工作区长操作的取消传递、进程终止失败恢复和相关输入体验。真实 Goal 保持 active，Worktree 的全部持久化故障边界尚未完成复核。

## 发现与实现

- 实际复现迁移正在捕获快照时，取消信号没有传入快照服务，操作仍等待子进程退出或超时。测试在捕获、文件清单和对象读取边界分别注入带两级派生进程的真实 Git 等待命令，旧实现首先在捕获场景失败。
- 迁移的捕获、预检、对象读取和文件替换均传递取消信号；替换前复核文件版本，取消后执行必要的逆向恢复。恢复过程不复用已取消的信号，避免只撤销一半；不会改变用户暂存区。归档与恢复中的仓库归属检查也接通取消。
- 快照 stdin 写入与二进制对象读取复用受管 Git 进程服务，取消、超时和输出超限均等待进程树及管道结束，再释放临时索引。增加 Buffer 输入/输出支持，保留原始二进制字节和原有文本调用行为。
- 长操作注册自己的 Git 取消控制器。停止 IPC 等待系统终止尝试；失败保留正在运行的记录，用户可以对同一次操作重试。超时同样中止所属操作，不能由后续命令继续越过取消边界。
- 退出预检同时检查普通 Git 与长操作的进程。终止失败时保留窗口，提供重试或返回应用；返回后两类服务均恢复接收请求。正式退出仍等待操作恢复和落盘完成。
- Worktree 表单按任务和目录保留起始引用、错误及请求状态，隐藏再打开不会丢草稿或重复启动。错误即时双语切换；正在运行的旧操作不被较新的占用查询记录隐藏。取消去重，失败可重试，成功应答后等权威操作记录结束再恢复按钮。

## 定向入口

在仓库根目录运行：

```powershell
npm run desktop:test:target -- worktree-cancellation
npm run desktop:test:target -- worktree-cancellation --level native
```

默认入口为新增的 5 项单元和 3 项 UI；native 仅执行 2 项真实 Windows 进程停止失败及退出恢复流程。只改表单时选 `--level ui` 或明确文件与用例。不要因一次按钮修改连带完整 Git、Worktree 或桌面回归。

## 实际验证

以下最终运行均退出 0；同一用例重跑不重复计数。报告位于 `.artifacts/worktree-cancellation/`。

- `npm run desktop:check`：最终桌面类型检查通过。
- `npm run desktop:test:target -- --file test/worktree-cancellation.test.ts --file test/worktree-transfer.test.ts --file test/worktree-archives.test.ts --file test/round-snapshots.test.ts --file test/operations.test.ts`：18 项通过；含二进制/CRLF、原始索引、嵌套目录、外部冲突、部分迁移回滚、归档恢复及操作持久化。报告 `related-unit-green.json`。
- `npm run desktop:test:target -- --file test/git-cancellation.test.ts --grep 'Git cancellation waits|Git timeout terminates|Git output limits|Git preserves stdout'`：只选 4 项共享进程执行回归，覆盖完整进程树、超时、输出边界及数字退出码；报告 `git-regression-green.json`。
- `npm run desktop:test:target -- --file test/e2e/worktree-controls.spec.ts`：3 项 UI 通过；报告 `ui-green.json`。
- `npm run desktop:test:target -- worktree-cancellation --level native`：2 项通过；报告 `native-green.json`。真实 post-checkout hook 启动两级辅助进程，通过无效的测试进程 SystemRoot 触发实际终止器启动失败，验证再次取消、退出重试、草稿及源文件保留。修复环境后可重新创建并打开新任务。
- `npm run desktop:test:target -- worktree --level native`：仅 3 项既有迁移、冲突和归档 UI 流程通过，不包含自动回收时钟场景；报告 `lifecycle-native-green.json`。
- `npm run desktop:test:target -- --file test/e2e/git-cancel-retry.nonvisual.spec.ts --grep 'Git shutdown failure'`：1 项既有 Git 退出失败及返回应用回归通过；报告 `git-shutdown-green.json`。
- `npm run desktop:test:target -- --file test/e2e/project-action-recovery.nonvisual.spec.ts --grep 'cancelling and quitting real project actions'`：1 项真实 PTY 取消/退出回归通过；报告 `project-action-shutdown-green.json`。
- `node --test scripts/desktop-test-target.test.mjs`：16 项选择器检查通过。

去重后为 22 项相关单元、3 项 UI、7 项原生流程，另有选择器 16 项。没有将这些证据描述为全项目验收。

失败记录保留：`transfer-red.json` 是修复前的真实取消缺陷；`ui-fixture-red.json` 是夹具缺少必需 settings/automations 导致的 schema 错误；`ui-message-red.json` 是错误字符串包含 Error 前缀，断言错误地要求完整文本相等。补全夹具并对实际双语错误内容断言后，三项 UI 全部通过。初次补丁因换行转义被工具拒绝，没有修改文件；重新应用后正常验证。

## 缓存与边界

新增用例复用所有权临时目录；原生用例结束后断言测试数据目录已删除。执行：

```powershell
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-cancellation.json
```

退出 0，候选残留 0；本轮辅助 Node 进程检查无残留。没有截图、视频、trace、提交、发布或 EXE；原生验证仅构建需要的开发产物。

下一项核对迁移文件完成后任务配置落盘失败，以及归档删除/恢复索引阶段中断和外部并发修改的恢复流程。本轮的正常生命周期回归不能替代这些尚未验证的故障场景。
