# 可选子任务的运行、结果回传与恢复

日期：2026-09-29。本次是持续 Goal 的一个已验证阶段，不代表整个功能范围完成。

## 本次修复

- 委派、启动、子聊天关联和结果采用同一串行状态队列。候选状态先写入磁盘再发布；保存失败不会把未提交的排队任务暴露给调度器。旧后台快照不能覆盖已提交的子任务记录。
- 停止覆盖正在提交的排队任务，在准备和运行检查点之后再次检查取消。停止保存失败仍发送真实停止信号，未启动任务保持中断，不因执行槽空出而运行。
- 重启不自动重放不确定任务；从已保存聊天的 subtaskId 恢复缺少的子聊天关联，保留已有结果与原始过程。
- 结果与“已加入草稿”凭据原子提交，保留父任务现有草稿及附件；重复点击、重试和重启不重复追加，不自动发送。
- 回传期间父任务草稿发生变化则拒绝覆盖，提示重新追加。大块写入仍异步；最终版本校验、文件原子替换和状态发布在同一事件循环中完成，避免校验与提交之间插入新的输入。
- 面板同步去重并按任务隔离。失败保留表单和请求标识，迟到响应不清空另一任务的内容；错误支持即时双语，等待时不能误关闭，仅修改环境/上下文选项也有放弃保护，默认聚焦取消。

## 实际验证

从仓库根目录执行。只运行受影响范围，未执行完整桌面或根级全套检查。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- subtasks` | 0 | 当时 16 项单元、8 项 UI 通过；后续新增第 9 项 UI 单独随该文件验证 |
| `node --import tsx --test apps/desktop/test/subtasks.test.ts apps/desktop/test/subtask-persistence.test.ts` | 0 | 修正测试类型后 16/16 通过 |
| `npm run desktop:test:target -- --file test/e2e/subtask-recovery.spec.ts` | 0 | 最终 9/9 通过；含中英文、深浅色与三种窗口尺寸的溢出/交互检查 |
| `npm run desktop:test:target -- subtasks --level native` | 0 | 当时 7/7；真实 Electron、Git Worktree、初始化、磁盘故障、停止、结果与重启 |
| `npm run desktop:test:target -- --file test/e2e/subtasks.nonvisual.spec.ts --grep 'subtask stop storage failure'` | 0 | 后加的保存失败仍停止实际子任务场景 1/1；去重后本轮原生共 8 项 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 定向选择器 16/16，未启动整套桌面测试 |
| `npm run desktop:check` | 0 | 最终桌面类型检查通过 |

证据目录：`.artifacts/subtask-recovery/`。保留 `unit-red.log`、`ui-red.json`、`desktop-check-first.log`、`unit-final.log`、`quick-final.json`、`ui-final.json`、`native-final.json`、`native-stop-failure.json` 与最终 `desktop-check.log`。quick-final 是当时运行的结果，不伪称包含后来新增的第九项 UI。

首次单测明确复现：保存尚未成功，公开队列长度已经为 1（期待 0）。首次面板测试明确复现：同帧点击两次产生两次请求（期待 1）。第一次类型检查发现测试使用了超出当前 lib 声明的 Promise.withResolvers，以及空数组断言导致的 never 收窄；改为现有 Promise 用法和长度断言后复测通过。初始直接 strip-types 调用不支持已有参数属性，随后使用项目既有 tsx 入口；未因运行方式错误改写产品行为。

原生测试只调用本地假供应商，不使用开发子代理、真实账号或付费模型；实际协议、worker、Windows 文件存储和 Worktree 都参与验证。没有截图、视频、trace 或像素验收；本轮不能当作全部页面视觉验收。

## 缓存与后续

所有新增夹具复用受管临时目录。原生每例退出后断言其根目录不存在，UI/单元夹具执行统一清理。最终只读审计 `.artifacts/temp-cleanup/subtask-recovery.json`：扫描 1、可清理 0、跳过 1，仅旧 `D:/systemp/pi-acceptance-9NrmPU`（201820 字节，缺少已验证签名）。未删除该旧目录；没有新增本轮残留。

真实 Goal 与 G-UX-04 保持 active。下一项按原范围复核独立/快捷聊天、多窗口和只读侧聊的草稿、结果追加与生命周期；历史验收可定位证据，但不直接代替当前实现的验收。
