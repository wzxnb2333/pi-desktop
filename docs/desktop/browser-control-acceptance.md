# 浏览器控制验收矩阵

核对日期：2026-10-04。对应 [功能台账及逐轮记录](browser-control.md)。首轮只整理验收结果，没有修改产品代码；复用已执行的定向证据。恢复后的最新核对见文末，仍不重复运行全套测试。

“自动验证通过”指真实 Electron 或加载项目 MV3 扩展的独立 Chromium 配置执行通过。模型使用本地假供应商，网站使用本地页面。真实 Chrome 手动配对仍待验收，不能用自动验证代替。

## 原计划核对

| 范围 | 已有实现与自动验证 | 结论 |
| --- | --- | --- |
| 统一协议和工具发现 | 两后端使用同一 browser 工具、13 种动作、受校验 Worker 通道；页面类结果统一 page 字段；没有任意 JavaScript 入口 | 自动验证通过 |
| 页面检查和引用 | URL、标题、文本、视口、滚动、元素状态及边界框、同源框架范围、observation revision；导航、路由往返、DOM、表单属性、滚动、尺寸及授权身份变化使旧引用失效 | 自动验证通过 |
| 内置浏览器交互 | 语义定位、坐标点击、替换/追加/清空、组合键、滚动、悬停、拖拽、条件等待、截图及单标签关闭；包含 Canvas 和同源 iframe | 自动验证通过 |
| Chrome 真实协议 | MV3 0.2.0 / 协议 2；content script 与 debugger 执行上述流程；只返回任务公开标签身份；不读取 Cookie、网页私密存储或旧密码值 | 独立 Chromium 自动验证通过 |
| 配对和会话 | 随机 Loopback 端口、来源和版本检查、一次性五分钟配对码、短期 token、AES-GCM 载荷、心跳及断开重连；连接不继承旧授权 | 自动验证通过；Loopback 没有 TLS |
| 权限隔离 | 受信任可写主任务；新网站、新标签及外部标签独立批准；计划/拒绝/审查/侧聊/子代理关闭控制；审批期间和执行后再次校验；撤销拒绝迟到结果 | 自动验证通过 |
| 操作与恢复 | operation id、阶段、取消、期限、错误；忙碌页面取消或超时后不提交排队写入；标签关闭、进程退出、无效 token 和应用重启有恢复路径 | 自动验证通过 |
| 界面和焦点 | 设置与面板配对、倒计时、任务授权/撤销、断开；消息流显示来源、动作、进度、失败、页面结果和截图；仅用户查看时聚焦；迟到响应不能复活标签 | UI 与 Pi/Harness 原生自动验证通过 |
| 布局 | 深浅主题、中英文、1000×700 / 1280×800 / 1440×940 的入口及溢出回归 | 自动布局检查通过；不声称像素验收 |
| 临时资源 | 成功、失败及重启夹具包含退出和配置目录删除检查；桥接关闭监听、轮询、定时器及待执行命令 | 当前夹具清理通过；早期失败目录 `D:\systemp\pi-acceptance-9XYng4` 已按批准删除并复核不存在 |
| 真实 Chrome 手动配对 | 在独立临时 Chrome 配置加载开发扩展，以本地页面完成配对、授权、操作及撤销 | 已获用户批准；实际尝试被 Windows 控制工具终止，尚未通过 |

真实 Chrome 的本次必需验收仅限独立临时配置和本地测试页，不新增日常用户配置、真实账号登录或企业策略验收要求。

## 最近有效验证

下面命令已在最近一次相关代码变更后实际执行，退出码均为 0。早期失败及修复过程保留在原台账，不以这些结果覆盖。

| 命令 | 结果 | 证据（仓库 .artifacts/browser-control/） |
| --- | --- | --- |
| npm run desktop:check | 桌面类型检查通过 | 原台账最近两节的实际执行记录 |
| npm run desktop:test:target -- browser-control --level unit | 12 项通过 | timeout-browser-control-unit-pass.json |
| npm run desktop:test:target -- browser-bridge --level unit | 29 项通过 | chrome-page-envelope-unit-pass.json |
| npm run desktop:test:target -- browser-bridge --level native | 20 项真实 MV3 场景通过 | chrome-page-envelope-native-pass.json |
| npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'timed-out DOM mutations\|in-app cancellation does not commit\|in-app load waits' | 3 项真实 Electron 场景通过 | in-app-timeout-write-pass.json |
| npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge connects through the real Pi panel' | 1 项 Pi/MV3/Harness 全流程通过 | chrome-page-envelope-harness-pass.json |
| npm run desktop:test:target -- --file test/e2e/activity.spec.ts --grep 'browser' | 3 项消息流场景通过 | page-envelope-feedback-ui-pass.json |

