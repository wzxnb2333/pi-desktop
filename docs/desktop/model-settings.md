# 模型连接设置

本轮调整日期：2026-09-26。

## 表单规则

- 内置供应商：通过下拉框联动选择供应商和模型，不显示 Base URL。协议、上下文窗口和输出上限读取当前安装的 Pi SDK 静态模型目录。
- 自定义接口：填写 API 协议、Base URL、模型 ID 和 API Key，不要求填写供应商 ID。新配置由应用分配稳定的内部标识；已保存的自定义标识保持不变。
- 自定义模型的上下文窗口、最大输出和思考能力放在可展开的“模型能力”中。
- 同一设置页面内按模型记录保留两种模式的独立草稿。切换模式或设置分类不会覆盖另一模式的草稿；保存和重启恢复的是当前选择的模式。
- 保存前检查模型匹配、必填项、HTTP(S) 地址和模型能力范围。自定义模型不受内置目录是否加载成功的限制。
- 旧配置中的内置模型端点覆盖继续保留原执行语义，单独说明当前状态。只有用户点击“转换为自定义模型”时，才根据真实目录参数转换；不支持的协议拒绝自动转换。
- 密钥继续通过已有 Windows 加密存储保存，不进入模型目录响应或配置文件。保存设置仍遵守现有运行任务保护。

## 允许的思考程度

- 在「设置 → 模型」中逐个模型配置「允许的思考程度」。自定义接口需要先展开「模型能力」并启用「支持思考」。
- 新建自定义接口预选 low、high、xhigh、max，也可以按接口能力选择 off、minimal、medium；至少保留一项。已有自定义接口未配置列表时沿用 SDK 基础档位。
- 内置模型的可选范围来自 SDK 实际支持的档位；不支持推理的模型固定为 off。不能通过勾选给内置模型增加不存在的能力。
- 输入框的思考菜单只显示当前模型允许的档位；新建任务、切换模型、修改列表和重启时都会校正失效选择。优先取不低于原值的可用档位，否则取最高可用档位。运行中仍禁止修改配置。
- 自定义模型通过 SDK 的 thinkingLevelMap 声明允许的档位，避免 xhigh、max 被默认收窄为 high。OpenAI 兼容与 Responses 协议均已用本地假供应商核对实际请求参数。
- 列表保存在模型配置的 thinkingLevels 中，任务选择保存在 thread.thinking 中，沿用 settings.save 和 thread.update；不新增供应商请求或认证逻辑。
- 本节取代早期能力矩阵中「可选档位集合无字段、固定 6 档」的描述。

本次思考程度变更的定向验证：

    npm run desktop:check
    npm run check
    cd apps/desktop
    node --import tsx --test test/model-configuration.test.ts test/provider-protocols.test.ts

在项目根目录执行：

    npm run desktop:test:nonvisual -- settings.spec.ts model-settings.nonvisual.spec.ts --grep "allowed thinking levels|both connection forms" --reporter=list

以上命令退出 0。单元与协议测试 20/20 通过，新增/扩展的专项非视觉测试 3/3 通过，覆盖四档真实请求、空集合校验、键盘选择、模式草稿、设置重载、任务/模型切换及 Electron 重启后继续发送。表单检查覆盖三个窗口尺寸和四种主题条件。初次组件运行的精确名称定位未匹配包含帮助文案的原生标签，已修正定位并通过定向重跑。

未调用真实供应商；自定义接口仍需按服务实际能力勾选。截图、视频及 trace 均关闭。

## 实现位置

- 连接表单：apps/desktop/src/renderer/src/ModelConnection.tsx
- 草稿、模式切换和保存：apps/desktop/src/renderer/src/Settings.tsx
- 数据转换及校验：apps/desktop/src/shared/model-configuration.ts
- 静态目录 IPC：apps/desktop/src/main/model-catalog.ts、application.ts 和 shared/contracts.ts
- 作用域样式：apps/desktop/src/renderer/src/styles/settings.css

## 模型连接拆分验证

以下命令均退出 0：

在项目根目录执行：

    npm run desktop:check
    npm run check

在 apps/desktop 目录执行：

    node --import tsx --test test/model-configuration.test.ts
    node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts settings.spec.ts model-settings.nonvisual.spec.ts desktop.nonvisual.spec.ts --reporter=list

- 配置单元测试：5/5 通过。
- 定向非视觉测试：15/15 通过。
- 真实 Electron 开发源码验证内置/自定义保存、两次重启恢复、Windows 密钥加密及本地假供应商回复。
- 浏览器组件验证目录匹配、无效配置拒绝保存、旧端点保留及显式转换、加载失败重试、草稿切换、键盘焦点。
- DOM 和计算样式检查覆盖 1000×640、1280×800、1440×940，以及浅色、深色、跟随系统明暗；两种表单均无横向越界。
- 沿用的桌面流程测试覆盖流式消息、审批、审阅、终端、预览、主题及首次配置。
- 截图、视频和 trace 均关闭，未进行图片识别或视觉审查。此处验证可用性和布局边界，不构成与 Codex 的像素一致性结论。
- 开发源码编译存在依赖 Zod 原有的 Rollup 注释提示，测试未失败；根项目检查未产生修复。

## 启动

在项目根目录执行 npm run desktop:dev。已启动的旧主进程需要重启后才能使用新增的目录 IPC。
