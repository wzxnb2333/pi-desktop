# Pi Desktop Codex 风格浏览器控制

本轮日期：2026-10-04。使用 Pi 自有内置浏览器和 Manifest V3 扩展；Satang 只读。不提交、不发布、不制作 EXE，不使用开发子代理。

真实持续 Goal：`Pi Desktop Codex 风格浏览器控制：持续完善内置浏览器与 Chrome 扩展桥接、语义和视觉交互、权限隔离、消息流反馈、设置入口、缓存清理与定向验收，直到纳入范围的功能完成。`

线程 `01a0de26-91c7-75f0-8836-8a5b70e6a920`，未设置 token 预算，实时状态以 Goal 工具为准。本文件补充此前 [接续迭代记录](ongoing-iteration.md)，不改写旧阶段结果。真实 Chrome 手动配对尚未验收，不能标记整个 Goal 完成。最新逐项核对见 [验收矩阵](browser-control-acceptance.md)。

## 功能台账

| 编号 | 内容 | 当前状态与证据 |
| --- | --- | --- |
| BC-01 | 统一请求、稳定引用、观察 revision、等待条件 | 已实现；协议单元、页面刷新、DOM/框架变化、运行时表单属性变化、仅 URL 变化、路由往返、根页面和滚动容器移动、视口调整及过期坐标回归；加载和忙碌 DOM 的等待期限及取消验证；Chrome 新标签首次观察绑定最终授权身份 |
| BC-02 | 内置浏览器语义与视觉控制 | 已实现；真实 Electron 的表单、禁用组及恢复、Canvas、同源 iframe、可信输入、组合键、拖拽、稳定后台视口和崩溃恢复；两端文本替换、追加、清空及不读取旧密码值的追加通过 |
| BC-03 | MV3 扩展及加密 Loopback 桥接 | 已实现；当前扩展 0.2.0 / 协议 2；真实扩展通过本地 Chromium 执行，配对、来源、版本、token、心跳及监听关闭单元回归 |
| BC-04 | 网站策略及任务/标签隔离 | 已实现；逐任务手动授权、不同连接相同原生 ID 隔离、子代理/只读任务默认关闭、审批期间变更阻止下发命令、运行中撤销与迟到结果拒绝 |
| BC-05 | 消息流、面板和设置入口 | 已实现；后台来源/动作/进度/失败反馈、按需展开检查及截图、可操作标签列表、关闭结果；桥接事件立即刷新，迟到响应不能复活标签或跨任务显示；Pi 面板真实配对和 Harness 全流程回归 |
| BC-06 | 断开、重连及临时资源清理 | 生命周期及正常清理已验证；旧轮询不清掉新连接、授权和引用不继承、监听/定时器/待执行命令关闭、配置目录删除断言；临时 Chromium 进程退出恢复、失效 token 及恢复取消回归通过。旧失败目录已按批准删除并复核不存在；真实 Chrome 手动验收结果见下方 |
| BC-07 | 真实 Chrome 手动验收 | 待验收；自动 Chromium 不等同于真实 Chrome 用户配置、企业策略或登录页面 |

## 模型接口

沿用 `browser` 工具及 Worker → 主进程的受校验通道。没有模型可调用的任意 JavaScript、debugger 命令或 Renderer IPC。

| 参数 | 行为 |
| --- | --- |
| `backend` | `in-app`（默认）或 `chrome` |
| `action` | tabs、open、navigate、inspect、screenshot、click、type、key、hover、drag、scroll、wait、close |
| `tabId` | 指定当前任务的标签；Chrome 对外 ID 包含连接身份，隐藏原生标签 ID |
| `ref` / `observationRevision` | 使用最近的 inspect 引用；页面内容、表单状态、URL、框架、滚动位置或视口变化后拒绝过期引用 |
| `locator` | role + accessible name，或 name（含 label）、placeholder、可见 text；有 ref 时优先使用 ref |
| `x` / `y` | 页面视口坐标；Canvas 等可以使用；跨域或不可访问的框架被拒绝 |
| `text` / `append` | 默认替换文本，append=true 追加，空字符串清空；支持普通输入、textarea、select 和 contenteditable |
| `key` / `keys` | 单个按键或一个组合键；如 Enter、Ctrl+A、[Control,a]、[Shift,a] |
| `target` | 拖拽终点，坐标、ref 或 locator |
| `direction` / `amount` | up/down/left/right，指定滚动量 |
| `condition` / `milliseconds` | load、url、text、role、ref，或指定时间；等待最多 10000 ms |

推荐流程：tabs/open → inspect → ref 或语义定位操作 → wait → screenshot。遇到“引用过期”先重新 inspect，不能沿用旧引用尝试其他标签。页面文本和截图始终作为不可信数据。

页面类动作 open、navigate、inspect、type、scroll、wait 使用 `{ backend, tabId, page }` 读取页面数据，不需要按后端选择顶层或嵌套字段。tabs 返回当前任务标签数组，截图另有图片内容块，close 返回标签关闭状态。Chrome 原生标签 ID 不放入 page，只返回当前任务可用的公开 tabId。

inspect 返回当前 URL、标题、可见文本、视口、滚动位置、最多 300 个可交互元素、框架访问范围、观察 revision。文本最多 80000 字，返回截断标记。元素包括角色、名称、标签、状态和边界框，不返回密码输入值。框架深度限制为 8。

长操作沿用 operation id、阶段、取消和失败状态。等待/任务停止取消不停止其他任务。按键或拖拽中途失败只释放已按下的键或指针；指针在视口外释放，避免补成页面点击。

## 权限及连接

