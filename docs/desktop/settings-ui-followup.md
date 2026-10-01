# 设置页布局与 UI 修正

日期：2026-09-27。承接用户“设置方面的布局与 UI 还原度较低”的反馈；以布局、层级和使用体验为本轮验收重点，不恢复严格像素门槛。

## 本轮调整

- 移除设置内容区重复的工具栏和通用“设置”标题，页标题显示当前分类。
- 左侧改为个人、集成、编码三组，使用统一图标、圆角搜索框和整行选中背景。分类拆为通用、外观、键盘快捷键、MCP、模型、审批与信任。
- 内容采用居中 768px 上限、同版标题起点与章节间距。宽度随窗口变化，侧栏仍可拖动并保存。
- 卡片统一 20px 圆角、细边框及深浅主题背景；移除模型和 MCP 表单的重复内层卡片。
- 下拉控件缩为 28px 高，开关采用 32×20px 胶囊形状，保留原生键盘和辅助技术语义。字段标题 13px、说明 12px，采用同版 DOM 的排版值。
- 快捷键列表改为左侧操作名、右侧按键字段。保存栏在长页贴合窗口底部，不再露出下方穿透的表单内容。
- 搜索支持设置项关键词；切换分类回到该页顶部。语言切换不重置当前分类、草稿或阅读位置。API Key、MCP 密钥、快捷键和其他未保存设置仍共享原有保存与离开保护逻辑。
- 设置样式统一由 settings.css 管理；移除 satang-surfaces.css 和 index.css 中重复的设置布局覆盖。

## 参考与范围

固定参考：Codex 26.915.4065.0 / app 26.915.31945，E:/AI_collection/satang_code 只读。

有效截图、DOM 及来源哈希见 [参考清单](codex-26915-reference-manifest.json) 和 [设置计算样式](satang-surfaces-reference.json)。开关尺寸与颜色另核验同版 settings/dark2/1440x940.dom-styles.json 的节点 686–688、696–698。

只展示 Pi 真实提供的设置。模型、MCP 等没有同场景截图的界面采用同版组件规范，记录为适配；没有复制 Codex 的账号、计费等占位功能。显式“保存设置”流程也属于 Pi 适配。

## 视觉证据

[查看前后对照与全部截图](../../.artifacts/settings-ui-followup/gallery.html)

- 6 类设置 × 深浅主题 × 简体中文/English × 1440×940、1280×800、1000×700，共 72 张当前实现截图。
- 通用页面可查看同版参考、调整前和调整后。中文沿用同一组件布局；1280×800 没有同尺寸参考。
- 保留旧截图于 .artifacts/settings-ui-followup/before；原始大图库中的设置截图仍是调整前基线。
- 已目视检查通用、模型、MCP、快捷键页面；矩阵自动检查所有分类的标题、导航、卡片颜色与圆角、控件边界、横向溢出和长页底部保存栏。
- [图库完整性](../../.artifacts/settings-ui-followup/gallery-validation.json)：72 组切换全部加载成功，没有图片缺失或页面异常。

## 验证记录

| 验证 | 退出码 | 本轮结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 最终源码类型检查通过 |
| settings、form-navigation、reference、satang（匹配含 mcp-settings） | 0 | 100 / 100 通过 |
| 最终字体、开关颜色及底栏修正后的 settings、form-navigation（含 mcp-settings） | 0 | 36 / 36 通过；重新生成 72 张截图 |
| Electron 原生 desktop、browser、terminal、file-navigation、localization、model-settings | 1，随后定位修复 | 首轮 26 / 27；页面和导航共用 data-category 导致语言用例选择器不唯一，已把页面标识改为 data-settings-category |
| 修正后完整 localization 原生文件 | 0 | 4 / 4 通过，覆盖立即切换、草稿、流式输出、阅读位置、原生弹窗及真正退出重启 |
| 图库切换校验 | 0 | 72 组，errors 为空 |

原生范围内的 27 个不同用例均获得本轮通过证据：语言文件修复后重新执行，其余 23 个沿用本轮成功结果。36 项最终设置测试与 100 项 UI 测试有重叠，不重复计数。未执行全仓或完整桌面回归，未改依赖、锁文件或检查入口。

运行日志：[类型检查](../../.artifacts/settings-ui-followup/desktop-check.log)、[100 项 UI 回归](../../.artifacts/settings-ui-followup/browser-tests.log)、[36 项最终设置回归](../../.artifacts/settings-ui-followup/final-settings-tests.log)、[原生首轮与失败诊断](../../.artifacts/settings-ui-followup/native-tests.log)、[修正后语言回归](../../.artifacts/settings-ui-followup/locale-tests.log)。测试仅使用本地假供应商、临时配置和测试项目。开发工具输出既有的 NO_COLOR 和 Rollup 注释提示，未修改第三方依赖。

复现命令，在项目根目录：

~~~powershell
npm run desktop:check
Set-Location 'E:/AI_collection/Pi desktop/apps/desktop'
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts settings.spec.ts form-navigation.spec.ts satang.spec.ts reference.spec.ts
node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts desktop.nonvisual.spec.ts browser.nonvisual.spec.ts terminal.nonvisual.spec.ts file-navigation.nonvisual.spec.ts localization.nonvisual.spec.ts model-settings.nonvisual.spec.ts
~~~

## 开发模式查看

~~~powershell
& 'E:/AI_collection/Pi desktop/Start Pi Desktop.cmd' -Dev
~~~

此次不提交、不发布、不重新打包 EXE。使用开发模式查看当前源码，普通启动仍可能打开既有 EXE。

## 接续迭代：设置分组保存（2026-09-29）

复现：模型目录加载失败时，修改外观并点击保存，会被无关的模型校验挡住。原来每次保存都会重新校验全部模型，即使本次 patch 只有 theme。

修正：在其他分类保存且模型配置未改动时，不再要求重载内置模型目录。显式保存模型页、或任意分类下存在未保存模型改动时，仍执行原模型校验；不丢弃用户尚未修复的模型草稿，不偷偷部分提交。主进程校验、分组并发冲突检查及凭据单独写入保持原有路径。

新增受控故障回归实际验证：目录失败 → 任务运行中修改主题 → 只发送 theme patch → 重新载入仍为新主题 → 修改模型后转到通用页 → 校验失败并完整保留两处草稿。

| 本轮验证 | 退出码 | 结果 | 证据 |
| --- | --- | --- | --- |
| `npm run desktop:check` | 0 | 桌面类型检查 | 本轮工具输出 |
| 设置定向 UI，完整命令见下方 | 0 | 9 项：新增故障回归、目录重试、自定义配置校验、凭据失败重试、运行中保存、外观恢复 | `.artifacts/settings-group-save/settings-ui.json` |
| `npm run desktop:test:target -- --file test/settings-updates.test.ts` | 0 | 3 项：差量字段、并发冲突、可选设置首次写入 | `.artifacts/settings-group-save/settings-unit.json` |

~~~powershell
npm run desktop:test:target -- --file test/e2e/settings.spec.ts --grep 'catalog failures|unlisted models|missing and invalid|failed key saves|provider key drafts|settings stay editable|appearance fonts|built-in provider changes'
~~~

初次故障复现退出 1，证据为 `.artifacts/settings-group-save/red-unrelated-preferences.json`；修复后该用例及相邻验证退出 0。UI 使用真实 Settings 组件和受控 IPC 故障，不声称本轮进行了真实账号接入。没有全量回归、发布或 EXE；持续 Goal 未完成，MCP/插件管理的完整失败恢复流程仍待下一轮复核。
