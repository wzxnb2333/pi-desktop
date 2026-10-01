# Pi Desktop 双语 UI 对齐记录

本轮实现固定使用 Codex MSIX **26.915.4065.0 / app 26.915.31945**，Satang 位于 E:/AI_collection/satang_code，只读。Pi 的品牌、运行时、任务和管理功能保留。

**当前验收口径：用户已取消严格像素级要求，以视觉接近、用户体验和功能完整性持续迭代。** 具体循环和待办见 [持续迭代 Goal](iteration-goal.md)。下文保留原像素诊断及真实验证结果；整窗差分未达旧门槛不再作为交付阻断条件。未提供同场景参考的页面仍标记为适配。

## 实现范围

- 删除顶部任务标签条。任务切换、关闭和重新打开通过侧栏、文件菜单和原快捷键继续使用。
- 主内容保留明确的 1px 左边界。侧栏正常使用可拖动并保存宽度，固定截图使用 240px。
- 摘要为右上角独立 302px 卡片，默认显示必要信息，展开后访问真实计划、审批、文件和来源。点击计划和审批定位真实会话节点。
- 变更面板默认不打开。审查建议只追加到草稿并聚焦输入框，用户发送后才执行，不自动调用模型。
- Git 的原始状态代码（例如未跟踪文件的两个问号）转换为本地化状态名称；摘要仅在展开后展示最多五个文件，再进入真实变更面板。
- 根据可用宽度决定辅助面板是否浮出。1000px 窗口与 240px 侧栏可并排展示会话和 407px 面板；宽侧栏没有足够空间时仍使用抽屉，保存值不被窗口缩小覆盖。并排面板与会话工具栏同一顶行。
- 统一标题栏、导航、欢迎页、输入框、摘要、正文、过程、计划、变更、文件、终端、浏览器、菜单、弹窗、设置及管理页的主题和布局。
- 终端采用已保存的 26.915 深色输出区，在深浅应用主题中保持 rgb(24,24,24) 背景、rgb(223,223,223) 前景和 12px 字体。查找按需展开，原快捷键、独立终端查询和运行进程继续保留。
- 浏览器移除重复的辅助栏页签和常驻操作行，保留 46px 标签行与 40px 地址行。查找、复制、外部打开、缩放、站点管理及恢复标签收拢到菜单，仍调用原生浏览器功能。
- 命令面板按聊天记录和快捷操作分组，任务显示所属项目，保持跨组键盘选择、原有快捷键和中文输入法行为。
- 窄会话栏的项目与任务名称单行截断，悬停可读取全名；浏览器菜单图标不再被通用页签内边距裁切。视觉检查同时核验标题换行和图标裁切，不只检查整页横向滚动。
- 标题菜单使用旧版 14px/14px、400 字重、10px 圆角和透明边框；英文点击区域采用捕获宽度，中文按内容自适应。菜单与侧栏分组标题统一使用同版三级文字颜色。
- 增加类型约束的 zh-CN / en-US 词条、占位参数和应用错误翻译。通用设置切换语言直接使用 ui.update，旧数据默认中文；重启恢复不依赖重启任务进程。
- 稳定 ID 驱动设置分类、菜单和操作；不再使用中文显示文案判断分类。
- 用户、模型、文件、路径、命令、工具输出、供应商原始错误保持原文。启动时的语言缓存只避免加载阶段闪回中文，持久化 UI 状态仍为权威来源。
- Electron 原生文件对话框、确认、托盘及通知随语言更新；已有会话与工具 IPC 操作名和业务行为保持不变。

## 参考证据

[参考清单](codex-26915-reference-manifest.json) 逐项记录截图、DOM、主题、窗口、展开状态、面板宽度、哈希和合成底色证据。

- 清单含 40 个固定场景。4 张无法恢复会话的 workspace 图被排除；同版本较早的替代图仍包含供应商错误。连同其他场景中可见的失败正文，共有 14 项参考只可检查不受错误正文影响的外壳和独立组件，不能证明正常会话整窗一致。布局提取会排除视口外、隐藏或透明节点。
- 透明图的底色样本与同版本不透明截图的 SHA-256 和像素均核验；单点底色不能还原原生窗口的空间色调，因此合成图仅提供有明确限制的对照。
- 原旧版本 app.asar 已不在安装位置。记录的 archive SHA-256 来自已保存的同版本提取清单，本轮没有声称重新核验不存在的原归档。
- Satang 的 DOM 采集没有保存 SVG 路径，保留的 26.915 提取也没有 SVG 文件。运行时移除了 26.917 的图标路径和关闭图形引用，现有 Lucide 图标填入对应尺寸，明确归类 Pi 适配，不能计为原版图标像素一致。
- 已有“验收完成”文档、旧版截图和测试数量没有被用作本轮整窗通过依据。

