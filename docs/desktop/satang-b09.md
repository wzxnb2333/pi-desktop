# B09：审批、加载与最终验收

日期：2026-09-26。本阶段接续B06–B08，保留原目标全部页面范围。图像累计20/20，已停止图像读取；源码、DOM和实际操作检查继续。

## 来源与实现

Satang的approval/emptyloading入口及spec未提供可采用的已登录状态。使用目标项目已有的26.917.9434.0解包资源作独立补充，没有把该版本标作26.915捕获，也未复制invented-v1占位界面。

- 原始WQ、z$、V8、AJi和共享c8按钮，加三份原始CSS；SHA-256及字节锚点见reference-states.json。生成器不导入Pi组件/CSS，不执行厂商应用，不联网、不截图。
- 审批：25px卡片圆角，16px内容内距，13/14px层次文字，28px圆形按钮；低于448px容器时操作纵向排列。浅色、深色和跟随系统均使用独立来源颜色。
- 保留Pi action/confirm/input/select及单次允许/拒绝语义。输入框原生表单关联支持Enter；提交同步守卫防重复，失败保留值并恢复操作，成功等待实际审批事件移除。没有新增永久或范围授权。
- 长描述保留完整文本、换行及250px内部键盘滚动，不以截断隐藏操作内容。仅实际溢出的描述进入Tab顺序，并随容器尺寸或内容更新；短描述保持摘要定位后Tab直接到回复控件或拒绝按钮。
- 加载：居中容器、56px标识、8px间隔、46px可拖动顶部区域；保留Pi标识、真实初始化状态和完整错误文本。bootstrap成功进入工作区，失败保留错误并结束busy状态。

## 已执行验证

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| node apps/desktop/scripts/reference-states.mjs | 0 | 8组独立来源样本；原始CSS哈希校验 |
| npm exec --workspace apps/desktop -- playwright test --config playwright.nonvisual.config.ts reference-states.spec.ts | 0 | 18/18；四种回复、重复提交、失败重试、长文本、加载成功/失败、宽窄明暗及系统主题 |
| npm run desktop:check | 0 | 桌面TypeScript通过 |
| npm run check | 0 | 完整根检查通过，Biome未改动文件；桌面类型由单独命令检查 |
| npm run desktop:test | 0 | 166/166，无失败/跳过 |
| npm exec --workspace apps/desktop -- playwright test --config playwright.nonvisual.config.ts reference-states.spec.ts summary.spec.ts summary.nonvisual.spec.ts | 0 | 36/36；包含短审批Tab顺序、长描述Tab/滚动，以及真实审批后文件编辑与摘要恢复 |
| npm run desktop:test:nonvisual | 0 | 最终404/404，31个测试文件；0失败、0跳过、0重试后通过，9.8分钟 |
| node apps/desktop/scripts/fidelity-report.mjs --results-only | 0 | 用最终机器结果生成逐用例报告，不重新运行测试 |
| node --check apps/desktop/scripts/reference-states.mjs | 0 | 来源生成脚本语法通过 |
| node --check apps/desktop/scripts/fidelity-report.mjs | 0 | 验收报告生成脚本语法通过 |
| 临时来源/图片元数据审计 | 0 | 67份独立来源哈希及字节锚点有效，11份合同、20条图像文件/序号有效；未解码或查看图片 |

第一次窄卡片样式测试14/18通过、4项失败：测试注入的width被宿主更高优先级规则覆盖，实际未形成320px容器。改为仅设置fixture容器行内宽度并先断言真实宽度，再比较生产样式，18/18通过；未放宽样式预期。

第一次完整nonvisual为402通过、2失败，退出1：审批描述无条件tabIndex=0，导致摘要定位后短描述抢占第一个Tab，破坏原有拒绝/允许键盘顺序。生产组件改为按实际溢出决定Tab入口，并观察尺寸变化；保留长描述键盘滚动。原失败用例不放宽断言，新增长描述真实Tab路径，36/36定向验证通过。失败日志保留为.artifacts/satang-b09-full-regression-initial.log。

修复后的完整nonvisual于2026-09-26T13:11:52.614Z开始，404/404通过，退出0，失败/跳过/重试后通过均为0。31个文件的逐项数量、261份源码/测试/配置/合同输入的SHA-256及早于测试开始的修改时间检查结果，归档于.artifacts/satang-b09-final-state-audit.json。测试期间没有修改产品或测试输入；根检查与桌面类型检查为修复后的结果。

## 视觉验收

实际查看的新增目标图：

- 图像18：.artifacts/desktop-visual/satang-b08-workspace-review-dark-1440.jpg。深色对话及Review树/差异，显示键盘分栏焦点；计划在屏外，没有声称该图可见计划。
- 图像19：.artifacts/desktop-visual/satang-b07-management-light-1440.jpg。浅色管理标题、搜索、筛选、创建与空态。
- 图像20：.artifacts/desktop-visual/satang-b09-plan-approval-light-1000.jpg。紧凑窗口完整计划卡、审批回复及输入区；计划内部可滚动，输入焦点可见。

这些图来自实际App和合成本地桥接数据，内容不是用户任务的真实验证结果。真实文件、Git、PTY、浏览器及审批生命周期由Electron临时项目测试另行验证。未宣称整窗像素一致。

## 产物与约束

产品修改集中在message.tsx、loading.tsx、App.tsx、approval.css、approval-theme.css、loading.css和样式入口。新增reference-states.spec.ts及来源合同，原有状态/服务协议保留。

完整日志位于.artifacts/satang-b09-{desktop-check,full-check,unit,state-regression,focus-regression,full-regression}.log；来源审计结果为.artifacts/satang-b09-evidence-audit.json。最终机器结果为.artifacts/satang-b09-final-nonvisual-results.json，逐用例清单为docs/desktop/fidelity-report.md，全范围逐项复核见satang-completion-audit.md。临时审计脚本执行后移除，保留JSON收据。

只修改Pi desktop；不使用子代理，不切分支、不提交、不生成发行包、不发布。预览页和服务已关闭；开发模式测试会编译应用入口，这不等同发行打包。

启动：在E:/AI_collection/Pi desktop运行npm run desktop:dev。
