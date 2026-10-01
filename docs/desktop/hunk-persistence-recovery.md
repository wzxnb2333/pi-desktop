# 差异块恢复记录的落盘与中断恢复

本轮接续 G-UX-04，不改变持续 Goal 的范围，也不把阶段验收当作全部完成。

## 实现

- 恢复副本和初始记录完整写入后才发布；发布成功之前不改工作文件。正常准备失败清理本次准备目录，不产生可被误用的半条记录。
- 记录状态通过固定候选文件和原子替换更新，部分写入不会截断上一份完整记录。失败候选保留在该记录目录，重试覆盖同一个候选，不逐次创建缓存。
- 恢复前先保存 `restoring` 意图。文件写入成功但回执失败时，保留足够的版本信息区分“尚未恢复”和“文件已恢复、记录待确认”。重启后按实际文件哈希核对，不自动重写项目文件。
- 文件已恢复但记录未完成时，界面提供“完成恢复记录”；重试只保存状态，不重复写入文件。未执行的撤销显示禁用状态，外部修改、备份损坏及目录不匹配继续拒绝覆盖。
- 某条记录损坏或缺失不再阻止其他有效记录恢复。列表分别显示可用项和可展开的错误，并提供刷新；不自动删除无法解析的记录和副本。
- 沿用既有 Git 面板与错误组件，增加中英文状态和恢复说明，没有增加顶部按钮。主进程现有仓库操作锁、路径校验及权限入口保持生效。

## 定向证据

合计 **12 项不同单元用例、4 项不同 UI 用例、3 项真实 Electron 流程**取得通过证据。重复运行不重复计数，未运行完整桌面或整仓回归。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/hunk-recovery.test.ts --grep 'recovery state write failures'`（修复前） | 1 | 缺少恢复前状态落盘保护；预期拒绝未发生，`state-red.json` |
| `npm run desktop:test:target -- --file test/hunk-recovery.test.ts`（首次） | 1 | 新测试辅助函数漏写闭合括号，未执行测试；`unit-syntax-failed.json` |
| 同一文件命令（修正后） | 0 | 11 项通过，`unit-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'recovery record\|recovery history\|hunk preflight'` | 0 | 4 项通过，`ui-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-history.nonvisual.spec.ts --grep 'hunk'` | 0 | 3 项通过，`native-green.json` |
| `npm run desktop:test:target -- --file test/hunk-recovery.test.ts --grep 'interrupted restore receipt'` | 0 | 完成记录入口所需状态的 1 项回归通过，`receipt-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'recovery history'` | 0 | 最终中英文、深浅主题的 2 项回归通过，`ui-receipt-green.json` |
| `npm run desktop:test:target -- --file test/hunk-recovery.test.ts --grep 'stale versions\|added and deleted file existence'` | 0 | 2 项通过，包含新增、删除文件的中断恢复，`existence-green.json` |
| `npm run desktop:check` | 1 → 0 | 首次发现 mock 回调隐式类型，改用文件系统 API 的参数类型；最终所有修改后退出 0 |

报告均位于 `.artifacts/hunk-persistence/`。失败运行保留原始退出码，不改写为通过；仅重跑失败或后续修改影响的用例。

单元测试使用真实临时仓库，覆盖版本校验、暂存区不变、备份校验、坏记录隔离、写入部分 JSON 后失败、恢复过程中外部编辑以及新增/删除文件。部分写入和精确时序用受控文件系统故障注入，其余读写通过实际文件系统执行。

原生测试通过实际 IPC 和界面操作，在记录候选路径放置测试目录制造真实磁盘写入失败，随后解除故障、重启并恢复；坏记录存在时仍可恢复有效文件。中断场景构造对应的持久化状态再重启应用，不声称模拟了断电或强杀过程中所有时机。

UI 检查深浅主题、中文切英文、1000×700、1280×800、1440×940 的 DOM 溢出和按钮状态，未做逐像素验收。

## 清理与后续

- 单测复用临时目录所有权机制；原生 fixture 关闭后确认目录不存在。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/hunk-persistence.json` 退出 0，候选残留 0。恢复副本属于持久数据，不作为可再生缓存清理。
- 未启用截图、视频、trace，没有提交、发布或制作 EXE。开发启动：`npm run desktop:dev`。
- 下一项检查真实 Windows Git 子进程取消、退出与迟到回执；本轮不声称该项已通过。整体 Goal 保持 active。
