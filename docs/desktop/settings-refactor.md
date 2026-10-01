# 设置界面重构（2026-09-30）

## 本轮范围与结果

响应“整个设置 UI 深度优化，尤其模型配置混乱”的要求。沿用 Codex 26.915.4065.0 / app 26.915.31945 已保存参考的中性色、24px 页标题、13px 控件、20px 卡片圆角和细分隔线；模型与 MCP 业务表单是 Pi 适配，不声称旧版 Codex 存在同款页面。没有修改 Satang、依赖、锁文件、供应商协议或密钥存储方式。

- 模型页从横向标签和单个长表单，改为可搜索的配置列表与详情。列表显示供应商/模型标识、默认模型和凭据状态；按名称、供应商、模型 ID 筛选。键盘方向遵循列表方向，筛选不会偷偷切换正在编辑的模型。
- 内容区域窄于 740px 时，列表变为紧凑模型选择器，保留添加入口和各模型草稿。1000px 的真实应用外壳不再被一整块模型列表挤占。
- 模型编辑先呈现连接方式、供应商或接口协议/地址/模型 ID、API Key；能力参数收进“模型能力”。思考程度保留紧凑多选控件。密钥状态仅表示保存状态，不冒充连接测试成功。
- 删除模型先确认；删除当前默认模型后选择剩余配置并维持有效默认值。只有保存才提交删除，删除最后一个后仍可添加。密钥草稿按稳定模型 ID 保留和清理。
- 保存发现其他模型有误时跳到对应编辑器、定位无效输入并保留其余分类的草稿。目录加载恢复后成功保存会清除旧错误。已有配置模式转换、失败重试、运行中偏好保存和加密密钥流程保持接通。
- 通用页按“界面与输入 / 通知与运行 / 本机工作环境 / 扩展任务能力”分组，发送方式的说明随选择变化。
- 外观页拆分主题、字体、颜色，提供只作用于预览区域的主题/字体/颜色草稿预览。保存后才应用到工作台；导入、导出、恢复默认入口保留。
- 快捷键、权限、MCP、记忆、离线语音管理页统一标题、说明和分组层级；MCP 分开连接与授权，权限页收纳长解释，记忆编辑单独保存的提示不会与全局偏好保存混淆。没有恢复聊天框中的语音入口。
- 底部保存栏区分未保存、保存中、已保存和错误状态，主按钮靠右。界面文案支持中文与英文，用户名称、路径、模型 ID 和内容保持原文。

## 主要实现

- `apps/desktop/src/renderer/src/Settings.tsx`：设置分类、草稿、错误路由和保存状态。
- `ModelSettings.tsx` / `ModelConnection.tsx`：模型列表、窄屏选择、连接/凭据/能力分层及删除确认。
- `GeneralSettings.tsx` / `AppearanceSettings.tsx` / `SettingsSection.tsx`：设置分组与局部预览。
- `McpSettings.tsx` / `MemorySettings.tsx` / `VoiceSettings.tsx`：辅助设置分组。
- `components/primitives/tabs.tsx`：可选垂直方向与筛选后的键盘入口；原横向默认保持。
- `styles/settings.css`：唯一设置样式来源；没有增加另一层覆盖样式文件。
- `apps/desktop/src/shared/settings-messages.ts`：新增类型约束双语词条。
- `test/e2e/settings.spec.ts`、`test/e2e/form-navigation.spec.ts` 及其夹具：新增模型操作/草稿/错误恢复、八类设置布局验证。

## 定向验证

全部命令从仓库根目录运行。退出码是实际结果，不把跳过、未运行或初次失败记为通过。

