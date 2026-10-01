# 模型读取桌面终端

H-06 接通模型工具 read_terminal，复用当前聊天已有的原生终端和输出缓冲。模型可以直接检查构建、服务或项目动作的运行输出，不需要用户复制粘贴。此接口提供观察与等待，不发送 shell 输入、不新建进程、不改变审批或沙箱权限。

## 调用与返回

~~~json
{}
{ "terminalId": "终端 UUID" }
{ "terminalId": "终端 UUID", "cursor": "上次返回的 cursor", "maxChars": 8000, "timeoutMs": 30000 }
~~~

- 不传 terminalId：只列出当前聊天的终端标识、名称、运行/退出信息及关联操作标识；不附带输出。最多返回最近 100 项，超过时给出 total 和 truncated。
- 指定 terminalId：首次返回最近一段原始输出；maxChars 默认 8000，上限 20000。复用返回的 cursor 后按顺序读取新增内容，hasMore 表示仍有内容未读取。
- cursor 与聊天和终端绑定。缓冲裁剪造成的缺口通过 skippedChars、bufferStart 和偏移量明确返回；边界不拆开完整的 Unicode 代理对。偏移和长度按 UTF-16 单元计算，与既有终端 IPC 一致。
- 传入 cursor 后可设置 timeoutMs，最多等待 30 秒。新增输出、进程退出或终端关闭会结束等待；超时返回 timedOut，不将超时当作完成。
- status 分别为 open、exited、closed。exited 带实际 exitCode；closed 只说明终端标签已移除，不冒充成功完成的命令。
- 原始输出保留控制序列及原语言。它是待分析的数据，不是新的用户指令或授权。工具名称和应用错误沿用即时中英文切换。

## 归属与生命周期

只给普通主会话注册工具；子代理、审查及临时侧聊均没有此入口。主进程另行校验调用者、活动轮次和终端归属，不接受任意 threadId、命令或输入参数。当前聊天即使处于只读权限或计划模式，也可观察自身已经存在的终端。

等待使用主进程事件订阅；结束、取消、错误和超时都释放监听器。用户停止模型只取消此次读取，真实终端进程继续运行；关闭终端则及时结束模型等待。聊天草稿和窗口布局不受读取影响。

终端进程和输出沿用现有应用生命周期，不新增日志落盘。重启后列表为空，旧 terminalId 和游标无法读取或自动重启旧进程。原有用户主动重启终端入口仍保留。

## 实现位置

- shared/terminal-tools.ts：严格参数及 Worker 协议。
- main/terminal-inspection.ts：归属校验、输出切片、游标、超时和取消。
- main/terminal.ts：复用创建、输出、退出、关闭及重命名事件，提供有生命周期的订阅。
- worker/harness-tool.ts、worker/agent.ts、main/application.ts：模型注册与主进程路由。
- shared/subtask-messages.ts：沿用 Harness 词条分组，添加双语名称及错误。

## 本轮验证

以下命令在仓库根目录执行，只选择本轮改动及直接依赖。没有使用开发子代理或真实供应商账号。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 最后一次代码/测试修改后的桌面类型检查 |
| npm run desktop:test:target -- harness-terminal | 0 | 15 项协议、隔离、增量、Unicode、缺口、等待/取消和双语单元 |
| npm run desktop:test:target -- harness-terminal --level native | 0 | 3 项真实 Electron / Worker / PTY 流程 |
| npm run desktop:test:target -- --file test/e2e/harness-terminal.nonvisual.spec.ts --grep "model terminal access" | 0 | 显式补齐测试 worktree: false 后，复核跨聊天拒绝及输入注入拒绝 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "child asks and receives" | 0 | 既有真实主子通信保持，子代理工具表不包含 read_terminal |
| npm run desktop:test:target -- --file test/e2e/terminal.nonvisual.spec.ts --grep "large output survives" | 0 | 既有大输出、重命名、后台输出、Renderer 重载、进程退出及应用重启 |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项定向入口选择器检查 |

三个新原生场景覆盖：真实终端列表和增量输出、退出码 7、草稿不变、重启及旧游标拒绝；输出唤醒、真实超时、模型停止后进程继续输出、关闭唤醒；其他聊天的终端拒绝、禁止通过读取参数输入命令、随后有效读取可恢复。五个不同原生场景按 3 + 1 + 1 分次通过，未声称同一次执行全部通过。

失败记录保留：最初协议测试拒绝尚未实现的 action；首次原生测试返回 Tool read_terminal not found。接通后通过。类型检查曾发现未知参数不能直接展开，以及测试遗漏已解析请求类型所需的 worktree 字段，均修正后再次运行检查和相关测试。

证据：[首次原生失败](../../.artifacts/harness-terminal/native-red.json)、[最终单元](../../.artifacts/harness-terminal/unit-final.json)、[三项原生](../../.artifacts/harness-terminal/native-green.json)、[最终隔离复核](../../.artifacts/harness-terminal/native-isolation-final.json)、[子代理隔离](../../.artifacts/harness-terminal/native-child-isolation.json)、[既有终端回归](../../.artifacts/harness-terminal/native-terminal-regression.json)。已有 NO_COLOR 与 Zod PURE 注释构建警告保持，未修改依赖。

## 缓存与完成边界

原生测试只用本地假供应商和既有 fixture，退出时断言自有目录删除，关闭截图、视频和 trace。最终 D:/systemp 只读审计没有新增遗留目录；仍仅保留此前无法核实身份的 pi-acceptance-9NrmPU（201820 字节），没有对该旧目录执行删除。[审计记录](../../.artifacts/harness-terminal/temp-audit.json)。

本轮未新增界面控件，未做视觉验收、全套桌面回归或根级完整检查；没有依赖变更、提交、发布或制作 EXE。项目根目录运行 npm run desktop:dev，重启应用后新模型轮次获得接口。整体 Goal 保持 active；本页完成 H-06，不代表原功能台账及全部体验验收完成。
