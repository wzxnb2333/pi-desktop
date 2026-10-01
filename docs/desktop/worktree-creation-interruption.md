# 新建 Worktree 中断记录与聊天恢复（2026-10-01，本地时间）

接续 G-UX-04。本轮补齐已经完成 Git checkout、但尚未提交任务关联时的恢复，并保守阻止未确认完成的 Git 创建被接管。**Git 创建任意阶段的完整恢复仍未完成**，不能用本轮通过的关联场景代替。持续 Goal 保持 active。

## 已实现的流程

- 在 Git 启动前持久化创建记录，记录项目、目录、起始提交、受管分支和工作目录。启动时同步记录直接子进程标识；Git 正常结束后记录完成阶段及目录身份。
- 任务提交前硬退出不再只剩一个没有入口的目录。重启后在“项目动作 → Worktree 管理 → 中断的 Worktree 创建”显示保留目录，支持重新检查、查看目录和显式恢复。沿用现有紧凑管理面板，中英文立即切换。
- 恢复核对项目目录、仓库、分支、真实路径、目录身份和 Git 锁。聊天与受管 Worktree 一起原子保存；保存失败、取消和重启保留恢复记录及外部修改，不产生幽灵任务。
- 同时恢复会受到现有操作去重约束；完成后重复请求返回已有聊天。恢复不覆盖暂存区或工作文件，不启动模型、不重放环境初始化，不修改来源草稿。
- 若任务关联已经提交、但清除创建记录前硬退出，启动时仅清除已经被受管记录认领的收据，不重复创建聊天。收据临时写入文件会随成功确认清理；孤立或损坏临时记录显式显示错误。
- 关联回归发现任务创建把父操作信号改成组合信号后，Git 终止失败不能传回父操作。现改为注册父子取消关系，保留独立取消能力，并把真实终止失败及重试结果传回 UI 和退出流程。

## 不能自动恢复的边界

- 直接 Git 启动进程退出，不等于它的 hook 后代已经停止。实测硬退出可以留下后代进程，所以 `prepared` 阶段仍不能只凭 PID 消失自动接管或删除分支。Git 进程及其 hooks 正常关闭时，在子进程 close 回调中同步写入 `git-complete` 检查点；重启后还要再次证明工作树已登记、分支匹配、暂存区存在、无锁且基线祖先关系成立，才升级为 `checkout` 并开放恢复。检查点缺失或证明失败继续显示保留记录。
- 缺少完成检查点、部分 checkout、缺失索引、遗留锁、损坏记录或目录身份变化，均保留数据并报告问题。目前没有自动补写部分 checkout，也不会解除不明 Git 锁。部分 checkout 仍需后续独立修复流程，不能借不完整检查点自动接管。
- `thread.fork` 直接创建 Worktree 的路径仍未纳入本轮收据服务。多目录配置的原子保存已由项目配置提交队列接入并完成定向验证，但不会替代 Git 创建中断、部分 checkout 和 fork 收据的后续工作。
- 没有新增模型的任意 IPC 权限、没有自动审批恢复操作。已有 Harness H-01–H-07 的验收记录保留，本轮恢复证据不冒充新模型接口验收。

## 关键实现

- `apps/desktop/src/main/worktree-creations.ts`：收据、阶段/进程/目录校验、保留与清理。
- `apps/desktop/src/main/git.ts`、`git-process.ts`：创建检查点、进程启动通知和可等待的父子取消。
- `apps/desktop/src/main/application.ts`：创建登记、启动核对、`worktree.creationRecovery` 及聊天关联原子提交。
- `apps/desktop/src/shared/contracts.ts`、`worktrees.ts`、`operation-messages.ts`：受校验 IPC、状态与双语提示。
- `apps/desktop/src/renderer/src/components/shell/worktree-manager.tsx`：现有管理面板中的恢复入口。
- 新增 `worktree-creations.test.ts`、`git-parent-cancellation.test.ts` 和 `e2e/worktree-creation-interruption.nonvisual.spec.ts`。

