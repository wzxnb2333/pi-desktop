# Pi Desktop 持续迭代 Goal

状态：本文记录的历史五轮 Goal 已完成。用户随后创建的持续迭代 Goal 仍为 active，当前台账见 [接续迭代](ongoing-iteration.md)。历史通过数量不代替新改动的验证。用户已明确取消严格像素级验收，改为关注 UI 复刻、用户体验和真实功能完善。

## 目标与边界

以 Codex 26.915.4065.0 / app 26.915.31945 为设计参考，保留 Pi Desktop 品牌和真实运行时。Satang 仅作为只读证据。默认中文，支持即时英文切换。严格像素差分保留为诊断，不再阻止功能交付。

不启用子代理，不提交、不发布、不打包 EXE。以开发模式、本地测试数据和假供应商验证。保留工作区已有修改，不操作真实用户数据来模拟测试。

## 每轮循环

1. 检查真实界面和一组完整用户流程，记录可复现问题及影响。
2. 优先修复阻断、数据丢失和错误行为，再处理难用交互与视觉层级。每轮选取可独立验证的小批问题。
3. 实现改进，保持会话、草稿、阅读位置、后台任务和持久化兼容。
4. 执行 desktop:check、受影响的定向测试和必要的界面检查。影响公共运行时或跨模块行为时扩大回归。
5. 登记修改、命令退出码、证据和待办，再进入下一轮；复用有效证据，不重复已完成劳动。

## 验收标准

- UI：整体布局、组件层级、间距、字体和交互状态协调；深浅主题、中英文以及 1440×940、1000×700、1280×800 无明显截断、遮挡或溢出。
- 体验：用户能找到入口，清楚知道是否运行、是否保存、下一步如何处理；失败有说明和恢复路径；键盘和输入法正常。
- 功能：核心流程使用真实 IPC 和服务完成，不引入静态演示、无效按钮或模拟业务。
- 可靠性：已确认的高优先级问题修复，定向与跨功能回归通过；残留限制明确记录。
- 像素误差、品牌差异和缺失旧版参考只作为辅助信息，不等同于用户体验失败或整体交付失败。

## 迭代队列

| 顺序 | 范围 | 检查与改进目标 | 状态 |
| --- | --- | --- | --- |
| 1 | 验收与双语体验 | 更新诊断报告口径；补齐原生浏览器权限、清除数据和下载对话框的语言切换 | 已完成：类型检查、3 项单测及 17 项原生回归通过 |
| 2 | 会话与输入 | 发送、停止、排队、附件、中文输入法、草稿恢复、审批与摘要定位 | 已完成：修复两处草稿覆盖；类型检查与 84 项定向回归通过 |
| 3 | 工作台 | Git/文件修改、未保存保护、终端与浏览器状态、错误恢复和键盘操作 | 已完成：修复保存竞争与错误反馈；9 项单测、30 项跨功能回归及 12 项最终编辑器验证通过 |
| 4 | 管理与设置 | 表单反馈、设置保存、模型连接、Skills/MCP、自动化和待审阅流程 | 已完成：密钥、表单切换和离页保护；类型检查、3 项单测及 51 项桌面回归通过 |
| 5 | 综合验收 | 复查视觉协调与跨功能流程，关闭高优先级问题并整理交付记录 | 已完成：179 项单测、401 项整套回归；最后导航修复经 116 项跨功能验证通过 |

## 证据与记录

前一轮基线见 [UI 改造记录](codex-26915-alignment.md) 和 [.artifacts 对照图库](../../.artifacts/codex-26915-alignment/gallery.html)。类型检查、173 项单元测试、367 项完整桌面回归和双语/布局专项已执行；这些是既有证据，不自动代表后续改动已验证。

### 第 1 轮

- 已创建活动 Goal，明确循环、优先级和完成条件。
- 已修复：浏览器权限申请、权限管理、清除站点数据、下载保存框跟随即时语言切换。权限名、站点地址和网页原始内容保持原样。
- 通过持久化状态 getter 读取当前语言，不重建浏览器服务、标签页或任务进程。回归覆盖中→英→中切换、取消清除后保留站点数据、下载框标题与权限请求。
- 已更新对照图库和报告：像素门槛仅作诊断。复用上一轮 288 张截图，未声称本轮重新采集了原生弹窗截图。