## 样式归属

| 层 / 组件 | 当前来源与责任 |
| --- | --- |
| 主题颜色与主要圆角 | src/renderer/src/styles/codex-26915-theme.css；按 26.915 可验证计算值统一 |
| Pi 基础排版、间距和交互 | tokens.css、base.css、utilities.css；缺少对应旧版证据的部分保持适配身份 |
| 标题栏与主内容 | shell.css；原 shell-satang 内容已收拢 |
| 侧栏 | sidebar.css；原 sidebar-satang 内容已收拢 |
| 欢迎页与输入框 | welcome.css、composer.css；欢迎页已有 DOM 几何验证，会话额外控件是 Pi 功能适配 |
| 摘要 | task-summary.css；302px 独立卡片与展开后的 Pi 功能 |
| 设置 | settings.css 独立负责分组导航、页面布局、卡片、控件、保存栏和响应式规则；不再由 satang-surfaces.css 叠加覆盖 |
| 终端、预览公共几何 | satang-surfaces.css 为最终几何层；对应组件 CSS 负责 Pi 功能区域 |
| Git Review | satang-review.css 为最终几何层；panels.css 负责布局与其他工作台功能 |
| 管理页 | satang-management.css 为最终几何层；management.css、skills.css 负责 Pi 页面功能 |
| 会话正文与计划 | satang-workspace.css 为已验证局部样式层；timeline.css、conversation-activity.css 负责真实会话与过程 |
| 命令面板 | commands.css；固定版本定位、输入、分组和结果行，内容数量由真实任务决定 |
| 审批和加载 | approval.css、loading.css；没有正常同版本场景，明确为适配 |

index.css 不再导入旧 reference-theme、surface-theme、activity-theme、approval-theme，也不再导入独立 shell-satang、sidebar-satang。这些旧文件与旧图标数据保留为未启用历史记录。新增样式应修改上表的责任层，不能继续追加另一组全局覆盖。

## 视觉矩阵与产物

2026-09-27 设置页专项调整后的截图和回归见 [设置 UI 后续修正](settings-ui-followup.md)。下方原始图库中的设置截图是调整前基线，不代表当前设置页。

24 个场景覆盖深浅主题、简体中文/English、1440×940 / 1000×700 / 1280×800，共 288 张实现截图。场景包括欢迎、会话、独立摘要、Review、文件、浏览器、终端、命令面板、模型/权限菜单、附件、通用/模型/权限/MCP 设置、自动化、待审阅、Skills、四类审批、对话框与加载。

- [交互对照页](../../.artifacts/codex-26915-alignment/gallery.html)：按场景、主题、语言、窗口及结果筛选；展示参考、实现和未遮罩差分。
- [逐项结果](../../.artifacts/codex-26915-alignment/acceptance.md)、[统计](../../.artifacts/codex-26915-alignment/summary.json)、[原始几何与哈希](../../.artifacts/codex-26915-alignment/results.json)。
- [桌面回归日志](../../.artifacts/codex-26915-alignment/desktop-regression.log)、[语言回归日志](../../.artifacts/codex-26915-alignment/localization-regression.log)、[单元测试日志](../../.artifacts/codex-26915-alignment/unit-regression.log)。
- [终端专项回归](../../.artifacts/codex-26915-alignment/terminal-followup-regression.log)、[浏览器专项回归](../../.artifacts/codex-26915-alignment/browser-followup-regression.log)、[命令面板专项回归](../../.artifacts/codex-26915-alignment/palette-followup-regression.log)。
- [最终布局专项回归](../../.artifacts/codex-26915-alignment/layout-followup-regression.log)，在完整回归后再次检查最后的标题截断、浏览器地址栏和图标修正。
- [最终外壳专项回归](../../.artifacts/codex-26915-alignment/shell-followup-regression.log)，覆盖最后的菜单宽度、字重、圆角与侧栏标题颜色；修正前的字宽失败保留在 shell-followup-before-fix.log。
- [回归退出码](../../.artifacts/codex-26915-alignment/regression-status.json)、[图库与图片校验](../../.artifacts/codex-26915-alignment/gallery-validation.json)。

差分保存全部文字与图标，没有为了通过而整体遮盖它们。品牌、账号、导航功能、Windows setup、真实内容差异单独登记。参考本身包含特殊面板或弹出状态的结果仍保留差分，不按相似页面伪报通过。

当前矩阵没有页面脚本异常、整页横向溢出、被检测控件溢出、标题换行或浏览器菜单图标裁切。16 组具有整窗对照资格的英文结果仍未达到像素门槛；12 组英文错误正文场景只作诊断；28 组为中文布局检查；232 组没有同场景参考。这些状态互斥，合计 288 张实现图。缺失参考和中文布局通过均不计入整窗像素通过。

