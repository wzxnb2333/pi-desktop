# Git 操作与面板恢复

本次属于 G-UX-04 的接续验收，不代表整个持续 Goal 完成。

## 问题与修复

- 原先关闭或切换审查面板会丢失正在执行的 Git 操作状态，重新打开后可重复提交操作。现在按任务、目录及工作区版本保留窗口会话内的操作、表单、选择和错误；来源任务的迟到结果不会污染当前任务。
- 取消按钮在重开面板、状态读取失败及语言切换后仍可使用。取消请求去重，失败可以重试；请求被接受后仍等待实际操作结束，不提前解除写入保护。
- 提交与评论成功只清理这次实际提交的草稿和路径，期间新输入的内容保留。读取行内容的迟到结果不能在另一目录打开评论表单。
- 撤销差异块的文件版本读取接入同一操作保护。准备期间可取消；切换任务、目录或差异选择后，不把旧读取结果用于撤销。重新打开保留选中的差异块，切换差异范围才重置选择。
- 恢复记录读取失败有独立重试入口，旧查询不能覆盖新结果。恢复写入未结束时隐藏、重开面板仍保留操作状态。

复用原有面板、进度和错误区域，没有新增常驻顶部工具。权限仍由现有主进程 IPC 校验，窗口内保存的草稿不宣称退出应用后恢复。

## 本轮验证

所有命令从仓库根目录执行。下列多次定向运行合计覆盖 **21 个不同 UI 用例、5 个原生流程**；重复运行的用例不重复计数。原生流程使用真实本地 Git、临时仓库和本地假供应商，不使用线上账号。

| 命令 | 退出码 | 结果与报告 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'Git actions remain pending'`（修复前） | 1 | 重开面板丢失进行中操作，`.artifacts/git-recovery/pending-red.json` |
| 同一命令（修复后） | 0 | 1 项通过，`pending-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts` | 1 | 12 项通过后，恢复记录用例遇到 StrictMode 两次读取；保留失败整轮，`ui-first-failed.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'recovery record\|pending status\|status read failure\|Git cancellation'` | 0 | 9 项通过；修正读取预期并验证乱序返回不会覆盖新结果，`ui-recovery-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-panel.spec.ts --grep 'hunk preflight\|selected hunk after'` | 0 | 2 项通过，`ui-hunk-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git.nonvisual.spec.ts` | 0 | 3 项通过，`native-git-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git-history.nonvisual.spec.ts --grep 'hunk revert and recovery'` | 0 | 1 项通过，`native-hunk-green.json` |
| `npm run desktop:test:target -- --file test/e2e/review.nonvisual.spec.ts --grep 'diff line comments persist'` | 0 | 1 项通过，`native-comment-green.json` |
| `npm run desktop:check` | 0 | 最后一次产品与测试代码修改后通过 |

表中简写报告均位于 `.artifacts/git-recovery/`。失败运行没有改写为通过；只补跑失败、尚未执行及后续修改影响的用例。

界面覆盖深浅主题、中文即时切英文，以及 1000×700、1280×800、1440×940 的 DOM 布局、溢出、草稿和操作状态。没有逐像素或截图验收。

原生验证包括本地 bare 远端的获取、跟踪、拉取、选定文件提交及推送，真实合并冲突、索引锁失败重试、多目录同名文件隔离、撤销指定差异块与重启恢复、行评论保存及位置过期。索引锁只在测试目录中创建和移除；未修改用户仓库暂存区。

## 清理与边界

- UI 与原生测试复用临时目录所有权机制；原生 fixture 关闭后确认目录不存在。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/git-recovery.json` 退出 0；只读审计候选目录 0。
- 未开启截图、视频、trace，没有全套检查、提交、发布或制作 EXE。
- 取消的界面、去重和 IPC 请求对应关系已验证；真实 Windows 慢 Git 子进程取消仍需独立复核。
- 差异块正常撤销和恢复已验证；恢复记录磁盘写入失败及中断后的恢复状态尚未验收，下一轮继续，不列为完成。

开发启动仍使用 `npm run desktop:dev`。整体 Goal 保持 active。

后续状态：差异块记录的写入失败与中断恢复已取得独立定向证据，见 [持久化恢复验收](hunk-persistence-recovery.md)；保留上文当轮验证边界，不回写历史结果。
