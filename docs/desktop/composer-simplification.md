# 输入区精简：2026-09-27

按本轮用户提供的 Codex 截图调整真实 Pi 输入区，保留已有样式、IPC、草稿及权限流程。没有变更 Satang，也没有提交、发布或打包 EXE。

## 实际入口

- 默认操作行：左侧 `+`、执行策略；右侧合并的模型与思考级别、发送。移除独立 `@`、`/`、听写、语音对话及朗读按钮。
- 输入 `/` 就地显示可用命令与已启用技能；`/plan` 开关计划模式，不发送消息。开启后才显示可关闭的计划状态。
- 输入 `@` 选择当前项目目录中的文件、文件夹、技能或工具；可输入相对目录，也可进入完整的项目文件选择器。选中项成为已有的结构化上下文引用。
- 建议可用上下键、回车、Escape 操作；焦点保持在输入框，支持中文输入法。只移除选中的触发片段，保留其余草稿、附件和引用。
- 点击合并选择器先调整当前模型允许的思考档位，点击其中的模型名称进入模型列表。变更仍通过真实 `thread.update` 保存。
- `+` 菜单提供附件、文件与文件夹、技能、工具、计划模式和 Worktree；运行中保留引导/排队及停止操作。
- 语音 UI 为暂时下线：不挂载 VoiceLayer、不请求麦克风、不自动启动语音；服务、模型文件与设置保留。普通文字聊天、侧聊不受此调整影响。

## 验证

本轮使用本地假供应商和测试目录，不访问真实模型账号。检查结果如下，退出码均为 0：

| 检查 | 实际结果 |
| --- | --- |
| `npm run desktop:check` | 类型检查通过 |
| `npm run desktop:build` | 开发资源构建通过；保留现有上游 Zod 注释和 Lucide `use client` 警告，未制作 EXE |
| 单元测试 | 25/25：触发片段、可配置按键、快捷键冲突以及既有文件/终端/浏览器作用域 |
| Chromium 定向回归 | 61/61：输入区、共享菜单、参考外壳及窄窗 |
| Electron 定向回归 | 48/48：草稿/附件/引用重启恢复、真实上下文发送、模型档位、IME、队列、任务窗口、语音入口下线和保留服务 |
| 最后样式与 Tab 焦点修整后复测 | Chromium 26/26、Electron 5/5；中英 × 深浅主题 × 1440×940/1000×700/1280×800，file:// 本地构建通过 |

首次 Chromium 回归为 24/26：测试替身未持久化 UI 草稿，且失败注入没有考虑 StrictMode 的双次挂载。修正替身的真实状态回显和失败注入后通过全部场景；未跳过失败用例。视觉检查发现建议行被基础按钮样式居中，随后改为左对齐，并将能力滑块调整为胶囊轨道。

执行命令（测试在 `apps/desktop` 下）：

```powershell
node --import tsx --test test/composer-trigger.test.ts test/quick-shortcut.test.ts test/appearance.test.ts test/browser-workbench.test.ts test/file-tree.test.ts test/terminal-workbench.test.ts
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts composer.spec.ts primitives.spec.ts reference.spec.ts --reporter=list
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts acceptance.spec.ts model-settings.nonvisual.spec.ts workbench.nonvisual.spec.ts voice.nonvisual.spec.ts final-ui.nonvisual.spec.ts --reporter=list
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts composer.spec.ts primitives.spec.ts --reporter=list
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts final-ui.nonvisual.spec.ts model-settings.nonvisual.spec.ts --reporter=list
```

日志：`.artifacts/composer-native-validation.log`、`.artifacts/composer-final-ui-validation.log`、`.artifacts/composer-build.log`。本轮没有依赖/锁文件/共享包/检查入口变更，没有重跑根检查或历史 479 项完整回归；历史数量不计入本轮结果。

原生实现图仅保存三张，手工检查过布局、对齐和控件层级，不声明严格像素一致：

- [精简输入区](../../.artifacts/composer-compact/composer-dark.png)
- [输入命令建议](../../.artifacts/composer-compact/slash-menu-dark.png)
- [合并模型与能力](../../.artifacts/composer-compact/model-effort-dark.png)

临时目录核验：`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/composer-temp-audit.json`，退出 0，扫描到的 Pi 测试遗留目录为 0；无跳过、无清理失败，未删除持久语音模型。普通测试未开启截图、视频或 trace。

## 开发启动

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
npm run desktop:dev
```
