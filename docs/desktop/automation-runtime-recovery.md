# 自动化队列与运行持久化恢复（2026-09-29）

本轮接续 G-UX-04，复核自动化实际排队、启动、结束和重启恢复；不重复整套桌面验收。

## 问题与修复

- 原调度器先修改共享状态再等待保存，队列可能在落盘前被其他轮询执行，失败配置也可能被无关保存带入磁盘。现改为在串行队列里构建私有候选状态，校验、原子保存成功后才发布。
- 运行启动原先直接修改记录，可能与配置保存和失败回滚互相覆盖。主进程现在等待启动记录提交后才向 worker 发送任务；保存失败不能派发模型调用。新聊天关联也进入同一写入队列。
- 自动化持久化具有独立修订号，较早的后台全量快照不会覆盖新提交的配置、取消、删除和运行结果。发布保留当前运行引用的对象身份，并正确移除被清除的可选字段。
- 结束记录无法保存时，当前进程标记中断并给出“自动化保存失败，请检查存储后主动重试”；重启不重放结果不明的运行。修复存储后可主动创建新的运行，旧记录仍保留。
- 排队取消写入失败会报告失败并保留原有持久记录，不假称取消已经生效。恢复存储后可以重试。暂停、删除、重复触发合并、同聊天串行和原有权限上限继续保留。

## 关键文件

- `apps/desktop/src/main/scheduler.ts`：私有候选状态、串行提交、聊天关联、等待启动提交。
- `apps/desktop/src/main/store.ts`：自动化专属持久化及旧快照合并保护。
- `apps/desktop/src/main/automation-state.ts`：提交后发布并保留运行对象身份。
- `apps/desktop/src/main/application.ts`：异步启动回调、发送前等待、初始化关联。
- `apps/desktop/test/scheduler.test.ts`、`test/automation-persistence.test.ts`、`test/e2e/automation-queue.nonvisual.spec.ts`：调度竞争、实际磁盘失败、重试与重启。
- `scripts/desktop-test-targets.mjs`：新增 `automation-runtime` 小范围入口，默认只运行 20 项单元测试。

## 实际验证

以下命令在仓库根目录执行。以 `--file` 开头的条目均使用 `npm run desktop:test:target --` 前缀。原始退出码和命令保存在 `.artifacts/automation-runtime-recovery/`。

| 命令 | 退出码与结果 | 记录 |
| --- | --- | --- |
| `--file test/scheduler.test.ts --grep 'occurrence remains invisible\|dispatch waits for serialized'` | 1；两个新增场景复现提前发布和启动记录竞争 | unit-regressions-failed.json |
| `--file test/scheduler.test.ts --file test/automation-state.test.ts` | 0；修复后 15 项通过 | runtime-unit-first.json |
| `--file test/automation-persistence.test.ts` | 1；3 项通过、1 项测试基线被实时对象更新导致失败 | store-fixture-failed.json |
| 同一持久化文件，改为克隆不可变测试基线后 | 0；4 项通过 | store-unit-final.json |
| `npm run desktop:test:target -- automation-runtime --level unit` | 0；最终 20 项通过，包含新增的启动保存失败不得调用模型 | unit-final.json |
| `npm run desktop:test:target -- automation-runtime --level native` | 1；前 7 项通过，最后一项在带数量徽标的导航定位器处失败 | native-first.json |
| `--file test/e2e/automation-queue.nonvisual.spec.ts --grep 'automation completion storage failure'` | 0；修正导航定位后，仅重跑该项通过 | native-completion-final.json |
| `--file test/e2e/goals.nonvisual.spec.ts --grep 'goal UI persists'` | 0；1 项既有真实 worker 目标流程通过，验证共享异步启动回调 | native-goal-integration.json |
| `npm run desktop:check` | 0；最终代码和测试类型检查通过 | desktop-check.log |
| `node --test scripts/desktop-test-target.test.mjs` | 0；16 项选择器检查通过 | 本轮命令输出 |

去重后为 20 项自动化单元、8 项自动化原生流程及 1 项 Goal 关联回归，另有 16 项选择器检查。失败整次运行保留退出 1，不改写为整组通过。首次类型检查还发现测试的空数组断言造成过度类型收窄，修正后已重跑相关单元与最终类型检查；原记录保留为 `desktop-check-fixture-failed.log`。

原生场景覆盖真实 Electron/IPC、本地假供应商、定时器、重复触发、忙碌聊天排队、独立模型权限、Worktree 初始化、实际磁盘写入失败、重启及主动重试。既有编辑器的中英文、深浅主题及 1440×940 / 1000×700 / 1280×800 DOM 布局检查通过；本轮没有新增视觉样式，也没有宣称像素验收。

本轮没有验证物理断电或真实付费供应商。已开始而结果不明的运行保持中断，不声称具有外部副作用的严格一次执行保证。

## 临时目录与运行

所有新增测试复用所有权临时目录；每个原生用例关闭后断言目录不存在。只读审计命令 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/automation-runtime-recovery.json` 退出 0：scanned=1、eligible=0、skipped=1，没有新增残留。既有 `pi-acceptance-9NrmPU` 保留，没有重试此前被拒绝的删除。

启动使用 `npm run desktop:dev`。没有新增依赖、修改锁文件或共享包，没有全套测试、提交、发布或制作 EXE。整体 Goal 继续 active；下一项复核记忆及可选子任务的运行恢复。
