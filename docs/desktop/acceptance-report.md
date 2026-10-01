# Pi Desktop 验收记录

## 对话折叠验收（本次）

固定参考：Windows 26.917.9434.0 / 归档应用 26.917.71314。最终非视觉全套开始于 2026-09-25T16:05:06.740Z，耗时 205.3 秒。以下结论仅覆盖本次对话折叠及实际运行的回归用例。

### 结果

本次执行的 292 项测试通过：81 项桌面单元/服务测试、211 项非视觉组件及 Electron 流程测试。最终全套没有失败、跳过、重试后通过或顶层执行错误；桌面专用类型检查和根工程检查均退出 0。

| 命令（仓库根目录） | 退出码 | 实际结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 桌面主进程、worker、renderer 和测试类型检查通过 |
| npm run desktop:test | 0 | 81 通过，0 失败，0 跳过 |
| npm run desktop:test:nonvisual | 0 | 211 通过，0 失败，0 跳过，0 flaky；205.3 秒 |
| npm run check | 0 | 格式、依赖、入口图、锁文件、类型及浏览器 smoke 检查通过；Biome 未改写文件 |
| node apps/desktop/scripts/fidelity-report.mjs --results-only | 0 | 从已完成的机器结果生成报告，不重复运行测试 |
| git diff --check | 0 | 已跟踪差异无空白错误 |

机器结果：.artifacts/desktop-nonvisual-results.json。逐项用例、原始来源哈希和比较范围见 [fidelity-report.md](fidelity-report.md)；实现与状态说明见 [conversation-folding.md](conversation-folding.md)。

### 实施与覆盖

- 实时与历史共用有序内容转换；关联工具参数、已校验详情及实际观测时间，保留未知值。最终回复确认前保留临时正文，完成后按结束原因和工具状态确定最终回答。
- 整轮过程、连续活动组、思考与单项工具详情分别折叠；稳定键及显式选择通过 ui.threadUpdate 保存。已验证任务切换、renderer 重载和 Electron 重启恢复，以及父子折叠独立性。
- read、grep、find、ls 使用语义摘要和真实文件入口；edit 使用实际 diff；write 不推断修改前内容。真实 Electron 验证审批、编辑、文件打开、停止、失败后继续及延迟追加工具调用。
- 验证默认状态、手动覆盖、摘要节流、立即完成更新、未知耗时、键盘焦点、隐藏内容 inert、阅读锚点、底部跟随及减少动画。现有中文合成输入、菜单、文件恢复和 worktree 流程回归同时通过。
- 新增 48 组独立来源样本：标题/正文、活动组、文件行、diff 外框及文件头，覆盖四种主题和三种指定窗口尺寸。真实组件与原始 CSS/DOM 比较列明节点的矩形及 21 项计算样式；被测 CSS px 偏差均不超过 0.5，箭头路径及过渡时序另有断言。

初次回归发现最终回答后的通知可能被上一轮过程折叠隐藏、同一消息内思考可能误报为 0 秒，均已修复并补充回归。编辑流程和菜单尺寸测试分别等待 renderer 折叠状态、ResizeObserver 定位完成，消除后端已空闲但界面尚未更新造成的竞态；各定向连续 5 次通过后，211 项全套重新运行通过。没有放宽几何阈值。

### 验证边界

- 0.5 CSS px 只适用于合同列明的稳定节点和属性；完整会话窗口、diff 内部编辑器、其余业务图标、字体栅格化及所有原端状态未建立逐节点等同性。已验证一致、Pi 适配与缺少依据项分别记录在 [remaining-differences.md](remaining-differences.md)。
- 本次中文输入证据为合成事件和 Chromium IME 协议；未重新执行独立 Windows 原生拼音入口，历史结果不计入本次 292 项。
- 全部模型请求使用本地假供应商和临时项目/用户目录。截图、视频、trace 均关闭；最终非视觉输出目录仅有一个 JSON 状态文件，没有进行视觉审查。
- 开发编译仍有上游 Zod 注释位置及 NO_COLOR/FORCE_COLOR 提示；四项必要命令均成功。没有改动依赖来隐藏提示。
- 正常开发、测试和运行不依赖本机继续安装 Codex；本次未切换分支、提交、发布或构建安装包，保留原有未提交工作。

## 历史：桌面基础还原验收

以下为前一轮的原始文字记录。其测试计数及运行状态不作为本次新增证据；机器结果和 fidelity-report.md 已由本次运行更新。

日期：2026-09-25。参考版本：Windows 26.917.9434.0 / 归档应用 26.917.71314。

### 结论

本轮纳入范围的226项测试通过：73项桌面基础测试、152项非视觉组件及Electron流程测试、1项Windows原生拼音输入测试。最终运行没有失败、跳过或重试后通过的用例。根工程检查、桌面专用类型检查均退出0。

这表示下面列出的功能和源码合同已验收，不表示所有 Codex 控件、实验分支或完整消息 DOM 已达到逐像素等同性。具体未建立等同性的项目继续保留在 remaining-differences.md，不用 token 匹配率替代这些证据。

