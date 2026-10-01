# Satang B06–B08 接续记录

日期：2026-09-26。本阶段开始时原请求累计15/20，结束并接续B09后累计20/20；不因自动续轮重置计数。来源目录只读，修改均在Pi desktop。

## B06：Review 内部

- 采用早期四份有效 Review DOM，记录在 satang-review-reference.json。pinned Review 未到达，未替代为成功截图。
- 完成 46px 页签条、81px 两行标题区、37px 筛选区、右侧文件树和 32px 文件标题。真实差异、编辑、暂存、回退仍使用 Pi 服务；原 Git 提交、远程、历史及工作树操作可从“Git 操作”展开。
- desktop:check退出0；Git / panel / workbench定向回归22/22；来源合同回归51/51，均退出0。图像18已检查最新文件树、差异及工作区组合画面，键盘调整Review宽550px。

## B07：管理页

- 四份早期有效 Sites DOM 提供共享标题、搜索、筛选、空态几何，记录在 satang-management-reference.json。保留 Pi 资源、收件箱及本地自动化语义，不移入 Sites 服务或来源数据。
- 资源按名称和类型筛选；待审阅按文本及状态筛选并清理失效选择；自动化按名称、项目、提示和启用状态筛选，创建/编辑采用按需展开并恢复焦点。
- desktop:check 退出 0；管理几何 8/8、管理交互 6/6 均退出 0。
- 组合回归 42 项首次 41 通过、1 失败：测试旧标签与新“搜索待审阅任务”不一致。修正后独立 management.spec.ts 6/6 通过。其他 41 项包含实际保存、资源、技能、日历和重启行为；未重跑无变化的通过项。
- 跟随系统深色搜索已通过B08回归；图像19已检查最新浅色宽窗标题、搜索、筛选与空态。创建/编辑仍调用Pi服务。

## B08：对话与状态

- 逐项检查 workspace 源实现及有效正常会话 DOM；其本地实现因令牌限制留下的圆角、间距等缺口，不视为目标要求。使用捕获中实际数值补齐消息气泡、计划卡、通知及正文布局。
- 保留 Pi 会话元数据、折叠持久化、审批、完整计划步骤、自动滚动和错误恢复。
- 来源approval与emptyloading入口均为技术占位；源码哈希及spec状态已登记，不采用invented-v1虚构界面。B09另用固定26.917原始源码补齐，并明确与26.915现场捕获的区别。
- desktop:check、npm run check、166/166单元、28/28受影响回归及8/8 workspace来源回归均退出0。B08完整nonvisual为386/386，退出0；该轮末尾与B09文件写入有时间重叠，不能替代B09最终一致状态的完整回归。
- 图像18检查气泡/通知/正文/表格/代码；图像20检查展开计划内部滚动及审批/输入区组合。完整18步骤可达、摘要定位/取消定位由DOM和Electron回归验证。
- 完整日志：.artifacts/satang-b08-desktop-check.log、satang-b08-full-check.log、satang-b08-unit.log、satang-b08-workspace-regression.log、satang-b08-source-regression.log、satang-b08-full-regression.log。
