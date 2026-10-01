# 任务 MCP 重连：取消、隔离与恢复

属于持续 Goal 的 G-UX-04。此记录覆盖“重新连接任务工具”，临时连接测试的历史记录保留在 mcp-connection-recovery.md。整体 Goal 保持 active。

## 实现

- 重连接入主进程操作记录，具有请求标识、进度、取消与终态，复用现有 operation.cancel IPC。重开设置能继续查看和取消；较新的失败记录不会遮掉仍在运行的操作。
- 同一任务只保留一次重连。带不同标识的重复请求明确拒绝，无标识的既有调用仍共享结果；任务发送、运行配置修改、目录迁移及分叉在重连期间受到保护。
- 仓库锁只用于短暂预检，不跨越第三方 MCP 的初始化或用户审批等待。同目录其他任务和主题等偏好保存可以继续。
- worker 在连接前登记 MCP 实例，初始化、工具发现和外部工具审批都纳入生命周期取消。重复 dispose 等待同一次释放；取消时关闭实际连接，阻止迟到的初始化继续建立会话。
- 主进程取消后先解除目标 worker 的事件关联、清除审批，再等待退出处理。迟到消息不能覆盖任务状态；停止任务也会取消该任务正在进行的重连。
- OAuth 令牌请求沿用既有权限校验和超时，并随对应 worker 的销毁取消；没有新增权限或将密钥返回界面。
- 界面沿用原有小号按钮和折叠区域，运行时才显示取消。配置草稿、取消失败重试、焦点恢复和即时双语反馈均保留；中断记录不自动重跑第三方程序。

## 本轮定向验证

| 实际命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/agent-initialization.test.ts` | 0 | 3 项：审批等待、真实 stdio 初始化和工具发现期间销毁；子进程退出、没有建立会话、重复销毁一致 |
| `npm run desktop:test:target -- --file test/e2e/mcp-settings.spec.ts --grep "MCP task reconnect"` | 0 | 3 项：失败重试、重复点击、编辑草稿后取消、取消失败重试、页面重开、双语进度和中断恢复 |
| `npm run desktop:test:target -- mcp-reconnect --level native` | 1 | 第一轮整体失败；其中初始化和工具发现取消的 2 项通过，旧审批回复的 1 项测试预期错误，末项及后续文件未运行 |
| `npm run desktop:test:target -- --file test/e2e/mcp-reconnect.nonvisual.spec.ts --grep 'approval cancellation\|application restart'` | 0 | 修正后只运行剩余 2 项：旧审批明确拒绝、取消和停止不启动第三方程序、重启关闭实际进程并保留取消记录 |
| `npm run desktop:test:target -- --file test/e2e/mcp.nonvisual.spec.ts` | 0 | 2 项既有回归：服务退出、worker 退出、应用重启、工具实际调用、错误配置恢复和运行中保护 |
| `node --import tsx --test --test-name-pattern "Pi runtime streams" apps/desktop/test/agent.test.ts` | 0 | 1 项：本地假供应商流式输出、工具审批、会话保存、恢复、分叉和压缩 |
| `node --import tsx --test --test-name-pattern "every translation" apps/desktop/test/localization.test.ts` | 0 | 1 项：词条插值约束 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项：新增小模块和用例筛选注册正确 |
| `npm run desktop:check` | 0 | 最终桌面类型检查通过 |

累计为 5 项相关单元验证、3 项 UI、6 项原生流程取得通过证据，另有 16 项选择器验证。原生首轮的 2 项成功证据保留，修复只涉及另一个用例的错误预期；没有为了凑整次成功而重跑全部场景。首轮整体仍记录为失败。

UI 在深浅主题、中文/英文、1440×940、1280×800、1000×700 检查真实 DOM 的反馈和溢出，不宣称像素或截图验收。所有模型和 MCP 流程使用本地服务，没有真实账号联调。

命令参数、耗时与退出码记录：`.artifacts/mcp-reconnect-recovery/native-first-failure.json`、`native-recovery-green.json`、`native-existing-green.json`。

## 失败及边界

- 首次新增 UI 回归退出 1：原重连请求不含操作标识，无法定位取消。补齐实现后 3 项 UI 通过。
- 中途类型检查分别发现新词条尚未登记、测试中的 thread.create 缺少显式 worktree 字段；已修正，最终退出 0。
- 原生首轮用例误以为过期审批回复可以成功；产品实际明确返回“该审批已结束”。改为断言拒绝，且继续检查没有启动服务，没有放宽产品行为。
- 新增 `mcp-reconnect` 小模块；默认只运行相关单元和 UI，原生阶段显式选择。没有运行全套桌面回归、根级全检、依赖安装、提交、发布或制作 EXE。
- 新单测复用 TemporaryDirectories；原生用例复用 acceptanceApp，每次清理后检查 storage 不存在。`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/mcp-reconnect-recovery.json` 退出 0，候选残留为 0。
- 后续继续复核首次打开/发送时 worker 初始化的停止恢复，以及其余功能台账；此轮不代表这些流程或整体 Goal 完成。
