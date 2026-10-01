# 聊天框增强台账

目标：完成本轮确认的全部九项功能。保持现有简洁输入栏、中英文、主题、权限与恢复语义；语音入口继续隐藏。

| 编号 | 功能 | 状态 | 验收 |
| --- | --- | --- | --- |
| C1 | 附件缩略图、详情、导入失败重试、纯图片发送 | 已完成并验证 | 图片与文本文件预览，逐文件导入状态、失败恢复和移除，模型能力校验 |
| C2 | 全项目模糊搜索、最近/打开文件、引用详情 | 已完成并验证 | 多目录同名文件显示目录名，打开和最近文件优先，详情复用真实上下文解析 |
| C3 | 长消息展开编辑、Markdown 预览、选区恢复 | 已完成并验证 | 原输入元素保持挂载，展开/收起不丢草稿、光标与附件 |
| C4 | 单条队列编辑、删除、排序 | 已完成并验证 | Worker 原子校验版本及消费状态，同文消息保持 ID，重启恢复编辑后的队列到草稿 |
| C5 | 发送状态、失败重试、幂等去重 | 已完成并验证 | 请求 ID + 内容指纹 + 持久收据；并发/丢失响应/重启重试只执行一次 |
| C6 | 聊天/代码/文件行精确引用与来源跳转 | 已完成并验证 | 原文字偏移与 SHA256，文件行范围、来源定位及过期刷新；真实拖选只发送选区 |
| C7 | 有限草稿历史与完整恢复 | 已完成并验证 | 最多 20 版，常规累计正文限制为 200 万字符；正文/附件/引用一起恢复，跨任务拒绝使用其他任务版本 |
| C8 | goal/review/help 命令与自定义模板 | 已完成并验证 | 命令连接已有功能，审查不自动执行，模板新增/修改/删除/插入和重启持久化 |
| C9 | 发送前检查与标明估算的容量提示 | 已完成并验证 | 失效引用、缺失附件、二进制格式、模型图片能力、上下文容量与权限校验 |

## 本轮约束

- 不启用开发子代理，不提交、发布或制作 EXE。
- 新增能力复用主进程受校验 IPC。测试只使用本地假供应商。
- 测试临时目录按所有权清理；仅保留必要证据。
- 只有真实实现及对应验证通过，才将条目标记完成。

## 实现与验证记录（2026-09-27）

- 界面默认仍只有添加、权限、合并的模型/思考级别、发送四个控件。长编辑、历史、模板和检查放在添加菜单或斜杠命令，语音入口保持隐藏。
- 引用与附件由主进程重新校验；Renderer 提供的路径或标签不能改变目录权限。历史附件只能读取所属任务的附件目录。
- 队列修改从 Desktop Worker 下传 AgentSession，再对 Agent 的待处理队列执行原子替换。消息已开始处理或版本已变化时明确拒绝，避免误撤回。
- 新任务发送在执行前保存收据，接收后确认；不确定的中断不自动重发。成功接收后的重试直接取收据，源文件后来改变也不会重复执行。
- 新增回归位于 apps/desktop/test/composer-enhancements.test.ts 和 test/e2e/composer-enhancements.nonvisual.spec.ts，覆盖真实 Electron、主进程、Worker 及回环地址假供应商。
- 桌面类型检查、单元测试、根级检查和开发构建已完成，结果见下表。没有提交、发布或生成 EXE。
- 新增 10 项真实 Electron 流程全部通过，覆盖上述九项功能；另验证深浅主题 × 中英文 × 1440×940、1000×700、1280×800。只保留必要截图，不进行严格像素差验收。

## 最终验证

| 命令 | 退出码 | 本轮结果 | 证据 |
| --- | --- | --- | --- |
| npm run desktop:check | 0 | 类型检查通过 | .artifacts/composer-desktop-check-final.log |
| npm run desktop:test | 0 | 287/287 桌面单元测试通过 | .artifacts/composer-full-unit.log |
| npm run check | 0 | 根级完整检查通过，无自动修改 | .artifacts/composer-root-check-final.log |
| npm run desktop:build | 0 | 主进程、Preload、Renderer 构建成功 | .artifacts/composer-build-final.log |
| npm run desktop:test:nonvisual | 1 | 完整执行 486 项：479 通过、7 失败，无跳过 | .artifacts/composer-full-nonvisual.log / composer-full-nonvisual-initial.json |
| npm run desktop:test:nonvisual -- --last-failed | 0 | 7/7 复测通过 | .artifacts/composer-nonvisual-repair.log / composer-nonvisual-repair.json |
| npm run desktop:test:nonvisual -- git.nonvisual.spec.ts --grep 'shows real conflict versions' --repeat-each=3 | 0 | Git 冲突保存额外连续 3 次通过 | .artifacts/composer-git-save-repeat.log |
| node ../../node_modules/vitest/dist/cli.js --run test/agent.test.ts（packages/agent） | 0 | 27/27 通过 | .artifacts/composer-agent-regression.log |
| node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-queue.test.ts（packages/coding-agent） | 0 | 15/15 通过 | .artifacts/composer-session-queue-regression.log |

