# 对话过程折叠

实现基准：Windows 26.917.9434.0 / 应用 26.917.71314。本文只说明本次对话折叠，不将局部源码合同解释为整个应用的像素一致性。

## 数据与持久化

- TimelineItem 新增可选 blocks、stopReason、startedAt、completedAt 和 details。blocks 保留 text / thinking / toolCall 原顺序；toolCall 保存 id、name 和 JSON 参数。details 只接受经过 schema 校验的真实 edit diff、可选 patch 和 firstChangedLine。
- worker 的 messageItem 是实时与历史的共同转换入口。restoreItems 从助手 toolCallId 找回工具名称和参数，支持并行结果的不同完成顺序；mergeTimelineItem 保留实时记录的参数、工具及思考的观测时间和有效详情。
- 时间以毫秒存储，只由实际事件测量。历史缺少起止时间就不显示耗时，不用消息时间戳倒推。过程耗时截止最终回答开始或该消息已完成的思考块，避免把同一消息中的思考误报为 0 秒。
- UiThread.folds 是 key → boolean 的显式选择表，继续通过 ui.threadUpdate 存储。默认状态只在渲染时计算，不写入偏好；旧数据缺少 folds 时读为空表，不改写原始会话文件。
- 稳定键：process:用户消息ID、group:首个工具调用ID、tool:工具调用ID、raw:工具调用ID、thinking:助手消息ID:内容块索引。Pi edit 每次调用对应一个文件，文件路径来自该调用参数，不以可变摘要或输出生成键。

## 渲染与状态

user 消息界定一轮。turnBlocks 按原内容顺序产生独立说明、思考、连续工具组、通知和最终回答；说明、通知与审批不会被混入相邻工具组。最终回答之后到达的通知保持在过程区外，不能随上一轮自动收起。

| 层级 | 默认状态与操作 |
| --- | --- |
| 整轮过程 | 运行中展开；确认最终回答后收起，仅留摘要、已知耗时和操作数。等待审批、取消或未恢复的错误保持过程可见，临时强制展开不写坏用户原有选择 |
| 思考 | 只显示供应商实际思考；运行预览最大 8.75rem，完成后收起；没有可靠时间只写“思考过程” |
| 活动组 | 默认紧凑摘要；当前工具改变时最多每 1000ms 切换一次；完成立即更新，运行但无活动工具时显示思考状态 |
| 普通命令 | 默认收起；打开后显示原命令参数和输出，不根据命令字符串猜测读取或编辑行为 |
| MCP / 通用工具 | 运行时默认展开详情，完成后默认收起；用户手动选择优先于默认规则 |
| read / grep / find / ls | 语义化读取、搜索和目录标题；路径或查询来自原参数，组摘要按真实操作次数统计。原参数与完整输出可独立展开，不推断未知搜索命中总数 |
| edit / write | edit 使用真实 diff 显示文件、增删行和逐项展开；write 只显示已写入，不推断新建状态或增删数量 |

Pi 没有可靠的流式最终回复通道：助手文字先留在过程区，message_end 后仅当结束原因是 stop / length、该消息没有工具调用、没有更新的待执行工具时确定最终回答。旧历史没有 stopReason 时，仅在非运行状态接受其末尾已完成助手文字。此时机是能力适配，不声称与原端最终通道一致。

折叠控件使用原生 button、aria-expanded / aria-controls。收起开始立即 inert，结束卸载详情；隐藏内容中的焦点回到折叠标题。正文内文件按钮与折叠按钮是独立可聚焦控件，文件点击仍调用现有 file.open。原有恢复文件和应用 worktree 流程未改动。

用户点击展开或收起时保存标题锚点；仅在原本跟随底部时随新增内容滚动。正文收展采用原始 300ms / cubic-bezier(.19,1,.22,1) 和四阶段状态；减少动画模式禁用过渡及忙碌动画。业务工具图标和忙碌提示仍是 Pi 适配。

## 来源与独立对照

reference-activity.json 保存原始文件 SHA-256、字节锚点、独立 DOM、计算样式及矩形。reference-activity.mjs 仅读取忽略目录的固定原始 JS/CSS 与已取证宿主主题；不读取 Pi 组件或 Pi CSS，不执行认证、遥测及网络服务代码。

| 原始模块 | 已追踪依据 |
| --- | --- |
| app-initial-fc9a33fdda88.js | MMi / xMi / BMi：标题按钮与文件链接层级、4px / 6px 间距、正文 24px 缩进、分组正文；_Mi：箭头状态 |
| app-shared-dc8f183e4945.js | k5（导出 Qp）原始箭头路径；wdt 的 300ms 过渡曲线 |
| conversation-blocks-dbf9cc487eb4.js | C_ 四阶段折叠、D_ / j_ 的 1 秒摘要节流、Rx 思考预览、Ww 整轮收起、ux diff 外框与文件头 |
| agent-activity-units-ebdc48135dc2.js | qe / Je 的相邻活动与边界分组 |
| tool-activity-disclosure-65375d723bb8.js | 运行/完成详情状态及隐藏内容 inert |

独立样本有 4 类 × 4 种主题 × 3 种尺寸，共 48 组：标题与正文、活动组、文件行、diff 外框/文件头；包含 light、dark、system-light、system-dark 和 1000×640、1280×800、1440×940。Pi 侧加载真实 Disclosure、ToolActivity 和 EditDiff。各列明节点比较完整矩形和 21 项计算样式，CSS px 最大偏差 0.5；其他字符串属性精确比较。

diff 参考样本用 40px 内容槽隔离外框，Pi 样本使用两行真实格式 diff。已验证的是外框与文件头，不包括原端完整 patch 编辑器、行号栏、语法高亮和所有折叠 hunk。整个过程容器、所有业务图标变体和字形栅格化不在局部几何承诺内。

仅重新取证需要原包：`node apps/desktop/scripts/reference-activity.mjs [提取目录]`。正常运行、类型检查和测试读取已保存合同与整理后的活动资源，不需要继续安装 Codex。

## 验收入口

- timeline.test.ts、timeline-groups.test.ts：有序混合内容、工具关联、并行顺序、历史参数重建、真实 diff、未知耗时、已观测思考计时、稳定键和临时回复判定。
- activity.spec.ts：48 组独立几何样本，以及默认/用户状态、父子独立折叠、任务切换、重载、焦点、滚动锚点、减少动画、过渡时序、摘要节流、最终消息内思考计时与后续通知。
- conversation.nonvisual.spec.ts：假供应商与临时项目，真实 Electron 以开发模式加载当前源码；覆盖文字后追加工具、思考、最终收起、停止、审批、文件打开、真实 edit diff、write、错误恢复，以及 renderer 重载和应用重启后的偏好/元数据。
- 现有非视觉回归继续覆盖中文合成输入、菜单关闭与焦点、文件恢复、worktree 应用、设置保存及重启。截图、视频、trace 均关闭；不重新执行独立 Windows 原生拼音入口，保留其既有记录，不计作本次新证据。

命令在仓库根目录执行：`npm run desktop:check`、`npm run desktop:test`、`npm run desktop:test:nonvisual`、`npm run check`。最终退出码与全套结果见 acceptance-report.md、fidelity-report.md；未通过的初次运行不计为通过。

本次不改模型执行逻辑，不添加后端能力，不切换分支、不提交、不发布、不构建安装包；保留已有未提交工作。
