# 文件编辑：重新加载与上下文隔离

持续 Goal 的 G-UX-04 接续项。保留现有编辑器、文件标签和确认框，修复重新加载失败丢失未保存内容的真实缺陷。整体 Goal 保持 active。

## 实现与边界

- 确认重新加载后先读取替代版本，成功后才替换草稿。读取失败保留原文、保存基准、错误和关闭保护；可恢复文件后再次确认加载。
- 读取期间继续输入的内容不会被迟到结果覆盖；即使输入恢复到旧磁盘原文，也不把它当成新磁盘版本已保存。外部版本变化仍保留原保存基准，不绕过主进程校验。
- 保存、关闭、读取交错时，旧读取不能覆盖新保存或重建已关闭的缓冲。保存回执仍校验真实内容、换行和版本。
- 放弃确认绑定任务、目录、内容及版本。切换任务或目录后撤销旧确认；同范围内容变化后需要重新核对。
- 同名文件在不同目录分别持有草稿、读写结果和关闭保护。后台保存与重新加载结果只回到来源目录。
- 仍是窗口会话内草稿保护，没有新增崩溃后草稿恢复或差异合并编辑器。外部版本冲突需用户核对后显式重新加载；真实文件权限、IPC 和应用关闭策略不变。

## 定向验证

| 实际命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/file-editor.spec.ts --grep 'failed confirmed reload'` | 1 | 首次复现：重新读取失败后编辑器与草稿消失 |
| 同上，修复后 | 0 | 1 项重新加载恢复通过 |
| `node --import tsx --test apps/desktop/test/file-buffers.test.ts` | 0 | 9 项缓冲与读写交错检查 |
| `npm run desktop:test:target -- --file test/e2e/file-editor.spec.ts` | 0 | 17 项 UI：包括加载中编辑、确认隔离和同名文件后台读写 |
| `npm run desktop:test:target -- --file test/e2e/file-editor.nonvisual.spec.ts` | 1 | Windows 换行/BOM 流程通过；新用例错误使用夹具文案，整轮保留失败记录 |
| `npm run desktop:test:target -- --file test/e2e/file-editor.nonvisual.spec.ts --grep 'native external modification'` | 0 | 仅重跑修正用例：真实外部修改、读取失败、草稿保护、恢复与重启 |
| `node --import tsx --test apps/desktop/test/file-save-verification.test.ts` | 0 | 4 项：真实 Windows 文件锁、外部变更及回执验证 |
| `node --import tsx --test --test-name-pattern 'every translation' apps/desktop/test/localization.test.ts` | 0 | 1 项词条插值检查 |
| `npm run desktop:check` | 0 | 桌面类型检查 |

去重后 17 项 UI、2 项原生流程、14 项相关单元检查取得通过证据。既有双语/深浅主题、1440×940、1280×800、1000×700 的编辑器状态与溢出检查通过。没有截图、视频、trace 或像素验收；目录切换与异步时序使用本地协议夹具，真实文件版本冲突另由 Electron 用例验证。

报告位于 `.artifacts/file-recovery/`：`reload-draft-red.json`、`reload-draft-green.json`、`file-ui-green.json`、`file-native-first-failed.json`、`file-native-green.json`。首次原生失败使用了 UI 夹具的“外部修改”文字，真实后端返回“已被其他程序修改”；修正测试预期，没有放宽产品版本校验。

## 缓存与接续

- UI 夹具改为复用 TemporaryDirectories 所有权清理，正常与失败均执行收尾。原生用例关闭后检查实际 storage 已不存在。
- 首次原生失败在关闭未保存编辑器时遇到 Playwright 对话框会话关闭异常，留下一个已确认归属的测试目录。不是成功清理；已记录后使用现有安全清理脚本删除，文件内容 19,158,213 字节。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/file-recovery-final.json` 退出 0，候选残留 0。清理前及实际清理报告为 `file-recovery.json`、`file-recovery-cleaned.json`。
- 没有改动依赖或测试入口，不运行全套检查、提交、发布或制作 EXE。下一项复核审查/Git 操作的失败恢复、异步结果和工作目录隔离。