### 执行记录

除单独注明外，命令从仓库根目录运行。

| 命令 | 退出码 | 最终结果 |
| --- | --- | --- |
| npm run check | 0 | 根工程格式、依赖、入口图、锁文件、类型及浏览器 smoke 检查通过 |
| npm run desktop:check | 0 | 桌面主进程、worker、renderer、测试和两个非视觉配置类型检查通过 |
| npm run desktop:test | 0 | 73 通过，0 失败，0 跳过 |
| node apps/desktop/scripts/fidelity-report.mjs | 0 | 152通过，0失败，0跳过，0 flaky；131.5秒 |
| node ../../node_modules/@playwright/test/cli.js test -c playwright.native-ime.config.ts | 0 | 在apps/desktop中运行；1通过，7.3秒 |
| git diff --check | 0 | 受版本控制文件的差异没有空白错误 |
| git diff --no-index --check -- /dev/null 指定文件 | 1（存在新增内容） | 本轮10个新增/未跟踪源文件无空白错误输出；无错误退出码 |

非视觉全套的机器结果位于 .artifacts/desktop-nonvisual-results.json，逐项结果及来源哈希见 fidelity-report.md。最后一轮从2026-09-25T14:30:50.368Z开始。

初次验证发现的问题均保留了回归用例并在修复后重跑；表格报告最终结果。根检查曾被生成目录里的独立 Biome 配置阻断，现已明确排除 .artifacts，未删除已有临时文件或修改依赖。开发编译仍会输出上游 Zod 注释位置和 NO_COLOR/FORCE_COLOR 提示，不影响退出码和测试结果。

追加对齐时发现正文段落选择器优先级和引用行距造成累计8.75px偏差，已按原始CSS修复。Tooltip延迟测试曾因安装虚拟时钟后仍随真实时间推进而在199ms断言中偶发失败，现先暂停时钟再精确推进；定向连续5次通过后，152项全套重新运行通过。未放宽0.5px阈值或删除状态断言。

### 功能覆盖

| 范围 | 验收内容 | 主要证据 |
| --- | --- | --- |
| 外壳、侧栏与布局 | 分区尺寸、任务搜索/排序/归档/恢复、项目折叠、键盘及鼠标拖动、任务切换、布局重启恢复 | reference.spec.ts、sidebar.spec.ts、desktop.nonvisual.spec.ts |
| 主题与基础组件 | 浅色、深色、跟随系统即时切换、菜单结构与选中/禁用态、Tooltip延迟/边界/内容重排、确认框按钮及关闭图标、焦点恢复 | reference.spec.ts、surfaces.spec.ts、primitives.spec.ts、composer.spec.ts、settings.spec.ts |
| 消息排版 | 默认用户气泡、h1–h6、中文段落间距、粗体、有序/无序/嵌套列表、引用、分隔线；真实Message组件与厂商源CSS比较 | surfaces.spec.ts、reference-surfaces.json |
| 输入和任务 | 流式输出、发送、停止、失败后继续、followUp/steer 队列各运行一次、计划和只读策略 | acceptance.spec.ts、composer.spec.ts、agent.test.ts |
| 中文输入 | 浏览器 composition/isComposing、Chromium IME 协议、Windows 拼音真实按键及上屏、选词不误发、回车发送 | composer.spec.ts、acceptance.spec.ts、windows-ime.spec.ts |
| 附件 | 选择器授权、中文文本进入模型上下文、二进制/超限/不存在文件拒绝、失败后继续 | acceptance.spec.ts |
| 模型与密钥 | 四种协议实际客户端的流式解析、鉴权头、历史恢复；设置保存、Windows 加密、重启回填 | provider-protocols.test.ts、desktop.nonvisual.spec.ts |
| Skills 与扩展 | 创建、导入、停用、启用、连续移除；100 条通知 ID 唯一并重启保留；标准确认/选择/输入与拒绝 | acceptance.spec.ts |
| MCP | 实际 SDK stdio 和 Streamable HTTP；分页、请求头、工具执行、错误、取消；界面保存和测试、密钥加密、重启恢复 | mcp.test.ts、acceptance.spec.ts |
| 自动化与待审阅 | 创建、暂停、启用、手动执行、遗漏计划合并、并发不重复、标记已审阅、重启保留、删除 | acceptance.spec.ts、services.test.ts、desktop.nonvisual.spec.ts |
| 文件与 Git | 中文路径、文件读取、变更解析、恢复前备份、worktree 创建和应用、脏目标拒绝、目录越界拒绝 | acceptance.spec.ts、services.test.ts、diff.test.ts、core.test.ts |
| 终端与预览 | 真实 PowerShell PTY、多个终端、标签切换、隐藏与终止区分、原生本地预览打开及释放 | desktop.nonvisual.spec.ts、panels.spec.ts |
| 故障与连续运行 | 运行中重启、worker 强制终止、renderer 崩溃自动重载、50 轮连续对话及历史一致、单个 worker | acceptance.spec.ts |
| 窗口生命周期 | 关闭到托盘、再次激活、关闭托盘保留后退出进程 | acceptance.spec.ts |

