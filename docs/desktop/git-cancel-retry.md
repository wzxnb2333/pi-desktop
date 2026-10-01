# Git 停止失败与退出重试

G-UX-04 接续。持续 Goal 保持 active，本轮只处理 Git 终止器失败后的取消和正常退出恢复。

## 已完成行为

- 真实 Windows 终止器启动失败会经 `git.cancel` IPC 返回错误。操作仍保持进行中，保留仓库互斥、暂存区和提交草稿；取消按钮恢复可用，再次点击结束同一批进程，不重新启动 Git。
- AbortSignal 仅触发一次；每个仍存活的调用登记自己的停止函数。失败的终止尝试可以重试，成功的尝试在管道关闭前不会重复发送。主操作仍等待进程及后续清理结束才释放仓库队列。
- 退出先尝试停止活动 Git 命令，失败显示“重试 / 返回应用”。返回后窗口、设置和其他服务继续可用；再次退出重新检查。停止阶段成功后，应用服务和仓库操作并行完成清理，避免依赖服务取消的操作互相等待。
- 最后一个主窗口关闭也走相同流程，确认清理前保留窗口。等待期间重复点击退出或关闭不会绕过清理，也不叠加错误窗口。
- 错误及原生退出提示支持中英文；没有新增常驻工具栏控件，没有改动用户工作区的权限或 Git 配置。

关键实现（相对仓库根目录）：

- `apps/desktop/src/main/git-process.ts`：按信号登记活动进程、传回终止错误并允许重试。
- `apps/desktop/src/main/git-workflow.ts`：等待取消结果、退出预检与失败后解除关闭状态。
- `apps/desktop/src/main/application.ts`：IPC 等待实际取消。
- `apps/desktop/src/main/index.ts`：最后窗口保留、重复退出保护、恢复与重试。
- `apps/desktop/src/shared/review-messages.ts`：双语提示。

## 定向验证

均从仓库根目录运行；12 项不同单元、5 项不同原生流程及 16 项测试选择器回归取得通过证据。没有运行全套测试。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- git-cancel-retry` | 0 | 2 项真实进程失败/重试及仓库锁单测；`unit-green.json` |
| `npm run desktop:test:target -- git-cancellation` | 0 | 10 项关联取消、超时、输出限制、队列和清理单测；`cancellation-regression.json` |
| `npm run desktop:test:target -- git-cancel-retry --level native` | 0 | 2 项 IPC/界面重试、最后窗口退出恢复流程；`native-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git.nonvisual.spec.ts --grep 'Git shutdown|Git late shutdown'` | 0 | 2 项提交前/后退出及重启回归；`shutdown-regression.json` |
| `npm run desktop:test:target -- --file test/e2e/runtime-startup.nonvisual.spec.ts --grep 'startup cancellation stays scoped'` | 0 | 1 项会话初始化退出、草稿落盘及任务隔离；`startup-regression.json` |
| `npm run desktop:test:target -- --file test/e2e/git-cancel-retry.nonvisual.spec.ts --grep 'Git shutdown failure'` | 0 | 最后修改后复核英文错误详情、重复退出、返回应用和再次退出；`shutdown-dialog-green.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器回归；新模块及原生配置登记有效 |
| `npm run desktop:check` | 0 | 最后一次桌面源码及测试修改后的类型检查通过 |

表内 JSON 位于 `.artifacts/git-cancel-retry/`。退出提示用例重复执行不重复计入不同用例数量。

最初真实失败保存在 `retry-red.json`：旧取消返回成功而不是终止错误，断言 `Missing expected rejection`，退出 1。首次核心修复通过保存在 `first-green.json`。随后两次类型检查退出 1，分别发现动态翻译参数/原生对话框重载，以及字符串不能作为类型约束词条；均已修复，最终退出 0。一次无效补丁因目标文本不匹配被拒绝，未改变文件；实际文件的钩子换行本身正确。

故障仅在测试 Node/Electron 进程中临时设置不存在的 SystemRoot 路径，触发真实终止程序启动失败；恢复后重试结束原有两级钩子进程。没有修改系统环境、真实项目或放宽产品审批。原生用例进一步核对 Git HEAD、索引字节、临时索引目录、可编辑草稿和重启后的设置。

## 清理与验收边界

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/git-cancel-retry.json` 退出 0；只读所有权审计发现 0 个候选残留。测试直接断言辅助进程已结束、临时索引和验收目录不存在，未生成截图、视频或 trace。

- 已验证 Windows x64 的真实终止器启动失败、显式取消重试和正常退出恢复；没有声称真实权限拒绝、强制退出/断电或其他操作系统已验收。
- 预检范围是 GitWorkflow 管理的命令；无显式请求 ID 的后台 Git 检查、自动超时后终止器自身失败的主动通知仍需后续复核，不将其记为已完成。
- 接续检查上述后台边界，再推进项目环境及 Worktree 长操作恢复；其他纳入项继续按总台账处理。
- 不提交、不发布、不制作 EXE。开发启动：`npm run desktop:dev`。

日常入口：`npm run desktop:test:target -- git-cancel-retry`；只有修改主进程/IPC/退出交互时增加 `--level native`。

后续记录：本页此前待复核的后台 Git 查询和自动超时停止失败已在 [后台查询恢复验收](git-background-recovery.md) 取得新的定向证据；本页原有命令与边界保留为当轮历史记录。
