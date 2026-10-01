# Pi Desktop 本地工作台能力矩阵

本表对应已批准的本地工作台补全计划，替代旧 WP-R 的 41 个操作封闭范围。固定交互参考为 Windows Codex 26.917.9434.0 / 应用 26.917.71314。业务能力来自 Pi、文件系统、Git 和 Electron，不加载参考端认证、遥测或服务代码。

已接通表示具有真实服务和界面入口，不代表所有状态与参考端几何等同。测试结果见 workbench-acceptance.md；独立来源与限制见 component-source-map.md、remaining-differences.md。表内 shell/、sidebar/、panels/、timeline/、composer/、management/ 路径相对 apps/desktop/src/renderer/src/components；Settings.tsx、TerminalPanel.tsx 位于 renderer/src；main/、worker/、shared/ 路径相对 apps/desktop/src。

| 范围 | 已接通的行为 | 主要实现 | 验收证据 |
| --- | --- | --- | --- |
| 辅助栏 | 摘要/文件/变更/浏览器；拖动、关闭/恢复；1000px 窗口覆盖抽屉、宽窗并排；终端底部停靠 | shell/workspace.tsx、panels/review-panel.tsx | layout.test.ts、reference.spec.ts、panels.spec.ts |
| 任务摘要 | 实际状态、按对话顺序选择的轮次计划、Git、产物、来源链接、审批；精确定位步骤/审批，等待真实收展并保留阅读位置；局部加载/错误/重试，空块隐藏；产物复用已有文件标签及编辑缓冲 | panels/task-summary.tsx、panels/review-panel.tsx、renderer/src/hooks/use-timeline-focus.ts、main/application.ts | summary.spec.ts、summary.nonvisual.spec.ts、workbench.nonvisual.spec.ts、conversation.nonvisual.spec.ts |
| 计划与过程 | 默认单行计划摘要；摘要和时间线共用真实轮次映射；按轮次保存折叠；旧记录仅在最近轮次回退，显式清空不复活旧计划；过程/活动组/详情分层 | timeline/turn.tsx、renderer/src/lib/turn-plans.ts、shared/timeline.ts | turn-plans.test.ts、timeline-groups.test.ts、activity.spec.ts、summary.spec.ts、summary.nonvisual.spec.ts、workbench.nonvisual.spec.ts |
| 输入/队列/用量 | 每任务草稿和独立附件文件；SDK 队列整体撤回；真实用量和上下文入口；未知数据不估算 | composer/composer.tsx、worker/agent.ts | composer.spec.ts、acceptance.spec.ts、workbench.nonvisual.spec.ts |
| 会话管理 | 右键/更多共用菜单：重命名、置顶、已读、归档、复制、三种导出、分叉、压缩、停止/继续；指定消息及新 worktree 分叉 | sidebar/thread-actions.tsx、main/application.ts | sidebar.spec.ts、workbench.nonvisual.spec.ts、agent.test.ts |
| 标签与搜索 | 任务标签关闭/恢复、最近任务、会话内容搜索、项目筛选；正文/思考/工具参数/输出/diff 按命中查找，展开对应折叠并定位；每页 200 条且可遍历全部结果；命令键盘选择；集中快捷键、修改/冲突/恢复默认 | shell/thread-tabs.tsx、shell/commands.tsx、renderer/src/lib/conversation-search.ts、shared/shortcuts.ts | conversation-search.test.ts、search.nonvisual.spec.ts、sidebar.spec.ts、settings.spec.ts、desktop.nonvisual.spec.ts |
| 回收站 | 软删除、恢复；永久删除需明确确认，仅清理应用自有独占会话/附件，保留分叉引用、导入记录、项目及 worktree | sidebar/thread-actions.tsx、main/application.ts、main/thread-storage.ts | thread-storage.test.ts、workbench.nonvisual.spec.ts |
| 浏览器 | HTTP(S)、地址补全/校验、导航、刷新/停止、标题/错误/重试、多标签及恢复；按网页独立查找、前后循环和当前序号、可配置快捷键、缩放、复制实际地址/外部打开；任务独立标签和应用共享持久登录 | main/preview.ts、main/browser-find.ts、shared/browser-address.ts、panels/preview-panel.tsx、panels/browser-find.tsx | browser-workbench.test.ts、browser.nonvisual.spec.ts、core.test.ts、workbench.nonvisual.spec.ts |
| 网页宿主 | 隔离原生视图、用户触发登录弹窗、上传下载、取消/打开目录、站点权限及清除数据；浮层出现时隐藏网页并恢复宿主焦点 | main/preview.ts、main/index.ts | workbench.nonvisual.spec.ts |
| 文件 | 懒加载目录树、面包屑、可取消分页文件名/内容搜索、多文件标签、跳行、完整路径、系统目录/编辑器；目录/展开/焦点按任务恢复；可配置键盘导航、空目录与错误重试；UTF-8 保存校验与未保存保护 | main/files.ts、main/file-search.ts、panels/files-panel.tsx、panels/file-navigator.tsx、panels/file-search-results.tsx、renderer/src/lib/file-tree.ts | file-tree.test.ts、file-search.test.ts、file-navigation.nonvisual.spec.ts、workbench-services.test.ts、workbench.nonvisual.spec.ts |
| 对话链接 | Markdown 中相对/绝对路径及本地 file URI 接入文件面板，支持行列、中文/空格、重复定位、任务切换与重启；网页及摘要来源在右侧新标签打开，修饰键保留外部打开 | timeline/message.tsx、renderer/src/lib/message-links.ts、renderer/src/hooks/use-open-link.ts、panels/files-panel.tsx | message-links.test.ts、message-links.nonvisual.spec.ts |
| 差异 | 文件/块导航、暂存/未暂存、文件/块暂存及取消、恢复备份、选中差异加入输入、统一/并排；读取/失败/重试状态与选中文件和范围绑定，忽略迟到响应 | panels/git-panel.tsx、renderer/src/hooks/use-git-query.ts、main/git-workflow.ts | diff.test.ts、git-panel.spec.ts、workbench-services.test.ts、workbench.nonvisual.spec.ts |
| 提交与历史 | 明确勾选暂存文件；独立索引提交，保留其他暂存及未暂存修改；选中提交详情、读取失败重试及关闭后焦点恢复；合并提交按第一父提交展示真实差异并注明基准 | main/git-workflow.ts、main/application.ts、panels/git-panel.tsx | git-panel.spec.ts、git.nonvisual.spec.ts、workbench-services.test.ts、workbench.nonvisual.spec.ts |
| 分支/同步/冲突 | 本地分支创建/切换/普通删除；列出真实远端分支、排除符号 HEAD、用独立本地名称创建跟踪分支及设置上游；fetch/pull/push 保留异名上游；默认仅快进，显式合并/变基；三方内容、编辑解决、继续/中止、请求级取消 | main/git-workflow.ts、main/application.ts、panels/git-panel.tsx | git-branches.test.ts、git-panel.spec.ts、git.nonvisual.spec.ts、workbench-services.test.ts；本地 bare 远端及真实临时仓库 |
| 仓库边界 | 共用 Git 目录写锁；影响运行目录的操作与活动任务互斥；复用系统 Git/SSH；错误及终端重试入口 | main/git-workflow.ts、main/application.ts | 服务串行化及 Git 集成测试 |
| Worktree | 列表/目录打开/创建任务/新隔离检出/应用改动；只清理 Pi 管理的空闲干净检出 | main/git.ts、main/application.ts | services.test.ts、workbench-services.test.ts、acceptance.spec.ts |
| 终端 | 重命名；中文/宽字符/组合字符/软换行查找，上一处/下一处及循环计数；按终端保留查找文字；复制实际选择或逻辑行、清屏及可配置快捷键；大输出和后台增量连续；隐藏、关闭入口和终止分离，重启仅恢复配置 | TerminalPanel.tsx、panels/terminal-section.tsx、renderer/src/lib/terminal-text.ts、shared/terminal-output.ts、main/terminal.ts | terminal-workbench.test.ts、terminal.nonvisual.spec.ts、panels.spec.ts、desktop.nonvisual.spec.ts、workbench.nonvisual.spec.ts |
| Skills/扩展 | 名称/真实描述/来源搜索、详情加载/错误/重试、文件位置、刷新；共享 ~/.agents/skills，移除配置不删共享文件；SDK 源文件诊断、启用资源名称冲突及真实任务加载错误；旧响应隔离、创建草稿/防重复提交、键盘焦点恢复 | management/skills-page.tsx、main/resource-inspection.ts、main/skills.ts、worker/agent.ts、main/application.ts | resource-inspection.test.ts、shared-skills.test.ts、resources.spec.ts、skills.nonvisual.spec.ts、acceptance.spec.ts |
| MCP | 字段校验、真实连接状态、原始工具显示名称与调用标识、展开详情、测试取消/失败/重试；防重复保存、旧配置响应隔离、焦点恢复；服务/worker 退出与重启保持未连接状态及历史工具，重新连接复用仓库锁与活动任务保护 | Settings.tsx、McpSettings.tsx、shared/mcp-configuration.ts、worker/mcp.ts、worker/agent.ts、main/application.ts | mcp-configuration.test.ts、mcp.test.ts、mcp-settings.spec.ts、mcp.nonvisual.spec.ts、acceptance.spec.ts |
| 自动化/审阅 | 间隔及日/周/月、显式时区、编辑/运行历史；夏令时/月末规则、离线合并一次；字段校验、防重复保存、失败保留草稿、删除确认；按可见可审阅任务全选/批量处理、部分失败反馈/重试、通知偏好与结果跳转 | shared/schedule.ts、main/scheduler.ts、main/automation-state.ts、main/application.ts、management/automations.tsx、management/inbox.tsx | automation-state.test.ts、schedule.test.ts、services.test.ts、management.spec.ts、management.nonvisual.spec.ts、acceptance.spec.ts、workbench.nonvisual.spec.ts |
| 模型 | 内置目录与自定义 Base URL 分离；可配置 low/high/xhigh/max 等允许档位；原协议和审批语义 | Settings.tsx、shared/thinking.ts | model-configuration.test.ts、provider-protocols.test.ts、model-settings.nonvisual.spec.ts |

