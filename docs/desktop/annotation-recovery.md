# 网页标注保存与删除恢复（2026-09-29）

持续 Goal 的 G-UX-04 接续。整体目标保持 active，本轮只复核网页标注流程，没有把局部验证当作全部功能完成。

## 实现

- 网页标注改用现有紧凑面板。截取、保存、读取、加入草稿及删除有同步操作锁；连续点击只发出一次操作，保存期间保留输入和选择并禁用相关控件与关闭入口。
- 替换带说明的截图先确认。截取失败继续保留原截图、元素/区域和说明；任务切换或窗口关闭后的迟到结果不能填入另一个任务。主进程以窗口身份和捕获序号核对结果，应用退出、任务关闭及新截图会使旧请求失效。
- 网页读取设置 30 秒上限。超时释放等待；迟到 DOM 结果不会继续触发截图。此上限不假称终止 Chromium 内部已经开始的工作。
- 元数据采用 JsonStore 的写队列，原子落盘后才发布。后台保存不会提交失败草稿，也不会覆盖已完成的标注提交；审查评论、运行状态及设置仍使用原有数据对象。
- 保存失败后可重试同一截图；重复回执只对应一条记录。相同所有者、相同截图字节的遗留文件可以复用，不覆盖其他内容。成功删除会使原捕获失效，旧保存请求不能恢复已删除标注。
- 保存已成功但页面复核失败时仍显示保存内容和截图，提供“重试读取标注”，不会误导用户再次保存。加入草稿失败可以重试，同一附件已经在草稿中时不会再次追加说明。
- 删除先提交删除意图，再移除截图、最后提交记录移除。截图无法移除或最后落盘失败时保留“删除尚未完成，可重试”的记录；重启后可继续，截图已经不存在也能完成收尾。未完成删除的记录不能作为正常标注读取或附加；已加入聊天的截图副本保留。
- 删除失败保留原确认框和错误，取消后列表仍有重试入口。说明、错误与操作状态即时中英切换；不新增常驻工具栏。

主要实现：src/main/browser-annotations.ts、src/main/store.ts、src/main/application.ts、src/shared/browser-annotations.ts、src/shared/browser-messages.ts、src/renderer/src/components/panels/browser-annotations.tsx（均位于 apps/desktop）。

## 定向命令

    npm run desktop:test:target -- annotations --level unit
    npm run desktop:test:target -- annotations --level ui
    npm run desktop:test:target -- annotations --level native

默认 annotations 只选择相关单元和 UI；原生流程需显式指定 native。只改某个场景时继续使用 --file / --grep，不附带浏览历史、网站权限或 PDF/HTML 测试。

## 实际验证

下列命令均从仓库根目录执行。报告保存在 .artifacts/annotation-recovery/。

| 命令 | 退出码及结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- annotations --level unit | 0，13 项（含 4 个捕获生命周期子场景） | unit-timeout.json |
| npm run desktop:test:target -- annotations --level ui | 0，9 项，约 6 秒 | ui-first.json |
| npm run desktop:test:target -- annotations --level native | 1，前三项通过；第四项测试在重启后仍使用旧 Page 定位器 | native-first.json |
| npm run desktop:test:target -- --file test/e2e/browser-annotations.nonvisual.spec.ts --grep 'screenshot deletion failures' | 0，修正定位器后只重跑该项，验证真实 IPC、删除失败、重启和附件保留 | native-delete-retry.json |
| npm run desktop:test:target -- --file test/review-persistence.test.ts --file test/browser-annotations-recovery.test.ts | 0，21 项；包含最后的旧捕获不可恢复已删除记录检查及既有审查写队列回归 | store-final.json |
| npm run desktop:test:target -- --file test/e2e/browser-annotations.nonvisual.spec.ts --grep 'page annotations preserve' | 0，增加超时后复核正常截图、保存、附加、过期、删除和重启 | native-final.json |
| npm run desktop:check | 0，最后一次代码修改后通过 | desktop-check.log |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项测试选择器检查 | 本轮终端输出 |

去重后 22 项相关单元、9 项 UI、4 项原生流程取得通过证据；另有 16 项选择器检查。初次类型检查发现测试替身被强转为完整 WebContents，已将服务接口收窄为实际使用的方法后通过。最初误用 --unit 的命令被入口拒绝，正确参数为 --level unit，没有误触完整套件。

双语、深浅主题及 1440×940、1280×800、1000×700 的 DOM 布局与错误恢复检查通过，不等同于逐像素或人工视觉验收。超时用可控时钟验证；磁盘故障使用真实临时目录阻塞写入/删除。没有声称外部账号、断电、磁盘损坏或 PNG 写入中强制结束进程已经验收。

## 缓存和后续

- 新测试使用已有所有权临时目录。所有原生测试结束均确认存储目录不存在；常规回归不留截图、视频和 trace。功能所需的临时截图随测试数据一起清理。
- 只读审计命令：node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/annotation-recovery.json，退出 0；scanned=1、skipped=1，仍仅保留旧 pi-acceptance-9NrmPU，没有新增残留，没有绕过先前删除拒绝。
- 没有全套测试、提交、发布或制作 EXE；原生夹具仅构建必要开发代码。
- 下一项进入 PDF/HTML 预览与标注的使用、保存和失败恢复。当前 Goal 继续 active。

开发启动：npm run desktop:dev。
