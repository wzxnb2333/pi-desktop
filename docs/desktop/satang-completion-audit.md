# Satang UI 完整范围复核

日期：2026-09-26。审计保持原始页面映射及真实Pi功能范围。前轮363项局部验收未被当作全范围完成；B06–B09补齐Review内部、管理搜索/过滤/空态、workspace以及审批/加载。最后一轮完整回归404/404、桌面单元166/166、desktop:check和完整npm run check均退出0。以下逐项证据支持原目标完成，不扩大为整窗像素一致。

## 参考证据

- satang-ui-migration.md登记完整12项页面/状态映射和B01–B09批次。7份Satang合同共34组有效DOM捕获：22组pinned，12组较早有效捕获；来源哈希、节点索引、矩形及计算样式独立于Pi组件。
- 26.917.9434.0解包来源另外提供12组基础、84组通用表面、48组活动以及8组审批/加载样本；对应reference-contract.json、reference-surfaces.json、reference-activity.json、reference-states.json。没有混作26.915现场截图。
- .artifacts/satang-b09-evidence-audit.json逐文件复核67份来源的SHA-256和源码字节锚点、11份合同的测量元数据及20条图像记录，结果passed。参考目录只读。
- Satang pinned workspace/management显示旧会话加载失败，pinned Review及1000px palette缺失；已继续查阅早期正常DOM与既有实现。workspace图可视区只有通知和diff，正文/计划来自屏外DOM。approval/emptyloading入口为技术占位，采用独立26.917原始源码补充，没有复制invented-v1占位。

## 页面逐项核对

实现组件路径以下相对apps/desktop/src/renderer/src/components；Settings及styles相对其上一级src。测试均在apps/desktop/test/e2e。每行列出直接覆盖该要求的证据，最终完整运行结果另列，不以总数代替范围审查。

| 映射项 | 当前实现与来源 | 行为、布局及视觉证据 |
| --- | --- | --- |
| 1. shell外壳 | shell/titlebar、toolbar、workspace；satang-shell-reference及reference-contract | reference.spec、panels.spec、desktop.nonvisual：窗口控制、分栏键盘/指针、窄窗覆盖、真实布局重启；B02外壳及图18组合画面 |
| 2. welcome欢迎页 | timeline/welcome、styles/welcome；satang-reference | reference.spec、acceptance：实际项目和模型引导；B01宽深/窄浅验收图 |
| 3. composer输入区 | composer/composer、home-utility；欢迎捕获及26.917输入框样本 | composer.spec、conversation.nonvisual、workbench.nonvisual：附件、中文合成、模型/思考、权限、计划、发送/队列/停止、草稿和重启；图9/18/20 |
| 4. sidebar侧栏 | sidebar/sidebar、thread-actions；satang-shell-reference | sidebar.spec、search.nonvisual、workbench.nonvisual：项目分组、真实任务、搜索、归档/恢复、快捷键与菜单；B02及图18 |
| 5. workspace对话及工具状态 | timeline/turn、message、activity、disclosure，styles/satang-workspace；satang-workspace-reference、reference-surfaces、reference-activity | satang-workspace.spec、surfaces.spec、activity.spec、summary.spec、conversation.nonvisual：消息/通知/正文/表格/代码、实际工具状态、折叠、18步骤内部滚动及定位、失败与阅读恢复；图18/20 |
| 6. palette命令面板 | shell/commands及命令样式；satang-palette-reference | satang.spec、search.nonvisual：四组定位/输入/行样式，短窗口、输入法、键盘选择、真实搜索导航；图7为中间态，最终图8 |
| 7. review及files辅助面板 | panels/review-panel、git-panel、files-panel、diff；satang-review-reference及26.917差异原语 | satang.spec、git-panel.spec、git.nonvisual、file-navigation.nonvisual、message-links.nonvisual、workbench.nonvisual：81px标题/46px条、37px过滤、右侧树/差异、Git操作及真实文件读写、重试、键盘和重启；图18取代旧图15 |
| 8. terminal终端 | panels/terminal-section；satang-surfaces-reference的terminal样本 | satang.spec、terminal.nonvisual、workbench.nonvisual：栏条样式、真实PTY输出、查找/复制、键盘配置、隐藏输出及重载；图11只验证启动前外框，未冒充PTY图 |
| 9. preview网页面板 | panels/preview-panel；satang-surfaces-reference的preview样本 | satang.spec、browser.nonvisual、workbench.nonvisual：页签/地址/空态、真实原生浏览器、查找、Cookie、下载及隔离；图10 |
| 10. settings设置 | Settings及现有模型/MCP/主题等表单；satang-surfaces-reference的settings样本 | settings.spec、model-settings.nonvisual、mcp-settings.spec、mcp.nonvisual：分类、字段、保存/失败、键盘、配置恢复、实际MCP连接；图12/13 |
| 11. management管理 | management/pages、automations、skills-page、inbox及satang-management样式；satang-management-reference | satang.spec、management.spec、resources.spec、management.nonvisual、skills.nonvisual：搜索、分段过滤、列表和空态、实际创建/保存/删除/审阅、诊断/重试及重启；图14为创建表单，图19为最新空态 |
| 12. approval / emptyloading | ApprovalCard及shell/loading；reference-states独立26.917补充 | reference-states.spec、summary.spec、summary.nonvisual：宽窄/显式与系统主题、四种回复、忙碌/失败重试、重复提交、短描述Tab直达动作和长描述键盘滚动、bootstrap成功/失败；图20为紧凑审批组合，加载不声称有新截图 |

