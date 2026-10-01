# MCP 与插件管理：失败恢复接续记录

日期：2026-09-29（Asia/Shanghai）。属于持续 Goal 的 G-UX-03；不表示整体 Goal 完成。

## 实现

- OAuth 状态读取失败提供独立的只读重试，不触发保存、登录或授权。重试期间保留键盘焦点，成功移除重试按钮后在 DOM 更新完成时恢复到登录入口，避免依赖绘制时序。
- OAuth 登录、刷新及撤销使用同步请求锁；取消有独立请求锁和失败重试。选取仍在运行的操作优先于较新失败记录，不再隐藏旧登录的取消入口。
- 插件安装、文件选择、更新、目录源读取与移除共用同步请求锁；原生选择器取消不发起安装。失败保留当前安装版本、目录源条目和再次操作入口。
- 插件历史只裁剪已结束记录，运行中记录无论距今多少条都可见、可取消。连续取消只发送一次，失败可重试。
- MCP 工具策略的发现和保存使用同步请求锁；返回空值明确提示取消，错误格式转换为简短错误信息。保存失败保留规则，错误通过 alert 语义播报。
- 服务配置、凭证草稿改变或组件移除后，之前的工具发现响应不再应用；配置改变清除该次发现的工具，保留用户规则与既有任务历史工具。凭证仅通过编辑修订号使请求失效，没有复制到 DOM 或扩大 IPC 内容。
- 不改变 OAuth 主进程凭证保管、插件信任流程、工具策略权限上限及运行中任务配置隔离。

## 实际失败复现

保留每次退出码 1 的选择记录于 `.artifacts/mcp-plugin-recovery/`，没有把失败运行改写成通过：

| 报告 | 修复前观察 |
| --- | --- |
| red-oauth-status.json | 授权状态读取失败后找不到只读重试入口 |
| red-oauth-repeat.json | 重复登录点击提前释放禁用状态 |
| red-oauth-active-cancel.json | 较新失败记录掩盖还在运行的授权及取消按钮 |
| red-plugin-repeat.json | 连续更新发出两个启动请求 |
| red-plugin-picker.json | 连续安装点击重复打开原生文件选择器 |
| red-plugin-active-cancel.json | 较早运行中的操作被最近十条记录裁掉 |
| red-policy-repeat.json | 重复读取工具导致请求未完成但按钮已恢复可用 |
| red-policy-stale.json | 改动服务命令后仍保留旧发现工具 |
| red-policy-cancelled.json | 取消读取后没有状态说明 |
| red-oauth-focus-timing.json | 一次组合回归中成功重试未恢复键盘焦点；改为提交后的 effect 后通过 |

新增插件测试最初因为未登记到 Playwright testMatch 而没有执行，补齐登记后才取得上述真实失败和通过证据；没有将“未找到测试”算作产品缺陷。

## 验证命令与证据

以下命令均在仓库根目录执行，退出码均为 0。重复执行的相同案例只计一次，共 26 项产品相关验证，另有 16 项测试选择器验证。

| 命令 | 结果 | 报告 |
| --- | --- | --- |
| `npm run desktop:check` | 桌面类型检查通过 | 本轮终端完整输出 |
| `npm run desktop:test:target -- --file test/e2e/mcp-settings.spec.ts` | 11 项 UI 通过 | `.artifacts/mcp-plugin-recovery/mcp-ui.json` |
| `npm run desktop:test:target -- --file test/e2e/plugin-management.spec.ts` | 5 项 UI 通过 | `.artifacts/mcp-plugin-recovery/plugin-ui.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-oauth.nonvisual.spec.ts` | 2 项原生流程通过 | `.artifacts/mcp-plugin-recovery/oauth-native.json` |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts` | 2 项原生流程通过 | `.artifacts/mcp-plugin-recovery/plugin-native.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-policies.nonvisual.spec.ts` | 1 项原生流程通过 | `.artifacts/mcp-plugin-recovery/policies-native.json` |
| `npm run desktop:test:target -- --file test/localization.test.ts --file test/mcp-tool-policy.test.ts` | 5 项单元测试通过 | `.artifacts/mcp-plugin-recovery/unit.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 16 项选择器验证通过 | 本轮终端完整输出 |

真实 Electron 流程覆盖本地 OAuth/MCP 协议、令牌加密与失效刷新、取消和重启恢复；测试插件覆盖授权、候选更新、真实工具回退和目录源持久化；工具策略覆盖运行隔离、任务审批与重启恢复。对话模型使用本地假供应商，未调用真实账户。

后续只改管理界面时可使用 `npm run desktop:test:target -- plugins --level ui`、`npm run desktop:test:target -- oauth --level ui` 或 `npm run desktop:test:target -- mcp --level ui`。这些入口不会自动启动 Electron；原生层需明确选择 `--level native`。注册表已有路径、分层、过滤器和去重验证。

## 清理及边界

- 新 UI fixture 使用既有 `mkdtemp` 所有权封装与 `cleanupTemporaryDirectories`，失败重现及通过运行均走同一清理。原生回归另断言 storage 已移除。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/mcp-plugin-recovery.json` 退出 0；扫描及可清理候选均为 0，没有执行批量删除。
- 常规运行关闭截图、视频和 trace。只保留小型定向报告；未增加依赖、改动锁文件或执行安装包制作。
- 未执行全套检查、完整桌面回归或像素验收。原生开发构建输出的已有 Zod 注释和 NO_COLOR 提示未影响退出码；未为消除第三方构建提示而改依赖。
- 其他管理页面、真实第三方账号组合和完整长期运行仍需按台账继续复核；本轮结果不代替这些验证。
