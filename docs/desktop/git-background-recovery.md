# Git 后台查询与超时恢复

G-UX-04 接续，2026-09-29。持续 Goal 保持 active，本轮范围为没有显式请求 ID 的后台 Git 查询、自动停止失败和相应恢复入口。

## 实现行为

- Git 状态、仓库信息、文件/范围差异等后台读取由服务持有取消作用域；关闭应用时一并停止，等待进程树和管道关闭。退出预检失败沿用“重试 / 返回应用”，不误报清理完成。
- 超时、输出超限或管道失败会取消所属命令链；即使某个子命令捕获错误，后续 Git 命令也不能继续启动。已经落盘的提交仍走独立的完成确认与索引同步路径。
- 停止失败时保留仍在运行的操作，发布一次全局提醒；对应目录的变更面板内显示原因和“重试停止进程”。实际进程及管道关闭后才返回完成，不以按钮点击代替停止。
- 恢复接口使用主进程生成的操作标识，经过既有窗口/任务和目录校验；不接受任意 PID。附加目录看不到另一目录的问题记录，也不能借用其标识停止进程。
- 错误、进行中状态及完成提示即时切换中英文。切换目录或隐藏面板后，重新打开仍能从主进程取得失败记录；成功后保留核对状态提示并恢复键盘焦点。恢复组件不因 Git 状态从可用变为不可用而卸载。
- 沿用现有内联错误区域，没有增加模态窗口或常驻工具栏入口。正常运行没有额外可见占位。

关键文件：

- `apps/desktop/src/main/git-process.ts`：后台作用域、所属控制器、失败进程注册与目录隔离的停止重试。
- `apps/desktop/src/main/git.ts`、`git-workflow.ts`：服务读取与正常退出生命周期。
- `apps/desktop/src/main/application.ts`、`src/shared/contracts.ts`：受校验的查询、重试及变更事件。
- `apps/desktop/src/renderer/src/components/panels/git-process-recovery.tsx`、`git-panel.tsx`：内联恢复、范围保护和焦点。
- `apps/desktop/test/git-background.test.ts`、`test/e2e/git-background.nonvisual.spec.ts`：真实进程与 Electron 验证。

## 定向证据

报告位于 `.artifacts/git-background/`。本轮 24 项不同单元、2 项 UI、6 项原生流程及 16 项选择器检查通过，没有运行整套桌面或整仓测试。

| 命令 | 退出码 | 结果与报告 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/git-background.test.ts` | 0 | 4 项后台退出、自动超时停止失败/重试、合并信号及写命令链单测；`unit-green.json` |
| `npm run desktop:test:target -- git-background --level native` | 0 | 2 项真实 Electron 流程，覆盖双语键盘恢复、附加目录隔离、索引/HEAD、最后窗口退出和重启；`native-green.json` |
| `npm run desktop:test:target -- git-cancellation git-cancel-retry git-commit --level unit` | 0 | 20 项关联取消、停止失败、提交确认及索引保护回归；`related-units-green.json` |
| `npm run desktop:test:target -- git-cancel-retry --level native` | 0 | 2 项既有取消 IPC 和退出重试回归；`stop-retry-regression.json` |
| `npm run desktop:test:target -- --file test/e2e/git.nonvisual.spec.ts --grep 'Git late'` | 0 | 2 项已提交后取消、退出及重启回归；`late-commit-regression.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'Git actions remain pending\|a Git status read failure'` | 0 | 2 项面板重开及状态失败时保留取消入口；`panel-regression.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器回归，新模块及非视觉文件配置有效 |
| `npm run desktop:check` | 0 | 最后一次桌面源码与测试修改后的类型检查 |

最初 `shutdown-red.json` 退出 1：旧实现正常关闭后，两级 fsmonitor 辅助进程仍在运行。最小修复后的单项证据是 `first-green.json`，最终四项证据为 `unit-green.json`。

首次原生运行 `native-recovery-red.json` 退出 1，一项失败、一项未执行；恢复提示在 Git 状态刷新时丢失。修复组件生命周期，同时校正测试中两条英文预期为项目真实词条，随后两项取得退出 0。保留失败整轮，不能用最终通过覆盖最初结果。

故障仅在本轮测试 Node/Electron 进程中设置不存在的 SystemRoot，触发真实 Windows 终止器启动失败；恢复后重试同一组辅助进程。原生超时仅在测试应用内把默认 60 秒定时器加速为 1.5 秒；实际 Git、fsmonitor、进程树、IPC、目录选择和界面事件均走产品逻辑。测试未使用真实模型账号或修改系统环境。

## 使用与边界

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/git-background.json` 退出 0，只读所有权审计为 0 个候选残留。另检查本轮 slow-git 辅助进程无残留，原生 fixture 结束后断言整个验收目录不存在。没有截图、视频或 trace。一次文档补丁因 JavaScript 字符串引用错误未执行，修正传输后成功写入，未影响源码与测试结果。

- 日常入口 `npm run desktop:test:target -- git-background` 默认只运行四项单测；主进程、IPC 或退出交互变更再选 `--level native`。新增入口不连带整个 Git、Worktree 或其他模块。
- 已验证 Windows x64 的终止器启动失败与正常关闭；未声称系统真实权限拒绝、强制终止/断电和其他操作系统已通过。
- 本轮退出所有权覆盖列出的后台查询和 GitWorkflow 操作。项目环境、Worktree 迁移/归档等其他长操作继续独立复核，不将其替代为已完成。
- 停止失败记录仅在当前应用进程中有效；完成后提示用户主动刷新、核对仓库，不自动重复原命令。
- 不提交、不发布、不制作 EXE。开发启动：在仓库根目录运行 `npm run desktop:dev`。