- 初轮 5 项失败来自旧断言：搜索结果新增目录说明、发送前错误保持任务空闲、引用按钮不属于正文、队列标签需要精确匹配。均已更新并复测。
- file:// 启动用例使用最新构建后通过，同时验证本地 PDF 资源与输入建议。没有修改产品启动逻辑来绕过该用例。
- Git 冲突保存初轮出现一次超时；保留更明确的文件错误诊断后，失败项复测及额外 3 次重复运行均通过。未复现其初轮原因，不将其描述为已定位的产品缺陷修复。
- 按测试文件、完整标题和项目逐项合并初轮与复测证据：486 项均有通过记录，未覆盖、跳过和遗留失败为 0。汇总在 .artifacts/composer-acceptance-summary.json；这不是一次全绿运行的声明。
- 构建仍输出第三方依赖的 Rollup 注释及 use-client 指令提示；构建退出码为 0，未改动依赖来隐藏提示。

## 截图与缓存

- 中文浅色：.artifacts/composer-enhancements/zh-CN-light.png（1440×940）。
- 英文深色：.artifacts/composer-enhancements/en-US-dark.png（1000×700）。已实际检查，配合 12 组尺寸/主题/语言布局断言。
- 测试默认关闭视频与 trace，新增原生流程结束后验证所属临时目录已删除。
- 最终扫描发现一个已失效且签名确认的测试目录，使用现有安全清理脚本回收 18,787,969 字节；复查 D:/systemp 已无匹配的 Pi 测试临时目录。记录见 .artifacts/composer-temp-cleanup.json 和 composer-temp-audit-final.json。未清理用户工作区、真实会话或持久模型。

## 关键文件与启动

- apps/desktop/src/main/composer.ts：上下文检索、详情、附件边界、历史和发送检查。
- apps/desktop/src/renderer/src/components/composer/：界面、附件、引用、队列、历史与模板入口。
- apps/desktop/src/shared/composer.ts：校验契约与历史边界。
- apps/desktop/src/main/application.ts、src/worker/agent.ts：收据、持久化和队列执行连接。
- packages/agent/src/agent.ts、packages/coding-agent/src/core/agent-session.ts：待处理消息原子替换。
- 在 E:/AI_collection/Pi desktop 运行 npm run desktop:dev。验收使用本地假供应商，不涉及真实账号或付费模型调用。

## 接续迭代：引用选择与模板插入（2026-09-29）

历史验收不覆盖之后引入的所有时序。本轮从真实输入入口复现并修复：

1. 点击 @ 引用后，未等读取完成就删除命令且可提前发送。现在校验完成后才消费命令，校验期间阻止发送并可主动取消，失败可直接重新选择。
2. 点击禁用的发送按钮仍可能让输入框失焦，间接取消正在添加的引用。现在禁用控件的指针动作保持焦点，按坐标实际点击的回归通过。
3. `/模板` 位于句中时，旧实现删除命令后把模板附加在全文末尾。现在原位插入，并把光标放到模板末尾。

选择生命周期共用于即时建议和上下文选择器。取消只放弃本地写入，不宣称终止已经发出的 IPC 读取。换任务、关闭面板、编辑查询及 Escape 都丢弃迟到结果；新选择的忙碌状态不会被旧响应解除。错误显示在原选择区域，保留草稿和引用；没有伪装成发送错误。

| 验证命令 | 退出码 | 结果 | 报告 |
| --- | --- | --- | --- |
| `npm run desktop:check` | 0 | 桌面类型检查 | 本轮工具输出 |
| 输入框定向 UI（命令见下方） | 0 | 15 项 UI：新增 9 项及 6 项相邻回归 | `.artifacts/composer-context-selection/composer-ui.json` |
| 原生上下文定向流程（命令见下方） | 0 | 3 项真实 Electron / 主进程 / 假供应商流程 | `.artifacts/composer-context-selection/native-context.json` |
| `npm run desktop:test:target -- --file test/composer-trigger.test.ts --file test/localization.test.ts` | 0 | 5 项单元测试 | `.artifacts/composer-context-selection/unit-context.json` |

初次复现均退出 1，修复后对应定向验证退出 0；保留 `red-validation-race.json`、`red-disabled-send-pointer.json`、`red-template-position.json`，位于相同证据目录。不将最初失败的整次运行改写为通过。常规浏览器测试使用真实组件/CSS 和受控延迟桥；原生测试使用真实 IPC、临时项目和本地假供应商，不涉及真实账号调用。

~~~powershell
npm run desktop:test:target -- --file test/e2e/composer.spec.ts --grep 'context selection|context picker|at mentions|slash plan|slash templates|suggestions respect|runtime controls|compact toolbar|composing Enter'
npm run desktop:test:target -- --file test/e2e/composer-enhancements.nonvisual.spec.ts --grep 'expanded editor, complete draft history|fuzzy search|same-name references'
~~~

没有执行全套测试、根级检查、发布构建或 EXE 打包；开发主进程/Preload 构建由原生定向测试按需执行。测试关闭后核对临时目录清理，`D:/systemp` 扫描候选为 0。当前持续 Goal 仍为 active，继续检查设置及管理流程。
