# 弹窗尺寸修正：2026-09-27

按用户反馈修复持续目标及同类弹窗的文字、图标和控件偏大问题。沿用已选定的 Codex 26.915 风格与 Pi 组件，不重新进行严格像素验收。

## 根因与修改

- 持续目标、可选子任务、项目环境与动作、项目目录、Worktree 管理复用了命令面板布局。表单继承遮罩层的 16px / 24px 排版，原生命令按钮叠加默认 padding 后明显大于主界面。
- `.dialog h2, .dialog p` 的通用字体和颜色重置还覆盖了说明文字的 12px 字号及弱化颜色。重置现只用于标准确认框自己的标题和说明。
- 共享弹窗新增 `panel` 展示类型，五类功能表单使用 13px 正文、12px 辅助说明；目标与子任务标题为 15px。使用既有小型控件尺寸，关闭和删除按钮为 28px，图标为 16px。
- 长表单不再使用命令面板固定的 504px 最大高度。弹窗按可用窗口高度限制，由一个内容容器滚动，验收项、保存操作及底部说明均可到达。
- 真实命令搜索保留命令面板结构；标准确认框保留独立的确认操作排版。没有调整整个应用的缩放。
- 无显式自动聚焦输入的表单会聚焦首个可用控件；Tab 导航排除禁用表单元素。保留未保存确认和关闭后焦点恢复。

## 主要文件

- `apps/desktop/src/renderer/src/components/primitives/dialog.tsx`：共享弹窗展示类型、初始焦点及 Tab 导航。
- `apps/desktop/src/renderer/src/styles/utilities.css`：弹窗文字重置、表单控件尺寸和滚动容器。
- `apps/desktop/src/renderer/src/components/panels/{goal-panel,subtask-panel}.tsx`：使用统一表单展示及 IconButton。
- `apps/desktop/src/renderer/src/components/shell/{project-actions,project-directories,worktree-manager}.tsx`：使用统一表单展示。
- `apps/desktop/src/renderer/src/styles/{goals,subtasks,review-findings}.css`：移除冲突的内层高度限制，收敛标题和间距。
- `apps/desktop/test/e2e/goals.nonvisual.spec.ts`：新增五类弹窗的 60 组合尺寸回归，以及长表单、取消丢弃、草稿与焦点回归。

## 本轮验证

以下命令均实际执行，退出码均为 0。所有任务运行使用本地假供应商。

| 验证 | 结果 |
| --- | --- |
| `npm run desktop:check` | 桌面类型检查通过 |
| `npm run desktop:build` | 开发资源构建通过；未制作 EXE |
| `goals.nonvisual.spec.ts` | 5/5，通过五类弹窗 × 中英 × 深浅主题 × 1440×940 / 1000×700 / 1280×800；并验证长表单、真实目标保存与重启 |
| 菜单、确认框、输入区定向 Chromium 回归 | 25/25 |
| 项目动作保存执行、子任务 UI、file:// 开发资源 | 3/3 |
| 本轮测试缓存核验 | Pi 测试遗留目录 0，跳过 0，清理失败 0 |

测试命令（工作目录 `apps/desktop`）：

```powershell
$env:PI_OVERLAY_EVIDENCE = '1'
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts goals.nonvisual.spec.ts --reporter=list
Remove-Item Env:PI_OVERLAY_EVIDENCE
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts surfaces.spec.ts reference.spec.ts composer.spec.ts --grep 'dialog|confirmation|command|palette|menu|model|菜单|确认|命令' --reporter=list
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts project-actions.nonvisual.spec.ts subtasks.nonvisual.spec.ts final-ui.nonvisual.spec.ts --grep 'configuration runs|explicit delegation UI|file://' --reporter=list
```

缓存核验（仓库根目录，只读核验）：

```powershell
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/overlay-temp-audit.json
```

日志保存在 `.artifacts/overlay-desktop-check.log`、`overlay-build.log`、`overlay-goals-validation.log`、`overlay-surfaces-validation.log` 和 `overlay-workflows-validation.log`。构建仍有现有依赖的 Zod 注释和 Lucide `use client` 警告；本轮没有引入依赖或修改锁文件。

仅保留两张必要的原生实现图，并已查看文字层级、图标、保存按钮和边界；没有宣称像素一致：

- [浅色中文 1440×940](../../.artifacts/overlay-scale/goal-light-zh-CN-1440.png)
- [深色英文 1000×700](../../.artifacts/overlay-scale/goal-dark-en-US-1000.png)

没有提交、发布或打包 EXE，没有修改 Satang，也没有停止用户正在运行的窗口。

## 开发启动

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
npm run desktop:dev
```