| 验证 | 工作目录与命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 桌面类型检查 | 根目录：npm run desktop:check | 0 | 通过 |
| 翻译单元测试 | apps/desktop：node --import tsx --test test/localization.test.ts | 0 | 3 / 3 |
| 双语、浏览器与工作台原生回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/localization.nonvisual.spec.ts test/e2e/browser.nonvisual.spec.ts test/e2e/workbench.nonvisual.spec.ts | 0 | 17 / 17 |
| 更新视觉诊断报告 | 根目录：node apps/desktop/scripts/alignment-report.mjs | 0 | 保留原始差分，移除像素阻断口径 |
| 图库检查 | 根目录：node apps/desktop/scripts/alignment-gallery-check.mjs | 0 | 288 个场景截图条目、492 个图片资产及筛选交互有效 |

日志：[类型检查](../../.artifacts/desktop-iteration-01/desktop-check.log)、[翻译单测](../../.artifacts/desktop-iteration-01/localization-unit.log)、[原生回归](../../.artifacts/desktop-iteration-01/native-regression.log)。本轮没有依赖、锁文件或根级检查入口变更，未重复执行根级完整检查。

### 第 2 轮

- 复现：新任务选项中的快捷建议直接替换已有草稿；任务错误卡片的“继续 / 重试”也会用上一条请求覆盖用户正在编辑的补充说明。中文回归在修复前分别断言失败，确认是实际内容丢失。
- 已修复：快捷建议追加到当前任务草稿；重试优先保留现有草稿，仅在草稿为空时恢复上一条请求。两个入口均保留附件、聚焦输入框、等待用户主动发送。
- 使用已有的任务级草稿更新接口读取最新状态，保留持久化与任务切换逻辑，没有引入第二份输入状态或更改会话 IPC。
- 新增中英文浏览器回归，验证草稿、附件、任务切换恢复、空草稿重试和不自动发送。对照截图使用本地测试数据。
- 已完成截图检查：1000×700 的中文深色和英文浅色输入区保留原始文字与附件，建议另起一段；没有明显遮挡或溢出。既有布局用例同时覆盖 1000、1280、1440 宽度及深浅/系统主题。
- 首次试跑还发现测试中的英文菜单名称与实际词条不符，已更正；这不计为产品缺陷。最终回归没有失败或跳过项。

| 验证 | 工作目录与命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 桌面类型检查 | 根目录：npm run desktop:check | 0 | 通过 |
| 会话与输入定向回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/composer-recovery.spec.ts test/e2e/composer.spec.ts test/e2e/reference.spec.ts test/e2e/summary.nonvisual.spec.ts test/e2e/acceptance.spec.ts | 0 | 84 / 84；包含 4 项新增草稿保护用例 |

覆盖真实任务的停止与错误恢复、排队恰好一次执行、会话重启恢复、50 轮历史、附件进入模型上下文、无效附件拒绝、Chromium 中文组合输入、审批、摘要定位与阅读位置。设置、Skills/MCP 和自动化原生用例也在本次选择的验收文件中通过，但不替代下一轮专项体验巡检。

修改：[快捷建议](../../apps/desktop/src/renderer/src/components/composer/home-utility.tsx)、[重试入口](../../apps/desktop/src/renderer/src/components/timeline/timeline.tsx)、[新增回归](../../apps/desktop/test/e2e/composer-recovery.spec.ts)、[中断场景数据](../../apps/desktop/test/e2e/fixtures/reference-harness.tsx)。

证据：[类型检查日志](../../.artifacts/desktop-iteration-02/desktop-check.log)、[最终回归日志](../../.artifacts/desktop-iteration-02/conversation-regression.log)、[初始复现日志](../../.artifacts/desktop-iteration-02/draft-before.log)、[中文深色截图](../../.artifacts/desktop-iteration-02/suggestion-draft-zh-CN.png)、[英文浅色截图](../../.artifacts/desktop-iteration-02/suggestion-draft-en-US.png)。本轮没有依赖、锁文件、根级检查入口改动；没有重复执行完整桌面回归或根级全量检查。

### 第 3 轮

