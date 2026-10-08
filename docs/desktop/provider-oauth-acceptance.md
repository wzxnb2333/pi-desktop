# 模型提供商 OAuth 验收

## SDK 声明的能力

以下清单根据仓库锁定的 `@earendil-works/pi-ai` 0.86.1 provider 声明整理，描述 SDK 暴露的认证能力，不代表已用真实账号登录或验证订阅权益。

| SDK provider | API Key | OAuth | 订阅认证 | OAuth 显示名 | 登录选项标签 |
| --- | --- | --- | --- | --- | --- |
| `anthropic` | 是 | 是 | 是 | Anthropic (Claude Pro/Max) | SDK 默认 |
| `github-copilot` | 是 | 是 | 是 | GitHub Copilot | SDK 默认 |
| `kimi-coding` | 是 | 是 | 是 | Kimi Code (subscription) | Sign in with Kimi Code |
| `meta` | 是 | 是 | 是 | Meta (Muse subscription) | Sign in with Meta |
| `openai-codex` | 否 | 是 | 是 | OpenAI (ChatGPT Plus/Pro) | SDK 默认 |
| `openrouter` | 是 | 是 | 未声明 | OpenRouter OAuth | Sign in with OpenRouter |
| `radius` | 是 | 是 | 未声明 | 创建 provider 时指定 | SDK 默认 |
| `xai` | 是 | 是 | 是 | xAI (Grok/X subscription) | Sign in with SuperGrok or X Premium |

`openrouter-images` 也在 SDK 中声明 OAuth，但属于图像生成 provider，不属于桌面文本模型目录，因此不计入上表。`radius` 是动态 provider；其 OAuth 显示名随创建参数变化。

## 自动化验收边界

定向入口 `npm run desktop:test:target -- provider-oauth` 按层级运行：

- `quick`：能力目录、默认认证方式、配置校验和 runtime/service 生命周期单测，加浏览器 UI harness。
- `--level native`：Electron 测试入口注入本地假 OpenRouter OAuth provider 和本地假模型服务，经过真实 worker/runtime。
- `--level all`：运行上述单测、UI 与 Electron 层。

Electron 验收覆盖本地假登录与浏览器授权页、加密凭据落盘和重启恢复、真实 worker/runtime 请求、过期刷新、模型调用、压缩、记忆和独立审查，以及忙碌保护、登出和配置删除清理。UI 流程检查认证选项、OAuth-only provider 默认值、端点限制、登录状态和退出交互。自动化流程只使用本地 fixture；它验证桌面集成行为，不代表第三方线上服务结果。

2026-10-07 执行结果：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 桌面类型检查通过 |
| `npm run desktop:test:target -- provider-oauth --level all` | 0 | 44 项单元测试、8 项 UI 测试、2 项 Electron 集成测试通过 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项测试选择脚本自测通过 |

Electron fixture 替换了系统浏览器打开动作，并记录和访问本地授权链接；系统默认浏览器与真实服务回调仍需真实账号验收。未提交、打包或发布，也未读取或改写 Pi CLI 认证文件。

## 真实账号验收矩阵

每家 provider 的真实账号登录、线上模型调用、重启后恢复和退出清理都尚未验收。SDK 能力描述不证明账号资格、地区可用性、服务端行为或订阅权益。

| Provider | 真实登录 | 线上模型调用 | 重启恢复 | 退出清理 |
| --- | --- | --- | --- | --- |
| `anthropic` | 未验收 | 未验收 | 未验收 | 未验收 |
| `github-copilot` | 未验收 | 未验收 | 未验收 | 未验收 |
| `kimi-coding` | 未验收 | 未验收 | 未验收 | 未验收 |
| `meta` | 未验收 | 未验收 | 未验收 | 未验收 |
| `openai-codex` | 未验收 | 未验收 | 未验收 | 未验收 |
| `openrouter` | 未验收 | 未验收 | 未验收 | 未验收 |
| `radius` | 未验收 | 未验收 | 未验收 | 未验收 |
| `xai` | 未验收 | 未验收 | 未验收 | 未验收 |
