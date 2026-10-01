# 桌面视觉增量验收

日期：2026-09-26。固定参考：Windows MSIX 26.917.9434.0 / app 26.917.71314。

本轮根据截图修正对话中的表格和代码块，并验证它们在实际工作台中的布局。现有 Pi 名称、中文和业务流程保持原有语义。整窗与全部功能状态的原版像素等同性仍未建立。

## 实际修改

- 表格由完整网格改为源样式中的横向分隔线、起始侧表头、正文内外距和按内容长度分配的列宽。保留 Markdown 的列对齐、强调与行内代码，超宽内容在表格区域内滚动。
- 代码块加入语言、复制和自动换行工具栏，匹配默认代码块的圆角、背景、间距及等宽字体。复制保留原代码内容；剪贴板失败显示局部错误并允许重试。
- 视觉检查发现 1000×640 工作台中两列短表格多出 23px 横向滚动。表格改用自身容器宽度扣除包装边距，复验 `clientWidth = scrollWidth = 718`，整页 `scrollWidth = innerWidth = 1000`。长表格仍能通过键盘横向滚动。
- 源码独立表面合同由 60 组扩展至 84 组，增加表格和代码块在四种主题模式、三种窗口尺寸下的 24 组样本；新增三个交互回归，含窄容器断言。

主要实现位于 `apps/desktop/src/renderer/src/components/timeline/markdown-blocks.tsx`、`message.tsx` 与 `styles/timeline.css`。源码提取位于 `apps/desktop/scripts/reference-surfaces.mjs`，回归位于 `apps/desktop/test/e2e/surfaces.spec.ts`。

## 视觉证据

通过内置浏览器查看本地预览，使用真正的 App/Message 组件与固定合成数据。参考页只加载固定厂商 CSS、保存的主题值和已追踪的 DOM 片段，不执行厂商 JavaScript。原始 CSS 在预览启动时逐文件核对 SHA-256。参考与 Pi 组件使用同类主内容区域背景，避免混入外壳背景差异。

本轮识别 13 张截图，包含修正前后与重拍；最终保留 10 个独立图片文件，未超过单轮 20 张限制。检查窗口包括 1000×640、1280×800、1440×940 CSS 像素。1440×940 最终页面读取的 `devicePixelRatio` 为 1。

| 截图 | 观察 |
| --- | --- |
| [修改前工作台](../../.artifacts/desktop-visual/before-workbench-light.jpg) | 旧表格全网格、表头居中；代码块缺少工具栏 |
| [源码表格](../../.artifacts/desktop-visual/reference-table-light.jpg) / [Pi 表格](../../.artifacts/desktop-visual/pi-table-light.jpg) | 浅色下文字位置、行分隔及留白对照 |
| [源码代码块](../../.artifacts/desktop-visual/reference-code-dark.jpg) / [Pi 代码块](../../.artifacts/desktop-visual/pi-code-dark.jpg) | 深色下外框、工具栏和代码区域；参考图标区域为定宽占位，不比较 glyph |
| [1280 浅色工作台](../../.artifacts/desktop-visual/workbench-light-1280.jpg) / [1280 深色工作台](../../.artifacts/desktop-visual/workbench-dark-1280.jpg) | 实际对话与输入区组合布局、主题层次 |
| [1440 浅色工作台](../../.artifacts/desktop-visual/workbench-light-1440.jpg) | 完整示例轮次、用户气泡、表格、代码与输入区 |
| [1000 深色工作台](../../.artifacts/desktop-visual/workbench-dark-1000.jpg) | 窄窗口短表格不再横向溢出，输入区与操作按钮保持可见 |
| [1000 通用设置](../../.artifacts/desktop-visual/settings-light-1000.jpg) | 设置侧栏、正文列、字段与保存入口可用，无整页横向溢出 |

这些图片来自浏览器中运行的真实前端与测试桥，不是原版活动窗口和 Pi Electron 窗口的全功能截图差分。窄窗口截图显示时间线底部跟随状态，较早消息在视口上方。图片为忽略目录中的本地产物，不随正常代码提交。

## 验证结果

| 实际命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node apps/desktop/scripts/reference-surfaces.mjs` | 0 | 固定 8 个源码文件，生成 84 组独立样本 |
| `npm run desktop:check` | 0 | 桌面 TypeScript 检查通过 |
| `npm run desktop:test` | 0 | 166/166，通过真实本地假供应商和文件/进程相关回归 |
| `npm run desktop:test:nonvisual` | 0 | 332/332，0 失败、跳过或重试；约 8.4 分钟 |
| `npm run check` | 0 | 根检查、依赖、入口、锁文件及浏览器 smoke 检查通过；Biome 未修改文件 |
| `node apps/desktop/scripts/fidelity-report.mjs --results-only` | 0 | 从本轮完整机器结果更新非视觉报告 |

完整用例及参考哈希见 [fidelity-report.md](fidelity-report.md)。自动化回归继续关闭截图、视频和 trace；人工图片为独立验收证据。运行日志中仍有 `NO_COLOR/FORCE_COLOR` 和第三方 Zod 纯注释位置提示，不影响上述退出状态。未运行根 `npm test`、发布构建或打包。

## 复现与启动

从仓库启动本轮视觉页：

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
node apps/desktop/scripts/visual-preview.mjs
```

打开终端打印的本机地址。`/app?theme=light&conversation=1` 展示示例工作台；`/reference?scene=table&theme=light` 与 `/surface?scene=table&theme=light` 分别展示来源与实现；代码块使用 `scene=code`。启动器只监听 `127.0.0.1`，依赖本地已提取的固定版本 CSS。

正常桌面开发启动无需参考归档：

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
npm run desktop:dev
```

## 尚未验证的边界

- 默认代码块合同覆盖普通文本及工具栏几何，不包含所有语言的高亮色板和图标完全一致性。语法高亮继续使用已有引擎。
- 表格合同针对普通分支，不包含原版预览、粘性表头、操作菜单和宽表实验分支；窄宿主处理是 Pi 工作台的布局适配。
- 管理表单、完整 diff 编辑器、全部动画和功能旗标仍没有完整的原版逐节点样本。本轮不生成整窗一致率。
- 历史文件编辑间歇失败本轮未复现，也没有据此认定已修复；具体限制继续记录在 [remaining-differences.md](remaining-differences.md)。
