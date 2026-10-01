# Worktree 归档回收与中断恢复（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。本轮修复归档删除到一半后仍把残缺目录当作可运行工作区的问题，并补齐旧目录回收失败后的继续、恢复和占用查看入口。

## 实际行为

- 完整快照及暂存区保存并校验后，先持久化归档移动凭据，再用 Git 将完整工作区移到应用拥有的待回收目录，最后删除经过备份校验的文件。任务执行目录不会留在正在逐文件删除的位置。
- 凭据记录原目录和 Git 元数据目录身份、Git 指向、索引指纹及移动阶段。移动前结束进程，重启核对原目录后恢复 ready；移动后结束进程，重启保留 archived 和待回收状态，不能向残缺工作区发送任务。
- 继续回收会验证目录身份、当前索引、HEAD、锁及每个剩余文件的内容。外部新增/修改文件、目录替换、暂存区变化均阻止回收并保留现场；缺失的自有 Git 指针可在验证元数据及反向路径后修复。
- 回收失败时可以先恢复工作区。仍占用原分支的旧目录保留，恢复使用已有的新分支回退路径。后续“继续回收旧目录”只处理旧目录，不会归档或终止已经恢复的工作区。
- Worktree 管理沿用原面板，增加待回收说明、路径、占用量和继续按钮。进度、取消、失败、即时语言切换复用既有操作记录与主进程权限，不增加顶部按钮或叠加窗口。
- 保存意图失败、操作取消、重启及回收完成均具有明确状态。原生测试等待操作成功，而不是仅看到 archived 就认为文件回收已经完成。

主要实现为 apps/desktop/src/main/worktree-reclamation.ts、worktree-archives.ts、application.ts、shared/worktrees.ts、shared/contracts.ts、shared/operation-messages.ts 和 renderer/src/components/shell/worktree-manager.tsx。

## 定向入口

按本轮改动选择其中一个层级，不要求全部执行：

    npm run desktop:test:target -- worktree-reclamation
    npm run desktop:test:target -- worktree-reclamation --level native

默认只执行新的 8 项回收单元测试；native 选择 3 项中断/取消流程和 1 项既有正常归档流程。15 项原有归档/恢复单测保留在 worktree-archives.test.ts，共享真实 Git 夹具已移到 test/fixtures/worktree-archive.ts。单个场景可继续使用 --file 和 --grep，不带上所有 Worktree、终端或 Git 回归。

## 本轮验证

证据位于 .artifacts/worktree-reclamation/。失败运行保留原始结果，不把部分通过重写为整轮通过。

| 命令 | 退出码与结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'interrupted directory reclamation' | 修复前 1：残缺工作区仍为 ready | partial-removal-red.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'interrupted directory reclamation\|archives and restores' | 0，最初 2 项回归通过；新用例随后移到独立测试文件 | partial-removal-green.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'archive intent\|archive cleanup' | 1，6 项通过、1 项失败：缺失 .git 指针导致真实 Git 拒绝回收；已修复并纳入新文件通过运行 | pointer-red.json |
| npm run desktop:test:target -- worktree-reclamation | 0，8 项回收单元通过 | unit-green.json |
| npm run desktop:test:target -- worktree-reclamation --level native | 整轮 1；新增原生文件的 3 项通过，既有正常流程因未等待操作结束而失败 | native-partial.json |
| npm run desktop:test:target -- --file test/e2e/worktree-lifecycle.nonvisual.spec.ts --grep 'managed archive UI' | 0，修正完成时点判断后的 1 项正常归档/恢复通过 | native-lifecycle-green.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --file test/localization.test.ts | 0，18 项既有归档/恢复及词条单元通过 | unit-regression-green.json |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项选择器检查通过 | 本轮命令输出 |
| npm run desktop:check | 最终代码修改后退出 0 | 本轮命令输出 |

去重后为 26 项相关单元、4 项真实 Electron/Git 流程，以及 16 项选择器检查。原生流程在归档意图落盘后、实际删除第一个文件后终止真实主进程并重启；另验证操作取消、外部新增文件、先恢复再清理、原暂存/未暂存内容、主仓库索引、草稿与即时英文切换。只使用本地仓库与假供应商。

所有本轮原生夹具结束后的目录清理断言通过。只读缓存审计命令：

    node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-reclamation.json

退出 0，scanned=1、skipped=1，仍仅有前轮受阻的 D:/systemp/pi-acceptance-9NrmPU（201820 字节）；本轮没有新增测试目录残留。该旧目录的删除曾被自动审批拒绝，本轮没有绕过或把它计为清理成功。

## 验证边界与下一项

- 本轮没有执行全套桌面/整仓测试、提交、发布或制作 EXE；原生夹具只构建必要的开发 main/preload，截图、视频和 trace 关闭。
- 两个真实进程结束点及取消流程不代表整机断电、磁盘损坏或每一条指令位置都已验收。
- 未登记为完成的接续项：恢复普通文件时的部分写入，以及独立索引准备阶段中断后的临时文件清理。
- 待回收目录在验证完成前属于恢复数据，不当作可直接删除的缓存。遇到外部变更时保留目录，由用户处理后重试。