测试目录：apps/desktop/test；Electron 流程目录：apps/desktop/test/e2e。所有模型请求均发往测试创建的 loopback 假供应商，所有修改均发生在临时项目和临时用户目录，不使用用户 API Key 或付费接口。

### 本轮修复

1. 同一自动化被并发点击时可能创建多个运行任务。执行锁在第一次异步操作前取得，五个同时请求现在只产生一个任务。
2. 创建 Skill 和写入 MCP 密钥绕过运行中任务保护。现在与设置保存一致拒绝，并在允许更新时重建已加载旧配置的空闲 worker。
3. 普通“保存设置”遗漏输入的 MCP 密钥。现在两个保存入口共享校验及加密保存流程，非法 JSON 或非字符串值在写配置前被拒绝。
4. 连续移除资源可能使用旧界面列表，把刚移除的资源带回。现在串行更新并从当前存储读取配置。
5. 关闭托盘保留选项后，关闭窗口仍残留后台进程。现在真正关闭最后一个窗口会退出；托盘模式继续隐藏并保留窗口。

此外，根工程检查明确忽略生成目录的独立配置，原生输入法验收辅助程序处理系统临时浮层抢占焦点的情况，并在结束时恢复输入布局。

本次源码对齐追加修改：

1. 用户消息改为完整外层与70%上限的独立气泡，时间在气泡外悬停显示；正文使用原版中文段落规则和标题/列表/引用排版。
2. 菜单重建标签与选中标记结构，修正行内距、玻璃背景、阴影和禁用态；触发器尺寸变化后重新计算浮层位置。
3. Tooltip改为原版主题、200ms延迟和2px偏移，补齐点击/窗口失焦关闭和长文本重排。
4. 确认框改为520px表面、原版body/heading/section/actions层级，包含medium按钮默认/hover/disabled/focus-visible样式及原始Y6关闭图标。
5. 新增独立reference-surfaces取证脚本和60组源码测量；常规测试只读已保存的JSON，不需要本机继续安装Codex。

### 源码合同和几何结果

参考侧为固定归档中原始 CSS、已追踪的桌面 DOM/宿主属性及白名单纯主题函数，Pi 侧加载真实组件；没有用 Pi 自身样式或快照生成参考值。

12组组合全部通过：light、dark、system-light、system-dark × 1000×640、1280×800、1440×940。基础合同包含10类探针（窗口区、工作栏、侧栏、主区域、导航、输入框容器、输入区、发送按钮、面板条、设置行）。旧空菜单探针已由完整表面样本替代。

表面合同包含菜单、Tooltip、确认框、用户气泡、助手正文共60组样本，逐节点比较完整矩形与26项计算样式；确认框包含取消/确认/关闭按钮，并额外比较按钮交互状态。两套合同合计记录11个去重原始文件及SHA-256。关闭图标路径也与原始JS定义比较。

合同实际比较的矩形和 CSS px 属性偏差不超过 0.5 CSS px；其余指定颜色、字族、圆角和阴影等属性按用例比较。此阈值只适用于合同列出的属性，不能扩展为所有 DOM 节点和全部控件状态的等同性声明。

### 原生输入法说明

独立入口需要已登录的交互式 Windows 桌面及中文拼音布局，不适合无桌面的 CI。辅助脚本对测试窗口发送原生键盘输入 nihao 加空格；真实输入框收到“你好”，compositionend 数据也为“你好”，此时供应商请求数为 0；再按 Enter 后只发出一次请求。全过程通过 DOM 和事件断言完成，没有读取候选窗图像。

### 保留的边界

- 真实外部模型供应商和任意第三方扩展/MCP 组合不在本轮假供应商验收内；通过四种协议不等于所有远程服务都已联调。
- 50 轮连续会话与进程故障恢复是有限压力测试，不等于数日持续运行证明。
- 未验证字体栅格化、所有动画曲线、所有原版图标变体、未映射的完整消息 DOM 和原版实验分支；Pi 适配与缺少依据项见差异报告。
- 代码块、表格、工具/审批/计划完整结构、Tabs细部和管理页全部表单仍缺少原版逐节点合同；不能将已通过的默认表面样本扩展为整应用像素级一致。
- 滚动位置按现有会话内语义处理，没有扩展保存契约。
- 截图、视频和 trace 图像采集全部关闭；两套测试输出目录本轮仅包含 JSON 状态文件。没有视觉审查、安装包构建、提交或发布。

## 启动

在 PowerShell 中运行：

    Set-Location 'E:\AI_collection\Pi desktop'
    npm run desktop:dev

正常运行和常规检查不依赖本机继续安装 Codex。

历史运行记录：前一轮结束时开发实例继续运行，5173端口返回当时的Message组件源码。本次折叠验收使用独立的临时开发实例，未重启用户实例。