- 工具仅提供给受信任项目的可写主任务。计划模式、deny、审查、侧聊、子代理、归档及删除任务关闭浏览器控制；主进程在操作中再次检查权限。
- 内置标签按聊天独立持有，Chrome 标签逐任务授权且同一时间只有一个所属任务。授权不能扩大网站规则或其他工具权限。
- 内置浏览器与 Chrome 的新标签均需要独立批准，拒绝时不创建页面、不发送请求。外部已有 Chrome 标签也不能因站点 allow 或任务完全访问而跳过标签授权。
- 网站 deny 立即生效；运行中截图的结果和迟到 Chrome 结果都需再次校验。跨来源结果不送到模型。
- Chrome 配对码为八位、五分钟、一次性；错误尝试有上限。桥接随机监听 127.0.0.1，校验 Host、扩展来源和协议/版本；会话最长 24 小时，心跳失联 45 秒后失效。
- 配对后的请求/结果通过 AES-GCM 载荷传输，使用短期 token 认证。Loopback 不使用 TLS；token 不返回 Pi Renderer。
- 断开、重连、任务归属变化或撤销后重新授权使旧页面引用失效；每份新授权有独立身份。授权身份只在主进程和扩展之间传递，不返回 Renderer。重复批准同一份现有授权不使正常引用失效。新连接不继承旧授权，应用重启需要重新配对。
- 网站原始数据不改变任务权限。Cookie、网页私密存储和浏览器配置不通过桥接读取。file:// 本地 HTML、chrome:// 及扩展内部页面不开放给 Chrome 控制。

## UI 与使用

开发启动：仓库根目录执行 `npm run desktop:dev`。

Chrome 入口在“设置 → 浏览器连接”和浏览器面板“浏览器操作 → Chrome 浏览器连接”。生成配对码后，在扩展弹窗输入端口/配对码；返回 Pi 选主任务并逐标签授权。安装说明见 [扩展 README](../../apps/desktop/chrome-extension/README.md)。

消息流显示浏览器来源、动作、实时阶段、具体等待条件及失败原因；页面检查、元素和截图在结果内展示。首条进度尚未返回时，从请求识别来源并显示“正在处理…”，不会提前显示完成。用户点击“打开浏览器查看”才聚焦对应页面。浏览器面板列出当前任务已授权的 Chrome 标签；授权、撤销和断开复用同一设置组件。

后台内置操作保留聊天 DOM 和 Electron 原生焦点，不更改活动工具标签。自动化页面保留在应用界面下方渲染，避免隐藏原生视图导致 DOM 视口变成 0×0、刚检查的引用在输入前失效。用户主动查看时使用面板尺寸，真实尺寸变化仍使旧观察失效。焦点恢复只在原窗口仍聚焦且没有转到其他页面时进行，不重新聚焦用户已经离开的窗口。

## 本轮验证

仅运行受影响的定向测试，关闭常规截图、视频和 trace。页面截图作为浏览器工具的实际返回能力测试，不写成每个场景的验收截图。

