# Worktree 文件恢复的中断与临时目录（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。上一轮完成归档回收，本轮处理恢复普通文件时的部分写入，以及这些恢复临时文件的重试和清理。独立索引准备阶段的临时文件仍单独待验收。

## 缺陷与实现

- 原恢复逻辑直接向目标文件写入。定向注入真实部分写入后抛出 EIO，目标留下 3 字节的半截二进制文件；再次恢复把它当作外部修改而停止。首次回归实际失败，没有把该状态视为可恢复。
- 现在先向应用拥有的独立临时目录写入完整归档内容，刷新并校验后，以排他硬链接发布到目标路径。发布不会覆盖并发创建的目标，写入失败或取消不会在执行目录中留下新半截文件。
- 临时目录身份和对应归档树在写文件前持久化。重启/重试只处理符合归档内容前缀的自有 .part 文件；非匹配内容、未知文件、目录身份替换均保留现场并提示错误。目录缺失时可以从仍保留的归档重新准备，不替换已经恢复的完整文件。
- 文件发布后、临时链接清理前结束进程，重试保留目标文件的身份与内容。原暂存区、未暂存内容、二进制文件、草稿和主仓库索引均保留。
- 恢复成功但临时目录清理失败，与恢复失败分开显示。原 Worktree 管理面板提供“清理恢复临时文件”，可直接重试；应用重启也会核对后收尾。提示和操作支持即时英文切换，没有增加顶部按钮或新弹窗。
- 随后复现清理操作错误沿用“必须关闭工作区窗口”的归档前置条件。仅对已恢复、没有待回收旧目录的临时文件清理允许保留当前窗口；正常归档、运行中任务及其他保护仍使用原校验。原生回归确认可在原聊天清理、草稿保留，而归档当前已打开工作区仍被拒绝。
- 新增可选 restoreFiles 状态字段，旧记录不需要该字段。普通文件临时数据与索引恢复凭据分别清理，失败不会把工作区重新标成归档或覆盖已恢复文件。

主要实现：apps/desktop/src/main/worktree-restore-files.ts、worktree-archives.ts、application.ts、shared/worktrees.ts、shared/operation-messages.ts、renderer/src/components/shell/worktree-manager.tsx。

## 定向测试

按实际改动选择其中一个层级：

    npm run desktop:test:target -- worktree-restore-files
    npm run desktop:test:target -- worktree-restore-files --level native

默认只执行 10 项文件恢复单元测试。native 选择 3 项文件恢复/界面流程，加 1 项既有状态保存失败回归。需要更小范围时使用 --file 与 --grep；不会自动运行全部 Worktree、Git 或桌面回归。

## 本轮验证

报告目录为 .artifacts/worktree-restore-files/。同一用例的失败、修复和重跑不重复计入通过数量。

| 命令 | 退出码与结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/worktree-restore-files.test.ts | 修复前 1：目标路径存在半截文件；首个修复后 0，1 项通过 | partial-write-red.json、partial-write-green.json |
| npm run desktop:test:target -- --file test/worktree-restore-files.test.ts | 补齐场景后 0，10 项通过 | unit-green.json |
| npm run desktop:test:target -- worktree-restore-files --level native | 0，4 项真实 Electron/Git 流程通过 | native-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-restore-files.nonvisual.spec.ts --grep 'cleanup failure' | 切回原聊天后首次 1；修复后 0，清理和正常归档拒绝分别验证 | open-workspace-red.json、open-workspace-green.json |
| npm run desktop:test:target -- --file test/worktree-archives.test.ts --grep 'archives and restores\|interrupted restoration\|executable index modes\|restoration retries a failed state save' | 0，只选择 4 项关联回归 | archive-regression-green.json |
| npm run desktop:test:target -- --file test/localization.test.ts | 0，3 项词条/持久化验证通过 | locale-green.json |
| npm run desktop:check | 最后一次代码与测试修改后退出 0 | 本轮命令输出 |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项选择器检查通过 | 本轮命令输出 |

去重后为 17 项相关单元、4 项原生流程与 16 项选择器检查。原生文件使用本地仓库和假供应商，真实终止主进程并重启：一个断点位于部分临时写入后，另一个位于完整目标发布后。还验证外部临时内容修改拒绝、即时语言切换、界面恢复重试、清理失败后的原地操作和发布后状态保存失败。

每个本轮原生夹具关闭后均断言其数据目录不存在。只读缓存审计：

    node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-restore-files.json

退出 0，scanned=1、skipped=1，只有前轮受阻的 D:/systemp/pi-acceptance-9NrmPU（201820 字节），没有本轮新增残留。该目录之前的删除被自动审批拒绝；本轮仍未取得可验证的夹具签名，没有换用其他删除手段。

## 边界与接续

- 没有执行全量桌面或整仓检查，没有提交、发布或制作 EXE；原生夹具只构建需要的开发 main/preload，截图、视频和 trace 关闭。
- 本轮证据针对普通归档文件写入、两个真实进程终止点、取消和恢复，不代表整机断电、磁盘损坏或每一处文件系统竞争均已覆盖。
- 未完成项：独立索引准备阶段被强制终止后的临时文件回收。收尾后继续浏览器与 PDF/HTML 产物使用流程复核，整体功能和体验验收尚未完成。
