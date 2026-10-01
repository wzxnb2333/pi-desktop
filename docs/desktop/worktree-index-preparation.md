# Worktree 索引准备的中断清理（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。本轮收尾已登记的索引准备临时文件问题；后续转向浏览器和 PDF/HTML 产物使用流程，不把 Worktree 的局部验收视为整个目标完成。

## 实际改动

- 真实 Electron 回归复现：索引准备完成、正式恢复凭据尚未发布时终止主进程，重新启动并成功恢复后仍留下 index.pi-restore-... 临时文件。原来只依靠 finally 删除，无法处理进程退出。
- 准备输出改为写入独立目录，先持久化目录身份与对应归档索引树，再执行 Git。重试使用新的文件名生成校验基准，核对此前完整或部分写入的私有索引/锁文件，然后清理目录与记录。
- 只接受已登记目录内的预期文件名和普通文件；目录替换、未知文件、非匹配内容以及正式恢复凭据被替换均保留。外部变更阻止清理时会移除本次能够确认的派生输出，避免每次重试继续堆积。
- 空目录启动失败、准备前后配置落盘失败、取消、文件清理失败均可重试。部分输出尚需恢复时保留登记，不用无依据的目录扫描或前缀匹配删除未登记旧文件。
- 对已存在暂存区的校验改为只读比较暂存条目，不再复制用户索引并执行 write-tree。保留索引原始字节、文件身份、版本与标志；实际索引发布仍沿用标准锁和恢复凭据保护。
- 新增错误文案进入现有双语恢复提示，继续使用 Worktree 管理的恢复入口，没有新增常驻工具栏按钮或叠加窗口。

主要文件：apps/desktop/src/main/worktree-index-preparation.ts、worktree-restore-index.ts、worktree-archives.ts、shared/worktrees.ts、shared/operation-messages.ts。

## 定向入口

    npm run desktop:test:target -- worktree-index-preparation
    npm run desktop:test:target -- worktree-index-preparation --level native

默认只执行 11 项准备阶段单元测试，原生层级只选 2 项准备阶段中断和 1 项状态保存失败场景。改动正式索引发布机制时再选择现有 locked/published/外部锁场景；不自动附带全部 Git、文件编辑或桌面测试。

## 本轮证据

报告目录为 .artifacts/worktree-index-preparation/。命令默认从仓库根目录运行，单独注明工作目录的除外。

| 命令 | 退出码与结果 | 证据 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/e2e/worktree-restore.nonvisual.spec.ts --grep 'index preparation' | 修复前 1：重启恢复后仍有临时索引；首个修复后 0，1 项通过 | native-red.json、native-first-green.json |
| npm run desktop:test:target -- worktree-index-preparation | 0，当时新增的 10 项单元通过 | unit-green.json |
| npm run desktop:test:target -- --file test/worktree-index-preparation.test.ts --grep 'split indexes' | 0，随后增加的 1 项独立配置检查通过，无新增共享索引缓存 | split-index-green.json |
| npm run desktop:test:target -- --file test/e2e/worktree-restore.nonvisual.spec.ts | 0，6 项相关原生流程通过 | native-green.json |
| 在 apps/desktop：node --import tsx --test --test-reporter=tap test/worktree-archives.test.ts test/localization.test.ts | 0，18 项既有归档/恢复与词条单元通过 | regression.log，保留完整输出 |
| npm run desktop:check | 最后一次代码/测试修改后退出 0 | 本轮命令输出 |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项定向选择器检查通过 | 本轮命令输出 |

去重后为 29 项相关单元、6 项真实 Electron/Git 流程和 16 项选择器检查。原生用例覆盖准备输出完成后结束进程、构造 16 字节私有锁文件后结束进程、持有正式索引锁及已发布后的结束恢复、外部锁保护，以及配置写入失败后的重试。使用本地仓库和假供应商；没有真实账号或付费供应商请求。

每个原生夹具结束后断言其数据目录不存在。最终只读缓存审计：

    node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/worktree-index-preparation.json

退出 0，scanned=1、skipped=1，仍只有前轮受阻的 D:/systemp/pi-acceptance-9NrmPU，201820 字节，没有新增测试目录残留。旧目录缺少可验证的夹具签名，未绕过此前的自动审批拒绝执行删除。

## 范围与接续

- 没有运行全套桌面/整仓测试，没有提交、发布或制作 EXE。原生夹具只构建需要的开发 main/preload，截图、视频和 trace 关闭。
- 证据覆盖明确的故障注入与真实主进程重启，不声称所有 Git 子进程写入时点、整机断电或磁盘损坏均已验收。
- 未登记的历史临时文件不按名称自动清理。本轮解决新流程的登记、验证及重试回收。
- 下一轮复核浏览历史、站点数据操作及失败反馈，再推进 PDF/HTML 预览与标注；整体 Goal 仍未完成。