| 命令 | 退出码 | 本轮结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `npm run desktop:test:target -- browser-control browser-sites browser-bridge --level unit` | 0 | 最终 33 项通过：协议、权限、新标签独立批准、撤销、持有输入释放、进程丢失及桥接生命周期 |
| `npm run desktop:test:target -- browser-bridge browser-tools --level ui` | 0 | 7 项通过：授权/重试/隔离、深浅主题 × 中英文、消息流来源/阶段/失败与打开对应标签 |
| `npm run desktop:test:target -- browser-tools browser-bridge --level native` | 1 | 第一段 4 项通过，第 5 项新面板没有关闭按钮失败；其余未执行，不改写为全通过 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge\|website'` | 0 | 修复关闭按钮后 4 项通过：真实 Pi/MV3/Harness 流程、网站规则、运行中撤销及磁盘失败恢复 |
| `npm run desktop:test:target -- browser-tools --level native` | 0 | 最终 10 项通过：内置浏览器、新标签拒绝不加载页面、真实 Pi/MV3/Harness 全流程、焦点、重启清除授权、崩溃恢复、网站撤销及保存失败恢复 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 最终 5 项真实 MV3 回归：可信输入、Canvas、iframe、滚动/尺寸变化、旧引用、取消/撤销、断开/重连、标签关闭及本地 Cookie/私密存储保留且不出现在工具结果中 |
| `npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'browser overflow\|each tab closes\|queries stay\|browser pages move\|launcher and mixed'` | 1 | 菜单画面、关闭标签、任务切换和窗口隔离 4 项通过；尺寸矩阵因旧断言预期 4 个工具失败，现有界面有 5 个 |
| `npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'empty browser\|launcher and mixed'` | 0 | 更新为核对工具名称后 2 项通过；深浅主题 × 中英文 × 1000×700 / 1280×800 / 1440×940 的入口及溢出检查 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项测试选择/执行器回归，未触发其他功能全套 |
| `node --check apps/desktop/chrome-extension/{background,content,input,popup}.js` | 0 | 四个文件分别执行语法检查；此处花括号仅表示文件列表，不是 PowerShell 命令 |
| `git diff --check` | 0 | 无差异格式错误；Git 提示既有 CRLF 将在后续操作转换为 LF |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit.json` | 0 | 只读审计：扫描 22 个目录，11 个符合清理条件，11 个跳过；未删除历史目录 |

证据存放 `.artifacts/browser-control/`，包括 unit-pass.json、ui-pass.json、tools-native-pass.json、extension-native-pass.json、panel-layout-native-pass.json 和缓存审计。真实模型请求全部使用本地假供应商，网页和 HTTP/MV3 协议为真实实现。

迭代中还实际发生过崩溃后检查挂起、标签关闭错误信息竞争、隐藏视图的 0×0 视口，以及滚动容器事件晚到导致旧坐标被接受。已分别补上进程状态/超时监听、关闭事件同步、后台稳定视口和同步滚动位置校验，并由对应定向回归验证。早期失败不改写为通过；表格中的最终命令为修复后重新执行的结果。

首轮焦点用例还发现欢迎页首次发送会重建输入框；为隔离后台浏览器行为，焦点回归先建立已有会话，再同时检查 DOM 和原生焦点。修复了后台网页新建时取得原生焦点的问题。欢迎页输入框切换的通用连续编辑行为不在本轮浏览器通过范围内，后续 UX 台账仍保留该问题。

## 缓存与最终边界

### 等待与审批复查（2026-10-04 接续）

本次接续通过失败回归复现三条缺陷，然后修复：Chrome 同源 URL 等待把预期路由变化当作地址错误；Electron 在加载期间排队执行 DOM 检查，100 ms 等待错误地在加载完成后报告成功；Chrome 页面脚本忙碌时，100 ms DOM 等待实际超过 1500 ms 才返回。现在条件等待允许同源 URL 变化，跨源变化仍拒绝；仅修改 URL 也使旧引用过期；加载期间不排队检查 DOM，DOM 等待本身受请求期限及取消信号约束。过期引用条件直接报错，不消耗完整等待时长。

另复现了审批期间任务权限被撤销后，Chrome 命令仍先进入扩展队列、内置导航仍先加载一次网页的问题。现在网站/标签批准返回后立即复查任务、连接、标签授权和页面地址，再下发操作。对应单元测试检查没有任何命令进入桥接队列，且内置 loadURL 未调用。

| 命令 | 退出码 | 接续结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- browser-control --level unit` | 0 | 12 项通过；新增加载期限、不排队 DOM、取消恢复、忙碌检查期限、监听清理及审批期间撤销阻止导航 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 20 项通过；新增审批期间任务/标签权限及网站变化阻止命令下发 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'load waits\|in-app waits'` | 0 | 2 项真实 Electron 回归通过；加载超时恢复、URL 变化、动态角色、旧引用等待快速失败 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 9 项真实 MV3 回归通过；新增 URL、加载超时/取消/恢复、动态角色、过期引用条件及忙碌页面期限 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'executes real DOM\|trusted controls\|real Pi panel\|renderer crash\|deny during'` | 0 | 5 项受影响原生回归通过；真实输入/截图/取消、同源框架、焦点、Pi/MV3/Harness 全流程、崩溃恢复和运行中撤销 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'executes real DOM'` | 0 | 补齐内置导航的批准后权限复查后，重跑直接受影响的 1 项；正常导航、输入、截图、取消及网站拒绝均通过 |
| `npm run desktop:test:target -- --file test/e2e/activity.spec.ts --grep 'browser feedback'` | 0 | 1 项通过；初始来源/进度、具体等待条件、即时英文切换、错误和精确标签定位 |
| `npm run desktop:check` | 0 | 修复测试中完整 UI 状态的类型后通过；不改动 IPC 契约 |

接续证据存放 `.artifacts/browser-control/`：wait-unit-pass.json、approval-unit-pass.json、in-app-conditions-pass.json、chrome-wait-native-pass.json、wait-controls-native-pass.json、navigation-approval-native-pass.json、wait-feedback-ui-pass.json。此前验证表保留原始阶段结果，不以新增数量替代未做的真实 Chrome 手动验收。background.js、content.js 语法检查和 `git diff --check` 均退出 0。

本机已确认安装并运行 Chrome 154.0.8037.98，但尚未在其用户配置中手动加载项目扩展、确认配对和标签授权。已执行的扩展回归仍使用独立临时 Chromium 配置，不能登记为真实 Chrome 手动验收通过。持续 Goal 保持 active。

接续全部测试结束后只读审计扫描 22 个临时目录，11 个符合清理条件、11 个跳过，符合条件的总大小仍为 24,481,508 bytes；与接续前一致，没有增加遗留目录。新夹具在正常和失败回归结束时均清理自身目录。未发现本轮 browser-tools、browser-bridge 或 Pi 验收夹具进程残留；历史目录未清理。记录在 cache-audit-waits.json。

### 授权身份与路由往返复查（2026-10-04 接续）

上一轮属于实际进展，本轮仍从代码及真实夹具继续，未把手动验收等待计为整体完成。

真实 MV3 失败回归证实：撤销 Chrome 标签授权并重新授权同一任务后，在未重新 inspect 的情况下，旧 ref 仍可点击。主进程现为每份新授权生成独立身份，所有页面命令携带该身份，扩展在身份变化时清空引用。任务转交后再交回同样不能恢复旧引用。重复批准以及正常标签元数据更新保持原身份；审批期间撤销并重新授权也不会复活待执行的命令。

扩展升为 0.2.0，桥接协议升为 2。旧 0.1.x / 协议 1 不支持授权身份检查，配对时明确拒绝，需要在 Chrome 扩展页重新加载项目扩展并重新配对。主进程、扩展握手及单元测试采用一致版本，模型 browser 请求和桌面 IPC 格式未改变。

另一个真实失败回归证实：不做工具检查，先跳到其他路由、再返回原 URL，旧引用仍可使用。内置隔离脚本和扩展现在监听 hashchange、popstate、pagehide、pageshow；同源嵌套框架采用相同处理，框架移除时释放监听。实际验证覆盖路由往返、内置 Electron 与 Chrome 的返回缓存生命周期及重新 inspect 后继续操作。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'reauthorization'` | 1 → 0 | 先复现旧引用被接受，再验证同任务重新授权、任务转交及旧观察失效 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'original route'` | 1 → 0 | 先复现路由往返恢复旧引用，再验证拒绝及重新检查后恢复 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'back-forward cache lifecycle'` | 0 | 1 项真实 Chrome 返回缓存生命周期回归通过；返回页面后旧引用被拒绝 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'in-app back-forward cache lifecycle'` | 0 | 1 项真实 Electron 返回缓存生命周期回归通过；返回页面后旧引用被拒绝 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 22 项通过；授权身份、审批期间撤销/重授、私有字段隐藏、旧协议/版本拒绝及既有桥接验证 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 增加路由往返监听前 10 项真实 MV3 回归通过；监听改动后按下行复查相关场景 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'URL waits\|same-origin nested\|reauthorization\|original route'` | 0 | 4 项受影响的真实 MV3 场景通过；等待、同源嵌套、重新授权和原路由返回均拒绝旧引用并完成清理 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'original route\|real Pi panel'` | 0 | 2 项真实 Electron 回归通过；内置路由往返、最新 Pi/MV3/Harness 配对、输入、截图、焦点及重启授权清除 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-final.json` | 0 | 只读审计：扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

证据：grant-scope-unit-pass.json、grant-scope-native-pass.json、reauthorization-native-pass.json、chrome-route-return-pass.json、bfcache-native-pass.json、in-app-bfcache-native-pass.json、scope-route-native-pass.json、scope-protocol-pi-native-pass.json、cache-audit-final.json，位于 `.artifacts/browser-control/`。真实 Chrome 手动验收问题仍待用户结果，未重新发送重复问题；持续 Goal 保持 active。

