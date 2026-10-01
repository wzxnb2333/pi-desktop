# B02–B05：外壳、搜索、辅助面板与设置移植

本页保留前轮局部范围的实现与验收记录，不能单独作为整个目标完成的证明。当前状态和剩余项见 [完整范围复核](satang-completion-audit.md)。

日期：2026-09-26。接续“还原 Codex Desktop 前端”中的 B01/B02 工作。本次可映射范围的 B02–B05 实现与验收完成；最终全量回归 363/363 通过。缺失来源和 Pi 能力差异仍按下文保留，不等于完整产品逐像素复刻。

## 实际完成范围

| 批次 | 实际结果 | 证据与适配 |
| --- | --- | --- |
| B02 | 顶部菜单、前进/后退、侧栏项目与任务、搜索入口和命令面板 | 外壳沿用前次接续代码，本次纳入组合回归；命令面板改为 520px 宽、20px 圆角、来源阴影和紧凑输入/结果行 |
| B02 | 对话正文、表格、代码、工具过程、搜索命中定位与状态恢复 | 保留已建立的 26.917 独立源码合同及真实 Pi 会话操作；没有把加载失败截图用作正常会话基准 |
| B03 | 终端/浏览器标签、地址输入框、浏览器空状态；Review/文件/Git 联动 | 终端条 40px、浏览器条 46px、标签高 28px；保留原生 PTY、网页查找、下载、文件编辑与 Git 服务 |
| B04 | 设置标题位置、768px 内容上限、20px 卡片、侧栏分类和页面间距 | 模型、通用、MCP 等仍是 Pi 实际表单，保存按钮和错误反馈保留；自动化/待审阅/资源页复用页面布局 |
| B05 | 独立来源登记、逐项 DOM 回归、人工截图与完整检查 | 新增 17 项 palette/settings/terminal/preview 回归，与已有首页、外壳、功能用例一起验收 |

命令面板独立使用 palette 呈现，复用原确认框的焦点循环、Esc 和焦点恢复；点击背景只关闭命令面板，不改变确认操作的已有语义。实际命令、最近任务、会话查找、分页和中文输入保护继续使用原实现。

这次没有修改 Pi 后端协议，也没有移入参考中的真实账户、聊天或订阅数据。截图由实际 App 和本地合成数据产生；其内容不代表用户项目的真实运行结果。

## 可复现的来源

所有来源来自只读目录 `E:/AI_collection/satang_code`，正常启动及测试只读取已经保存的合同，不依赖该目录。合同保存来源文件 SHA-256、节点索引、矩形与计算样式。

| 合同 | 样本 | 实际检查范围 |
| --- | --- | --- |
| `satang-reference.json` | 4 | B01 首页标题、输入框和环境条；本轮回归保留 |
| `satang-shell-reference.json` | 4 | 标题栏、侧栏关键节点矩形、文本样式与圆角 |
| `satang-palette-reference.json` | 4 | 面板位置/宽度、阴影、圆角、输入与结果行的尺寸和样式 |
| `satang-surfaces-reference.json` | 12 | 设置标题与卡片、终端/浏览器条高与内边距、地址框及空状态标题 |

以上都是浅色/深色 × 1440×940 / 1000×700。命令面板 1000px 的两组采用早期未 pinned 捕获，其余 22 组采用 pinned。首页/外壳所列矩形容差 0.5px，设置宽度上限允许 1px 滚动条差异；没有宣称这些断言覆盖每页全部节点、整页高度或字体栅格化。

本轮新来源生成命令：

```powershell
node apps/desktop/scripts/satang-palette-reference.mjs E:/AI_collection/satang_code
node apps/desktop/scripts/satang-surfaces-reference.mjs E:/AI_collection/satang_code
```

两条命令均退出 0，分别生成 4/12 组来源测量；不会读取账户凭证、执行供体应用或识别额外图片。

