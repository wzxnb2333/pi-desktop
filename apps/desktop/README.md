# Pi Desktop

面向 Windows 的 Pi 本地工作台。基于 Pi v0.86.1（`13cbf77`），使用 Electron、React 和 TypeScript，保留 upstream 远程以同步上游。

## 运行

已构建的程序：`.artifacts/desktop/win-unpacked/Pi Desktop.exe`。安装程序：`.artifacts/desktop/Pi Desktop Setup 0.1.0.exe`。

源码首次启动需要 Windows 10/11 x64、Node.js 24 LTS、Git for Windows 和 PowerShell（优先 PowerShell 7，未安装时回退 Windows PowerShell）。在仓库根目录执行：

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run hydrate:model-data
npm run build:offline
npm run desktop:dev
```

仅 Electron 的下载脚本需要显式运行。node-pty 使用包内的 Windows 预编译模块，不需要全局安装 npm 包。已准备好依赖和 Pi 构建后，直接运行 `npm run desktop:dev`。双击根目录 `Start Pi Desktop.cmd` 会打开已构建版本；添加 `-Dev` 参数启动开发模式。

```powershell
npm run desktop:build
npm run start --workspace=@pi-desktop/app
npm run desktop:package
```

## 首次使用

1. 添加本地项目文件夹。
2. 在设置中添加模型，选择内置供应商及目录模型，或选择自定义接口并填写协议、Base URL 和模型 ID，然后保存 API Key。两种模式分别配置。
3. 返回任务，为任务选择模型并发送消息。默认在命令、写文件与扩展工具执行前询问。
4. 在右侧查看改动、文件、计划和产物；工具卡片可展开查看命令与输出。

`Ctrl+N` 新建任务，`Ctrl+K` 搜索，`Ctrl+,` 设置，`Ctrl+J` 终端。Enter 发送、Shift+Enter 换行；设置中可切换 Ctrl+Enter 发送。侧栏和 Review 分隔条支持拖动和方向键。

任务可以恢复、分叉、归档和压缩上下文。过短会话无法压缩，Pi 会返回明确提示。Worktree 从当前 HEAD 创建，应用改动前先运行 `git apply --check`；冲突时保持目标项目不变。恢复单文件会在本地 recovery 目录保留副本。

## 扩展与自动化

- Skills 默认使用用户目录 `~/.agents/skills`（Windows：`%USERPROFILE%\.agents\skills`），启动时自动加载其中的 Skills；应用内创建也写入此目录，导入窗口默认打开这里。Pi 按需读取正文。
- 停用或移除只影响 Pi，不删除共享文件或更改其他应用的启用状态；移除后重新导入可恢复。已有手动导入的路径保留。
- Pi 扩展支持标准确认、选择、输入和通知。依赖终端渲染的自定义 TUI 组件需在 Pi CLI 使用。
- MCP 支持 stdio 和 Streamable HTTP；环境变量或请求头通过加密存储配置。stdio 服务依赖的外部运行时需由用户安装。
- 可执行扩展与 MCP 仅在信任项目且允许执行的任务中启用。计划模式和只读策略不加载它们。
- 自动化按分钟间隔持久化运行，应用重启会合并错过的运行。应用退出时不执行；保留托盘可以继续调度。结果进入待审阅队列。

## 数据与边界

默认数据目录由 Electron 的 `userData` 决定（通常 `%APPDATA%/Pi Desktop`）。可用 `--user-data-dir=绝对路径` 指定独立配置目录。

| 路径 | 内容 |
| --- | --- |
| `desktop.json` / `.bak` | 项目、任务视图、设置和调度；原子替换与损坏恢复 |
| `secrets.json` | Electron safeStorage 加密后的密钥 |
| `agent/sessions/` | Pi 原始 JSONL 会话 |
| `worktrees/` | 隔离工作目录 |
| `recovery/` | 恢复文件前的副本 |
| `logs/desktop.log` | 主进程诊断日志 |

Renderer 禁用 Node，经沙箱化 preload 的白名单 API 与主进程通信。请求、事件、worker 消息使用 Zod 校验。预览使用独立 WebContentsView 与独立存储分区，仅允许本地 HTTP(S) 页面导航。

操作确认不是操作系统沙箱。获准的 PowerShell 命令、扩展与 MCP 服务具有当前用户权限。内置文件工具检查项目目录、链接与 Pi 路径别名，显式导入的 Skill 正文可只读访问。API Key 不会通过配置读取接口返回 Renderer。

不包含 ChatGPT 登录、订阅 OAuth、云端调度、SSH 和跨设备同步。安装包未签名；真实供应商的 API smoke test 需自行在设置中添加密钥。

## 验证

日常只改桌面代码时，只运行一次类型检查和相关模块的定向测试，不再每轮跑完整桌面回归：

```powershell
npm run desktop:check
npm run desktop:test:list
npm run desktop:test:target -- toolbar
npm run desktop:test:target -- settings
# 涉及 Electron、主进程或 IPC 时，明确补充相关原生用例
npm run desktop:test:target -- browser --level native
# 单个缺陷可直接精确到用例
npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'browser overflow'
```

从以上示例选择与本轮修改相关的命令即可，不要全部照跑。默认 quick 只执行所选模块的单测和浏览器 UI 用例，不启动 Electron；`--level unit/ui/native/all` 可选层级，all 也只包含指定模块。`--dry-run` 只打印计划。无参数或拼错模块会报错，不会回退到全套测试。详见[定向测试说明](../../docs/desktop/targeted-tests.md)。

类型检查复用现有 tsgo 和桌面 tsconfig；新增入口不引入依赖、不改锁文件。定向运行保留现有断言、超时和清理，首次失败就停止后续阶段；使用独立且固定的输出目录，不覆盖完整验收的 JSON 报告。

修改共享包时运行 `npm run check:quick`；涉及依赖、锁文件、包入口边界、检查脚本或完整验收时运行 `npm run check`。根检查不包含桌面类型检查。

```powershell
npm run desktop:test
npm run desktop:test:nonvisual
npm run check
```

以上完整命令仅用于明确要求的完整验收或 CI，不是日常开发收尾步骤。不要因为本轮改过多个测试文件，就把这些文件全部重新串成完整回归；只验证修改过的用例及直接受影响的行为。单元与集成测试使用本机假供应商和临时 Git 仓库；原生用例直接加载开发源码，关闭截图、视频和 trace，无需预先构建安装包。

旧的 `test:ui` 面向打包版且包含截图，不用于日常开发或非视觉验收。参考资源提取和报告生成脚本仅在更新参考或交付报告时使用，不在启动或日常检查链中。

## 代码结构

`src/main`：窗口、持久化、安全策略、Git、终端、调度、浏览器。
`src/preload`：受限桥接接口。
`src/shared`：IPC schema 和共享类型。
`src/worker`：Pi AgentSessionRuntime、审批桥接、MCP、时间线。
`src/renderer`：React 工作台、设置和 xterm 终端。

参考：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Windows 支持](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/windows.md)、[Codex Desktop](https://openai.com/index/introducing-the-codex-app/)。界面采用 Pi 品牌。
