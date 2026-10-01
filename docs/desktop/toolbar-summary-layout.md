# 顶部收拢与摘要、辅助栏共存

日期：2026-09-28。沿用 Codex 26.915 参考和 Pi 品牌，按本轮请求调整布局，不恢复严格像素验收。

## 实际行为

- 任务顶部保留项目动作、辅助栏、任务摘要、更多操作四个主入口，以及运行状态。窄窗口自动收起项目动作文字和状态文字。
- 独立窗口、编辑器、项目目录、Worktree、持续目标、可选子任务、变更、终端、浏览器和侧聊收进“工作台更多操作”，继续调用原有真实服务。子任务的返回父任务入口也保留。
- 摘要和辅助栏分别开关；从顶部或视图菜单打开摘要，都不会关闭辅助栏。打开工具也不会排斥摘要。
- 宽窗口并排布局；空间不足时摘要浮在会话上方，不继续压缩中间阅读区。更窄时辅助栏也浮起；横向放不下两者时，摘要在上、工具在下。
- 浮层根据实际输入框高度留出底部空间，保证发送与输入控件可用。卡片、工具尺寸和缩放拖柄同步调整。
- 拖动偏好仍持久化；窗口变小时只限制当前显示尺寸，不覆盖用户保存的宽度。语言、主题、任务切换及草稿逻辑保持原有行为。
- 两类省略号菜单使用不同的无障碍名称：侧栏为“任务更多操作”，顶部为“工作台更多操作”。键盘打开、关闭和弹窗返回焦点均有回归验证。

## 主要实现

| 文件 | 变更 |
| --- | --- |
| apps/desktop/src/renderer/src/components/shell/toolbar.tsx | 顶部主入口及更多操作菜单 |
| apps/desktop/src/renderer/src/components/shell/project-directories.tsx | 目录弹窗支持菜单控制 |
| apps/desktop/src/renderer/src/components/shell/worktree-manager.tsx | Worktree 弹窗支持菜单控制 |
| apps/desktop/src/renderer/src/components/panels/subtask-panel.tsx | 复用已有子任务面板 |
| apps/desktop/src/renderer/src/components/shell/workspace.tsx | 独立显示、浮层定位和输入框避让 |
| apps/desktop/src/renderer/src/lib/layout.ts | 会话宽度保护、摘要浮动和上下布局判定 |
| apps/desktop/src/renderer/src/components/shell/resizer.tsx | 浮层拖柄边界同步 |
| apps/desktop/src/renderer/src/components/shell/commands.tsx | 摘要命令不再关闭辅助栏 |
| apps/desktop/src/renderer/src/styles/shell.css | 紧凑更多操作按钮 |
| apps/desktop/src/renderer/src/styles/task-summary.css | 摘要与工具浮层样式 |
| apps/desktop/src/shared/feature-messages.ts | 顶部更多操作的双语名称 |

## 验证记录

验证使用本地页面和假供应商，不使用真实账号或付费模型。原生测试通过真实菜单和 IPC 执行。常规测试关闭截图、视频及 trace；仅保留两张布局证据。

所有本轮新增或修改的测试用例均已实际执行。最终有效结果为 15 项单元测试、149 项去重后的定向界面/原生回归通过；没有把初次失败的整批运行记作全通过，也没有宣称运行桌面测试全集。

| 实际命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最后一次代码修改后通过 |
| `node --import tsx --test apps/desktop/test/layout.test.ts apps/desktop/test/panel-tabs.test.ts apps/desktop/test/ui-patches.test.ts apps/desktop/test/localization.test.ts` | 0 | 15/15 |
| `npm run desktop:test:nonvisual -- summary.spec.ts reference.spec.ts file-editor.spec.ts satang.spec.ts --timeout=45000` | 1 | 95/96；一项新布局断言在 resize 状态更新前取值，修正等待条件后以下 21 项全通过 |
| `npm run desktop:test:nonvisual -- summary.spec.ts --timeout=45000` | 0 | 21/21；包含新菜单和布局矩阵 |
| `npm run desktop:test:nonvisual -- browser.nonvisual.spec.ts summary.nonvisual.spec.ts desktop.nonvisual.spec.ts file-editor.nonvisual.spec.ts file-navigation.nonvisual.spec.ts workbench.nonvisual.spec.ts message-links.nonvisual.spec.ts` | 1 | 39/40；顶部和侧栏菜单同名导致定位歧义，补充独立双语名称后在后续批次重跑通过 |
| 下列原生菜单入口定向命令 | 0 | 14/14；含前述失败的完整桌面流程 |
| `npm run desktop:test:nonvisual -- summary.spec.ts --grep 'compact toolbar\|summary and tool pane'` | 0 | 最终代码上的两项新回归再次通过 |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/toolbar-summary/cache-audit.json` | 0 | 匹配测试目录 0；无残留需要删除 |

原生菜单入口定向命令（仓库根目录，PowerShell）：

```powershell
npm run desktop:test:nonvisual -- desktop.nonvisual.spec.ts goals.nonvisual.spec.ts subtasks.nonvisual.spec.ts worktree-lifecycle.nonvisual.spec.ts git-history.nonvisual.spec.ts git.nonvisual.spec.ts acceptance.spec.ts --grep-invert 'automatic cleanup remains|a real independent Worktree|stop, close, parent deletion|actual subtask tool|pause, stop, closing|real provider errors' --grep 'Windows desktop|feature dialogs|long goal forms|goal UI persists|explicit delegation UI|same chat migration|migration refuses|managed archive UI|latest run diff|hunk revert|Git workbench|multiple directories isolate|separate task windows share'
```

覆盖真实浏览器画面与输入保留、摘要定位、工具切换、发送和审批、终端、文件编辑、重启恢复、多窗口/多目录、Git 差异与恢复、Worktree 迁移/归档/恢复，以及从更多菜单打开的管理弹窗。子任务功能回归只使用本地假供应商，本次开发未调用开发子代理。

新增布局矩阵覆盖深浅主题 × 中英文 × 1920、1440、1280、1000px；另验证 1000px 窗口配合已保存的宽侧栏时，摘要位于工具上方，输入框不被遮挡。已查看两张布局截图，不作严格像素一致声明。

更早一次摘要测试为 19/21：旧用例依赖辅助栏按钮强制进入变更页面，现改为通过更多菜单明确选择“查看变更”。这些用例已包含在通过的 21 项中。最初单测命令遗漏项目要求的 `--import tsx`，本地化测试无法解析已有 TypeScript 参数属性；使用正确命令后 15 项全部通过，未为此修改业务代码或依赖。

## 证据

- .artifacts/toolbar-summary/coexist-1440.png：1440×940，摘要浮在会话右上方，工具栏保持并排。
- .artifacts/toolbar-summary/coexist-1000.png：1000×700，摘要与工具采用浮层，底部完整保留输入框。
- .artifacts/toolbar-summary/summary-results.json：摘要、键盘菜单、深浅主题、中英文及尺寸矩阵。
- .artifacts/toolbar-summary/secondary-actions-results.json：14 项原生入口及恢复流程结果。
- .artifacts/toolbar-summary/final-layout-results.json：最终代码的两项新增回归结果。
- .artifacts/toolbar-summary/cache-audit.json：缓存核对，匹配目录为 0。
- initial-summary-results.json、layout-timing-results.json、native-first-results.json：保留初次失败及同批其他通过项的实际结果，均位于同一证据目录。

开发模式启动：在仓库根目录运行 `npm run desktop:dev`。本轮不提交、不发布、不重新制作 EXE。
