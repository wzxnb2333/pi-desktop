# 只读侧聊、草稿追加与退出恢复

日期：2026-09-29。本记录是持续 Goal 的定向验收，不代表全部功能完成。

## 实现与修复

- 创建、保留为普通聊天及回答追加，均在磁盘提交成功后发布。失败不显示幽灵侧聊、不改变临时状态、不污染父任务草稿；旧后台快照不能覆盖已提交状态。
- 创建和发送保留请求标识，失败重试不重复执行。回答与追加凭据原子保存，重复点击、重试和重启不会再次追加；已有附件保持不变，不自动发送。
- 追加期间若父任务草稿发生变化，拒绝覆盖并允许重新追加。父任务删除阻止迟到的创建和保留；原有只读权限、指定时点上下文及主任务持续运行不变。
- 面板按父任务隔离，迟到响应不切换另一任务、不重新打开用户关闭的面板。失败保留草稿，输入法候选 Enter 不发送，错误与反馈即时中英文切换。
- 退出先等待已经接受的侧聊提交收尾，再清除临时侧聊；已保留的普通聊天继续保存。原生用例在 will-quit 时读取最终 desktop.json，证明清理发生在退出前，而非由下一次启动补救。

## 定向验证

命令均在仓库根目录执行。没有运行完整桌面、根级全套检查或真实付费模型。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/sidechat-context.test.ts apps/desktop/test/sidechat-persistence.test.ts` | 0 | 最终 8/8；包含上下文、并发草稿、旧快照、失败重试和退出等待 |
| `npm run desktop:test:target -- sidechat --level ui` | 0 | 8/8；双语、深浅主题、1440×940 / 1280×800 / 1000×700 的布局与交互 |
| `npm run desktop:test:target -- sidechat --level native` | 1 | 首两项磁盘故障/重启场景通过，第三项夹具缺少 ui.update 的 ui 字段而失败，后续未执行；整轮保留为失败 |
| `npm run desktop:test:target -- --file test/e2e/sidechat-recovery.nonvisual.spec.ts --grep 'late sidechat creation\|sidechat append rejects'` | 0 | 修复夹具后 2/2；关闭面板与并发输入 |
| `npm run desktop:test:target -- --file test/e2e/sidechat-recovery.nonvisual.spec.ts --grep 'shutdown clears sidechats'` | 0 | 后增退出写入竞争 1/1，先复现失败再修复 |
| `npm run desktop:test:target -- --file test/e2e/acceptance.spec.ts --grep 'side chat captures a selected point\|temporary side chats keep panel drafts'` | 0 | 既有只读运行、指定时点、草稿、停止隔离、保留及父任务删除 2/2；只调整旧辅助栏选择器 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 定向入口 16/16 |
| `npm run desktop:check` | 0 | 最终桌面类型检查通过 |

上表 grep 中的竖线是正则“或”，实际 PowerShell 命令使用引号内的裸 `|`，不输入 Markdown 转义反斜杠。本阶段去重后为 8 项单元、8 项 UI、7 项原生流程取得通过证据；原生通过来自这些分次运行，未将失败的整轮改写成通过。共享 JsonStore 另以 5 项子任务存储测试验证既有行为未受影响。

证据保留在 `.artifacts/sidechat-recovery/`：`native-red.json`、`native-first.json`、`native-recovery-final.json`、`shutdown-red.json`、`shutdown-final.json`、`behavior-first.json`、`behavior-final.json`、`ui-first.json`、`ui-second.json`、`ui-final.json`、`unit-final.log`、`desktop-check-first.log` 与 `desktop-check.log`。

首次产品缺陷分别为失败创建仍公开一条侧聊，以及退出时最终快照仍保存临时侧聊。UI 初次失败来自测试初始化读取不存在的 ui 行和 role=status 同时匹配测试输出；既有原生场景最初仍定位已移除的独立侧聊栏和顶部侧聊按钮。修正为统一辅助栏入口后，行为断言完整保留并通过。

## 缓存与后续

新增测试复用受管临时目录；原生每例退出后断言其根目录不存在。没有截图、视频、trace 或像素验收。只读审计 `.artifacts/temp-cleanup/sidechat-recovery.json`：扫描 1、可清理 0、跳过 1，仅既有 `D:/systemp/pi-acceptance-9NrmPU`（201820 字节、缺少已验证签名）；未删除该目录，本轮没有新增残留。

新增 `sidechat` 小范围入口：默认仅相关单元和 UI，真实 IPC/磁盘/退出流程按需使用 `--level native`。后续继续独立/快捷聊天和多窗口恢复，整体 Goal 仍 active，没有提交、发布或制作 EXE。
