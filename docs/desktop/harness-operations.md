# 模型操作查询、等待与取消（H-07）

模型原先只能从 get_harness 查看最近操作摘要，无法事件等待真实结果，也没有受约束的取消入口。本轮增加 manage_operations，继续走 Worker → 校验 IPC → 主进程 Operations 服务，不增加工具栏、弹窗或任意 IPC 代理。

## 模型行为

| action | 参数 | 行为 |
| --- | --- | --- |
| operations.list | 无 | 当前聊天操作，活动项优先，其余从新到旧；最多 50 项，返回 total/truncated |
| operations.read | operationId | 状态、阶段、是否结束、可取消性及游标；项目动作附已保存的输出、终端标识、退出码 |
| operations.wait | operationId、cursor、timeoutMs | 等待阶段或结果变化，最长 30000ms；无游标立即返回快照 |
| operations.cancel | operationId | 仅取消当前聊天的项目动作，包括初始化、清理及常用动作；调用原有停止服务 |

先 read，再用返回的 cursor 调用 wait。changed 表示快照改变，timedOut 仅表示等待超时；只有 settled 为 true 才进入最终状态，最终状态仍可能是 failed/cancelled/interrupted。结果保存尚未结束时继续报告 running；保存失败报告 failed，不能提前声称成功。操作记录被回收时返回 unavailable，不当作已完成。

取消返回 cancelRequested，表示本次是否发出了请求；不是“已经停止”或“修改已撤销”。最终结果继续 read/wait。重复取消已结束的同一项目动作返回 cancelRequested=false，不重新启动。停止模型或取消等待只释放订阅，不停止原项目动作。

结果字段按已知结构投影：项目动作只返回 terminalId、exitCode、最多 8000 个 UTF-16 单元的已保存输出及 outputTruncated。实时终端输出继续使用 read_terminal。其他操作类型不返回任意结果和错误正文，仅保留 hasError 等状态；详细内容通过对应功能查看。所有截断避免切开代理对，文本仍作为不可信数据处理。

## 权限和恢复

- 仅普通主聊天注册工具；子代理、审查及临时侧聊没有此入口，主进程也独立拒绝这些角色。
- 不接受 threadId、命令、原始 op、force、启动或重试操作；所有查询和游标绑定当前聊天及 operationId，不能读取其他聊天或全局设置操作。
- 计划/只读模式可以查询与等待，不能取消。取消同时检查本轮捕获权限和当前权限；Git/PR、插件、MCP、浏览器、Worktree 和记忆操作不在取消白名单。
- 沿用已有项目动作取消和进程收尾，不新增强制终止后门，不扩大沙箱、审批或任务权限。
- 重启后可以读取已经保存的操作记录和项目输出，不重放命令或模型请求。普通终端仍遵循既有关闭/重启生命周期。
- 无界面布局变更；工具名称和新增错误提供中英文词条。本轮未做独立截图/视觉验收。

## 实际验证

命令均从仓库根目录执行，除注明目录外。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npm run desktop:test:target -- harness-operations | 0 | 19 项单元：协议、范围、截断、订阅、取消、保存结束及既有 Operations 行为 |
| npm run desktop:test:target -- harness-operations --level native | 0 | 3 项真实 Electron/Worker/IPC/PTY：退出结果与重启、等待/取消、跨聊天和权限隔离 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "child asks and receives" | 0 | 1 项既有真实主子代理通信，增加子代理不可用 manage_operations 断言 |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项测试选择器检查 |
| npm run desktop:check | 0 | 最终桌面类型检查 |
| node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/harness-operations/temp-audit.json | 0 | 只读目录审计，见报告 |

失败证据不改写为通过：新增协议首次测试退出 1，确认接口尚不存在；随后未知类型错误正文保护和供应商 object-root 参数契约各出现一次预期失败，修复后通过。新增参数契约测试曾因直接读取 TSchema 未声明属性导致类型检查退出 1，改为显式属性窄化后检查通过。

报告在 .artifacts/harness-operations/：native-first-pass.json 保留最初 3 项通过；native-final.json 为最终参数与过滤版本的 3 项通过；child-isolation.json 为独立子代理隔离检查；unit-final.json 为最终单元记录。使用本地假供应商，没有线上账号或付费模型验收。开发构建仍显示已有 Zod PURE 注释及 NO_COLOR 警告，未修改依赖。

每项原生测试均断言自有目录删除；关闭截图、视频、trace，未扩大到全套回归。没有提交、发布、打包 EXE 或调用开发子代理。启动仍为 npm run desktop:dev，重启开发应用加载新工具。

## H-09/H-10 接续：项目动作查询与受控启动

新增 list_project_actions 与 run_project_action。前者只读当前执行目录的动作清单和配置命令，供独立代审批模型检查真实命令；后者要求原样回传已列出的 command，主进程按当前配置精确匹配后才允许启动，不能注入命令或切换目录。启动复用现有 project.action、Operations、终端和审批链，模型拿到操作记录后使用 manage_operations 等待或取消。

list_project_actions 在计划/只读模式仍可作为 Harness 观察入口；run_project_action 继续经过模型工具策略、独立代审批和主进程当前权限检查，计划模式、拒绝模式、审查任务、子代理及临时侧聊均拒绝执行。命令正文只作为受校验的审批输入，不改变沙箱权限。

本轮新增定向证据：harness-tools.test.ts 7 项单元通过；harness-operations.nonvisual.spec.ts 4 项原生流程通过，其中新增流程覆盖动作清单、动作启动、真实终端退出码和命令正文隔离；npm run desktop:check 退出 0。失败动作使用退出码 7 的本地夹具，按真实结果保留为 failed，不改写为 succeeded。

持续 Goal 保持 active。本轮只完成 H-08–H-10，不把新建 Worktree 硬退出、缺失归档任务关联及多目录配置恢复认定为已完成；这些独立事项仍按原记录推进。