新增浏览器夹具使用已有临时目录所有权和清理机制，在结束及启动异常路径关闭上下文/桥接并清理。新增原生测试明确断言本轮配置路径已不存在，清理失败令测试失败。桥接连接、配对码和授权只在内存中；常规 DOM 检查不新建截图文件。

一次早期崩溃用例失败曾留下 `D:\systemp\pi-acceptance-9XYng4`（约 22.7 MB）。当时已确认目录归夹具所有并停止关联测试进程，但删除曾被执行策略拒绝；该目录已于 2026-10-04 获批准后按原命令删除并复核不存在，证据见 `.artifacts/browser-control/cache-removal-approved-9XYng4.json`。其他历史目录未删除；只读审计记录于 `.artifacts/browser-control/cache-audit.json`。

真实 Chrome 手动配对、真实登录页面和策略受限环境尚未验收；已验证的是本地 Chromium 加载项目真实 MV3 扩展。内置浏览器渲染进程崩溃后的快速失败、重新导航和旧引用失效已通过；真实 Chrome 进程崩溃尚未单独验收。不得将未验证项登记为已通过，也不得仅依据测试数量关闭持续 Goal。

### 取消提交复查（2026-10-04 接续）

本轮失败回归复现了另一条竞态：页面渲染线程忙碌时，`type` 或 `scroll` 请求已经被送入内容脚本；主任务取消虽然立即返回 AbortError，页面恢复后仍可能提交 DOM 变化。Chrome 扩展现在为每个命令携带操作 ID，取消时向对应标签发送失效消息，内容脚本在页面操作提交前让出一次事件循环并复查取消状态。内置浏览器使用同样的操作 token，通过隔离世界取消脚本标记排队中的页面执行；取消后的迟到结果仍不会发布到任务。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'queued DOM mutations'` | 1 → 0 | 先复现取消后输入框被写入，再验证忙碌页面恢复后不会提交文本 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 22 项通过；授权、取消、协议、重连和输入事件回归 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 12 项通过；包含取消、撤销、页面忙碌、路由往返和真实 MV3 扩展 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'in-app cancellation does not commit'` | 0 | 1 项通过；内置页面忙碌恢复后不会提交取消的文本 |
| `npm run desktop:test:target -- browser-tools --level native` | 0 | 14 项通过；内置浏览器完整定向回归、Chrome 面板流程、权限、崩溃恢复和取消提交 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-drag-target.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-cancel-side-effects.json` | 0 | 只读审计仍为 22 个目录，11 个符合条件、11 个跳过，符合条件总大小 24,481,508 bytes |

新增证据：`in-app-cancel-native-pass.json`、`chrome-cancel-native-pass.json`、`cancel-side-effects-targeted-pass.json`、`cache-audit-cancel-side-effects.json`，位于 `.artifacts/browser-control/`。真实 Chrome 手动配对、真实登录页面和策略受限环境仍待单独验收，持续 Goal 保持 active。

### 截图取消复查（2026-10-04 接续）

截图属于后台长操作，之前内置浏览器的 `capturePage()` 没有接收任务取消信号。现在内置浏览器和 Chrome 扩展都在截图等待期间监听 `AbortSignal`，取消后不发布图片；调试器连接仍在 `finally` 中释放，网站策略撤销也不会把迟到的截图送入消息流。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'website deny during a running wait or capture'` | 0 | 1 项通过；截图权限撤销与取消截图均不返回图片，随后可重新 inspect |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-screenshot-cancel.json` | 0 | 只读审计仍为 22 个目录，11 个符合条件、11 个跳过，符合条件总大小 24,481,508 bytes |

新增证据：`screenshot-cancel-native-pass.json`、`cache-audit-screenshot-cancel.json`，位于 `.artifacts/browser-control/`。持续 Goal 保持 active。

### 标签实例复查（2026-10-04 接续）

发现 Chrome 标签同步存在一个授权边界：若原生 `tabId` 在两次同步之间被复用，单靠 `tabId` 无法区分旧标签和新标签。扩展现在为每个标签生命周期生成 `instanceId`，主进程只在实例未变化时保留授权；实例替换会清除任务授权并取消挂起操作。该字段只在桥接主进程和扩展之间传递，不返回 Renderer。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 24 项通过；新增同原生 tabId 实例替换不继承授权，以及实例替换取消挂起 close 回归 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 13 项通过；真实 MV3 扩展、标签隔离、取消、路由和返回缓存回归 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-tab-instance-final.json` | 0 | 只读审计仍为 22 个目录，11 个符合条件、11 个跳过，符合条件总大小 24,481,508 bytes |

新增证据：`tab-instance-unit-pass.json`、`tab-instance-native-pass.json`、`cache-audit-tab-instance-final.json`，位于 `.artifacts/browser-control/`。持续 Goal 保持 active。

### 扩展权限复查（2026-10-04 接续）

扩展清单移除未使用的 `scripting` 和 `activeTab` 权限，保留标签读取、调试器、扩展本地存储及 HTTP(S) 内容脚本所需声明。这样不会改变已授权标签的控制范围，只减少安装时的无关权限提示。

本次验证：扩展 `background.js`、`content.js` 和 `input.js` 语法检查退出码 0；`npm run desktop:test:target -- browser-bridge --level unit` 为 24 项通过；`npm run desktop:check` 退出码 0。

补充验证：`npm run desktop:test:target -- browser-bridge --level native` 为 13 项通过，证据保存为 `.artifacts/browser-control/extension-permissions-native-pass.json`。

### 标签实例绑定复查（2026-10-04 接续）

桥接下发给扩展的命令和聚焦请求现在同时携带标签生命周期 `instanceId`。扩展在执行前复核原生 `tabId` 对应的实例；标签关闭后原生 ID 被快速复用时，旧命令会被拒绝，不会作用于新标签。主进程仍在同步替换时清除授权并取消挂起操作。

定向证据：`npm run desktop:test:target -- browser-bridge --level unit` 24 项通过；`npm run desktop:test:target -- browser-bridge --level native` 13 项通过；`npm run desktop:check` 退出码 0；扩展脚本语法检查退出码 0。原生结果保存为 `.artifacts/browser-control/instance-binding-native-pass.json`。

