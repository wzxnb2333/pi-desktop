# 持续目标运行与保存恢复（2026-09-29）

G-UX-04 本轮复核产品内 Goal 的编辑、续轮、暂停、停止、归档和重启。开发任务自身的持续 Goal 保持 active，本模块通过不代表整个目标已经完成。

## 复现与修复

- 保存目标时先修改活跃对象、后写磁盘，导致尚未提交的说明和 active 状态已经能被快照或调度器读取。现在单独构造候选目标，通过主进程写队列和版本校验提交后才发布；延迟的后台快照合并已提交版本，清除不会被旧快照恢复。
- 一轮已经结束但结果保存失败时，旧 pendingRunId 仍占用任务。现在保守地记为中断、释放占用并停止自动续轮；用户修复存储后可显式恢复。该错误状态不代表验收成功，也不会把未保存编辑发布出去。
- 归档期间结束的轮次仍完成历史记录和清理，不再遗留“仍在执行”；归档、恢复任务及重启均不会自动重新启动目标。
- 真实 Electron 回归复现了存储失败使“停止任务”提前抛错、worker 继续运行的问题。现在即使目标暂停记录写入失败，也应用用户的运行时暂停意图并继续发送停止命令，随后明确报告未保存状态；重启不会自动重放不确定轮次。
- 面板同步阻止重复点击，保存失败保留编辑内容，错误在语言切换后重新翻译。清除失败保留原确认与重试入口，确认绑定目标身份和版本；目标被其他入口替换时旧确认不能删除新目标。
- 面板按任务隔离；迟到响应不能改写或关闭另一任务的编辑器。目标被其他入口清除时仍有可用的编辑与重新加载入口，聊天草稿保留。

暂停/停止是保守的运行时例外：持久化失败仍必须阻止自动续轮，不把磁盘故障当作继续执行授权。新目标、说明、验收证据和清除操作继续遵守提交后发布。恢复需要用户操作；目标不会扩大任务权限。

## 实际验证

报告保存在 `.artifacts/goal-recovery/`。以下 `--file` 命令均通过 `npm run desktop:test:target --` 执行。

| 命令或选择 | 退出码与结果 | 记录 |
| --- | --- | --- |
| `--file test/goals.test.ts --grep 'goal publication\|failed finalization'` | 1；两个缺陷稳定复现 | unit-regressions-failed.json |
| `goals --level unit`（首次修复后） | 0；当时 8 项通过 | runtime-unit-first.json |
| `--file test/goal-persistence.test.ts` | 0；4 项实际 JSON 写入验证通过 | store-unit-first.json |
| `--file test/e2e/goal-recovery.spec.ts --grep 'goal save deduplicates'` | 1；连续点击产生两次请求 | ui-duplicate-failed.json |
| `goals --level ui`（修复后） | 0；8 项面板恢复验证通过 | ui-first.json |
| `--file test/goals.test.ts --grep 'archiving an active'` | 先 1 后 0；归档占用缺陷复现并修复 | archive-unit-failed.json、archive-unit-pass.json |
| `goals --level native` | 0；当时 7 项原生流程通过，约 72 秒 | native-first.json |
| `--file test/e2e/goals.nonvisual.spec.ts --grep 'goal pause storage failure'` | 1；停止后仍为 running | native-stop-failed.json |
| `npm run desktop:test:target -- goals` | 0；最终 15 项单元和 8 项 UI 通过，约 7 秒 | quick-final.json |
| `--file test/e2e/goals.nonvisual.spec.ts --grep 'pause, stop, closing\|goal pause storage failure'` | 0；普通停止/重启及磁盘故障停止 2 项通过，约 25 秒 | native-stop-final.json |
| `npm run desktop:check` | 0；最终桌面类型检查通过 | desktop-check.log |
| `node --test scripts/desktop-test-target.test.mjs` | 0；最终 16 项选择器检查通过 | 本轮命令输出 |

第一次类型检查发现新 UI 夹具对可选 draft 的读取缺少保护，修正后重新执行受影响的 UI 与类型检查。失败运行保留原退出码；没有将其改写为通过。

去重为 **15 项单元、8 项 UI、8 项原生流程**，另有 16 项测试入口检查。最后只重跑改动影响的停止场景，其余仍有效的原生证据复用。原生测试使用真实主进程、worker、IPC、JSON 磁盘故障、重启和本地假供应商，没有调用真实账号或付费模型。

UI 覆盖中英文、深浅主题、1440×940 / 1280×800 / 1000×700 的 DOM 布局、草稿和确认行为；原生复核长表单滚动与焦点。没有宣称逐像素或人工视觉验收。

## 缓存与后续

本轮所有原生夹具关闭后都确认自己的目录已删除。只读审计 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/goal-recovery.json` 退出 0：scanned=1、eligible=0、skipped=1，仅旧的缺少可验证所有权签名的 `pi-acceptance-9NrmPU`（201820 字节）保留，没有新增残留或再次尝试删除旧目录。

没有运行全套桌面回归、提交、发布或制作 EXE。下一项推进自动化调度的运行恢复，再复核记忆和可选子任务；既有设置表单验收不冒充运行服务的完整验证。

开发启动：在仓库根目录运行 `npm run desktop:dev`。