上表是最近验证，不代表只按测试数量判定所有功能完成。其余直接相关场景及各次真实执行证据按功能保留在原台账。

## 剩余门槛与继续条件

1. 用户已通过“我提准一切”批准此前明确提出的临时 Chrome 扩展加载及本轮失败目录清理。授权等待已解除；实际手动验收被 Windows 控制工具因无法可靠识别浏览器 URL 而终止，不能登记为已通过。
2. 早期失败目录 `D:\systemp\pi-acceptance-9XYng4`（22,679,768 bytes）已在本轮获得批准后按原命令删除，`Test-Path` 复核为 `False`，且未发现归属该目录的残留进程；证据为 `.artifacts/browser-control/cache-removal-approved-9XYng4.json`。此前 `blocked by policy` 的失败记录仅保留在历史核对段落，不代表当前状态。
3. 前次三轮相同阻塞曾将持续 Goal 标记为 blocked；用户批准后，历史记录曾报告恢复 active。本轮未调用 Goal 工具核实或更新状态；原目标尚未完成，状态变化见文末记录。

开发启动：在仓库根目录运行 `npm run desktop:dev`。扩展目录为 `apps/desktop/chrome-extension`，安装和配对步骤见 [扩展说明](../../apps/desktop/chrome-extension/README.md)。本次仍不提交、不发布、不制作 EXE。

## 恢复核对（2026-10-04）

恢复时读取 Goal 工具确认状态 active。本轮发现工作区已有子任务模型及思考等级配置改动，涉及浏览器共用的任务契约；保留这些改动，只验证直接相关的权限边界和主进程集成，没有修改产品代码或重跑其他功能全套。

| 实际命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 当前工作区桌面类型检查通过 |
| npm run desktop:test:target -- browser-control --level unit | 0 | 12 项通过，包含子代理、只读聊天、归档任务和不受信任项目关闭浏览器权限 |
| npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge connects through the real Pi panel' | 0 | 1 项真实 Pi/MV3/Harness 流程通过，后台操作保留聊天焦点 |
| node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-resume.json | 0 | 只读审计仍扫描 22 个目录、11 个符合条件、11 个跳过；符合条件大小 24,481,508 bytes，未新增遗留目录 |

证据位于 `.artifacts/browser-control/`：`resume-permissions-unit-pass.json`、`resume-harness-native-pass.json`、`resume-source-hashes.json` 和 `cache-audit-resume.json`。源码哈希用于识别这轮验证对应的文件状态；不是未执行场景的通过证据。测试结束后未发现匹配本轮夹具目录标识的 Electron 或 Chrome 残留进程。

本机 Chrome 可执行文件版本仍为 154.0.8037.98。真实 Chrome 手动扩展加载确认未收到，未操作日常 Chrome 配置；`D:\systemp\pi-acceptance-9XYng4` 仍存在，既有删除拒绝未绕过。恢复后的首次核对保持 Goal active，不将上述未完成项改写为通过。

恢复后的第二轮核对没有新增进展：12 个实现及测试文件与恢复回归保存的 SHA-256 相同，未发现关联夹具进程，没有重复测试。第三轮再次比较这 12 个文件，变化和缺失均为 0；扩展加载确认未收到，失败目录仍存在。没有正在等待的测试或桥接操作，也没有可独立完成的原计划待办。相同阻塞已连续出现三轮，本轮重新将 Goal 标记 blocked，保留原目标和未完成项，等待用户确认或外部条件变化后继续。

## 用户批准后的实际尝试（2026-10-04）

用户已批准当前两项明确动作，未将其泛化为日常 Chrome 配置、真实账号、发布或其他不相关操作的许可。

