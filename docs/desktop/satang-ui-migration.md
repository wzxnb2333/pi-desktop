# Satang 参考 UI 分批移植

日期：2026-09-26。目标：将本机 `E:\AI_collection\satang_code` 中保存的 Codex 截图、解包样式及已实现界面移植到 Pi 桌面，继续使用真实 Pi 会话、模型、项目与工具服务。

## 参考优先级

1. Satang 保存的 Codex 26.915.4065.0 / app 26.915.31945 原始截图与对应 DOM 样式。固定布局的 `pinned` 重拍优先于早期几何样本。
2. Satang 的界面实现用于定位组件、布局和交互，不整体复制业务层或依赖。
3. Pi 原有 26.917.9434.0 源码合同继续作为独立证据；版本或场景不同的差异明确记录，不混作同一个像素基准。

参考归档 SHA-256：`b8aeb817cd1ee6ef50efe8a97985d3be41de89688a5addfe0a444e1e52348096`。参考目录只读；不读取账户凭证、不移入真实对话内容。

## 执行批次

| 批次 | 范围 | 状态 | 验收 |
| --- | --- | --- | --- |
| B01 | 证据登记、工作台外壳、欢迎页及输入区布局 | 首页已验收；顶部外壳已由 B02 接续 | 两种主题、宽窄窗口、真实操作入口 |
| B02 | 顶部外壳、侧栏、对话、搜索及工具状态 | 已实现及定向验收 | 源合同、真实导航、会话搜索和状态恢复 |
| B03 | 文件、审查、终端及预览面板 | 已实现；Review内部由B06补齐 | 面板条、地址栏、空状态及真实文件/Git/PTY/浏览器操作 |
| B04 | 设置及管理页 | 已实现；管理搜索/过滤/空态由B07补齐 | Pi实际表单、保存与管理操作 |
| B05 | 组合验收与未覆盖项核对 | 已由B06–B09补齐并完成最终复核 | 原始12项页面/状态逐项核对，见完整范围复核 |
| B06 | Review内部 | 实现、类型检查、定向回归及视觉检查通过 | 早期有效DOM；文件树、差异、筛选与Git操作 |
| B07 | 管理搜索、过滤、列表及空态 | 实现、类型检查、定向回归及视觉检查通过 | 早期有效Sites样式；真实Pi资源、收件箱及自动化 |
| B08 | workspace气泡、通知、计划及正文 | 实现、类型检查、定向回归及视觉检查通过 | 完整18步骤内部滚动、折叠定位、消息/正文无溢出 |
| B09 | 审批、加载及全范围最终验收 | 已完成，最终404/404回归及完整检查通过 | 审批/加载单独标记26.917补充；261份输入状态及67份来源哈希归档 |

每次用户请求最多识别20张图片，同一次请求切换批次或自动续轮不重置额度；重复查看、重拍及拼图中的每张原图均计数。早期预留修改后验收额度，本请求最终跨B02–B09合计20/20：8次来源图、12次目标图，包含早期中间图。额度已用尽，不再查看图片。逐次记录于[satang-ui-image-ledger.json](satang-ui-image-ledger.json)；仅做元数据、DOM、源码读取和数值断言不计图像。

## 当前证据边界

- 固定截图中的 240px 侧栏是捕获时手动调整的宽度，不代表所有窗口的默认值。
- `welcome` 是项目内欢迎页，不能据此覆盖没有项目或没有模型时的引导逻辑。
- 实际查看发现 pinned `workspace` 和 `management` 为旧会话加载失败画面；B07/B08改用已确认到达的较早DOM及图像，继续覆盖管理搜索、筛选、空态和对话通知、消息、计划。原始workspace图的可视区为通知和diff，正文及计划的数值证据来自屏外DOM；Pi管理内容仍来自真实服务。
- 固定布局批次未到达 review 页面及 1000px palette；旧截图可作参考，但需保留来源说明。
- 来源系统字体与目标可用字体的差异需要实际检查，不能仅凭 CSS 相同声明像素一致。

## 页面映射

下表保留初始入口映射；B06–B09继续覆盖原范围而非缩小目标。Review采用早期有效内部DOM；管理采用早期有效Sites搜索/过滤/空态；workspace采用消息/通知/计划DOM；审批/加载入口查明为占位后，以已固定26.917原始WQ/z$/V8/AJi源码补充。当前逐项证据见[satang-completion-audit.md](satang-completion-audit.md)，接续实现见[satang-b06-b08.md](satang-b06-b08.md)、[satang-b09.md](satang-b09.md)。