本轮只读缓存审计扫描 22 个临时目录，11 个符合条件、11 个跳过，未删除目录；符合条件总大小 24,481,508 bytes。结果保存为 `.artifacts/browser-control/cache-audit-instance-binding.json`。

### 桥接来源校验复查（2026-10-04 接续）

桥接现在要求每个连接和已认证请求携带有效的 `x-pi-extension-id`，并在存在 `Origin` 时要求它与同一扩展 ID 匹配。这样既拒绝无来源或伪造扩展请求，也兼容实际 MV3 后台请求不总是自动附带 `Origin` 的行为；扩展请求、CORS 预检和测试夹具均已同步。

验证结果：`browser-bridge` 单元 24 项通过，真实 MV3 原生 13 项通过，扩展脚本语法检查和 `npm run desktop:check` 均退出码 0。

### 语义容器滚动复查（2026-10-04 接续）

`scroll` 请求现在会使用 `ref` 或 `locator` 找到最近的可滚动容器；没有目标时仍滚动当前视口。内置浏览器和 Chrome 扩展都支持同源嵌套文档中的容器滚动，并返回实际容器或视口的滚动位置。滚动会触发观察 revision 更新，旧引用仍需重新检查。

定向证据：内置浏览器 `native browser trusted controls...` 1 项通过；Chrome 扩展 `preserves task isolation...` 1 项通过；`npm run desktop:check`、扩展脚本语法检查和 `git diff --check` 均退出码 0。Chrome 证据保存为 `.artifacts/browser-control/scroll-container-chrome-pass.json`，缓存审计为 `.artifacts/browser-control/cache-audit-scroll-container.json`。

### 拖拽语义终点复查（2026-10-04 接续）

发现模型工具的 TypeBox 参数仍把拖拽终点限制为坐标或必填 `ref`，而内置浏览器和 Chrome 执行层已经支持 `locator`。这会让模型在调用主进程前就收到参数校验错误。现已统一为支持坐标、`ref`、`locator` 三种终点形式，并在共享 Zod 校验中拒绝空目标或只提供一个坐标；现有起点定位和权限检查保持不变。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- browser-tools --level unit` | 0 | 12 项通过；增加 locator/ref 终点及不完整坐标拒绝用例 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'native agent browser routes wait, keyboard, hover and drag actions'` | 0 | 内置浏览器语义起点到 locator 终点的真实拖拽通过 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'real Chrome extension preserves task isolation, trusted input, stale refs and screenshots'` | 0 | Chrome 扩展语义终点拖拽、引用失效和截图回归通过 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |

本轮只读缓存审计仍按现有临时目录所有权执行；未删除历史目录，不绕过删除策略。真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### 语义文本定位一致性复查（2026-10-04 接续）

内置浏览器的 `locator.text` 原先使用大小写无关匹配，Chrome 扩展却使用大小写敏感匹配；同一请求可能只在 Chrome 后端失败。扩展现已统一为大小写无关的可见文本匹配，`role`、名称和占位符规则不变。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'real Chrome extension preserves task isolation, trusted input, stale refs and screenshots'` | 0 | 真实 Chromium 扩展使用不同大小写的文本定位悬停，并通过后续点击、输入、等待、截图及引用失效回归 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### 设置页任务授权守卫复查（2026-10-04 接续）

设置页现在会根据当前任务的权限状态同步授权按钮：计划模式或拒绝策略下，授权按钮保持禁用并显示原因；如果该标签已经属于当前任务，仍可执行撤销。这样不会把主进程必然拒绝的授权请求暴露成可点击操作，同时保留收回旧授权的恢复路径。子任务和归档任务继续从任务选择器中排除。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 24 项通过；桥接协议、授权范围、取消、断线、标签实例和输入事件回归 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.spec.ts` | 0 | 6 项通过；验证任务所有者显示、计划/拒绝模式禁用授权、配对刷新、断开和失败重试 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-settings-grant-guard.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### `open` 新标签语义复查（2026-10-04 接续）

`open` 在 Chrome 扩展中始终创建新标签，而内置浏览器此前在传入 `tabId` 时会复用旧标签。内置浏览器现已统一为 `open` 始终创建新标签，只有 `navigate` 复用指定标签；关闭旧标签、后台运行和授权流程保持不变。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'native agent browser can close one existing tab without touching another'` | 0 | 内置浏览器验证带旧 `tabId` 的 `open` 仍创建新标签，并可单独关闭旧标签 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-open-new-tab.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### 默认滚动距离一致性复查（2026-10-04 接续）

内置浏览器默认按当前视口高度的 80% 滚动，Chrome 扩展原先固定为 400px。扩展现已采用相同的 80% 规则，显式传入 `amount` 时仍优先使用调用值。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'real Chrome extension preserves task isolation, trusted input, stale refs and screenshots'` | 0 | 真实 Chromium 验证默认滚动距离等于视口高度的 80% |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-scroll-default.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### Chrome 导航结果复查（2026-10-04 接续）

Chrome 扩展的 `open`/`navigate` 原先只返回 URL，而内置浏览器会同时返回页面检查结果。扩展现在在页面加载完成后执行一次受限 `inspect`，并在返回中提供同样的 `page` 数据；仍保持后台打开、不抢焦点和原有授权边界。新标签在加载、检查失败或取消时会自动关闭，不留下孤立标签。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'real Chrome extension preserves task isolation, trusted input, stale refs and screenshots'` | 0 | 真实 Chromium 扩展验证新标签 `open` 和既有标签 `navigate` 都返回页面检查结果 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'cancelling a Chrome open closes the newly created loading tab'` | 0 | 取消加载中的新标签后，真实扩展关闭该标签且不会残留 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/background.js` | 0 | 扩展后台脚本语法检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-open-cleanup.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### 检查结果形状一致性复查（2026-10-04 接续）

