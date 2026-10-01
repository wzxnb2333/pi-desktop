# 独立 LLM 代审批（2026-09-29）

用户明确纠正“替我批准”的含义：另外一次 LLM 审查待执行命令，低风险自动批准，危险操作由用户手动批准。旧实现将沙箱内操作直接放行，已改正。本项独立于持续 Goal，不修改 Goal 的目标正文；也没有调用开发子代理。

## 当前流程

1. 请求批准仍对修改与命令逐次询问；完全访问沿用用户主动选择的本机执行方式。计划/审查只读限制、目录边界和工具显式禁止优先。
2. 替我批准新增 review 决策。PowerShell、写入、编辑以及继承任务权限的 MCP 操作在执行前调用独立审查器。MCP 明确要求询问、未信任的附加目录及外部代码加载继续由用户批准，不被 LLM 放行覆盖。
3. 审查使用当前任务已选供应商和模型，但创建独立请求、独立上下文及内存凭据存储，不复用执行会话，不提供工具，不加载项目指令、Skills、扩展或完整聊天历史。这里的“独立”指审查调用与权限隔离，并不代表已另选一种模型。
4. 输入是原始用户请求、实际工作目录、工具名称和本次完整参数。附加目录使用自己的路径。命令中的指令及声称已获批准的文字都作为不可信数据。
5. 仅严格、完整的 JSON 低风险结果自动放行。危险、不确定、解析失败、接口失败及 30 秒超时均进入原有人工审批卡，显示原因、审查模型和实际操作，只批准这一次。过长内容直接转人工，不截掉命令后半段再批准。
6. 停止会取消正在进行的审查；迟到的结果不能执行操作。后续运行重新审查，不缓存命令许可。

网站访问继续走主进程网站/任务授权，Goal 和自动化管理保留各自显式权限；不能把这个命令/写入审查器描述为覆盖应用内每一种操作。沙箱仍然限制操作系统访问；用户在卡片中批准也不会自动扩大目录、网络或管理员权限。

## 文件

- `apps/desktop/src/worker/action-review.ts`：独立模型调用、固定审查说明、结果校验、取消及失败回退。
- `apps/desktop/src/worker/agent.ts`、`src/main/policy.ts`、`src/shared/mcp-tool-policy.ts`：在执行前接入 review，并保留更严格的权限。
- `apps/desktop/src/shared/contracts.ts`、`src/renderer/src/components/timeline/message.tsx`：结构化风险原因与双语审批卡。
- `apps/desktop/src/renderer/src/Settings.tsx`、`src/renderer/src/lib/labels.ts`：修正三档说明；沿用现有组件和尺寸。
- `scripts/desktop-test-targets.mjs`：approval-review 定向入口。

## 验证边界

使用真实模型协议适配器、本地假供应商和真实 Windows Electron/AppContainer。测试验证判定后的授权流程、异常回退、阻止提前执行、单次批准及停止语义；没有调用真实付费模型，也不声称已经测得模型对任意命令的危险识别准确率。

初次原生用例的 PowerShell Remove-Item 在现有沙箱内返回 Access is denied；没有为通过测试扩大沙箱权限。授权删除场景改用精确的 .NET 文件删除命令，仍在沙箱中执行。保留该失败记录，不将其描述为产品已成功执行 Remove-Item。

首次检查发现两个测试中的 ui.update 类型不完整，已补足快照和 frame。两次后续原生失败分别是语言切换后继续使用中文定位器，以及停止后尚在保存轮次快照便立即再次发送；分别改为语言无关定位与等待实际快照结束，只重跑受影响场景。

启动：`npm run desktop:dev`。不提交、不发布、不制作 EXE。

## 本轮验证结果

运行元数据保存在 `.artifacts/approval-review/`。仅重跑修改/失败或尚未执行的场景；没有运行全套桌面测试。

| 实际命令 | 退出码与结果 | 记录 |
| --- | --- | --- |
| `npm run desktop:test:target -- approval-review` | 0；10 项单元、4 项 UI 通过，约 8 秒 | quick-first.json |
| `npm run desktop:test:target -- approval-review --level native` | 1；低风险实际沙箱执行通过，后续 Remove-Item 用例失败，5 项未运行 | native-first.json |
| `--file test/e2e/approval-review.nonvisual.spec.ts --grep 'independent high-risk'` | 1；补充诊断确认沙箱内 PowerShell 返回 Access is denied | native-diagnostic.json |
| `--file test/e2e/approval-review.nonvisual.spec.ts --grep 'independent high-risk\|independent review'` | 1；改用精确文件调用后，高风险拒绝/批准通过；后续语言定位失败，4 项未运行 | native-high-pass-locale-failure.json |
| `--file test/e2e/approval-review.nonvisual.spec.ts --grep 'independent review'` | 1；不确定、无效结果、接口失败 3 项通过；后续停止后重试时点失败，超时未运行 | native-fallbacks-pass.json |
| `--file test/e2e/approval-review.nonvisual.spec.ts --grep 'independent review can be stopped\|independent review timeout'` | 0；停止后恢复及真实 30 秒超时 2 项通过 | native-cancel-timeout.json |
| `--file test/e2e/permissions.nonvisual.spec.ts --grep 'permission choices'` | 0；原有请求批准、替我批准的沙箱边界、完全访问、设置/重启恢复 1 项通过 | native-existing-permissions.json |
| `npm run desktop:test:target -- approval-review --level ui` | 0；修正 UI 更新参数后，4 项中英文/深浅主题 UI 再次通过 | ui-final.json |
| `npm run desktop:check` | 0；最终代码与测试的桌面类型检查 | desktop-check.log |
| `node --test scripts/desktop-test-target.test.mjs` | 0；16 项选择器检查通过 | 本轮命令输出 |

表中以 --file 开头的条目均通过 `npm run desktop:test:target --` 执行。去重为 10 项相关单元、4 项 UI、7 项新原生流程及 1 项既有权限回归；另外 16 项选择器检查。失败整次运行仍按退出 1 保存，不改写为全组通过。

审批卡检查了中英文、深浅主题及 1000×700、1280×800、1440×940 的 DOM 溢出与交互；没有宣称像素或人工视觉验收。设置文字明确提示当前任务模型的独立调用，未新增默认开启的第二模型或更改用户凭据。

所有本轮原生夹具关闭后均断言其目录已删除。只读清理审计 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/approval-review.json` 退出 0：没有新增残留，仅既有 `pi-acceptance-9NrmPU`（201820 字节、skipped=1）继续保留，没有绕过旧删除拒绝。