下表左侧路径相对于参考项目 `src/renderer/src/`，右侧相对于目标项目 `apps/desktop/src/renderer/src/`。这是实际功能映射，不表示所有页面与原版完整等同。截图和 DOM 的统一根目录为参考项目 `.artifacts/reference/26.915.4065.0/`。

| 参考面 / 实现入口 | Pi 实际入口 | 批次与保留功能 |
| --- | --- | --- |
| shell：`shell/MenuBar.tsx`、`shell/LeftPanelHeader.tsx`、`shell/Toolbar.tsx` | `components/shell/titlebar.tsx`、`toolbar.tsx`、`workspace.tsx` | B02；原生窗口控制、分栏、工作台导航 |
| welcome：`surfaces/welcome/index.tsx`、`styles/welcome.css` | `components/timeline/welcome.tsx`、`styles/welcome.css` | B01 已验证；实际项目选择、无项目与无模型引导 |
| composer：`surfaces/composer/index.tsx`、`styles/composer.css` | `components/composer/composer.tsx`、`home-utility.tsx` | B01 欢迎页已验证；对话输入区在 B02；模型、权限、附件、计划、队列和用量 |
| sidebar：`surfaces/sidebar/index.tsx`、`styles/sidebar.css` | `components/sidebar/sidebar.tsx`、`thread-actions.tsx` | B02；项目分组、真实会话、归档/回收站与快捷操作 |
| workspace：`surfaces/workspace/index.tsx`、`parts.tsx` | `components/timeline/timeline.tsx`、`turn.tsx`、`message.tsx`、`activity.tsx` | B02/B08；消息、通知、完整计划及正文间距，保留流式工具与滚动恢复 |
| palette：`surfaces/palette/index.tsx`、`commands.ts` | `components/shell/commands.tsx` | B02；真实任务搜索及命令，1000px pinned 参考缺失须注明 |
| review：`surfaces/review/index.tsx`、原始 `review/*-*.dom-styles.json` 与已有 26.917 源码合同 | `components/panels/review-panel.tsx`、`git-panel.tsx`、`files-panel.tsx`、`diff.tsx` | B03/B06；有效早期标题、过滤、文件树及差异结构，保留全部Pi Git操作 |
| terminal：`surfaces/terminal/index.tsx`、`pane.tsx` | `components/panels/terminal-section.tsx` | B03；真实 PTY、配置档、调整高度与恢复 |
| preview：`surfaces/preview/index.tsx`、`panel.tsx` | `components/panels/preview-panel.tsx` | B03；原生浏览器页签、地址栏、查找及下载 |
| settings：`surfaces/settings/index.tsx`、`nav.tsx`、`page.tsx` | `Settings.tsx` 及其现有表单模块 | B04；沿用 Pi 模型、MCP、主题等真实配置与保存路径 |
| management：`surfaces/management/sites.tsx`、`chrome.tsx` | `components/management/pages.tsx`、`automations.tsx`、`skills-page.tsx`、`inbox.tsx` | B04/B07；标题、搜索、过滤及空态，列表和管理动作使用Pi真实数据；不移入Sites业务 |
| approval / emptyloading：来源入口为技术占位；独立26.917 WQ/z$/V8/AJi及原始CSS补充 | `components/timeline/message.tsx` 中 ApprovalCard、`components/shell/loading.tsx` | B09；四种审批、失败/忙碌、加载成功/失败及宽窄主题，版本边界见reference-states.json |

## 批次结果

B01 历史结果见 [satang-b01.md](satang-b01.md)。本次接续完成外壳及侧栏验收，新增命令面板、终端/浏览器外框和设置页面合同，保留实际 Pi 会话、工具、文件、Git、模型、MCP 和管理功能；没有移入账户、站点或真实线程内容。

B02–B05前轮的实现、命令退出码、图像登记与缺失来源见[satang-b02-b05.md](satang-b02-b05.md)。B06–B09按原目标完成[完整范围复核](satang-completion-audit.md)，没有用pinned样本缺失代替已有高保真实现的移植。最终404/404、166/166、desktop:check及完整npm run check全部通过；本范围无剩余实现或验收项，来源版本和像素等同性边界单独保留。