- 复现并修复两条真实保存竞争：提交保存后把文字改回旧内容，晚到回执会覆盖这次编辑；保存期间切到其他面板再返回，已完成的保存版本没有同步，下一次保存错误使用旧版本。修复前的两项浏览器回归均明确失败，见复现日志。
- 文件缓冲按任务与路径集中管理。保存回执更新落盘基线并保留后续输入；多个文件独立保存，面板隐藏或任务切换后仍接收状态。旧读取结果不能覆盖新保存版本，重复保存不会再发出第二个写入请求。
- 加入双语读取/保存/未保存状态、读取失败后的内联重试；保存尚未完成时不允许把“关闭/重新加载”误当成取消写入。完成后提示自动解除，原有未保存确认与外部修改冲突检查继续生效。
- 后台保存失败保留原始错误与草稿，回到文件后可继续处理。应用级关闭保护随所有缓冲区状态同步，文件面板隐藏后完成保存也会解除保护，启动时重新同步真实状态。
- 新增测试同时验证 Windows CRLF 与 UTF-8 BOM 的落盘归一化；只有提交后没有继续编辑才接受保存结果中的归一化文本，避免误报“未保存”或覆盖新输入。原生 Electron 回归验证实际文件字节、无脏标记关闭及重启后的磁盘内容。
- 文件编辑与保存反馈属于 Pi 功能适配，沿用同版组件的字体、边界、主题颜色与交互层级；不声称旧版参考包含同等编辑器功能。

| 验证 | 工作目录与命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 桌面类型检查 | 根目录：npm run desktop:check | 0 | 最终代码通过 |
| 缓冲区与双语单测 | apps/desktop：node --import tsx --test test/file-buffers.test.ts test/localization.test.ts | 0 | 9 / 9，其中 6 项缓冲区用例 |
| 工作台跨功能回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/file-editor.spec.ts test/e2e/file-navigation.nonvisual.spec.ts test/e2e/workbench.nonvisual.spec.ts test/e2e/git.nonvisual.spec.ts | 0 | 30 / 30；包含真实 Git、文件搜索、关闭保护、终端恢复、浏览器与任务切换 |
| 最终编辑器验证 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/file-editor.spec.ts test/e2e/file-editor.nonvisual.spec.ts | 0 | 12 / 12；归一化修复后重跑 11 项编辑器用例并加入 1 项原生保存回归 |

30 项与 12 项运行存在 11 项重复，不合计为 42 项独立测试。最终单行归一化修复未改变 Git、搜索、终端和浏览器流程，这些复用本轮跨功能证据；完整桌面回归留在综合验收阶段。

已生成 12 张界面图：中英文 × 深浅主题 × 1440×940、1280×800、1000×700。逐场景检查编辑工具栏与整窗横向溢出，均通过；人工复核中英文、深浅和窄分屏代表图，保存状态与操作可辨认。窄分屏下欢迎标题的中文尾词仍有不自然断行，登记到第 5 轮视觉整理，不影响本轮文件保存操作。

修改：[缓冲区](../../apps/desktop/src/renderer/src/lib/file-buffers.ts)、[文件面板](../../apps/desktop/src/renderer/src/components/panels/files-panel.tsx)、[关闭保护同步](../../apps/desktop/src/renderer/src/state/app.tsx)、[双语词条](../../apps/desktop/src/shared/extra-messages.ts)、[面板样式](../../apps/desktop/src/renderer/src/styles/panels.css)。测试新增缓冲区单测、延迟回执场景与原生文件保存用例。

证据：[原问题复现](../../.artifacts/desktop-iteration-03/editor-reproduced.log)、[类型检查](../../.artifacts/desktop-iteration-03/desktop-check.log)、[单测](../../.artifacts/desktop-iteration-03/buffers-localization-unit.log)、[工作台回归](../../.artifacts/desktop-iteration-03/workbench-regression.log)、[最终编辑器验证](../../.artifacts/desktop-iteration-03/editor-final.log)、[中文深色截图](../../.artifacts/desktop-iteration-03/file-saving-zh-CN-dark-1440.png)、[英文浅色窄分屏截图](../../.artifacts/desktop-iteration-03/file-saving-en-US-light-1000.png)。本轮未修改依赖、锁文件、IPC 契约或根级检查入口。

### 第 4 轮

- 复现并修复：模型标签切换直接清空未提交的 API Key；仅保存当前标签的密钥，导致其他模型的密钥遗漏。草稿现在按稳定模型 ID 存在界面内存中，保存时处理所有保留模型；只清除已经成功写入加密存储的密钥，失败后可定向重试，不把明文密钥放入设置或 UI 持久化数据。
- 自动化重复点击“新建”或当前条目“编辑”只重新聚焦表单，保留输入；切换其他表单前可选择继续编辑或明确放弃修改。删除当前编辑的计划后关闭表单，避免留下虚假的新计划状态。
- 设置、MCP 密钥、自动化和 Skill 草稿增加工作台离页保护。保存进行中保持当前页面并提示等待；失败保留草稿；保存成功或明确放弃后允许离开。没有改动现有会话、工具或设置 IPC。
- 离页确认优先聚焦“继续编辑”，支持 Escape 返回原入口；后退/前进的历史游标仅在真正导航后更新，取消离开不会破坏历史位置。中英文切换保持密钥和表单内容。
- 12 张新增界面图覆盖中英文、深浅主题和三个窗口宽度，整窗和确认卡片没有横向溢出。检查中文深色宽窗与英文浅色窄窗代表图，确认按钮、正文与边界清晰。属于 Pi 表单保护适配，不声称是旧版 Codex 的逐像素复现。

