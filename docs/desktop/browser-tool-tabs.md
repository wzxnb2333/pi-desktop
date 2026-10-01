# 浏览器与统一工具标签验收

日期：2026-09-28。开发模式交付，沿用 Codex 26.915 参考及 Pi 品牌；未提交、发布或制作安装包。

## 本轮功能

- 辅助面板统一使用工具/网页标签栏。项目与任务导航保持原有职责。
- “+”打开新标签页：可输入网址，或选择审查、终端、侧聊、文件。入口连接现有真实服务；审查仍需主动运行。
- 每个标签都有自己的关闭按钮，鼠标悬停或键盘焦点进入时显示；触控设备常显。鼠标中键关闭对应标签。关闭非当前标签不改变当前选择，关闭当前标签选择相邻标签。
- 网页标签和工具标签保持混合顺序并持久化；旧状态按需补齐。旧终端打开请求会确认并保存，避免隐藏面板后被旧状态重新打开。
- 工具页内继续使用已有文件和终端会话标签。关闭工具标签不终止终端进程；终止进程仍使用明确的终止操作。
- 浏览器菜单和其他 DOM 弹层显示时，保留原生网页的当前画面；关闭弹层恢复同一个网页，不重新加载或清除输入。
- 修复窄终端查找反馈换行导致终端重排、搜索选区消失的问题。

## 实现入口

| 文件 | 内容 |
| --- | --- |
| apps/desktop/src/shared/panel-tabs.ts | 标签顺序、选择、旧状态及主进程终端请求适配 |
| apps/desktop/src/shared/contracts.ts | 标签状态与网页遮挡/画面事件校验 |
| apps/desktop/src/renderer/src/state/app.tsx | 稀疏持久化、状态确认、终端导航 |
| apps/desktop/src/renderer/src/components/panels/review-panel.tsx | 统一标签、新标签工具入口、关闭与相邻选择 |
| apps/desktop/src/renderer/src/components/primitives/tabs.tsx | 独立关闭、中键关闭、键盘导航 |
| apps/desktop/src/renderer/src/components/panels/preview-panel.tsx | 网页挂载、弹层遮挡及画面恢复 |
| apps/desktop/src/main/preview.ts | 原生网页画面保留及异步生命周期校验 |
| apps/desktop/src/renderer/src/styles/workspace-tabs.css | 紧凑标签、左对齐工具列表、窄终端布局 |

## 实际验证

以下命令从仓库根目录运行。涉及的新增/修改测试均已实际执行。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 最终样式调整后再次通过类型检查 |
| node --test apps/desktop/test/panel-tabs.test.ts apps/desktop/test/browser-workbench.test.ts apps/desktop/test/ui-patches.test.ts apps/desktop/test/layout.test.ts | 0 | 18/18 |
| npm run desktop:test:nonvisual -- browser.nonvisual.spec.ts terminal.nonvisual.spec.ts project-actions.nonvisual.spec.ts workbench.nonvisual.spec.ts panels.spec.ts | 0 | 32/32 |
| npm run desktop:test:nonvisual -- reference.spec.ts -g "combined wide" | 0 | 1/1；确认隐藏终端后不会被旧状态重新打开 |
| npm run desktop:test:nonvisual -- browser.nonvisual.spec.ts -g "launcher and mixed" | 0 | 最终左对齐调整后通过；深浅主题 × 中英文 × 1000×700、1280×800、1440×940 |
| node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/browser-tool-tabs/cache-audit.json | 0 | 扫描到的匹配测试临时目录为 0，无需执行删除 |

32 项回归覆盖真实浏览器菜单、原生输入保留、网页查找、地址草稿、多窗口、关闭与恢复、工具顺序重启恢复、终端进程与输出、项目动作、文件编辑保护、会话草稿等。新增主进程侧聊回归确认：从终端创建侧聊后不会被旧终端标志抢回焦点。

本轮早期的较大范围检查及修复记录：

- 浏览器/终端首轮 14 项：12 通过、2 项终端查找失败；修复搜索状态高度变化后，最新 32 项中的全部 3 项终端测试通过。
- 文件/审查/工作台/项目动作首轮 36 项：34 通过、2 项旧文件标签丢失；补齐旧标签状态后，后续文件编辑器 11 项全部通过。
- 文件编辑器/面板/参考布局/Satang/终端后续 86 项：85 通过、1 项隐藏面板后重开；持久化状态确认后，针对该失败项重跑通过。其余 85 项包含文件编辑器 11 项、面板 8 项及原有参考布局检查；未将最初失败的整次运行改写为全通过。
- 最终只追加了工具列表左对齐样式及对应布局断言，并重跑该主题、语言与尺寸矩阵。没有宣称执行整个桌面测试全集或外部真实账号联调。

## 证据与缓存

- .artifacts/browser-tool-tabs/browser-tools-results.json：最新 32 项回归结果。
- .artifacts/browser-tool-tabs/launcher-matrix-results.json：最终布局矩阵结果。
- .artifacts/browser-tool-tabs/browser-menu.png：菜单打开时页面内容仍然可见。
- .artifacts/browser-tool-tabs/launcher-light-zh-CN.png：浅色中文工具入口。
- .artifacts/browser-tool-tabs/launcher-dark-en-US.png：深色英文工具入口。
- .artifacts/browser-tool-tabs/cache-audit.json：测试临时目录核对结果。
- 较早的失败证据保留于 .artifacts/browser-tabs-results.json、.artifacts/browser-tools-dependent-results.json、.artifacts/browser-tool-tabs-layout-first-results.json。

