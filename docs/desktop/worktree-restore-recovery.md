# Worktree 恢复暂存区与重启（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。本轮完成恢复暂存区的并发保护、取消、保存失败和主进程强制结束后的重试；归档目录删除中断、恢复文件部分写入和断电仍未登记为通过。

## 实际改动

- 两项真实 Git 回归复现：恢复文件期间外部进程写入的暂存区被覆盖，已有 index.lock 也未阻止恢复。原来的临时文件直接 rename 发布路径已替换。
- 恢复先准备独立索引，使用标准 index.lock 排他发布。发布前重新核对索引、HEAD、完整文件快照；校验失败保留外部暂存、锁与文件。自己的锁被外部替换时，即使字节完全相同也不清理它。
- 准备好的索引以同卷硬链接保留身份凭据。主进程在持锁或发布之后被强制结束，重启可以辨认自己的锁与已经发布的索引，继续完成恢复。索引已经生效时不重复写入；Git 刷新索引元数据但暂存内容未变时，保留现有字节和文件身份。
- 最终配置保存失败会恢复内存中的未完成状态，保留索引凭据，下一次可以重试。成功保存后清理凭据，清理失败显示独立提示。
- 校验使用独立索引的跟踪信息，保留可执行位、删除文件、原始二进制及暂存/未暂存差异。最初实现中可执行位校验失败已实际复现并修复，没有降低断言。
- Worktree 管理在原面板中显示“恢复未完成，可重试”和处理说明，错误随语言立即切换；没有新增顶部按钮或弹窗。

主要文件：apps/desktop/src/main/worktree-restore-index.ts、worktree-archives.ts、round-snapshots.ts、shared/operation-messages.ts，以及 renderer/src/components/shell/worktree-manager.tsx。

## 定向入口

从仓库根目录按改动选择一个层级：

    npm run desktop:test:target -- worktree-restore
    npm run desktop:test:target -- worktree-restore --level native

默认只执行 15 项归档/恢复单元测试。native 执行 4 项恢复故障场景，加 1 项既有归档管理流程。只改某个场景时继续用 --file 和 --grep；不会带上迁移、终端或全套 Git 测试。

## 本轮验证

报告位于 .artifacts/worktree-restore/，失败运行保留原始退出码。

| 命令 | 退出码与结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'restoration refuses' | 修复前 1，两项均未抛出预期冲突；修复后纳入通过单测 | index-conflicts-red.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'executable index modes' | 初次实现 1；修复后纳入通过单测 | executable-mode-red.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --file test/round-snapshots.test.ts --file test/localization.test.ts | 0，19 项相关单元通过 | unit-final-green.json |
| npm run desktop:test:target -- worktree-restore --level native | 0，5 项真实 Electron/Git 流程通过 | native-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-restore.nonvisual.spec.ts --grep 'state-save failure' | 0；增加外部索引版本刷新后，保留全部字节和文件身份，重启重试通过 | native-refreshed-index-green.json |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项选择器检查通过 | 本轮命令输出 |
| npm run desktop:check | 最终 0 | 本轮命令输出 |

原生场景包含外部索引锁、面板失败提示/即时英文切换/重启后重试、两个实际主进程终止点、真实配置落盘失败以及既有正常归档恢复。仅使用隔离的本地 Git 仓库和假供应商。每个原生用例结束断言其数据目录已经删除。

去重后为 19 项相关单元、5 项原生流程、16 项选择器检查，不把同一场景的重跑重复计数。最终只读清理审计命令 node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-restore.json 退出 0：scanned=1、skipped=1，仅余前轮的 201820 字节目录，本轮没有新增残留。

没有运行全量桌面或整仓检查，没有提交、发布或制作 EXE。原生 fixture 仅构建必要的开发 main/preload；现有 Zod 注释与 NO_COLOR 提示没有作为依赖改动处理。

## 未完成边界

- 下一项继续归档删除过程中被中断、恢复普通文件部分写入及相关失败反馈。
- 本轮两个强制结束点不等于整机断电、磁盘损坏或恢复的任意指令位置都已验证。
- 独立索引准备阶段被强制结束可能留下准备临时文件；本轮验证的是持有标准索引锁及已经发布后的恢复，不宣称准备阶段清理已经完成。
- 前轮 D:/systemp/pi-acceptance-9NrmPU 残留的删除曾被自动审批拒绝，本轮没有改用其他方式绕过，也没有将其登记为清理成功。