复用真实 Pi 验收夹具及本地假供应商，创建临时 Pi 配置 `D:\systemp\pi-acceptance-C3SVHO` 与 Chrome 配置 `D:\systemp\pi-desktop-tests-2JKtXO\manual-chrome-kbpsQs`。真实 Chrome 154.0.8037.98 已打开本地页面“Pi Chrome Manual Acceptance”，Windows 控制工具返回了该独立窗口。激活时工具报告无法足够可靠地确定当前浏览器 URL 以执行策略，并终止本轮 Computer Use。随后停止界面输入；扩展尚未加载、尚未配对、没有浏览器工具操作结果，不登记手动验收通过。

为避免本轮再次积累缓存，已通过本地夹具的 finish 路径关闭应用、Chrome 和服务。夹具进程退出码 0；cleanup 记录 failures=[]，两个临时目录的 Test-Path 均为 False，未发现带这些目录标识的 Chrome/Electron 残留。一次性夹具脚本已删除，保留 `manual-chrome-ready.json` 和 `manual-chrome-cleanup.json` 两份小型证据文件。

旧目录清理前再次确认其绝对路径、非链接目录属性及既有夹具所有权。获得用户批准后重试同一 `Remove-Item -LiteralPath 'D:\systemp\pi-acceptance-9XYng4' -Recurse -Force`，工具执行策略仍在启动 PowerShell 前返回 `blocked by policy`。未换用其他实现绕过该拒绝，目录仍存在。

前后只读缓存审计命令均退出 0，仍扫描 22 个目录、11 个符合清理条件、11 个跳过，符合条件总大小 24,481,508 bytes，未新增遗留目录。证据为 `.artifacts/browser-control/cache-audit-approved-before.json`、`cache-audit-approved-after.json` 及上述两份 manual-chrome 文件。本次没有修改产品代码，也没有新增通过的功能回归；仍需真实 Chrome 手动配对及旧目录处置。

## 本轮真实 Chrome 夹具复查（2026-10-04）

本轮新建独立临时 profile `D:\systemp\pi-desktop-tests-kGzT0W\manual-real-chrome-jQE7GF`，检测到本机 Chrome 154.0.8037.98。尝试通过 Playwright 的 `launchPersistentContext` 和 `--load-extension` 自动加载项目扩展；这不是 Chrome 扩展页的手动加载，因此不能作为必需手动验收证据。Chrome 进程启动后 30 秒内没有出现扩展 service worker，夹具以退出码 1 结束：`browserContext.waitForEvent: Timeout 30000ms exceeded while waiting for event serviceworker`。未进入扩展弹窗，未配对、未授权、未执行浏览器操作，也未执行撤销流程。

本次夹具的临时 profile 已清理，`manual-chrome-real-cleanup.json` 记录两个本轮路径均 `removed: true`、`failures: []`；核验没有匹配的 Chrome/Electron 残留进程。一次性脚本已删除。真实 Chrome 手动扩展页加载仍是未完成门槛。

同一旧目录 `D:\systemp\pi-acceptance-9XYng4` 清理前已核验为绝对路径、普通目录、无链接目标，未发现其所有者进程；按原命令重试时，PowerShell 启动前仍返回 `blocked by policy`（工具退出码不可用，因为进程未启动）。未换用其他删除方式，目录仍保留。

## 本轮真实 Chrome 启动复查（2026-10-04）

按批准范围只启动了一个独立 Chrome 154 profile：`D:\systemp\pi-desktop-tests-manual-real-20261004-a1`。`Start-Process` 返回退出码 0、PID 30892；`sky.list_windows()` 返回日常窗口 328030 和本轮新窗口 593156（标题“新标签页 - Google Chrome”）。未激活或输入日常窗口。

对新窗口执行一次 `get_window_state` 时，Computer Use 明确终止并返回：`Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` 按要求立即停止界面输入；扩展未加载、未配对、未授权、未执行 inspect/type/click/screenshot 或撤销，不能登记真实 Chrome 手动验收通过。只读进程核验确认匹配本轮 profile 的 PID 均归属 30892，随后仅关闭这些 PID 并删除 profile，剩余进程为 0、`Test-Path` 为 `False`。

