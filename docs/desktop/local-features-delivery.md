# 本地功能补齐交付与综合验收

日期：2026-09-27。八阶段范围及综合验收已完成，功能台账 F00–F32 均已验收。逐项历史、依赖及证据保留在 feature-completion-goal.md。

后续输入区调整：按用户的精简要求，听写、语音对话和朗读入口已暂时下线，保留离线服务与模型设置；命令、技能和上下文改为输入 `/`、`@` 调出，模型与思考级别合并。下文的 277/479 和语音录音截图验收是这次调整之前的历史证据，当前变更验证另见 [composer-simplification.md](composer-simplification.md)。

## 功能入口

| 范围 | 入口与实际行为 |
| --- | --- |
| 设置与输入 | 设置中的通用、外观、快捷键、模型、MCP、记忆、离线语音等分组；运行中保存偏好，模型与工具配置下一次运行生效。输入框支持引导/排队、命令、目录/文件/技能/工具引用、拖拽与粘贴。 |
| 项目、窗口与侧聊 | 新建聊天、快捷聊天、独立任务窗口、项目目录管理；从消息进入只读侧聊，保留为普通聊天或追加回答到主草稿。 |
| 审查与 Git | 用户主动选择审查范围；结构化发现、行评论、过期定位提示；变更面板选择分支/最近一轮，撤销差异块并保留恢复副本；PR 使用 GitHub CLI。 |
| 环境与 Worktree | 项目初始化、清理和动作；起始引用选择、同聊天双向迁移、归档、恢复、占用统计及默认关闭的自动回收。 |
| 插件与 MCP | 本地目录、归档包和目录源安装；启停、更新回退、卸载；MCP OAuth、逐工具策略与结构化图片/资源结果。 |
| 浏览器与产物 | 智能体浏览器操作、网站授权、历史与清理、元素/区域标注；本地 PDF 翻页/搜索/缩放/标注，隔离 HTML 渲染/源码/标注。 |
| 持续任务 | 产品内 Goal 独立管理目标验收；同聊天唤醒或新任务自动化；默认关闭自动生成的跨会话记忆；默认关闭且明确委派后执行的子任务。 |
| 离线语音 | 输入区听写、语音对话和朗读入口暂时隐藏；已有设置、持久模型和 SenseVoice/Silero/Kokoro 服务保留，便于后续恢复。 |

## 运行