## 状态与接口

- MCP 测试与任务加载共用经校验的工具描述：name 保留真实映射调用标识，label 保留服务及原始工具名。只读工具列表与实际连接状态分开；测试连接结束后明确提示已关闭，断开后的历史工具不冒充可用工具。stdio 错误流持续消费但不存储可能含凭据的第三方输出，重复工具名称或分页标识明确失败，避免无限工具发现。
- MCP 设置保存通过同步守卫防重复，保存期间锁定表单，结束后在仍需恢复时归还键盘焦点；编辑配置、移除卡片或卸载后忽略旧测试响应。测试响应必须通过共享 schema；任务重连展示局部错误和重试反馈，未保存配置或运行任务禁用重连。同一任务并发重连复用在途操作，与 Git 目录锁和启动流程串行；旧 worker 退出不能清理新 worker 的审批。重启不自动连接，保留上次工具详情并标记未连接。
- resource.inspect 使用严格空参数契约，只读取共享目录和已配置资源；Skill 描述、警告与冲突来自 SDK，扩展只校验普通文件及可读性，不导入或执行代码。资源配置变化才重新检查，普通任务流式更新不触发目录扫描。检查失败、详情读取失败与任务加载诊断分别展示，不互相冒充成功。
- worker 初始化时将真实 Skill 诊断、扩展加载失败及服务诊断发送为经校验的 resources 事件，主进程按现有 worker 身份保护写入可选 Thread.resourceLoad，保存实际时间并跨重启恢复。旧数据无该字段时不制造记录；刷新源文件不删除历史错误，下次创建运行环境后的实际结果才替换旧记录，不改写原始会话文件。
- Skills 详情按资源和请求代次隔离，选择其他资源、关闭或卸载后不接收迟到成功/失败。创建失败保留输入，同一操作同步阻止重复提交；成功关闭后恢复创建入口焦点。详情/检查重试在临时按钮移除前转交稳定区域焦点，Escape 关闭详情回到原入口，合成输入期间不关闭。启停/导入/创建/移除/刷新沿用主进程活动任务保护，查看与源文件检查仍可用。
- 摘要与时间线按真实消息顺序共用轮次计划映射，不使用 plans 字典的插入顺序猜最新轮次；缺少 plans 的旧记录只在最后实际轮次回退，显式空计划抑制旧摘要。计划跳转携带轮次、步骤序号和文字，审批跳转携带独立审批 ID；同名工具不会误定位至第一个审批。
- 摘要定位只展开目标计划，等待实际有限动画后聚焦并滚动至对应行；局部折叠和阅读锚点沿用现有字段合并及保存。跳转时取消底部跟随，后续流式内容不把用户拉回底部；窄窗口关闭覆盖辅助栏以显示目标，不修改宽窗口尺寸偏好。滚轮、鼠标、后续键盘操作及切换任务取消待执行定位，临时定位请求本身不写入桌面 JSON。
- 摘要 Git 信息使用独立请求代次和局部加载/错误/重试，不把尚未完成的初始查询显示为无仓库；同任务刷新及跨任务迟到结果不能回填新状态或弹出全局错误。工具完成时合并刷新，普通流式文字不触发重复查询。产物原始路径先编码再交给既有受控文件链接解析，绝对路径与相对路径落到同一标签和未保存缓冲，文件名中的 # 和 % 保持字面含义。
- 自动化保存只接收可编辑配置，主进程保留 lastRunAt、lastThreadId、未改计划时的 nextRunAt 及在途对象引用；新建忽略客户端伪造的历史。运行开始时固定本次项目、名称和提示，更新只影响后续运行。任务先进入运行状态再公开 lastThreadId，避免空任务被误认作已完成。调度在等待保存或前一任务后重新检查是否删除、暂停或改期，未开始的计划不改写真实上次运行时间。
- 批量审阅限当前筛选的未审阅且非运行/待审批任务，切换筛选或运行状态变化会移除失效选择。逐项等待保存，展示成功数和失败原因并保留失败选择；主进程同时拒绝运行、待审批及回收站记录的已审阅写入。已审阅任务收到新的发送/排队请求后回到待审阅。删除计划保留任务结果，失效或正在运行的计划禁用失败重试入口。
- DesktopBridge 仍是唯一通信入口，请求经 Zod 校验，继续检查主窗口及主 frame 来源。文件/Git/浏览器带任务标识；异步 UI 查询按任务/文件生命周期丢弃旧响应。
- Git 仓库信息、文件差异、冲突及提交详情各有独立请求代次和错误重试；同一任务内连续刷新也只接收最新结果，失败响应不能覆盖后续选择。远端引用来自真实 refs/remotes，分支跟踪的本地名称与 startPoint 分开校验，复用原有仓库写锁和活动任务保护。推送至匹配远端的既有上游时使用完整引用映射，不因本地名称不同创建另一远端分支或重写上游。
- ui.update 保存外壳，ui.threadPatch 合并任务字段，保留 ui.threadUpdate 原入口。客户端串行发送并重放未完成局部变更。浏览器增删/恢复标签由主进程原子处理，避免登录弹窗与前端旧列表互相覆盖。
- 保存每任务面板、打开文件/网页、草稿、附件引用、阅读锚点、底部跟随、折叠和终端配置；附件内容独立落盘，Cookie 只存 Chromium 分区。
- 阅读锚点在快速切换任务时立即提交，通过消息标识与偏移跨重启恢复；恢复位置和底部跟随使用真实八轮对话验证。
- 查找通过稳定轮次、内容块及字段标识定位，单次合并必要祖先折叠，不重置其他展开选择；等待真实折叠动画结束再滚动，用户再次操作会取消待执行定位。Markdown 渲染组件保持稳定，防止保存阅读位置、置顶和主题切换重建文本节点而丢失选择或高亮。
- 侧栏内容搜索包括真实思考、工具参数及 diff；命中已收起项目时临时显示结果，退出搜索保留原折叠偏好。重复使用搜索快捷键会再次聚焦现有输入；命令面板跳过已删除或不存在的最近关闭任务。
- 文件链接与文件搜索共用按任务保存的定位请求，不覆盖未保存缓冲；行列超出实际内容时夹取到合法位置。非法协议、无效行列和显式越界链接显示普通文本，目录链接穿越仍由主进程拒绝。链接解析只传给受控按钮，其他 Markdown URL 属性继续使用默认过滤。
- 文件树使用 UiThread.fileDirectory、expandedDirectories 和 fileTreeFocus 保存当前目录、展开项及活动行；刷新不重置展开选择，异步目录加载完成后才恢复仍属于树的焦点。方向键、Home/End、Enter/Space 集中定义并可在设置中修改；普通字符查找只移动焦点，合成输入期间不处理树操作。
- 文件搜索使用任务/请求标识及不透明游标，分段扫描并按 200 条展示，上一页使用已收集结果；不再在 200 条命中或 20000 个目录项处静默终止。重复当前请求返回同一页，新查询及关闭面板取消旧扫描；过期/错误提供重试，输入法合成期间不发请求。停止保留结果但不伪装为搜索完成，旧响应不回填其他任务，也不触发全局错误条。
- 内容搜索读取最多 10 MiB 的完整 UTF-8 文件，不再沿用编辑器的 512000 字节预览截断。界面显示实际检查文件/行数、排除目录数，以及二进制、非 UTF-8、过大文件和链接/读取失败的跳过数。排除 .git、node_modules、dist、build、.cache、.artifacts，不遍历目录链接；根目录错误会明确失败。这是按需扫描，不是实时磁盘索引或文件系统快照；后续文件变化需要重新搜索。
- 原始会话文件不迁写。桌面 JSON 缺失字段采用默认值，写入前保留 .bak，损坏文件另留副本。重启不自动发消息、执行 Git 或终端命令；中断队列恢复为草稿。
- 终端增量和快照携带 UTF-16 绝对输出位置；主进程与 renderer 各保留至多 200000 单元恢复尾段，重命名/启动/重载响应不能覆盖较新的事件。已创建的 xterm 在隐藏时继续接收增量；首次恢复超出缓冲时明确提示，退出标记也进入快照。查找/复制针对当前 xterm 缓冲，软换行不伪装为真实换行。每终端查询在本次 renderer 生命周期内保留，应用重启只恢复配置与手动启动入口，不恢复已结束进程或伪造完整日志。
- 终端查找下一处/上一处/返回终端使用独立快捷键作用域，可修改、清除及恢复默认；默认 Enter/Shift+Enter/Escape 不影响文件树同名按键。全局终端操作在 xterm 消费事件前派发，只操作可见活动终端；设置中的快捷键录入、菜单、对话框及输入法合成不触发全局动作。
- 网页查找由每个原生页面持有查询和 Chromium 请求标识，只接受当前请求的最终计数及实际序号；新查询、清除和导航后的迟到结果不能覆盖状态。加载期间只保留最后一个查询，文档完成后执行；切换任务、隐藏面板和 renderer 重载保留仍存活页面的查询，关闭页面或应用退出才结束查询。中文合成期间不发查找请求，清除后可返回网页焦点。
- 地址栏按任务/标签隔离未提交草稿，网站自行导航不会覆盖正在编辑的文字；Escape 恢复当前地址，复制使用实际加载 URL。裸本地域名使用 HTTP，普通外部域名使用 HTTPS；显式非网页协议、嵌入凭据及非法地址在创建页面前拒绝。地址和网页查找快捷键分作用域保存、检查冲突并可恢复默认；未提交地址草稿不跨面板卸载或应用重启保存。

## 不包含

Codex 账号/订阅、云任务、跨设备、云市场、语音、智能体浏览器自动化、托管平台 PR 服务和任意终端式扩展自定义 UI。没有为这些能力放置不可用入口。

独立参考合同仅覆盖列明的布局、菜单、Tooltip、确认框、消息和折叠节点；新增摘要、浏览器、Git、文件编辑器及管理表单属于 Pi 适配，不能据此宣称整个应用像素一致。