## 验证命令

初始 UI 对齐阶段执行的行为检查如下；后续 Goal 的新增修复、最终检查和逐轮结果见 [持续迭代记录](iteration-goal.md)。此表中的 173 / 367 是历史基线，不代表后续代码自动通过。

| 检查 | 命令 / 范围 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 桌面类型检查 | npm run desktop:check | 0 | 通过 |
| 桌面单元测试 | node --import tsx --test，test 下全部 .test.ts | 0 | 173 / 173 |
| 完整桌面回归 | Playwright，playwright.nonvisual.config.ts | 0 | 367 / 367，无跳过、失败或不稳定重试 |
| 双语原生回归 | localization.nonvisual.spec.ts | 0 | 3 / 3，覆盖草稿、运行中切换、阅读位置、重启和原生弹窗 |
| 终端专项 | panels、terminal.nonvisual、satang、search.nonvisual | 0 | 46 / 46 |
| 浏览器专项 | browser.nonvisual、workbench.nonvisual、message-links.nonvisual、panels、satang | 0 | 54 / 54 |
| 命令面板专项 | search.nonvisual、satang | 0 | 36 / 36 |
| 最终布局专项 | browser.nonvisual、reference、satang | 0 | 68 / 68，最后的 CSS 修正后通过 |
| 最终外壳专项 | reference、satang | 0 | 64 / 64，菜单及侧栏标题修正后通过 |

专项检查与完整回归有重叠，不将它们相加当作独立测试数量。运行日志保留了开发依赖的 Rollup 注释和 NO_COLOR 提示；类型检查没有错误。完整回归后的标题提示与截断、浏览器控件边距及背景修正通过 68 项定向回归；随后菜单和侧栏标题修正通过 64 项外壳与面板回归。类型检查在最终源码上再次通过。

在项目根目录执行类型检查：

~~~powershell
npm run desktop:check
~~~

在 apps/desktop 执行本地单元测试、完整桌面回归与新增双语行为回归：

~~~powershell
$tests = Get-ChildItem test -Filter '*.test.ts' | ForEach-Object FullName
node --import tsx --test @tests
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts
node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/localization.nonvisual.spec.ts
node ../../node_modules/@playwright/test/cli.js test -c playwright.config.ts test/e2e/reference.spec.ts test/e2e/satang.spec.ts
~~~

在根目录重新生成视觉对照：

~~~powershell
node apps/desktop/scripts/alignment-reference.mjs
node apps/desktop/scripts/alignment-visual.mjs
node apps/desktop/scripts/alignment-regions.mjs
node apps/desktop/scripts/alignment-report.mjs
node apps/desktop/scripts/alignment-gallery-check.mjs
~~~

检查使用本地 faux provider、隔离临时目录、临时 Git 仓库及受控 MCP，未调用真实付费模型。初始对齐阶段未修改依赖、锁文件或根级检查入口，未执行根级完整检查、发布构建或 EXE 打包。后续 Goal 将新增用例纳入开发回归入口，已执行根级完整检查，详见持续迭代记录。测试启动的是 Electron 开发产物。

视觉采集、区域比较和图库检查的退出码只说明脚本成功执行。像素是否通过必须查看 summary.json、results.json 和逐项结果，不能根据这些脚本退出 0 宣称通过像素验收。

## 尚未达到的视觉要求

- 整窗原始像素对照仍有失败项。alignment-regions 按结构表面 0.5%、文字密集组件 1% 分别比较原始坐标下参考与实现矩形的并集，不挪动对齐、不遮盖文字或图标。结构表面连同内部内容一起比较，因而会保守计入动态内容差异。区域结果与独立区域差分同时保留，不能把局部通过当作整窗通过。
- 已验证欢迎页、侧栏、部分设置和面板的局部几何/计算样式，不代表全部组件都满足 1px / 0.5px 的门槛。
- 部分旧版捕获含 Windows setup、项目悬浮卡片、错误正文及原生透明效果；当前真实 Pi 功能与这些状态有登记差异。中文与 1280×800 没有相同旧版参考，只检查布局与溢出。
- 图标原始轮廓、审批、加载和 Pi 专属页面缺少充分同版本证据，继续记为适配。
- 菜单的字体栈和字号声明已匹配，但当前系统字形测量仍与旧版 DOM 有差异。英文菜单点击区域按捕获尺寸固定，不以容器几何通过宣称字体像素通过。

## 开发模式启动

~~~powershell
& 'E:/AI_collection/Pi desktop/Start Pi Desktop.cmd' -Dev
~~~

普通启动可能打开旧 EXE，验收本轮源码必须使用 -Dev。工作保留在当前工作区，没有提交或发布。
