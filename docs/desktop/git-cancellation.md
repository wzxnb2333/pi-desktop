# Git 取消与退出恢复

本轮修复真实 Windows Git 进程取消，属于 G-UX-04。整体 Goal 保持 active；这里的证据不替代其他功能或全量验收。

## 问题与实现

- 首次单测复现：取消 Git 后调用已经返回，但 Git 启动的两级 Node 辅助进程仍然存活，可以继续写文件。旧逻辑只终止 Git 主进程。失败记录保留在 `.artifacts/git-cancellation/process-red.json`，退出 1。
- `git-process.ts` 统一 Git 调用、标准输入、输出限制、超时及取消。Windows 在主进程仍存活时调用系统目录下的 taskkill 结束该次进程树；等待进程、管道和终止操作结束后才返回。保留数值退出码和 UTF-8 输出，供差异读取使用。
- Git 状态读取传递取消信号，等待并发读取全部结束。差异块暂存和 Worktree 补丁经同一进程管理器写入标准输入。
- GitWorkflow 跟踪活动及排队操作。取消后先清理本次临时索引，再释放仓库队列；拒绝重复活动请求。应用退出时取消活动操作、拒绝尚未启动的排队操作，并等待清理后退出。
- 面板已有取消入口保持可用：隐藏后重开仍可取消，失败保留提交草稿，明确重试后正常提交。取消错误可以即时切换为英文。

## 实际验证

以下命令均从仓库根目录运行，修复后的退出码均为 0。新增单测分两次运行，合计 10 项不同用例；没有为累计数量重复执行。

| 命令 | 结果与证据 |
| --- | --- |
| `npm run desktop:test:target -- --file test/git-cancellation.test.ts` | 当时已有的 8 项通过；`unit-green.json`。此前首个用例修复后独立通过，记录 `process-green.json` |
| `npm run desktop:test:target -- --file test/git-cancellation.test.ts --grep 'status cancellation\|hunk actions'` | 后增的状态取消、差异块标准输入 2 项通过；`status-hunk-green.json` |
| `npm run desktop:test:target -- --file test/git-index-lock.test.ts --file test/git-scope.test.ts --file test/git-branches.test.ts` | 8 项既有索引锁、目录范围、分支和推送目标回归通过；`existing-unit-green.json` |
| `npm run desktop:test:target -- --file test/services.test.ts --grep 'git handles spaces'` | 1 项既有 Unicode 路径、撤销及 Worktree 补丁应用通过；`worktree-patch-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git.nonvisual.spec.ts` | 5 项真实 Electron 流程通过，其中新增取消/退出 2 项；`native-green.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 16 项定向入口检查通过；日志中的故意启动失败和零匹配属于断言对象 |
| `npm run desktop:test:target -- git-cancellation --level all --dry-run` | 正确选择 1 个单测文件及原生文件中的 2 项取消/退出用例，不启动测试 |
| `npm run desktop:check` | 最后一次桌面源码与测试修改后的类型检查通过 |

表内 JSON 均位于 `.artifacts/git-cancellation/`。新单测覆盖预先取消、两级辅助进程、超时、输出上限、启动失败、退出码、重复请求、队列、临时索引、退出拒绝新操作、文件监视器和差异块。

两个新增原生流程使用实际 Git 与本地 pre-commit hook：在 hook 等待时取消或退出，确认辅助进程已结束、临时索引目录已移除、HEAD 与原索引未变化；重开应用/面板后保留可重试状态，解除测试 hook 后正常提交。原有三项流程同时验证本地 bare 远端、冲突处理、索引锁失败和多目录隔离。

## 临时目录与边界

- 测试目录复用现有所有权机制；测试辅助进程仅按本轮记录的 PID 清理。正常、失败及取消都检查残留；没有删除用户索引锁。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/git-cancellation.json` 退出 0，只读审计扫描到 0 个候选目录。此结果只针对脚本管理的目录，不代表整个临时盘为空。
- 本轮验证 Windows x64、本地 Git 和本地假供应商；没有真实账号网络联调、POSIX 进程终止验收或截图/像素验收。没有整套回归、提交、发布或 EXE。
- 取消终止尚未完成的执行，不自动回滚此前已经完成的提交或推送。当前新增取消证据发生于 pre-commit；HEAD 已更新后的 post-commit 取消、迟到回执及相应索引恢复列为下一项，尚未验证。
- 系统拒绝结束进程时保留仓库占用，避免把仍在运行的进程误报为清理完成；该系统错误分支及用户恢复路径尚待验证。

开发启动：`npm run desktop:dev`。日常只复核取消时使用 `npm run desktop:test:target -- git-cancellation`，需要实际退出/重启证据时再加 `--level native`。

后续提交已生效后的取消、索引同步及相关恢复已取得独立证据，见 [提交确认接续记录](git-commit-completion.md)。本页原始运行数量与当时边界保留，不替换为后续结果。