## 本轮定向验证

根目录执行。表内省略的文件选择前缀为 `npm run desktop:test:target --`；所有证据位于 `.artifacts/worktree-creation-interruption/`。

| 命令或选择 | 结果 | 证据 |
| --- | --- | --- |
| worktree-creation-interruption git-cancellation --level unit | 退出 0，20 项单元 | unit-final.json |
| --file test/worktree-creations.test.ts（后续复核） | 退出 0，10 项，不重复计数 | creation-units-final.json |
| --file test/git-parent-cancellation.test.ts | 退出 0，2 项父子取消 | parent-cancellation-fixed.json |
| --file test/e2e/worktree-creation-interruption.nonvisual.spec.ts --grep 'hard exit before task registration' | 退出 0，1 项中英文入口、源草稿、索引和假供应商实际读取 | native-entry-final.json |
| 同文件 --grep 'a real interrupted Git checkout' | 退出 0，1 项真实 Git/hook 强退后的保守拒绝 | native-git-checkpoint.json |
| 同文件 --grep 'failed and cancelled|hard exit after task' | 退出 0，2 项保存失败、取消、并发/重复请求及提交后强退 | native-commit-recovery.json |
| --file test/e2e/task-creation.nonvisual.spec.ts --grep 'failed worktree task|baseline preparation|failed worktree registration' | 退出 0，3 项原有创建回收/保留流程 | native-existing-creation.json |
| --file test/e2e/worktree-cancellation.nonvisual.spec.ts | 退出 0，2 项真实停止失败、退出和重试 | native-cancellation-fixed.json |
| --file test/e2e/worktree-lifecycle.nonvisual.spec.ts --grep 'same chat migration' | 退出 0，1 项迁移、工具 cwd、草稿、索引和重启 | native-migration.json |
| node --test scripts/desktop-test-target.test.mjs | 退出 0，16 项选择器检查 | selector-final.log |
| npm run desktop:check | 最终退出 0 | desktop-check.log |

去重后 22 项业务单元、10 项原生流程通过，选择器另计 16 项，按小范围分次执行。未执行完整桌面套件或整仓检查。新增日常入口 `npm run desktop:test:target -- worktree-creation-interruption` 默认仅 12 项单元；`--level native` 仅对应 4 项原生流程。启动仍为 `npm run desktop:dev`。

保留首次失败证据：`native-red.json` 复现缺少恢复入口；`native-process-timeout.json`、`native-restart-timeout.json` 是带活跃 hook 后代的 Playwright 崩溃连接收尾超时。测试后来先结束仅属于夹具且已记录 PID 的 hook 后代，再等待旧连接关闭和重启，保留了真实应用硬退出；这不是“活跃后代存活期间重启”的通过证明。`native-duplicate-expectation.json` 是测试误以为不同请求 ID 可同时运行，最终按已有互斥契约验证一个成功、另一个明确拒绝、后续重试幂等。`native-cancellation-red.json` 和 `parent-cancellation-red.json` 复现了实际取消传递问题，修复后对应单元和两项原生回归通过。早期 `unit-empty-red.json` 的“死亡 PID 足以回收”假设已废弃，最终测试要求保留不确定状态。新增测试一次类型检查错误也已修复。

## 缓存与未完成项

原生验证只使用本地假供应商和临时仓库，关闭截图、视频、trace。普通及最终失败/成功流程均核对夹具清理；两次超时的测试专用遗留进程已处理，并另核对其确切目录不存在。最终只读目录审计保存在 `temp-audit.json`，旧的不可确认归属目录不自动删除。没有开发子代理、提交、发布或制作 EXE。

下一项仍是未完成 Git 创建阶段的独立完成证明、部分 checkout 恢复和 fork 入口接入。多目录配置原子性已完成定向验证，不能替代这些恢复流程。只有全部纳入项取得证据，整个 Goal 才能标记完成。