在 PowerShell 7 执行：

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
npm run desktop:dev
```

语音开发验证已有一份模型位于 E:\AI_collection\Pi desktop\.artifacts\voice-models。在“设置 → 离线语音”选择并保存该目录即可复用，无需再下载。未改写真实用户的设置或聊天。模型版本、哈希及识别限制见 offline-voice.md。

## 验证结果

| 检查 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 桌面类型检查 | 根目录 npm run desktop:check | 退出 0 |
| 开发构建 | 根目录 npm run desktop:build | 退出 0，仅开发资源 |
| 完整桌面单元测试 | apps/desktop：node --import tsx --test --test-concurrency=1 test/*.test.ts | 277/277，退出 0，无跳过 |
| 完整非视觉桌面回归 | apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts | 479/479，退出 0；无失败、跳过或重试后通过，耗时 26.9 分钟 |
| 最终根检查 | 根目录 npm run check | 退出 0；1,383 文件无自动修复 |
| 旧数据与恢复 | data-recovery.nonvisual.spec.ts | 原生定向 4/4，退出 0 |
| 真模型与语音全流程 | voice.test.ts、voice.nonvisual.spec.ts | 单元 3/3、原生 5/5，退出 0 |
| 界面矩阵与本地构建 | final-ui.nonvisual.spec.ts | 原生 2/2，退出 0；12 个主题/语言/尺寸组合、file:// PDF 与真实麦克风 Worklet 通过 |
| 本轮临时目录核验 | cleanup-desktop-temp.mjs，先预检再 apply，最后重新扫描 | 三次均退出 0；清理 1 个已验证目录、18,326,867 字节；剩余 Pi 临时目录 0，桌面进程 0 |

根检查前后已有 tracked diff 的 SHA-256 均为 F14F9CB8332F41DA8E906AE35F1D3831CED2445396CAE32A48EA91748608676F。未通过回滚消除其他工作。完整日志在 .artifacts/f32-desktop-unit.log、f32-final-desktop-nonvisual.log、f32-final-root-check.log；完整桌面结果在 .artifacts/desktop-nonvisual-results.json。最终完整回归开始于本地时间 20:06:01，报告 expected=479、unexpected=0、skipped=0、flaky=0、errors=[]。

首轮完整非视觉回归为 463 通过、16 失败（退出 1），原报告保存在 .artifacts/f32-first-desktop-nonvisual-results.json，日志在 .artifacts/f32-desktop-nonvisual.log。修复发送错误收尾与扩展初始化审批的竞争问题、窄面板工具栏溢出，并更新新增功能对应的旧测试预期；布局定向 12/12、真实运行恢复与界面定向 9/9 均退出 0。随后完整复测 479/479 通过，未通过跳过、删减场景或放宽全局容差取得结果。

常规回归不录制截图、视频或 trace；综合界面检查只保留必要的六张图，涵盖深浅色、中英文和窄窗。1440×940、1000×700、1280×800 的全部布局组合检查溢出、输入控件和保存操作位置，不恢复像素级门槛。

六张实现图已逐张检查。主题、语言、侧栏宽度与摘要读取完成后再截图；设置保持左侧分组、正文滚动和可见保存栏，摘要为右上独立卡片，无顶部任务标签。英文独立聊天入口明确为 New standalone chat。

| 场景 | 实现图 |
| --- | --- |
| 中文深色会话与摘要 | [conversation-dark-zh-CN.png](../../.artifacts/final-ui/conversation-dark-zh-CN.png) |
| 英文浅色会话与摘要 | [conversation-light-en-US.png](../../.artifacts/final-ui/conversation-light-en-US.png) |
| 中文深色设置，1440×940 | [settings-dark-zh-CN-1440.png](../../.artifacts/final-ui/settings-dark-zh-CN-1440.png) |
| 英文浅色设置，1440×940 | [settings-light-en-US-1440.png](../../.artifacts/final-ui/settings-light-en-US-1440.png) |
| 中文浅色设置，1000×700 | [settings-light-zh-CN-1000.png](../../.artifacts/final-ui/settings-light-zh-CN-1000.png) |
| 英文深色设置，1000×700 | [settings-dark-en-US-1000.png](../../.artifacts/final-ui/settings-dark-en-US-1000.png) |

## 数据与缓存

应用数据使用版本迁移、原始备份和显式恢复；任务、模型、浏览器、产物与 Worktree 恢复数据各自管理。临时测试目录验证所有权并在成功、失败和重启后清理，不能把用户文件当成缓存。

语音安装验证后已删除本轮下载归档 528,463,201 字节，仅保留一份持久模型，结果在 .artifacts/voice-cleanup-result.json。模型本身不是可丢弃缓存。

完整回归退出后确认没有 Electron/Pi Desktop 进程，清理经过项目路径、会话目录及版本签名验证的 D:\systemp\pi-acceptance-rwKN8b，共 18,326,867 字节。重新扫描 D:\systemp 后，Pi 临时目录为 0，未发生清理失败或跳过。预检、执行及复核证据分别为 .artifacts/temp-cleanup/f32-preview.json、f32-result.json、f32-after.json。模型和 Worktree 恢复数据未作为缓存删除。

## 验证边界

- GitHub PR、OAuth/MCP、供应商与插件均使用实际适配器和本地替身/协议服务；未进行真实第三方账号的线上操作。
- 语音实际运行离线模型和固定中英文音频；原生录音链路使用虚拟麦克风。未以此代替物理麦克风、扬声器的主观音质及所有驱动兼容性；测试未修改系统防火墙。
- 开发构建退出 0，保留上游依赖的 Rollup 注释及 use-client 指令警告；没有将构建描述为无警告。
- 明确排除远程/SSH/跨设备和 Office 专用预览。Office 文件仍可外部打开。
- 沿用 Codex 26.915 参考、Pi 品牌与双语；Satang 只读。未启用开发子代理，未提交、发布或重新打包 EXE。
