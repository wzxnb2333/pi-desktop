# 提交确认与迟到取消

G-UX-04 接续：修复提交已经生效，但取消或后续索引同步失败仍被当作提交失败的问题。原持续 Goal 保持 active，没有缩减范围。

## 行为与实现

- 实际 post-commit 钩子运行时 HEAD 已更新，旧实现仍抛出“Git 操作已取消”，界面保留可再次提交的草稿。首轮失败保存在 `.artifacts/git-commit-completion/late-cancel-red.json`。
- 每次选中文件提交使用独立的 reflog 标识确认本次调用产生的提交。取消后仍读取结果；不能仅因 HEAD 移动就把外部提交认作本次成功。标识不写入提交正文，不持久修改用户的 Git 配置。
- 主进程返回带提交 ID、中断状态和后续警告的结构化结果。界面明确显示“提交已完成；后续步骤已中断”，清除对应已提交草稿与选择，保留请求期间新输入的文字。应用标签即时中英切换，原始 Git 输出保持原文。
- 同步暂存区先取得标准索引锁，在副本中更新选中文件，再校验索引与 HEAD/分支基线并原子发布。并发暂存、外部 HEAD 变化及索引锁失败均保留现状，显示已经提交及需要核对的提示，不自动重复提交。不会删除其他进程的索引锁。
- 正常退出在提交已生效时仍完成后续索引同步与临时文件清理；重启不再次提交。用户可以在同步失败后刷新并主动取消暂存，恢复到与提交一致的状态。
- 额外复现并修复嵌套项目的文件名校验：暂存路径按项目相对路径比较，Unicode 文件名可提交，仓库相邻文件保持原来的暂存状态。

关键文件：`src/main/git-commit.ts`、`src/main/git-workflow.ts`、`src/shared/git-results.ts`、`src/shared/review-messages.ts`、`src/renderer/src/components/panels/git-panel.tsx`（相对 apps/desktop）。

## 验证记录

均从仓库根目录运行。最终不同用例合计 11 项相关单元、1 项 UI、6 项原生流程，另有定向脚本 16 项检查。不是整仓或全桌面验收。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/git-commit-completion.test.ts` | 0 | 最终 8 项通过；`unit-green.json` |
| `npm run desktop:test:target -- --file test/git-cancellation.test.ts --grep 'cancelled commits\|Git shutdown\|queued Git cancellation'` | 0 | 既有提交前取消、退出和排队 3 项通过；`early-cancel-green.json` |
| `npm run desktop:test:target -- git-commit --level ui` | 0 | 1 项草稿/选择与任务切换回归通过；`ui-green.json` |
| `npm run desktop:test:target -- --file test/e2e/git.nonvisual.spec.ts --grep 'Git late\|Git post-commit\|Git cancellation\|Git shutdown\|Git workbench fetches'` | 0 | 6 项真实 Electron 流程通过；`native-green.json` |
| `npm run desktop:check` | 0 | 最后一次桌面源代码及原生测试修改后的检查通过 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项脚本检查通过；新增 git-commit 模块的文件和名称选择有效 |

表内 JSON 位于 `.artifacts/git-commit-completion/`。初次迟到取消失败、首次修复通过以及嵌套路径的失败与定向重跑，分别保留在 `late-cancel-red.json`、`first-green.json`、`nested-red.json`、`nested-green.json`；首次 8 项运行中的 7 项通过不把该整轮改写成成功。修复静默 HEAD 查询后再执行最终 8 项，取得上述最终证据。

单元场景包含：提交后的取消与正常退出、钩子修改选中内容后的索引同步、并发外部暂存、索引锁存在、HEAD 外部移动、外部提交不能冒认、用户禁用 reflog 时的首次提交、嵌套目录与 Unicode 路径。

新增 3 项原生场景验证：重开面板后取消并显示真实提交 ID/中英文提示，正常退出/重启不重复提交，提交后索引锁失败的提示和显式取消暂存恢复。另复核 3 项既有实际 Git 流程，远端使用本地 bare 仓库。

## 清理与边界

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/git-commit-completion.json` 退出 0；只读审计发现 0 个受管候选目录。本轮测试目录与辅助进程均按既有所有权机制清理，没有新增截图、视频或 trace。

- 本轮覆盖 Windows x64、真实本地 Git/钩子/文件系统及正常退出，不声称断电、强制杀进程或真实账号网络联调已经验证。
- 无法读取提交证据时显示需要核对历史，不推断成功，也不自动重新提交。索引同步警告不等于撤销已经产生的提交。
- 系统拒绝终止 Git 子进程的即时反馈、再次取消与退出恢复仍是下一项，未登记为完成。其他纳入功能继续按台账推进。
- 不运行整套回归，不提交、不发布、不制作 EXE。开发启动：`npm run desktop:dev`。

日常定向入口：`npm run desktop:test:target -- git-commit`（8 项单测与 1 项 UI）；实际取消/退出/恢复使用 `git-commit --level native`（仅 3 项）。
