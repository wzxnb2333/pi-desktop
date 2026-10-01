# 聊天 UI 调整与验收

日期：2026-09-30。范围为本轮截图指定的四项调整；沿用 Pi Desktop 的组件、主题与即时双语切换。

## 实际行为

1. 项目任务、独立聊天和最近任务的未读点使用蓝色圆点，固定在行右侧。短标题、长标题、悬浮操作都不改变其位置；归档和更多操作不遮挡圆点。
2. 移除消息下方常驻引用按钮。鼠标选择消息正文后出现紧凑引用菜单，可追加到主任务上下文、创建锚定该消息的只读侧聊并填入草稿，或复制选中内容。不会自动发送或覆盖已有草稿。
3. 上下文占用改为模型选择器左侧的圆环。悬浮和键盘聚焦显示当前占用、窗口上限、输入/输出/合计 token 及已有 SDK 费用；未知仍显示未知。圆环绘制限制在 0–100%，详情保留实际值。Escape 可关闭详情。
4. 聊天滚动区域延伸到工作区最右侧，独立摘要卡仍占自己的内容列；停靠工具栏打开时，滚动条位于聊天与工具栏边界。窄窗口继续使用既有叠加布局，正文与输入框不会铺到摘要卡下方。

引用通过渲染文本的源位置映射，不使用全文第一次匹配。覆盖同一句话重复出现、粗体、代码、表格、实体、转义、CRLF、代码内容与语言名称相同、未闭合代码围栏。滚动、Escape、取消选择和切换任务会收起菜单；异步引用迟到时不串草稿或抢新任务焦点。主进程 IPC 与权限契约保持现有实现。

## 关键文件

- `apps/desktop/src/renderer/src/components/sidebar/sidebar.tsx`、`styles/sidebar.css`：未读点和行操作布局。
- `apps/desktop/src/renderer/src/components/composer/selection-quote.tsx`、`lib/markdown-selection.ts`：选文菜单、源位置与草稿动作；替换旧 `quote-message.tsx`。
- `apps/desktop/src/renderer/src/components/composer/context-usage.tsx`、`components/primitives/tooltip.tsx`：上下文圆环、详情与 Escape。
- `apps/desktop/src/renderer/src/components/timeline/message.tsx`、`timeline.tsx`、`message-actions.tsx`：渲染源位置、菜单挂载和移除旧入口。
- `apps/desktop/src/renderer/src/styles/satang-workspace.css`、`task-summary.css`：滚动区域与摘要层级。
- `apps/desktop/test/e2e/conversation-ui.spec.ts`、`fixtures/conversation-ui-harness.tsx`：定向 UI；`composer-enhancements.nonvisual.spec.ts`：真实 Electron；`reference.spec.ts`：既有上下文回归适配。
- `scripts/desktop-test-targets.mjs`、`apps/desktop/playwright.nonvisual.config.ts`：最小测试入口。

## 本轮实际验证

下列命令均已执行并最终退出 0。先运行十项 UI，新增代码边界用例后仅重跑相关两项，得到十一项不重复的本模块 UI 证据；没有把同一用例重复运行累加。

| 命令 | 结果 | 报告 |
| --- | --- | --- |
| `npm run desktop:check` | 最后一次代码修改后通过 | 本轮命令输出 |
| `npm run desktop:test:target -- conversation-ui` | 初始 10 项 UI 通过 | `.artifacts/conversation-ui/ui.json` |
| `npm run desktop:test:target -- --file test/e2e/conversation-ui.spec.ts --grep 'code selection\|rendered selection'` | 新增边界与引用源位置 2 项通过 | `.artifacts/conversation-ui/quote-source.json` |
| `npm run desktop:test:target -- conversation-ui --level native` | 2 项真实 IPC/选文/侧聊草稿/发送流程 | `.artifacts/conversation-ui/native.json` |
| `npm run desktop:test:target -- toolbar` | 6 项单元 + 2 项 UI；摘要与工具面板共存 | `.artifacts/conversation-ui/layout.json` |
| `npm run desktop:test:target -- --file test/e2e/sidebar.spec.ts --grep 'row actions\|archiving and restoring'` | 2 项行操作和归档回归 | `.artifacts/conversation-ui/sidebar.json` |
| `npm run desktop:test:target -- --file test/e2e/reference.spec.ts --grep 'model setup\|long project\|docked review'` | 5 项模型/窄屏/停靠面板回归 | `.artifacts/conversation-ui/responsive.json` |
| `npm run desktop:test:target -- --file test/e2e/message-rendering.nonvisual.spec.ts --grep '1000 turns retain\|code and wide tables stay local: light zh-CN 1000'` | 2 项千轮消息/选择/代码与表格回归 | `.artifacts/conversation-ui/markdown.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 16 项测试选择器检查通过 | 本轮命令输出 |

合计不重复：22 项 UI、2 项原生流程、6 项布局单元、16 项选择器检查。原生模型使用本地假供应商，没有请求真实模型账号。源位置修复后保留原生纯文本证据，只重跑受影响的 Markdown 场景。

另在 `apps/desktop` 目录临时设置 `PI_DESKTOP_CAPTURE=1`，执行 `node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts conversation-ui.spec.ts --grep 'chrome.*1440' --workers=1 --retries=0 --reporter=list`，2 项退出 0；随后删除该环境变量。仅保留 [浅色](../../.artifacts/conversation-ui/light.png) 与 [深色](../../.artifacts/conversation-ui/dark.png) 两张 1440×940 图并人工核对。常规定向脚本仍关闭图片、视频和 trace。

布局断言覆盖中英文、深浅主题与 1000×700、1280×800、1440×940；摘要/工具面板关联场景同时覆盖更宽窗口。图片为本地测试数据，正文保持原文；不声称全产品或逐像素验收。

初次运行定位到悬浮详情的 Escape 未关闭和代码/CRLF 源位置问题，已修复并重跑受影响用例。夹具缺少必填思考字段、供应商多余字段及滚动内容不足也已纠正；这些失败运行不计为通过。

## 临时目录与启动

UI 与 Electron 测试均使用现有临时目录所有权机制，并在结束时验证清理。最终执行：

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/conversation-ui.json`

退出 0，`eligible=0`、`skipped=1`；仅此前的 `pi-acceptance-9NrmPU` 被跳过，没有新增本轮测试目录残留，也没有删除该旧目录。只保留上述少量证据，没有运行全套桌面测试、提交、发布或制作 EXE。

仓库根目录启动开发模式：`npm run desktop:dev`。