内置浏览器和 Chrome 扩展的 `inspect` 结果原先分别使用顶层 `width/height/scrollX/scrollY` 与嵌套 `viewport/scroll`，模型需要按后端分支解析；`scroll` 动作的滚动位置也存在同样差异。现在两端同时返回两组字段，保留旧字段兼容现有标注与回归逻辑，并统一提供视口尺寸和滚动位置。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'native agent browser executes real DOM operations, images, cancellation and origin restrictions'` | 0 | 内置浏览器检查结果同时验证 `viewport` 与 `scroll` |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'real Chrome extension preserves task isolation, trusted input, stale refs and screenshots'` | 0 | Chrome 扩展检查结果同时验证 `viewport` 与 `scroll` |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-inspect-parity.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未删除，符合条件总大小 24,481,508 bytes |

真实 Chrome 手动配对、真实登录页面和策略受限环境仍待用户验收，持续 Goal 保持 active。

### 桥接 UI 同步及消息结果复查（2026-10-04 接续）

上一轮属于实际进展。本轮复查发现设置页和浏览器面板未消费已有 `browser.bridge` 事件，只靠三秒轮询，因此标签关闭或断开后会短暂显示旧状态。现在生命周期事件立即触发刷新，轮询保留作为兜底；读取按请求顺序接收，迟到的响应不能覆盖新状态。面板快照还绑定任务身份，切换任务时先隐藏旧标签，不能在新请求等待期间显示其他任务的标签。

消息流的 `tabs` 数组结果现在显示标题、网址和对应标签的查看按钮；空列表有明确提示。成功关闭的结果显示“标签已关闭”并移除无效的打开按钮，中英文立即切换。页面结果仍保留原始信息，不把页面文字当成命令执行。该回归夹具改用已有临时目录所有权及清理机制。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.spec.ts` | 0 | 9 项通过；新增立即刷新、迟到响应、任务切换隔离及输入焦点回归 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge connects through the real Pi panel'` | 0 | 1 项真实 Electron/MV3/Harness 流程通过；冻结 Renderer 轮询后，标签关闭事件仍立即清空面板并保持聊天焦点；重启清除授权及配置目录删除断言通过 |
| `npm run desktop:test:target -- --file test/e2e/activity.spec.ts --grep 'browser'` | 0 | 3 项通过；两后端标签列表、精确查看请求、空列表、关闭结果和即时英文切换 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-event-ui-results.json` | 0 | 只读审计扫描 22 个目录，11 个符合条件、11 个跳过；未新增残留，符合条件总大小仍为 24,481,508 bytes |

进程只读核对未发现带本轮验收、Chrome 夹具或 UI 临时目录标识的 Electron/Chrome 残留。历史目录未删除。真实 Chrome 日常配置中的手动配对、真实登录页面和策略受限环境仍未验收；自动 Chromium 证据不代替这些项，持续 Goal 保持 active。

### 运行时表单状态复查（2026-10-04 接续）

真实 Electron 与 MV3 失败回归均复现：页面脚本直接修改输入值后，旧引用仍被接受，并把新值覆盖为模型的旧操作。诊断探针证实属性赋值没有修改 HTML 的 value 属性，也没有产生 MutationObserver 记录；仅监听 DOM 变更无法发现这类变化。探针已移除，保留实际行为回归。

两端现在在执行前同步比较普通输入、勾选状态、选择项及可编辑状态，并消费 input/change 事件。主文档及安全可访问的同源框架使用相同规则；检测变化时一起清除引用和更新 observation revision，带旧 revision 的坐标操作也被拒绝。密码值不被读取或保存到比较快照。重新 inspect 后可继续输入，过期写入不会覆盖页面的新值。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'form property changes'` | 1 → 0 | 先复现覆盖新输入值，再验证输入、勾选、选择项、同源框架变化及旧坐标观察被拒绝；新引用可恢复 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'form property changes'` | 1 → 0 | 真实 Electron 验证相同边界，并检查原输入值仍保留、密码值未返回 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'trusted input\|same-origin nested frames'` | 0 | 2 项直接受影响回归通过；真实 MV3 输入、键盘、拖拽、截图及同源嵌套控制 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'executes real DOM\|routes wait, keyboard\|trusted controls'` | 0 | 3 项直接受影响回归通过；内置输入、取消、截图、组合键、拖拽、Canvas、框架及旧观察 |
| `npm run desktop:check` | 0 | 补齐测试观察结果的 value 类型后通过；未修改依赖或 IPC 契约 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-form-properties.json` | 0 | 只读扫描 22 个目录，11 个符合条件、11 个跳过；未新增残留，符合条件总大小仍为 24,481,508 bytes |

证据保存为 `.artifacts/browser-control/` 下的 `chrome-form-property-before.json`、`in-app-form-property-before.json`、`chrome-form-property-pass.json`、`in-app-form-property-pass.json` 及两份 `form-property-regression-pass.json`。检查未发现本轮夹具进程残留，历史目录未删除。真实 Chrome 手动配对验收仍未完成，持续 Goal 保持 active。

### 禁用表单组复查（2026-10-04 接续）

真实 MV3 失败回归复现：fieldset 禁用时，后代输入框自身的 disabled 属性仍为 false，Chrome 扩展误允许直接写入，并在 inspect 中把该控件报告为可操作。扩展现与内置浏览器一样使用实际的 :disabled 状态，同时修正检查结果和执行前守卫，语义定位、ref 和坐标点击遵循同一状态。

新增两端原生场景验证输入框、textarea、select 和按钮继承禁用状态，拒绝操作且原值不变；fieldset 首个 legend 中可编辑控件仍可输入。解除禁用并重新 inspect 后，模型可使用新引用继续操作。内置浏览器执行逻辑本身未修改，仅补充行为一致性回归。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'disabled fieldsets'` | 1 → 0 | 先复现禁用输入被写入，再验证状态报告、语义输入、ref/坐标点击拒绝、legend 例外及重新启用恢复 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'disabled fieldsets'` | 0 | 1 项真实 Electron/Harness 场景通过；禁用拒绝、原值保留、legend 可编辑及恢复一致 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'trusted input\|form property changes'` | 0 | 2 项直接受影响回归通过；正常输入、可信键盘、拖拽、截图及运行时表单状态引用失效 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-disabled-fieldsets.json` | 0 | 只读扫描 22 个目录，11 个符合条件、11 个跳过；未新增残留，符合条件总大小仍为 24,481,508 bytes |

