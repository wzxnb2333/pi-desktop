# 项目环境与动作恢复（2026-09-29）

本轮属于 G-UX-04，核对项目命令的保存、草稿、执行及取消。持续 Goal 保持 active，不代表 Worktree 生命周期或全部功能验收完成。

## 实际缺陷与实现

- 将真实测试数据目录的 `desktop.json.tmp` 替换为目录，复现“保存报错但新命令已经出现在运行状态”的缺陷。此前主进程先修改项目对象再写文件；现在通过 `JsonStore.saveProjectEnvironment` 在写队列内校验旧配置，完成原子替换后才发布新配置。写文件或备份失败保留原命令，同一草稿可以重试。
- 已排队的后台保存按项目合并成功提交的环境配置，不能把新命令覆盖回旧版本；同时保留背景快照中的其他项目、名称、运行状态和 UI 更新。并发旧表单、项目移除和损坏存储有明确拒绝路径。
- 项目配置草稿及进行中的保存保留在当前窗口内，关闭配置面板或切换任务后可继续编辑。保存应答只确认提交版本，不覆盖等待期间的新输入；窗口退出后的未保存草稿不声称能够恢复。
- 配置冲突就地提示，替换草稿使用面板内确认，不增加叠加弹窗。错误随语言立即切换；开始保存时撤销旧的替换确认，避免在等待中改换保存基准。
- 保存、启动和取消均防止重复提交。动作错误和迟到应答归属于来源任务、目录，不在其他任务打开终端或配置面板。仍在运行的旧动作不受最近十条记录限制，始终保留停止入口。
- 取消失败可重试，取消应答后保留等待状态，直到权威操作记录结束。使用真实 Windows PTY 验证取消和退出均结束两级派生进程，再保存完成状态；本轮没有替换 PTY 终止实现或放宽任务权限。

## 定向入口

在仓库根目录使用 `npm run desktop:test:target -- project-actions`，默认只选 8 项单元测试和 6 项 UI 用例。涉及实际命令、主进程保存或退出时追加 `npm run desktop:test:target -- project-actions --level native`，只选择 4 项 Electron 流程。单个失败继续使用 `--file` 和 `--grep`，不执行整个 Git、Worktree 或终端测试集。

## 本轮验证

下面列的是实际执行命令，重复运行同一用例不重复计数。报告位于 `.artifacts/project-action-recovery/`。

| 命令 | 退出码 | 结果 / 报告 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最终桌面类型检查通过 |
| `npm run desktop:test:target -- --file test/project-environment-persistence.test.ts` | 0 | 新增 6 项真实磁盘/队列验证，`unit-green.json` |
| `npm run desktop:test:target -- --file test/project-environment.test.ts` | 0 | 2 项既有 schema/真实 PowerShell 命令验证，`existing-unit-green.json` |
| `npm run desktop:test:target -- --file test/settings-persistence.test.ts --grep 'mixed settings publish\|plugin records publish'` | 0 | 仅 2 项共享写队列回归，`settings-queue-green.json` |
| `npm run desktop:test:target -- --file test/review-persistence.test.ts --grep 'queued feedback'` | 0 | 仅 1 项注释与设置交错保存，`review-queue-green.json` |
| `npm run desktop:test:target -- --file test/e2e/project-action-recovery.spec.ts` | 1 | 首轮 3 项通过、1 项失败、2 项未运行，`ui-first-run.json` |
| `npm run desktop:test:target -- --file test/e2e/project-action-recovery.spec.ts --grep 'late action acknowledgement\|cancelling a running\|older active'` | 0 | 修正导航等待后 3 项通过，`ui-remaining-green.json` |
| `npm run desktop:test:target -- --file test/e2e/project-action-recovery.spec.ts --grep 'stale environment\|late action acknowledgement'` | 0 | 增加保存时撤销替换确认及应答完成断言，2 项通过，`ui-final-fixes.json` |
| `npm run desktop:test:target -- project-actions --level native` | 0 | 最终 4 项真实 Electron 流程通过，`native-final-green.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器检查通过 |

去重后本轮 11 项相关单元、6 项 UI、4 项原生流程取得通过证据；另有选择器 16 项。首次原生缺陷保存在 `persistence-red.json`（退出 1），核心修复后的两个新增原生用例保存在 `native-first-green.json`（退出 0）；最终 UI 代码更新后已复核四项原生用例，不把旧失败运行改写为通过。

UI 首轮失败是夹具发布任务切换事件后，在 React 导航尚未完成时就释放应答。修正为先断言目标任务已显示，再释放并等待动作按钮恢复；这没有降低来源任务隔离断言。

原生用例使用本地测试数据，覆盖真实命令与输出、Worktree 初始化只写新目录、运行中更新配置仅用于下次执行、磁盘失败重试、取消/退出派生进程及重启记录。没有真实远端账号、逐像素或全套桌面验收。开发夹具仅构建所需 main/preload，没有制作 EXE。

## 缓存与后续

新增用例复用临时目录所有权清理；原生流程在结束后断言测试数据目录已经删除。最终清理审计命令：

```powershell
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/project-action-recovery.json
```

退出 0，扫描到 0 个候选残留；匹配本轮测试的 Node 辅助进程检查没有残留。没有截图、视频、trace、提交或发布。

下一项继续复核 Worktree 创建、迁移、归档及恢复的取消、失败与退出。当前已取得的“新建后初始化”证据不能代表整个 Worktree 生命周期通过。
