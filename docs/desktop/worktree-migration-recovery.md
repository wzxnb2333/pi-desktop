# Worktree 迁移关联保存与失败恢复（2026-09-29）

本轮继续 G-UX-04。真实 Goal 保持 active；上一轮的取消验收保留，本轮不宣称归档、恢复索引或强制退出的全部故障边界已完成。

## 问题与实现

原生用例在文件迁移完成后，针对新的执行目录制造真实 desktop.json.tmp 写入失败。旧代码恢复了任务字段，却留下已改写的目标 README.md 和新增文件。失败测试保存为 transfer-red.json。

- 将捕获最终目标、关闭旧 worker 和保存任务关联纳入同一次迁移的恢复范围。保存失败时恢复本次修改、删除和新增的文件；源目录、原始索引与聊天草稿保持不变。外部变动不覆盖，保留恢复快照及受影响文件清单。
- 提交前复核整个目标文件清单，期间出现额外改动时停止，不能把外部内容作为这次迁移的基线。取消后的回滚仍独立完成。
- 任务 cwd、分支、基线、工作区版本与文件导航在主进程写队列中原子保存，成功后再发布到 live 对象；队列内校验来源版本。旧后台快照合并已提交的工作区字段，保留新草稿、标题和其他设置。
- desktop.json 的原子替换作为关联提交点。实际原生验证在替换成功后暂停返回并取消：结果仍为成功，文件与新目录在重启后保持一致。
- 提交后的恢复记录更新失败，不再回滚已关联的文件；显示双语完成警告和恢复记录 ID。初始化未能启动单独提示，可从项目动作重新执行，不误报整个迁移失败。
- 进一步验证回滚后的记录落盘失败：原始快照和原始错误仍保留，不用后续保存错误掩盖前因。双语错误标题不会改写路径和原始诊断内容。

主要实现：src/main/store.ts、worktree-transfer.ts、application.ts；界面沿用 WorktreeControls 的内联状态，不新增窗口或常驻按钮。

## 定向入口

仓库根目录：

```powershell
npm run desktop:test:target -- worktree-migration
npm run desktop:test:target -- worktree-migration --level native
```

默认入口为 13 项相关单元与 1 项完成提示 UI；native 为 5 项真实 Electron 故障恢复。只改文案可选择 --level ui；定位单个问题用 --file 与 --grep。

## 本轮实际验证

报告保存在 .artifacts/worktree-migration-recovery/。以下为实际运行，重复执行的同一用例只计一次：

| 命令 | 退出码及结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/worktree-migration-persistence.test.ts --file test/worktree-transfer.test.ts | 0；当时 12 项通过 | unit-green.json |
| npm run desktop:test:target -- --file test/worktree-transfer.test.ts --grep 'failed recovery status save' | 0；后来新增的 1 项通过 | recovery-journal-green.json |
| npm run desktop:test:target -- --file test/worktree-migration-persistence.test.ts --file test/localization.test.ts | 0；5 项关联保存和 3 项双语检查通过 | storage-locale-green.json |
| npm run desktop:test:target -- --file test/worktree-cancellation.test.ts --grep 'migration cancellation stops snapshot' | 0；仅 3 项直接受影响的取消回归 | cancellation-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-controls.spec.ts | 0；4 项 UI 通过 | ui-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-migration-recovery.nonvisual.spec.ts | 1；双向保存失败恢复的前 2 项通过，语言切换用例失败，初始化用例未运行 | native-partial.json |
| npm run desktop:test:target -- --file test/e2e/worktree-migration-recovery.nonvisual.spec.ts --grep 'committed migration\|initialization save failure' | 0；修正用例和此前未执行的用例共 2 项通过 | native-warning-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-migration-recovery.nonvisual.spec.ts --grep 'cancellation after the task state' | 0；新增提交点迟到取消 1 项通过 | late-cancel-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-lifecycle.nonvisual.spec.ts --grep 'same chat migration\|migration refuses' | 0；2 项既有正常迁移、真实工具目录、冲突与重启流程通过 | lifecycle-green.json |
| node --test scripts/desktop-test-target.test.mjs | 0；16 项选择器回归 | 本轮命令输出 |
| npm run desktop:check | 最终退出 0 | 本轮命令输出 |

去重后：19 项相关单元、4 项 UI、7 项原生流程，另有选择器 16 项。没有把首轮失败的整组运行改写成通过。

其余失败记录：首次注入没有同步 Node 内置 ESM 绑定，见 fault-injection-red.json；第二次断言误把窗口活动更新的 lastUsedAt 当成不可变化字段，见 activity-expectation-red.json。修正后取得真实目标文件未回滚的失败。native-partial 的语言切换使用旧的整份 UI 快照关闭了刚打开的面板，已改为使用当时的 UI 状态。两次类型检查失败分别修正 JSON 返回类型推断和测试中的模块类型转换，最终检查通过。

## 缓存与后续

新增临时目录沿用所有权机制；原生用例结束后断言数据目录不存在。执行 cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-migration-recovery.json，退出 0，候选残留 0；辅助 Node 进程核对无匹配残留。没有截图、视频、trace、全量检查、提交、发布或 EXE。

未完成：迁移中主进程被强制结束时，恢复记录与已提交关联的自动核对；归档删除和恢复索引阶段的中断及外部并发修改。当前 files-transferred 记录会保留，提交后的警告已明确无需重复迁移，但不声称该记录的启动时自动收尾已经实现。后续继续这些边界，不能把异常返回后的正常重启证据等同于强制退出恢复。