证据保存为 `.artifacts/browser-control/` 下的 `chrome-disabled-fieldset-before.json`、`chrome-disabled-fieldset-pass.json`、`in-app-disabled-fieldset-pass.json`、`chrome-disabled-fieldset-regression-pass.json` 及本轮缓存审计。未发现本轮夹具进程残留，历史目录未删除。

真实 Chrome 界面验收将使用独立临时配置及本地测试页。Computer Use 的 confirmations.md 将安装浏览器扩展列为需动作时确认；已向用户请求允许加载本项目开发扩展，尚未收到确认，因此未执行扩展安装或修改日常 Chrome 配置。该验收未计为通过，持续 Goal 保持 active。

### 新标签首次观察与授权复查（2026-10-04 接续）

真实 MV3 失败回归复现：Chrome `open` 返回了页面检查及 ref，但主进程随后生成新的标签授权身份，使返回的 ref 立即过期。模型无法直接继续点击，必须多做一次 inspect。

现在主进程在创建命令发出前生成独立授权身份，扩展的首次 inspect 和最终标签授权使用同一身份。带来源 `tabId` 的 open 也使用新身份，不沿用旧标签身份。授权身份不出现在工具结果或 Renderer；撤销、转交或重新授权仍使旧引用失效。协议和扩展版本未变化。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'newly opened tabs'` | 1 | 修复前复现打开后立即使用返回引用被拒绝；修复后结果见下方三项回归 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 25 项通过；新增带/不带来源标签的创建身份、首次观察连续性、私有身份隐藏和撤销后重新生成身份 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'newly opened tabs\|reauthorization\|preserves task isolation'` | 0 | 3 项真实 MV3 场景通过；首次引用、授权变更及既有输入/截图流程 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge connects through the real Pi panel'` | 0 | 1 项真实 Pi/MV3/Harness 场景通过；面板配对后打开新标签、直接点击返回引用、单独关闭并保持聊天焦点，重启清除授权 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |

证据保存为 `.artifacts/browser-control/` 下的 `chrome-open-refs-before.json`、`chrome-open-scope-unit-pass.json`、`chrome-open-refs-native-pass.json` 和 `chrome-open-refs-harness-pass.json`。

### 文本输入模式与密码值复查（2026-10-04 接续）

补齐输入模式验收时，两端失败回归均发现密码 append 通过读取旧 value 再拼接实现。这违反不读取密码值的边界。现在密码追加使用浏览器原生选择范围及末尾插入，不把旧密码值读入隔离脚本；普通输入、textarea、contenteditable 的替换、追加、清空和 select 选值保持可用。

新增真实 Electron/Harness 与 MV3 场景在各自实际隔离世界安装读取拦截器，读取密码 value 即报错；修复前追加失败，修复后 inspect、追加和清空均完成，工具结果不含密码值。拦截器仅属于本地测试页面，夹具结束时销毁；没有增加模型可调用的 JavaScript 通道。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'text modes'` | 1 | 修复前复现 PASSWORD_VALUE_READ；修复后结果见下方两项回归 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'text modes'` | 1 | 真实 Electron/Harness 同样复现旧密码值被隔离脚本读取；修复后结果见下方两项回归 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'text modes\|queued DOM mutations'` | 0 | 2 项通过；输入模式及忙碌页面取消后不提交写入 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'text modes\|in-app cancellation does not commit'` | 0 | 2 项通过；内置输入模式及忙碌页面取消写入回归 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/content.js` | 0 | 扩展内容脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-input-modes.json` | 0 | 只读扫描 22 个目录，11 个符合条件、11 个跳过，符合条件总大小仍为 24,481,508 bytes；本轮未新增遗留目录 |

证据：`chrome-password-append-before.json`、`in-app-password-append-before.json`、`chrome-text-modes-pass.json`、`in-app-text-modes-pass.json` 和 `cache-audit-input-modes.json`，均位于 `.artifacts/browser-control/`。未发现本轮浏览器夹具进程残留；历史目录未删除，既有删除策略限制仍保留。真实 Chrome 界面配对验收等待此前发出的扩展加载确认，未重复申请、未计为通过；持续 Goal 保持 active。

### 扩展启动恢复与进程退出复查（2026-10-04 接续）

新增生命周期单元回归执行实际 background.js，分别阻断本地凭据读取、暂停首次标签同步及返回失效 token。修复前均失败：恢复失败或同步期间断开留下一个定时器；凭据读取完成前断开还会把旧连接重新标为 connected。恢复现在先记录连接代次，在异步凭据读取、密钥推导和首次同步后复查代次与连接状态；取消或失败后不发布旧连接、不启动定时器和长轮询。凭据按既有断开流程删除，浏览器权限及协议未变。

真实扩展回归新增强制退出项目拥有的 Chromium 进程，再使用同一临时配置重新启动。进程 ID 从该夹具的浏览器调试会话取得，未操作日常 Chrome。验证运行中等待在恢复时失败、旧任务授权不继承、旧引用被拒绝，重新授权并 inspect 后可继续输入。另一场景在进程退出后令 Pi 侧旧连接失效，重启扩展保持未连接，用户重新配对和授权后恢复输入。

