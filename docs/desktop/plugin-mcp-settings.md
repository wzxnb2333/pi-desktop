# 插件 MCP 连接配置

持续 Goal 的 G-UX-04 接续项。此前插件卡片只有 OAuth 和工具策略，没有环境变量/请求头的用户配置入口；首次 UI 回归实际找不到凭据表单，退出 1，证据为 `.artifacts/plugin-mcp-settings/ui-red.json`。本轮补齐该流程，不代表整体 Goal 完成。

## 可操作流程

- 在「Skills 与扩展 → 插件管理」中，每个已授权插件服务按名称及实际目标分组；连接凭据默认折叠。键值逐行输入、密码框遮蔽、添加/移除、保存、刷新状态和确认清除均连接真实 IPC。
- stdio 使用环境变量，HTTP 使用请求头。保存替换该服务的整组凭据，完全空白的表单不会保存；带名称的空值是明确的空字符串。保存后清空界面草稿，不回显或读取已有密钥。
- 新增受校验的 `mcp.secretStatus`，仅返回是否已配置；读写均检查有效插件配置和基线。未授权插件不能借此配置服务，过期配置不能读取新目标的状态或覆盖其密钥。清除删除当前服务的密文记录，不影响其他服务或 OAuth。
- 表单和运行时复用同一插件路径解析，支持 `{pluginRoot}`。新增名称、重复项、长度及控制字符校验；错误不包含用户输入的密钥值。
- 读取状态和保存去重，失败保留草稿；迟到状态读取不能覆盖刚保存的结果。切换语言立即翻译应用错误，字段原文保留。
- 搜索隐藏卡片时保留组件及草稿。导航、停用、切换已启用版本和卸载检查未保存草稿；保存期间阻止这些本地操作，明确放弃后清除草稿。准备候选更新不清空凭据草稿。
- 连接配置改变时保留草稿，显示冲突并要求核对当前目标；已有清除确认框失效关闭，不把旧确认用于新连接。
- 使用已有折叠控件、按钮、确认对话框和主题 token；输入框 32px、图标 14px，无新增常驻工具栏按钮。该服务表单是 Pi 功能适配，不声称有同版 Codex 的逐像素参考。

## 验证

从仓库根目录执行。案例去重共 14 项单元、11 项 UI、2 项原生流程取得通过证据；UI 中 5 项既有管理回归来自一次整体失败运行中的逐项通过结果，不把该整次运行记为通过。最终六项凭据 UI 定向运行全部通过。

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/mcp-configuration.test.ts apps/desktop/test/plugins.test.ts apps/desktop/test/localization.test.ts` | 退出 0，14 项通过 | 本轮完整终端输出 |
| `npm run desktop:test:target -- --file test/e2e/plugin-management.spec.ts` | 退出 1，6 项通过、筛选隐藏用例失败、2 项未运行 | `.artifacts/plugin-mcp-settings/ui-filter-failure.json` |
| `npm run desktop:test:target -- --file test/e2e/plugin-management.spec.ts --grep 'plugin credential'` | 首轮退出 1：2 项通过、尺寸用例失败、1 项未运行；修复后退出 0，4 项通过 | `ui-sizing-failure.json`、`ui-credentials-green.json`，位于同一证据目录 |
| `npm run desktop:test:target -- --file test/e2e/plugin-management.spec.ts --grep 'credential'` | 退出 0，最终 6 项通过 | `.artifacts/plugin-mcp-settings/ui-final-green.json` |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts --grep 'plugin credential forms'` | 退出 0，1 项完整原生流程通过；补充未授权和过期配置检查后再通过 | `.artifacts/plugin-mcp-settings/native-final-green.json` |
| `npm run desktop:test:target -- --file test/e2e/settings-persistence.nonvisual.spec.ts --grep 'changing an MCP target'` | 退出 0，1 项基础凭据回归通过 | `.artifacts/plugin-mcp-settings/settings-regression-green.json` |
| `npm run desktop:check` | 最终退出 0 | 本轮完整终端输出 |
| `node --import tsx --test --test-name-pattern 'every translation' apps/desktop/test/localization.test.ts` | 退出 0，最终翻译参数检查通过；已计入 14 项单元 | 本轮完整终端输出 |

原生流程实际从表单保存两种凭据，通过 SDK 连接本地 stdio/HTTP 服务、发现并调用真实测试工具，确认密文落盘和重启恢复；清除一个服务后，该服务连接拒绝且另一个服务仍保留凭据。未使用真实账号、网络供应商或付费模型。

UI 验证包括默认密码类型、重复操作、保存/清除失败重试、搜索与导航草稿保护、配置冲突、过期确认框及状态读取竞态。深浅主题 × 中英文 × 1440×940、1280×800、1000×700 检查控件尺寸及无横向溢出；这是 DOM 布局验证，不是截图或逐像素验收。

失败记录保留：筛选卡片的 hidden 被原有显示样式覆盖，补充局部隐藏规则；原始输入高度为 37px，改用现有 32px token。初次类型检查中反馈类型过宽导致翻译参数错误，缩窄为实际两种状态后最终检查通过。没有以修改测试阈值掩盖尺寸问题。

## 缓存与后续

- 原生夹具结束后断言自有存储目录已删除；UI 复用所有权清理。最终 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/plugin-mcp-settings.json` 退出 0，候选残留 0，没有批量删除。
- 沿用已有 plugins/mcp 定向入口，无依赖、锁文件或测试选择器变更。未运行全套检查/回归、生成整套截图/视频/trace、提交、发布或制作 EXE。启动仍为 `npm run desktop:dev`。
- 下一项是 MCP 连接测试的长操作取消和配置变化保护：当前 `mcp.test` 在用户确认后直接等待连接/发现，没有独立操作标识和取消入口。该缺口已从当前主进程及工具策略组件确认，尚未补齐，不算验收通过。
