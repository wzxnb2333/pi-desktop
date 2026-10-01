# 模型连接设置

本轮调整日期：2026-10-01（两级结构）。布局与思考程度细节见下文的历史记录。

## 表单规则

模型配置分两级：先添加「模型提供商」，再在该提供商下添加「模型」。

- 提供商 = 一个连接 + 一个凭据。设置页左栏按提供商列出，右栏上半是连接与凭据，下半是该提供商下的模型列表。
- 内置供应商：从 Pi SDK 静态目录选择命名空间（如 `openai`），可留空 Base URL 直接使用 SDK 端点，也可填写替代端点用于中转或网关。协议、上下文窗口和输出上限读取当前安装的 Pi SDK 目录。
- 自定义提供商：填写显示名称、Base URL 和 API 协议（Base URL 必填），命名空间由应用生成为 `desktop-<提供商 id>`。
- 在同一提供商下添加模型时，内置供应商只列出目录中尚未添加的模型，并复制目录里的协议与能力；自定义提供商手填模型 ID，并填写上下文窗口、最大输出和思考能力。
- API Key 属于提供商，旗下所有模型共用，密钥继续通过 Windows 加密存储保存，不进入模型目录响应或配置文件。
- 保存前检查提供商必填项、HTTP(S) 地址、模型是否属于内置目录、思考程度范围以及自定义模型的窗口与输出上限。自定义提供商不受内置目录是否加载成功的限制。
- 内置模型目录加载失败时，只校验本次草稿真正改动的条目：已有的内置提供商不会阻止保存无关的改动（例如新建自定义提供商）；改动过的内置条目仍会因目录未加载而拒绝保存。
- 新建提供商的表单是设置页「模型」分类内的局部状态：切换到其他分类会丢弃尚未创建的草稿，已保存的提供商与模型不受影响。
- 保存设置仍遵守现有运行任务保护；修改提供商连接或密钥会使该提供商下的任务在下次运行时重建 Worker。

## 从旧版数据迁移

首次启动新版本时，`desktop.json` 的 `version` 从 2 升到 3：

- 旧版 `settings.providers` 里每条记录同时是连接和模型。迁移按「连接 + 密钥」分组：连接相同且密钥相同的记录合并为一个提供商，模型保留原来的 id，因此已有任务、自动化和历史记录引用的模型不变。
- 连接相同但密钥不同的记录拆成多个提供商，避免把两把密钥合并成一把。
- 密钥从 `provider:<模型 id>` 移动到 `provider:<提供商 id>`（只搬运密文，不解密）；迁移前的原文件按既有约定保存为 `desktop.pre-migration-v2-<hash>.json`。
- 启动顺序固定为「读取密钥指纹 → 加载并迁移 desktop.json → 回放凭据删除日志」：凭据删除日志依赖已加载的配置判断哪条密钥仍被引用，先回放会在空配置上误删待恢复的密钥。

## 允许的思考程度

- 在「设置 → 模型」中逐个模型配置「允许的思考程度」。自定义提供商的模型需要先启用「支持思考」。
- 新建自定义模型预选 low、high、xhigh、max，也可以按接口能力选择 off、minimal、medium；至少保留一项。已有自定义模型未配置列表时沿用 SDK 基础档位。
- 内置模型的可选范围来自 SDK 实际支持的档位；不支持推理的模型固定为 off。不能通过勾选给内置模型增加不存在的能力。
- 输入框的思考菜单只显示当前模型允许的档位；新建任务、切换模型、修改列表和重启时都会校正失效选择。优先取不低于原值的可用档位，否则取最高可用档位。运行中仍禁止修改配置。
- 自定义模型通过 SDK 的 thinkingLevelMap 声明允许的档位，避免 xhigh、max 被默认收窄为 high。OpenAI 兼容与 Responses 协议均已用本地假供应商核对实际请求参数。
- 列表保存在模型的 thinkingLevels 中，任务选择保存在 thread.modelId / thread.thinking 中，沿用 settings.save 和 thread.update；不新增供应商请求或认证逻辑。

## 实现位置

- 提供商与模型表单：apps/desktop/src/renderer/src/ModelSettings.tsx、ModelConnection.tsx
- 草稿、提供商与模型增删和保存：apps/desktop/src/renderer/src/Settings.tsx
- 数据结构与校验：apps/desktop/src/shared/contracts.ts、model-configuration.ts
- 运行时注册：apps/desktop/src/shared/model-runtime.ts（Worker、审批审查、记忆生成共用）
- 数据迁移与密钥搬运：apps/desktop/src/main/data-migrations.ts、store.ts、application.ts
- 静态目录 IPC：apps/desktop/src/main/model-catalog.ts、application.ts 和 shared/contracts.ts
- 作用域样式：apps/desktop/src/renderer/src/styles/settings.css

## 历史：内置/自定义表单拆分（2026-09-26）

- 内置供应商：通过下拉框联动选择供应商和模型，不显示 Base URL。
- 自定义接口：填写 API 协议、Base URL、模型 ID 和 API Key。
- 同一设置页面内按模型记录保留两种模式的独立草稿；切换模式或设置分类不会覆盖另一模式的草稿。
- 旧配置中的内置模型端点覆盖继续保留原执行语义，单独说明当前状态；只有用户点击「转换为自定义模型」时，才根据真实目录参数转换。
- 该「单条记录同时是连接和模型」的设计已在两级结构中被取代，端点覆盖保留为内置提供商的 Base URL 字段，转换入口不再需要。