| 验证 | 工作目录与命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 桌面类型检查 | 根目录：npm run desktop:check | 0 | 最终代码通过 |
| 翻译单测 | apps/desktop：node --import tsx --test test/localization.test.ts | 0 | 3 / 3 |
| 管理、设置和导航回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/settings.spec.ts test/e2e/management.spec.ts test/e2e/form-navigation.spec.ts test/e2e/mcp-settings.spec.ts test/e2e/management.nonvisual.spec.ts test/e2e/model-settings.nonvisual.spec.ts test/e2e/localization.nonvisual.spec.ts test/e2e/primitives.spec.ts | 0 | 51 / 51；含 12 项新增用例、原生持久化、模型切换、流式输出期间语言切换、MCP 失败重试和审阅历史 |

修复前 3 项定向回归均失败，见 [问题复现日志](../../.artifacts/desktop-iteration-04/forms-before.log)。中途测试还修正了语言选择器的精确标签和测试翻译助手类型，这些测试问题不计为产品缺陷。最终运行没有失败或跳过项；开发打包过程保留了已有 Zod 注释位置警告，没有改动该依赖。

修改：[设置](../../apps/desktop/src/renderer/src/Settings.tsx)、[离页保护](../../apps/desktop/src/renderer/src/components/primitives/unsaved-navigation.tsx)、[自动化](../../apps/desktop/src/renderer/src/components/management/automations.tsx)、[Skills](../../apps/desktop/src/renderer/src/components/management/skills-page.tsx)、[导航历史](../../apps/desktop/src/renderer/src/hooks/use-workspace-history.ts)。

证据：[类型检查](../../.artifacts/desktop-iteration-04/desktop-check.log)、[翻译单测](../../.artifacts/desktop-iteration-04/localization-unit.log)、[最终 51 项回归](../../.artifacts/desktop-iteration-04/management-regression.log)、[中文深色宽窗](../../.artifacts/desktop-iteration-04/unsaved-settings-zh-CN-dark-1440.png)、[英文浅色窄窗](../../.artifacts/desktop-iteration-04/unsaved-settings-en-US-light-1000.png)。未修改依赖、锁文件或根级检查入口；完整桌面回归进入第 5 轮。

### 第 5 轮

- 修复窄分屏欢迎标题的中文尾词断行，保持“中构建”完整换行。中英文、深浅主题、三种宽度重新采集 288 张场景图；整页、控件、面包屑与图标检查没有溢出、异常换行或裁切。人工复核中文深色窄分屏和英文浅色确认框，正文、边界、按钮与保存状态可辨认。
- 复现并修复离页保护的两处不完整行为：取消切换空项目时，当前任务已经提前清空；取消“新建任务”时，后台已经创建了不需要的任务。现在项目、任务、阅读标记与页面一起在确认后更新，创建任务也等待确认。保存进行中拒绝创建；取消或取代请求会结束相应等待，不遗留隐式任务。
- 自动化新草稿记录打开时的项目，避免目标随其他导航漂移。后退、前进、侧栏项目、任务和新建入口使用同一离页保护；延迟任务创建完成后若已经进入另一份待保存表单，会重新检查当前保护。
- 将前几轮新增的草稿、文件编辑、离页保护和双语用例纳入现有开发模式回归入口，没有移除旧测试。由于检查入口变化，执行根级完整检查；没有依赖或锁文件改动。
- 重新核验固定参考中的 80 个截图与 DOM 哈希，全部匹配；Satang 保持只读。旧 app.asar 不存在，只保留原提取清单的归档哈希，不声称重新验证原归档。