## 验证结果

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run desktop:test:nonvisual -- satang.spec.ts` | 0 | 17/17；来源样式、页面几何、短窗口、中文合成、焦点与保存操作通过 |
| `npm run desktop:test` | 0 | 修正文件搜索分页测试后 166/166 通过 |
| `npm run desktop:check` | 0 | 最终桌面 TypeScript 检查通过 |
| `npm run check` | 0 | 最终完整检查通过；1383 文件无需格式修复，类型、依赖、入口边界、shrinkwrap、安装锁及浏览器 smoke 通过 |
| `npm run desktop:test:nonvisual`（首次全量） | 1 | 362/363；新增标题栏后退按钮使旧浏览器测试定位出现二义性，已将定位限定到网页工具栏 |
| `npm run desktop:test:nonvisual`（修正后全量） | 0 | 363/363；9.1 分钟，失败/跳过/重试后通过均为 0 |

首轮完整机器结果保留于 `.artifacts/satang-initial-nonvisual-results.json`。最终标准机器结果为 `.artifacts/desktop-nonvisual-results.json`，另存 `.artifacts/satang-final-nonvisual-results.json`；最终命令完整日志为 `.artifacts/satang-final-nonvisual.log`。类型检查与根检查日志分别为 `.artifacts/satang-final-desktop-check.log`、`.artifacts/satang-final-root-check.log`。按机器结果生成的逐项清单见 `fidelity-report.md`。

补充核对：32 项来源文件 SHA-256 与当前只读供体一致，24 组测量为有效数值；15 条图像登记均有对应文件且未超额；三份新/改报告与来源脚本通过 `node --check`。浏览器返回的 9 张截图实际为 JPEG，已将扩展名改为 `.jpg`，没有重拍或改变图像内容。临时检查脚本与预览服务已清理。

本轮修正两个测试问题：浏览器“后退”需限定网页工具栏，以免与顶部任务导航混淆；文件搜索每页有 50ms 工作预算，第一页允许尚无匹配且 `done=false`，测试现在沿 cursor 读取到结束再断言结果。后者没有修改服务或放宽完整结果要求。

Electron 回归使用临时项目、本地假供应商、本地 Git 远端及本地网页，验证真实 PTY、原生浏览器、文件/Git、搜索/分页、设置保存和进程重启。自动截图、视频和 trace 均关闭；没有调用真实付费模型。测试启动器会编译开发代码，不生成发行包。

测试开发编译输出包含现有 Zod 注释的 Rollup PURE 标记警告及颜色环境变量警告；未改变依赖，警告未阻塞检查或测试。

## 图像记录

本次用户请求总计 **15/20**：6 张参考图、9 张 Pi 输出图，包含 1 张恢复输入占位提示前的中间图。完整逐次登记见 `satang-ui-image-ledger.json`，跨 B02–B05 不重置额度。

| 输出 | 实际观察内容 |
| --- | --- |
| `.artifacts/desktop-visual/satang-b02-palette-dark-1000.jpg` | 最终命令面板，包含输入提示、真实命令与最近任务 |
| `.artifacts/desktop-visual/satang-b02-workspace-light-1440.jpg` | 会话、表格、代码与输入区 |
| `.artifacts/desktop-visual/satang-b03-preview-light-1000.jpg` | 紧凑窗口浏览器空状态和辅助抽屉 |
| `.artifacts/desktop-visual/satang-b03-terminal-dark-1440.jpg` | 终端尚未启动时的标签与控制区 |
| `.artifacts/desktop-visual/satang-b03-review-dark-1440.jpg` | Pi Git 工作台与干净工作区状态 |
| `.artifacts/desktop-visual/satang-b04-settings-light-1440.jpg` | 通用设置、卡片与显式保存 |
| `.artifacts/desktop-visual/satang-b04-models-dark-1000.jpg` | 模型设置与可滚动表单 |
| `.artifacts/desktop-visual/satang-b04-automations-light-1000.jpg` | 自动化新建表单及页面内容宽度 |

这些图片已实际查看。终端图没有运行中的 PTY 输出，浏览器图没有加载的原生网页，相关实际行为由 Electron 测试单独验证；不能用空状态截图替代行为证据。

## 保留的差异与来源缺口

- pinned `workspace` 和 `management` 实际是旧会话加载失败画面。此前将后者描述为已经到达 Sites 页不准确，本轮已纠正；没有正常管理页同态像素证据。
- pinned `review` 缺失。Pi Review/文件/Git 使用已有 26.917 局部源码合同和真实行为测试，没有完整原版文件树/Git 表单的逐像素证明。
- Pi 在浏览器外层保留 Review 标签、查找、下载等实际操作，1000px 使用辅助抽屉；终端默认高度继续服从用户布局。这些与参考捕获的整窗分栏、高度不同，不属于同态几何声明。
- 设置保留 Pi 专属模型/MCP 字段、原生控件、显式保存及提示；自动化/待审阅/Skills 是 Pi 实际能力，未增加 Sites、账户、订阅或云端功能。
- 对话完整工具/审批块、diff 编辑器内部、全部图标和动画、字体栅格化仍未建立完整原版等同性。其余既有边界见 `remaining-differences.md`。

本次只完成已有功能可映射的 UI 移植与回归；没有宣称整个 Codex Desktop 产品或所有页面逐像素一致。未提交、未切换分支、未打包、未发布。

## 启动

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
npm run desktop:dev
```