## 验证终态

| 检查 | 当前结果 | 直接证据 |
| --- | --- | --- |
| 桌面类型 | 退出0 | .artifacts/satang-b09-desktop-check.log；最后焦点修复后执行 |
| 完整根检查 | 退出0 | .artifacts/satang-b09-full-check.log；含Biome、根TS、依赖/导入、入口预算、shrinkwrap/install-lock和浏览器烟测；Biome未改动文件 |
| 桌面单元 | 166/166，退出0 | .artifacts/satang-b09-unit.log；后续审批焦点仅影响renderer，单元涉及的后端/共享输入未变化 |
| 审批及摘要受影响回归 | 36/36，退出0 | .artifacts/satang-b09-focus-regression.log和satang-b09-focus-results.json；真实Electron审批后编辑、长描述滚动及摘要Tab均通过 |
| 完整nonvisual | 404/404，退出0；0失败/跳过/重试后通过 | .artifacts/satang-b09-full-regression.log、satang-b09-final-nonvisual-results.json；31个测试文件，2026-09-26T13:11:52.614Z开始，9.8分钟 |
| 来源与图片元数据 | 通过 | .artifacts/satang-b09-evidence-audit.json；未增加图片识别 |
| 一致状态与报告 | 退出0 | .artifacts/satang-b09-final-state-audit.json记录261份输入SHA-256及修改时间早于本次完整回归；fidelity-report.md为最终404项逐用例清单 |

首次B09完整回归402通过、2失败，发现短审批描述错误占用Tab顺序；修复生产组件后36项定向通过。原始失败日志另存，未修改原失败预期。最终完整回归从修复后启动，执行期间不再修改产品/测试/配置文件。B08的386/386和更早363/363仅保留历史，不代替本轮验收。

## 视觉计数与执行约束

- 同一请求跨B02–B09累计20/20：8次来源图、12次目标图，重拍/中间态均登记；B06开始时保留5次额度并实际用于两张来源和三张最终目标图。没有通过自动续轮重置。详见satang-ui-image-ledger.json。
- 图18/19/20来自实际App与合成本地桥接数据；真实文件、Git、PTY、MCP和审批生命周期由开发模式Electron临时项目另行验证。回归关闭截图/视频/trace，不产生额外图片识别。最后焦点修复只改变Tab参与条件，不改变已验收几何。
- 沿用React/TypeScript/Electron及现有服务；保留Pi身份、业务字段、实际模型/工具功能，不用来源站点或云服务占位替换Pi能力。
- 只修改目标仓库；保留原分支及全部既有未提交工作，不使用子代理、不切分支、不提交、不打安装包、不发布。开发模式测试编译入口，不是发行打包。自建浏览器预览和服务已关闭。

## 结论边界

原始12项页面/状态映射全部实现，类型、受影响回归、完整验收、来源审计和机器结果归档均完成；本次约定范围没有剩余实现或验收项，满足goal完成条件。每个执行批次及之前失败原因保留在记录中，未以成功摘要覆盖失败历史。

不声称整窗像素一致、厂商所有实验状态或所有第三方供应商组合等同。Satang缺失的同态截图与26.917补充版本分别标记；字体栅格化、专属业务表单及原生网页行为仍有明确证据边界。既有文件编辑间歇失败曾未复现但原因未确定，保留remaining-differences.md记录，本UI验收不将其宣称为已修复。
