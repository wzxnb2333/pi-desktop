# 沙箱与三档权限

本项是用户单独指定的必做内容，不写入持续 Goal 的目标正文。持续 Goal 已创建并保持 active，继续按已有功能台账和定向验证规则迭代功能与体验。

## 本轮验收台账

| 项目 | 状态 | 验收内容 |
| --- | --- | --- |
| 请求批准 / 替我批准 / 完全访问 | 已验证 | 输入框、默认设置和自动化使用三档稳定 ID；中英文切换、草稿保留、设置及任务重启恢复 |
| Windows 命令沙箱 | 已验证 | 真实 AppContainer 命令执行、项目外读写与链接越界拦截、回环网络阻断、环境变量过滤、取消及子进程终止 |
| 工具与扩展边界 | 已验证 | 文件工具权限、计划及内部只读约束；外部扩展与 MCP 单独授权，拒绝后不加载扩展 |
| 进程生命周期 | 已验证 | 主进程持有启动器；任务进程被强制结束后取消命令、清理临时目录，原聊天可继续；运行中输出跨 IPC 实时送达 |
| 定向验证 | 已通过 | 见下方本轮实际执行记录；未运行全项目回归，不将本轮通过等同于持续 Goal 完成 |

请求批准：沙箱内的读取可直接执行；修改和命令需要确认。替我批准：由独立 LLM 请求审查待执行操作，低风险才自动批准，危险、不确定、超时或失败转为用户手动批准，不能扩大沙箱边界。完全访问：用户主动选择后，使用本机用户权限执行。审批方式和系统隔离是两个维度；不能只改标签就宣称有沙箱。

2026-09-29 根据用户澄清修正了早期 auto 的直接放行语义；旧测试只能证明当时的沙箱和授权边界，不能证明存在独立 LLM 审查。新实现与验收见 [独立代审批](approval-review.md)。本项仍不写入持续 Goal 正文。

Windows 实现依据 Microsoft 的 AppContainer 和 Job Objects 官方接口；默认不授予网络 capability，进程树归属本轮 Job。开发验证使用本地测试目录与假供应商，不触碰真实账号。

## 三档行为

| 显示名称 | 稳定 ID | 文件和命令行为 |
| --- | --- | --- |
| 请求批准 | `ask` | 项目内读取直接执行；修改与命令逐次请求批准，批准后的命令仍在沙箱中运行 |
| 替我批准 | `auto` | 独立 LLM 审查命令、写入等需要授权的工具调用；只自动放行低风险，危险或无法判断时逐次询问用户；批准后的命令仍在同一沙箱中运行 |
| 完全访问 | `full` | 用户主动选择后，文件和命令使用当前本机用户权限；不等于提权到管理员 |

任务运行期间不能切换权限；计划模式、审查及临时侧聊的只读限制优先于这三档。已有 `deny` 数据继续用于内部只读状态，不作为普通任务的第四档。

## 实现与边界

- `src/main/windows-sandbox.ts` 校验启动器源文件 SHA-256，用系统 .NET Framework 编译器构建 Windows x64 启动器。源文件校验、编译或沙箱启动失败时拒绝执行，不回退到完全访问。修改 `resources/sandbox/launcher.cs` 时必须一并审查和更新固定校验值。
- 每条命令使用独立的 AppContainer 身份；只向该身份临时授予当前任务目录与本轮临时目录的权限，不授予所有应用包或整个磁盘权限。目录授权更新加锁，结束后移除本轮规则，不覆盖用户原有 ACL。
- 当前工作目录由主进程从任务配置取得，IPC 请求不能提供另一执行根目录。盘符根、包含 Windows、用户主目录或应用存储的过宽目录被拒绝。
- 子进程环境不继承供应商密钥等任意环境变量；HOME、临时目录和应用缓存目录重定向到本轮目录。命令的输出、取消和退出状态通过现有受校验 IPC 返回。
- 执行根是**整个项目目录**，包含其中的 `.git`、`.env` 等文件；本轮不提供项目内敏感子目录的单独保护。多目录文件工具沿用明确的目录标识与各自校验；命令以当前任务目录为边界。
- Windows 默认允许 AppContainer 读取部分系统运行时资源；不能描述成只有两个目录可见。内置浏览器、模型供应商请求有各自的权限与网络流程，不属于 PowerShell 命令网络沙箱。
- 外部扩展和 MCP 在命令沙箱之外执行。`ask` / `auto` 即使项目已受信任，仍须单独同意加载；`full` 表示用户选择本机访问。此授权不把外部代码变成受操作系统隔离的代码。
- 用户手动打开的终端属于主动本机操作，不声称整个 Electron 应用都在沙箱内。

## 生命周期与缓存

启动器由主进程持有，避免 Electron 结束任务 utility process 时先杀死启动器、跳过清理。任务进程退出、取消及正常命令结束均会终止命令进程树，移除本轮 ACL、AppContainer profile 和 `sandbox-runs/run-*` 目录。编译后的启动器按源哈希保存在应用私有缓存，正常运行复用。

本轮实际发现并修复了“任务进程被强制结束后遗留沙箱目录”；修复后真实 Electron 回归通过。之前失败测试留下的两个专用 AppContainer profile 已通过 Windows `DeleteAppContainerProfile` 删除，未直接递归删除系统应用目录。`D:/systemp` 的测试所有权清理核对结果为 0 个候选残留。

接续迭代已增加主进程与启动器被强制结束后的恢复，见下一节。真实硬件断电及磁盘故障仍未实机验收，不以进程故障注入替代这些场景。

## 接续迭代：异常退出恢复

