# MCP 连接测试：进度、取消与配置变化保护

属于持续 Goal 的 G-UX-04。本轮完成连接测试流程的接续验收；整体 Goal 保持 active。

## 行为

- 设置中的“保存并测试”和插件中的“读取工具列表”使用同一主进程操作记录，包含操作标识、等待确认、连接、读取工具、关闭连接和终态。运行中提供“取消连接测试”，没有增加常驻工具栏。
- 取消覆盖原生确认、stdio 初始化、HTTP 握手和工具列表读取。客户端等待同一次 transport 关闭结束，再发布终态；重复 close 不提前宣称子进程已退出。
- 一个服务同一时间只运行一个连接测试；操作记录沿用已有持久化机制。重开设置页面可以接续查看和取消正在运行的测试，应用正常退出取消并关闭测试连接。启动恢复把未结束记录标记为中断，不自动重新执行第三方程序。
- 测试只在短暂的配置队列中启动，连接等待不占用设置保存队列。慢服务不妨碍保存主题等偏好，也不重启正在运行的任务。
- 请求携带经规范化的配置基线；主进程在确认、读取凭据、连接和工具发现的边界再次验证当前目标。服务修改、删除、凭据更新、OAuth 操作或插件目标退休会取消旧测试，旧确认不能用于启动新命令。
- 插件路径比较使用实际展开的安装目录，避免相同清单在版本目录变化后继续旧测试。停用插件能够终止仍在等待的测试进程。
- 失败与取消保留配置和规则草稿；连续点击去重，取消失败可重试。结果已过期时不展示旧工具或旧错误。取消按钮消失后恢复键盘焦点，进度和应用说明随语言即时切换。
- 正常无操作时不渲染空进度块；有进度时沿用小号按钮、现有字体和主题，不堆叠重复的完成通知。

## 定向验证

以下成功结果只支持本轮列出的流程，不代表全量桌面验收。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/mcp.test.ts apps/desktop/test/operations.test.ts` | 0 | 9 项通过：真实 stdio 初始化/发现取消与进程退出、HTTP 握手取消、既有协议行为及操作持久化 |
| `npm run desktop:test:target -- mcp-connection --level ui` | 0 | 8 项通过：重复点击、草稿、迟到响应、取消失败重试、页面重开、活动操作优先、双语进度及布局 |
| `npm run desktop:test:target -- mcp-connection --level native` | 0 | 4 项通过：原生确认取消与过期基线、真实进程取消、偏好保存、重试、凭据更新、插件停用与应用重启 |
| `node --import tsx --test --test-name-pattern "every translation" apps/desktop/test/localization.test.ts` | 0 | 1 项通过：全词条插值约束 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项通过：新入口路径、分层和筛选登记；没有执行其他产品模块全套测试 |
| `npm run desktop:check` | 0 | 桌面类型检查通过 |

去重后为 10 项产品单元验证、8 项 UI、4 项原生流程，另有 16 项选择器验证。UI 在深浅主题、中文/英文、1440×940、1280×800、1000×700 检查状态文字、控件字号、尺寸与溢出；属于 DOM 验证，不宣称像素一致或截图验收。模型与 MCP 服务均使用本地测试数据，没有调用真实账号。

原始定向记录位于 `.artifacts/mcp-connection-recovery/`：`ui-green.json`、`native-green.json`。命令实际的工作目录、参数、耗时与退出码保留在报告中。

## 失败记录

- `ui-red.json`（退出 1）：原实现没有操作 ID 和配置基线，新增回归在验证请求结构时失败。随后补齐取消入口和主进程操作生命周期。
- `native-selection-failure.json`（退出 1）：新文件尚未登记到 Playwright，零用例不能视作通过；已补登记并实际运行。
- 中途类型检查退出 2：测试替身未覆盖 Electron showMessageBox 的两个调用签名；修正替身类型，最终检查退出 0。
- 中途选择器自测 15/16，退出 1：提前登记的进度用例还未加入；加入实际用例后 16/16。没有删除筛选检查或降低门槛。
- `ui-disabled-click-failure.json`（退出 1）：6 项通过、1 项测试超时、1 项未运行。测试错误地让 Playwright 等待 aria-disabled 的按钮变为可点击；改为直接分派点击验证处理函数的去重保护，新增用例限定 15 秒，最终 8 项通过。

以上失败整轮保持失败记录，不根据其中通过的个别用例改写整轮结果。

## 缓存与边界

- 新单测复用 TemporaryDirectories；原生流程复用 acceptanceApp 并在每次关闭后断言 storage 已不存在。成功、失败和取消沿用同一清理路径。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/mcp-connection-recovery.json` 退出 0；候选残留 0，没有批量删除其他目录。
- 没有截图、视频、trace、依赖安装、全套测试、提交、发布或 EXE。原生测试只构建开发用 main/preload。
- 本轮不是整个 MCP 子系统的完成证明。“重新连接任务工具”仍使用原来的任务 worker 重连流程，下一轮继续检查其取消和错误恢复；它与临时连接测试是不同操作。