| 验证 | 工作目录与命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 最终桌面类型检查 | 根目录：npm run desktop:check | 0 | 最后导航修复后的代码通过 |
| 根级完整检查 | 根目录：npm run check | 0 | Biome 检查 1383 个文件且没有应用修复；类型、依赖、导入边界、锁文件与浏览器冒烟检查通过 |
| 全部桌面单测 | apps/desktop：$tests = Get-ChildItem test -Filter '*.test.ts' \| ForEach-Object FullName; node --import tsx --test @tests | 0 | 179 / 179，无失败或跳过 |
| 整套开发模式回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts | 0 | 401 / 401，9.2 分钟，无失败、跳过或不稳定重试 |
| 最后导航修复定向验证 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/form-navigation.spec.ts | 0 | 11 / 11；含 3 项新增取消、确认和读取标记用例 |
| 最后导航修复跨功能回归 | apps/desktop：使用下方 16 个文件的定向命令 | 0 | 116 / 116，3.6 分钟，无失败、跳过或不稳定重试 |
| 视觉矩阵 | 根目录：node apps/desktop/scripts/alignment-visual.mjs | 0 | 24 个场景，288 张截图，页面异常及布局溢出均为 0 |
| 区域差分与报告 | 根目录：node apps/desktop/scripts/alignment-regions.mjs；node apps/desktop/scripts/alignment-report.mjs | 0 | 更新参考、实现和差分；像素阈值只作诊断 |
| 图库验证 | 根目录：node apps/desktop/scripts/alignment-gallery-check.mjs | 0 | 492 个图片资产及场景筛选通过，错误 0 |

401 项整套回归在最后导航修复之前完成。其后补充 3 项用例并运行定向与跨功能回归，不能把相互重叠的运行数相加当作独立用例数。末轮只改桌面导航与对应测试，未改根级检查覆盖的公共代码；根级检查与 179 项服务/工具单测复用本轮有效结果。

最后的跨功能命令，在 apps/desktop 执行：

~~~powershell
$specs = @('form-navigation', 'settings', 'sidebar', 'management', 'primitives',
  'search.nonvisual', 'workbench.nonvisual', 'localization.nonvisual',
  'management.nonvisual', 'model-settings.nonvisual', 'resources', 'skills.nonvisual',
  'summary.nonvisual', 'desktop.nonvisual', 'composer-recovery', 'composer') |
  ForEach-Object { 'test/e2e/' + $_ + '.spec.ts' }
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts @specs
~~~

验证边界：默认 playwright.config.ts 的一次广泛试跑枚举了 413 项，旧的 desktop.spec.ts 两项仍使用历史打包渲染入口而未通过，随后主动停止该试跑，退出 1；[完整日志](../../.artifacts/desktop-iteration-05/desktop-full.log) 保留。维护中的 desktop.nonvisual.spec.ts 使用开发源码入口，对应的原生核心流程和首启加密存储均通过，没有以删除旧测试或更新像素快照消除失败。安装器条件未配置，该项被跳过；没有运行安装/卸载、打包 EXE 或实际 Windows 拼音驱动测试。Chromium 组合输入及原生终端的 IME 行为在开发回归中覆盖，不能代替系统拼音驱动验收。

视觉边界：16 组可比英文整窗仍不满足旧像素阈值；12 组错误正文只作诊断，28 组中文只检查布局，232 组没有同场景参考。它们合计 288 张图，不伪报为逐像素通过。按照用户更新后的要求，这些保留的诊断不阻止本轮视觉与功能交付。末轮导航修复没有改变矩阵组件外观，因此复用本轮矩阵，不重复采集。

证据：[最终类型检查](../../.artifacts/desktop-iteration-05/desktop-check-final.log)、[根级检查](../../.artifacts/desktop-iteration-05/root-check.log)、[179 项单测](../../.artifacts/desktop-iteration-05/desktop-unit.log)、[401 项整套回归](../../.artifacts/desktop-iteration-05/desktop-maintained-full.log)、[导航问题复现](../../.artifacts/desktop-iteration-05/navigation-before.log)、[11 项修复验证](../../.artifacts/desktop-iteration-05/navigation-fixed.log)、[最后跨功能验证](../../.artifacts/desktop-iteration-05/navigation-cross-regression.log)、[参考哈希](../../.artifacts/desktop-iteration-05/reference-hashes.json)、[视觉报告](../../.artifacts/codex-26915-alignment/gallery.html)。

中文窄分屏：[修复前](../../.artifacts/desktop-iteration-05/welcome-before/file-saving-zh-CN-dark-1000.png)、[修复后](../../.artifacts/desktop-iteration-05/welcome-after/file-saving-zh-CN-dark-1000.png)。前后目录分别保留 12 张对应主题、语言与尺寸的图。

历史五轮的终态：当时已识别的高优先级问题均已修复，相关开发模式检查通过，5 轮证据与保留的限制已登记；当时没有后台迭代任务。此结论不表示用户后来创建的持续 Goal 已完成。未提交、未发布、未重新打包 EXE。