本轮先真实杀死 Windows 启动器，确认下一次命令仍遗留上一轮 ACL，回归以“the next command must recover orphaned ACL entries”失败。普通任务进程退出时的 finally 清理不能覆盖启动器自身被结束，因此新增持久恢复记录，而非扩大应用目录权限或将错误忽略。

- 在创建 AppContainer 和修改 ACL **之前**，将唯一身份、项目目录与临时目录写入私有 `sandbox-leases` 并刷新落盘。记录不含命令、聊天或密钥，也不放入已授权给沙箱的临时目录。
- 活跃启动器始终持有记录的排他文件锁。重启恢复和并发恢复跳过仍被占用的记录，不根据过期时间或 PID 猜测运行状态。
- 应用启动及下一次命令执行前使用同一恢复服务。仅移除记录对应身份的精确 ACL、专用 profile 与受管运行目录；不回写整份旧 ACL，不覆盖用户的新权限配置。
- 验证记录版本、身份名称、临时目录归属及路径链接。损坏、越界和链接记录保留并报错，阻止新沙箱命令；不删除它们以伪装恢复成功，也不切换到完全访问。
- 启动恢复失败提供中英文“重试 / 打开数据目录 / 继续打开”。继续打开后聊天、草稿与文件查看仍可用，新的沙箱命令继续受恢复检查约束；修正记录后可以重试。
- Windows 启动器源校验值同步更新。实际测试目录及系统 profile 清理一并核验，测试故障注入自身的残留也单独清理。

接续验证与历史记录分开：

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 桌面类型检查通过 |
| `npm run desktop:test:target -- --file test/sandbox-recovery.test.ts --file test/windows-sandbox.test.ts --file test/localization.test.ts` | 0 | 7 项通过：3 项恢复、1 项完整 Windows 沙箱、3 项双语基础测试，约 30 秒 |
| `npm run desktop:test:target -- sandbox --level native` | 1 | 前 3 项通过；新增主进程故障用例等待 Playwright 协议 close 事件超时，后 2 项未运行，不记为整组通过 |
| `npm run desktop:test:target -- --file test/e2e/permissions.nonvisual.spec.ts --grep 'restarting after main\|startup recovery'` | 0 | 改为核对实际 PID 已退出后重开；3 项通过，约 42.5 秒 |
| `npm run desktop:test:target -- --file test/sandbox-recovery.test.ts --grep 'damaged or linked'` | 0 | 增加“记录已落盘但 profile 尚未创建”的中断窗口断言，1 项通过 |

本轮原生证据覆盖三档权限与重启、扩展独立授权、任务进程中断、主进程与启动器同时终止后的自动清理、恢复原任务执行、草稿保留，以及双语错误界面的打开目录、修正后重试和保留记录继续打开。原有 3 项与新增 3 项分别取得当前代码证据，没有将首轮退出 1 描述成整套通过。测试没有更改真实供应商、账号或用户设置。

最终 `desktop:check` 退出 0。所有权清理预检报告为 `.artifacts/temp-cleanup/sandbox-recovery-pass.json`：`D:/systemp` 候选残留为 0；另核对系统 `PiDesktop.Run.*` profile 数为 0，没有遗留启动器进程。未产生截图、视频或 trace。

旧的八阶段完成记录与上一轮权限测试保留为历史证据；持续 Goal 仍为 active，本项没有写入 Goal 正文，也不代表全部功能及体验迭代完成。

## 本轮验证记录

下列命令均已实际执行并退出 0；同一用例重跑不重复计数。

| 命令 / 选定文件 | 结果 |
| --- | --- |
| `npm run desktop:check` | 桌面类型检查通过 |
| `npm run desktop:test:target -- sandbox` | 6 条权限单元测试 + 7 条输入框 UI 测试通过；本次约 8 秒 |
| `npm run desktop:test:target -- --file test/windows-sandbox.test.ts` | 1 条真实 Windows 隔离集成测试通过，含读写、链接、环境、网络、取消、派生进程、并发 ACL 和清理检查 |
| `permissions.nonvisual.spec.ts` | 3 条真实 Electron 用例通过：三档执行及恢复、设置页授权/语言切换、强制结束任务进程及继续；最后一项增加流式输出断言后独立重跑通过 |
| `plugins.nonvisual.spec.ts` | 2 条插件生命周期、信任与来源目录用例通过 |
| `mcp.nonvisual.spec.ts` | 2 条 MCP 连接与恢复用例通过；同时修复初始化授权结束后任务停留在运行中的状态 |
| `mcp-policies.nonvisual.spec.ts` | 1 条工具策略用例通过 |
| `mcp-oauth.nonvisual.spec.ts` | 2 条本地 OAuth 协议用例通过 |
| `acceptance.spec.ts` 中 Skills create、MCP settings test、extension confirmation | 3 条受影响原有用例通过 |
| `node --test scripts/desktop-test-target.test.mjs` | 16 条定向测试选择器测试通过 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/sandbox-pass.json` | 核对 0 个候选残留，无删除他人目录 |

原生集成命令在 `apps/desktop` 下执行：`node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts`，后接上表明确的文件和需要的 `--grep`。本轮没有执行不带筛选的该命令。权限与插件最终联合运行 5 条通过（51.6 秒），最后的流式输出及强制结束用例独立运行 1 条通过（11.4 秒）。

后续通常使用 `npm run desktop:test:target -- sandbox`；修改原生命令、IPC 或生命周期时再加 `npm run desktop:test:target -- sandbox --level native` 和明确的 `windows-sandbox.test.ts`。不默认扩大为完整桌面或根级回归。

本轮为 Windows x64 开发模式验收；没有提交、发布或重新制作 EXE，没有进行第三方安全审计，也没有声称其他系统、真实远端账号和全部 Codex 功能已经验收。