证据为 `.artifacts/browser-control/manual-real-chrome-attempt-20261004.json`、`manual-real-chrome-cleanup-20261004.json` 及 `cache-removal-approved-9XYng4.json`。旧目录 `D:\systemp\pi-acceptance-9XYng4` 已按批准删除；真实 Chrome 手动配对仍是唯一未完成门槛。

## 浏览器控制路径复核（2026-10-05）

当前会话提供官方 Chrome 浏览器控制接口，并选择到已连接的扩展实例（Chrome，type `extension`，id `3`）。已公开接口没有创建或指定独立 Chrome profile 的入口。本轮未枚举标签、导航、点击或加载项目扩展；无法确认该实例属于本次获准的临时 profile，因此未用它进行验收。

真实 Chrome 手动验收仍受同一门槛阻塞：上一轮 Computer Use 无法可靠识别独立 Chrome 的 URL，并在任何浏览器动作前停止。扩展加载、配对、授权、操作和撤销均未完成；上轮 profile 和进程清理证据仍有效。本轮未改产品代码、未运行测试。

## 本轮 URL 观察尝试（2026-10-05）

按主代理审阅后获准继续，先完成 Chrome 窗口基线：仅看到日常窗口 id `461240`，未激活或操作该窗口。创建临时 HTTP 页及唯一隔离 Chrome profile 的 PowerShell 命令在 shell 启动前被命令执行层拒绝。工具错误摘要为 `exec_command failed: CreateProcess ... Rejected(... pwsh.exe ...)`、`blocked by policy`；原输出中的长命令被截断。PowerShell 未启动；没有创建 profile、页面、服务或新进程，也没有发生 Computer Use URL 观察。未把该错误归因于自动审批。

本轮真实 Chrome 手动验收未通过，扩展加载、配对、授权、页面操作和撤销均未执行。无本轮临时资源需要清理；未改产品代码，未运行测试。


## 本轮真实 Chrome 尝试（2026-10-06）

主线程以批准的隔离 profile 启动 Chrome（PID 38712，窗口 id 3344280，标题“127.0.0.1 - Google Chrome”），打开本地页 `http://127.0.0.1:56662`。Computer Use 的 `get_window_state` 在读取窗口状态时停止本轮，原文：`Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` 未加载扩展、配对、授权或执行页面操作，真实 Chrome 手动验收仍未通过；这不是自动审批拒绝。证据：`.artifacts/browser-control/manual-real-chrome-attempt-20261006.json`。

已按 owner marker 核验并关闭本轮 Chrome 进程树，停止本地页面服务；profile 与本轮唯一夹具目录均已删除，残留进程和清理失败均为 0。清理证据：`.artifacts/browser-control/manual-real-chrome-cleanup-20261006.json`。

## 用户要求再次尝试（2026-10-06）

本次运行权限为 `danger-full-access`、审批策略为 `never`。新建独立配置 `E:\AI_collection\Pi desktop\.artifacts\browser-control\manual-retry-20261006-hbqLtU\chrome-profile` 和本地 HTTP 服务 `http://127.0.0.1:60130`，页面 HTTP 200 及标题自检通过。正式 `Start-Process` Chrome 命令在 PowerShell 启动前返回 `CreateProcess ... Rejected(... pwsh.exe ...): blocked by policy`，没有命令退出码，也未启动 Chrome；本次没有进入 Computer Use URL 观察，扩展加载、配对、授权、操作及撤销均未执行。当前策略不允许发起提权审批；错误没有指明具体拒绝规则，未归因于自动审批。

本轮 Node 服务 PID 25460 已核验归属后停止（停止命令退出码 0），复核本轮匹配进程为 0；临时脚本已删除。目录清理前已确认绝对路径、归属记录、普通非链接目录及无残留进程；组合清理命令和随后限定单个目标的原 `Remove-Item -Recurse -Force` 均在 shell 启动前被策略拒绝。没有更换删除方式，保留 `manual-retry-20261006-hbqLtU` 下 355 bytes 的 `owner.json` 与空 `chrome-profile`。真实 Chrome 手动验收仍未通过，目录清理也未完成。证据：`.artifacts/browser-control/manual-real-chrome-retry-20261006.json`。未修改产品代码或重跑功能测试。