| 命令 | 退出码 | 证据与范围 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最终桌面类型检查；首次编辑中 JSX 闭合问题已修复 |
| `npm run desktop:test:target -- --file test/e2e/settings.spec.ts` 及下列失败/未运行范围重试 | 初次 1；最终各范围 0 | 27 个独立设置用例均取得通过证据，包含 5 个新增场景；不是一次无失败的整文件运行 |
| `npm run desktop:test:target -- settings-layout` | 0 | 5 项：深浅色 × 中英文 × 1440×940、1280×800、1000×700 × 全部 8 类设置，共 96 个分类布局状态；另含英文长自定义接口字段 |
| `npm run desktop:test:target -- --file test/e2e/form-navigation.spec.ts --grep 'settings search\|pending settings\|MCP secrets\|cancelled back navigation'` | 0 | 4 项草稿、保存中导航、语言切换、历史恢复 |
| `npm run desktop:test:target -- --file test/e2e/form-navigation.spec.ts --grep 'settings\|MCP secrets\|cancelled back navigation'` | 1 | 前 8 项通过，包括 4 项双语/主题未保存保护；后遇到旧断言未包含 provider.key 的既有 base 字段，补正后按上行重试；初次整轮保持失败记录 |
| `npm run desktop:test:target -- --file test/e2e/model-settings.nonvisual.spec.ts` | 0 | 2 项真实 Electron：模式保存、加密凭据、重启恢复、思考程度与本地假供应商调用 |
| `npm run desktop:test:target -- --file test/e2e/mcp-settings.spec.ts --grep 'MCP validates fields\|MCP secret saves\|MCP long tool names\|OAuth status failure'` | 0 | 4 项配置、凭据失败保留、长内容布局与授权状态重试 |
| `npm run desktop:test:target -- --file test/e2e/memory-settings.spec.ts --grep 'memory saves dispatch once\|memory generation keeps'` | 0 | 2 项记忆编辑保存/导航保护和生成取消 |
| `npm run desktop:test:target -- --file test/e2e/panels.spec.ts --grep 'closing a tab deselects'` | 0 | 1 项现有横向标签关闭回归 |
| `npm run desktop:test:target -- --file test/model-configuration.test.ts --file test/settings-updates.test.ts --file test/localization.test.ts` | 0 | 14 项单元：连接参数、分组更新、语言持久化和全部翻译占位符 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器验证；输出中的 fixture spawn failure 是预期故障注入 |

设置文件本轮完整的范围重试命令：

```powershell
npm run desktop:test:target -- --file test/e2e/settings.spec.ts --grep 'compact model|failed key|category nav|keyboard overrides|shortcuts can|appearance fonts|settings stay|built-in provider|custom mode|missing and invalid|legacy endpoint|unlisted models|catalog failures|mode selection|allowed thinking|reasoning choices|both connection'
npm run desktop:test:target -- --file test/e2e/settings.spec.ts --grep 'catalog failures support retry|invalid hidden'
```

前一命令 21 项通过，后一命令 2 项通过；与最终编辑后的前 6 项通过证据合并覆盖 27 项，不重复计数。其他中间的 4 项新增测试与 4 项连接重试也曾通过。第一次错误定位后旧测试仍断言停留“通用”，现改为验证自动回到出错模型且通用草稿不丢；紧凑选择器测试使用 900px 独立组件夹具，与带 240px 侧栏的 1000px 应用内容宽度匹配。

去重共 47 项浏览器 UI、14 项功能单元、2 项原生流程，另有 16 项测试选择器验证。上述范围不是整项目验收，没有运行全量桌面回归或根级全检查。原生夹具按需生成开发输出，未制作安装包。原生构建有第三方 Zod 注释位置警告，不影响退出码；没有为了消除提示更改依赖。

## 界面证据与清理

报告保存在 `.artifacts/settings-refactor/`，含初次失败与分批通过记录。仅生成 6 张必要界面图，已人工查看；不是严格像素匹配证据。

- [模型列表与详情，浅色 1440](../../.artifacts/settings-refactor/models-light-1440.png)
- [紧凑模型选择，深色 1000](../../.artifacts/settings-refactor/models-dark-1000.png)
- [自定义接口，英文深色 1280](../../.artifacts/settings-refactor/models-custom-en-dark-1280.png)
- [通用分组](../../.artifacts/settings-refactor/general-light-1440.png)
- [外观分组](../../.artifacts/settings-refactor/appearance-light-1440.png)
- [MCP 分组](../../.artifacts/settings-refactor/mcp-light-1440.png)

只在设置布局命令传入 `PI_SETTINGS_REFACTOR_EVIDENCE=1` 时保存这组图；普通定向运行不生成。沿用现有临时目录所有权与 afterAll 清理，失败运行也执行清理。

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/settings-refactor.json` 退出 0：没有本轮残留或可回收候选，仅既有 `pi-acceptance-9NrmPU` 因缺少可验证所有权而保留。没有删除用户缓存、模型或恢复快照。

## 继续开发

启动：`npm run desktop:dev`。只更新工作区源代码，不提交、不发布、不重新打包 EXE。

当前真实 Goal 查询为 active；本轮设置 UI 是进展，不等于全部 Goal 完成。原台账中 Worktree 硬退出恢复、恢复关联与多目录配置等未验收项继续保留，不能由本轮设置测试替代。