早期进程退出探针使用 Browser.crash，未在等待请求的期限内完成；随后改为终止已确认归夹具所有的浏览器进程。第二次失败来自新弹窗启动状态含端口的既有文案，修正为验证完整启动状态。两次失败均为验收夹具问题，未登记为产品恢复缺陷；相应测试实际重跑通过。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `node --test test/chrome-extension-lifecycle.test.mjs`（apps/desktop） | 1 | 修复前 3 项失败，分别复现定时器遗留和旧连接复活；修复后结果见桥接单元命令 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 28 项通过；包含新增 3 项恢复失败和取消路径，实际执行背景脚本并检查凭据、定时器及请求状态 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'browser process crash'` | 1 | 两次早期夹具失败，原因如上；未改写为通过 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'browser process crash\|reconnects without old polling'` | 0 | 修改背景脚本前 2 项通过；证实进程退出和主动重连不继承授权 |
| `npm run desktop:test:target -- --file test/e2e/browser-bridge.nonvisual.spec.ts --grep 'browser process crash\|invalid stored connection\|reconnects without old polling'` | 0 | 修复后 3 项真实 MV3 场景通过；进程退出恢复、失效连接重新配对、旧轮询/任务授权/引用隔离 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器回归通过；新增生命周期测试已加入 browser-bridge 单元选择，代表命令实际执行，未运行其他功能全套 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `node --check apps/desktop/chrome-extension/background.js` | 0 | 扩展背景脚本语法检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-restore-lifecycle.json` | 0 | 只读扫描仍为 22 个目录，11 个符合条件、11 个跳过，符合条件总大小 24,481,508 bytes；未新增遗留目录 |

证据位于 `.artifacts/browser-control/`：`chrome-process-crash-before.json`、`chrome-process-recovery-pass.json`、`chrome-restore-lifecycle-before.json`、`chrome-restore-lifecycle-unit-pass.json`、`chrome-restore-lifecycle-native-pass.json` 和 `cache-audit-restore-lifecycle.json`。未发现本轮浏览器或测试进程残留，临时配置删除断言通过。当前新增的是独立 Chromium 的真实协议及进程退出证据，不代替真实 Chrome 手动配对；扩展加载确认仍待回复，持续 Goal 保持 active。

### 超时后的迟到写入复查（2026-10-04 接续）

按原计划核对取消、超时及失败恢复时，真实 Electron/Harness 失败回归复现：页面渲染线程忙碌超过 10 秒，工具已报告页面检查超时，但页面恢复后仍将“late write”写入输入框。此前只有用户取消会标记隔离脚本的操作 token 失效，超时只丢弃了返回结果。

现在超时与取消复用同一操作失效处理。排队脚本执行前检查失效 token，超时后不再提交 DOM 写入；页面恢复后重新 inspect，使用新引用仍可正常输入。没有缩短生产期限、模拟成功或清空用户输入来通过验收。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'timed-out DOM mutations'` | 1 | 修复前真实页面在工具超时后仍被写入；保留失败证据 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'timed-out DOM mutations\|in-app cancellation does not commit\|in-app load waits'` | 0 | 3 项通过；超时和取消不提交迟到文本，加载期限及重新检查后输入恢复 |
| `npm run desktop:test:target -- browser-control --level unit` | 0 | 12 项通过；协议、权限、等待期限、取消、监听和输入事件释放 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |

证据：`.artifacts/browser-control/in-app-timeout-write-before.json`、`in-app-timeout-write-pass.json` 和 `timeout-browser-control-unit-pass.json`。本次仅运行直接受影响的原生场景，没有重新执行其他功能全套。

### 两后端页面返回格式复查（2026-10-04 接续）

原计划要求两后端使用同一 browser 格式。此前 Chrome 的 inspect、type、scroll、wait 将页面数据放在顶层，内置浏览器却使用 page 字段；模型仍需要按后端分支解析。新单元回归先复现该差异，Chrome 现将这些动作统一为 `{ backend, tabId, page }`，与内置浏览器一致。页面文本保留不可信数据前缀，原生 Chrome 标签 ID 不出现在 page 中。请求、扩展握手和授权身份不变，截图仍以图片内容块返回。

| 命令 | 退出码 | 本次结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/browser-bridge.test.ts --grep 'page result envelope'` | 1 | 修复前检查结果缺少 page，确认为接口差异 |
| `npm run desktop:test:target -- browser-bridge --level unit` | 0 | 29 项通过；新增四种动作的统一页面格式、不可信前缀和公开标签身份验证 |
| `npm run desktop:test:target -- browser-bridge --level native` | 0 | 20 项通过；页面格式影响所有 Chrome 页面动作，因此执行本模块原生回归，未扩大至其他功能 |
| `npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts --grep 'Chrome bridge connects through the real Pi panel'` | 0 | 1 项真实 Pi/MV3/Harness 流程通过；模型实际收到 page 中的观察及元素，输入、等待、截图、标签关闭、焦点和重启授权清除仍正常 |
| `npm run desktop:test:target -- --file test/e2e/activity.spec.ts --grep 'browser'` | 0 | 3 项消息流回归通过；来源、进度、错误、标签列表、关闭结果及精确查看入口 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查 |
| `git diff --check` | 0 | 无差异格式错误 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-control/cache-audit-timeout-envelope.json` | 0 | 只读扫描仍为 22 个目录，11 个符合条件、11 个跳过，符合条件总大小 24,481,508 bytes；未新增缓存遗留 |

证据：`chrome-page-envelope-before.json`、`chrome-page-envelope-unit-pass.json`、`chrome-page-envelope-native-pass.json`、`chrome-page-envelope-harness-pass.json`、`page-envelope-feedback-ui-pass.json` 和 `cache-audit-timeout-envelope.json`，位于 `.artifacts/browser-control/`。未发现本轮夹具进程残留。真实 Chrome 手动配对仍等待此前的扩展加载确认，历史目录删除策略限制仍保留；没有把这两项登记为完成，持续 Goal 保持 active。

### 真实 Chrome 启动与资源收尾复查（2026-10-04 接续）

按用户批准范围只启动一个独立 Chrome profile `D:\systemp\pi-desktop-tests-manual-real-20261004-a1`，命令退出码 0，`Start-Process` 返回 PID 30892。`sky.list_windows()` 返回日常 Chrome 窗口 328030 与本轮窗口 593156（“新标签页 - Google Chrome”）；未激活或输入日常窗口。

对本轮窗口执行一次 `get_window_state` 后，Computer Use 因无法可靠识别当前浏览器 URL 明确终止：`Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` 立即停止界面输入，扩展未加载、未配对、未授权，未执行 inspect/type/click/screenshot/撤销；该场景不计为真实 Chrome 手动验收通过。只读进程核验确认匹配 profile 的进程均由 PID 30892 派生，随后关闭这些进程并删除 profile，剩余匹配进程为 0、`Test-Path` 为 `False`。

证据：`.artifacts/browser-control/manual-real-chrome-attempt-20261004.json`、`manual-real-chrome-cleanup-20261004.json`。早期目录 `D:\systemp\pi-acceptance-9XYng4` 已按批准删除，复核证据为 `cache-removal-approved-9XYng4.json`；真实 Chrome 手动配对仍待在 URL 核验可用时重新验收。