网页弹层后方使用当前帧的内存图像；弹层关闭后恢复原生交互。该图像不写入磁盘缓存。视觉证据仅在 PI_DESKTOP_CAPTURE=1 时生成，本轮保留上述 3 张图，不默认生成每个矩阵场景的截图、视频或 trace。

启动开发模式：npm run desktop:dev。

## 接续迭代：键盘入口与焦点恢复

本轮从实际缺口开始：浏览器新标签和审查只能通过鼠标打开；网页聚焦时应用的 DOM 键盘监听无法收到按键；关闭被聚焦的标签按钮后焦点落到正文。当前持续 Goal 的台账见 [接续迭代](ongoing-iteration.md)，本节完成不代表整体 Goal 完成。

参考来源：只读 `E:/AI_collection/satang_code/src/renderer/src/surfaces/palette/commands.ts` 中的 26.915 捕获说明，Open browser tab 对应 #1564 / Ctrl+T，Open review tab 对应 #1588 / Ctrl+Shift+G。新增辅助栏关闭与循环切换是 Pi 的体验适配，不冒充旧版像素证据。

实现：

- `shared/shortcuts.ts` 增加浏览器/审查命令，以及仅在辅助栏生效的关闭和循环切换快捷键；现有设置直接显示这些命令，支持中文、英文、冲突提示和自定义保存。
- `renderer/src/hooks/use-panel-actions.ts` 为鼠标、命令面板、渲染器快捷键和原生网页事件共用一份操作状态。按任务防止并发重复操作，异步回执写回原任务；新建、关闭失败保留原标签与草稿。
- `renderer/src/components/shell/commands.tsx` 连接真实服务并恢复地址输入框或选中标签的焦点。打开审查不会自动开始审查，组合输入、自动重复及弹层保留原有处理。
- `main/preview.ts` 接收原生网页的真实按键，核对当前选中、可见、聚焦的网页；通过受校验的 `panel.command` 事件定向发送到所属窗口。网页 DOM 事件不能直接调用此接口。
- `renderer/src/components/primitives/tabs.tsx` 在聚焦的关闭按钮被移除后恢复选中标签焦点。鼠标关闭后台标签时不抢走输入区焦点。关闭工具标签继续保留底层终端进程。

本轮实际验证（仓库根目录执行）：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最终桌面类型检查 |
| `npm run desktop:test:target -- --file test/panel-commands.test.ts --file test/browser-workbench.test.ts` | 0 | 10 项通过：快捷键、作用域冲突、事件校验及既有浏览器逻辑 |
| `npm run desktop:test:target -- --file test/localization.test.ts --file test/panel-tabs.test.ts` | 0 | 8 项通过：双语、旧状态、混合标签与导航 |
| `npm run desktop:test:target -- --file test/e2e/panels.spec.ts` | 0 | 当时的 9 项通过：终端状态、面板生命周期、异步新标签、shell 按键保护 |
| `npm run desktop:test:target -- --file test/e2e/panels.spec.ts --grep 'failed browser close'` | 0 | 后增的 1 项通过：关闭失败保留标签、地址草稿并解锁控件 |
| `npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'panel commands'` | 1 | 修复初始化问题后第 1 项通过；第 2 项遇到测试选择器不唯一，第 3 项未运行 |
| `npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'panel commands from\|panel commands stay'` | 0 | 修正选择器并等待语言生效后，余下 2 项通过；覆盖真实网页按键、设置与重启、IME 标志、菜单遮挡及窗口归属 |
| `npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'each tab closes\|tool tabs share'` | 0 | 既有鼠标关闭、混合顺序、终端保留及重启 2 项通过 |
| `npm run desktop:test:target -- --file test/e2e/search.nonvisual.spec.ts --grep 'command palette navigates'` | 0 | 既有任务导航、自定义快捷键与恢复标签 1 项通过 |

本轮共 34 项不同用例取得通过证据，没有跑全套。过程中还修正了：缺省快捷键的 TypeScript 类型错误；控制器移到工作台后提前创建隐藏“变更”标签；关闭失败测试未先悬停便点击隐藏关闭按钮。最后一项按真实交互补上悬停，并将该测试超时收紧到 30 秒，重跑 1.5 秒通过。没有用增加超时或跳过断言掩盖失败。

定向运行记录保存在 `.artifacts/browser-tool-tabs/keyboard-native-followup.json`、`keyboard-panels.json`、`keyboard-unit-state.json`、`keyboard-existing-tabs.json`、`keyboard-failure-recovery.json` 和 `keyboard-palette.json`。本轮不生成截图、视频或 trace。使用本地网页和假供应商；组合输入标志验证不代替真实 Windows 输入法驱动验证。

最终 `npm run desktop:check` 退出 0。测试结束后执行 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/keyboard-tabs-pass.json`，退出 0，匹配的测试临时目录为 0，没有删除其他目录。本轮未改依赖、锁文件或根级检查入口，没有提交、发布或制作 EXE。
