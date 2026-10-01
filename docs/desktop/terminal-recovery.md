# 终端操作：失败恢复与任务隔离

持续 Goal 的 G-UX-04 接续项。上一轮会话初始化已取得定向证据，本轮转向终端的真实操作、任务切换及关闭后恢复。整体 Goal 保持 active。

## 实现与边界

- 真实 UI 复现连续点击“新建终端”发出两次请求。创建、重命名和终止现在同步登记进行中的操作，重复点击只执行一次；启动与终止期间显示就地状态，不增加常驻工具栏按钮。
- Shell 启动、终止、重命名和剪贴板失败在对应位置显示。错误被捕获，不再形成未处理的 Promise 或跨任务全局提示；失败后可直接重试。已知应用错误即时双语切换，外部错误文本保留原文。
- 每个任务独立保存终端选择、进行中操作、错误和重命名草稿。隐藏、关闭工具面板或切换任务不丢失这些状态，异步结果只回到来源任务。重命名捕获目标终端 ID，不随之后显示的终端变化。
- 保存重命名期间禁止重复提交、修改及误关闭，焦点保留在对话框；失败保留草稿并恢复输入焦点。空白名称不能提交，取消返回入口。沿用现有对话框、按钮和字体体系。
- 项目动作首次产生终端时自动显示；用户随后手动选择其他终端后，重开面板不再强制切回旧动作终端。
- 保持“隐藏面板/关闭页签不终止进程”的既定行为，以及原有真实 IPC、权限检查、输出缓冲、输入法、终端查找和配置持久化。
- 未提交的重命名表单仅保留在当前窗口会话内；已经保存的名称/配置可在应用重启后恢复。应用重启后的入口明确启动新进程，不冒充原进程继续运行。

## 定向验证

| 实际命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/terminal-recovery.spec.ts --grep 'terminal creation'` | 1 | 首次复现，预期 1 次创建请求，实际 2 次 |
| `npm run desktop:test:target -- --file test/e2e/terminal-recovery.spec.ts` | 0 | 实现初期的 2 项创建/重命名恢复用例通过 |
| `npm run desktop:test:target -- --file test/e2e/terminal-recovery.spec.ts` | 1 | 扩展后 10 项中 5 项通过；项目动作夹具错误，4 项未执行，整轮保持失败记录 |
| `npm run desktop:test:target -- --file test/e2e/terminal-recovery.spec.ts --grep 'reopening the pane\|progress and errors'` | 0 | 只重跑修正的项目动作及剩余双语/主题场景，共 5 项 |
| `npm run desktop:test:target -- --file test/e2e/terminal-recovery.spec.ts --grep 'empty rename\|clipboard failure'` | 0 | 2 项新增：空白校验/取消焦点、剪贴板失败后重试 |
| `npm run desktop:test:target -- --file test/e2e/panels.spec.ts --grep 'hiding the pane\|终止终端\|switching tabs keeps\|terminal preserves'` | 0 | 4 项既有面板回归：隐藏、终止、主题及标签输入隔离 |
| `npm run desktop:test:target -- terminal --level native` | 0 | 4 项真实 Electron/PTY 流程 |
| `node --import tsx --test apps/desktop/test/terminal-workbench.test.ts` | 0 | 7 项输出恢复、查找、中文/宽字符及快捷键单元检查 |
| `node --import tsx --test --test-name-pattern 'every translation' apps/desktop/test/localization.test.ts` | 0 | 1 项词条插值检查 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项定向入口检查 |
| `npm run desktop:check` | 0 | 最后一次源代码及测试修改后的类型检查 |

去重后本轮共 16 项 UI、4 项原生流程、8 项相关单元检查取得通过证据，另有选择器 16 项。没有将失败的整轮运行改写为成功，也没有重复已经有效的无关测试。

原生验证包含实际设置一个不存在的 Shell、显示失败、修复后仅创建一个进程；真实重命名与隐藏重开；应用重启后恢复配置，并明确启动一个新进程。现有大输出、renderer 重载、实际退出、复制查找、中文输入法与自定义快捷键流程同时通过。本地测试进程内的环境改动在用例中恢复。

UI 包含深浅主题 × 中英文，在 1440×940、1280×800、1000×700 检查进度和错误的真实 DOM、溢出及切换语言后的状态保留。没有生成截图、视频或 trace，不宣称像素验收。终止/重命名失败通过协议夹具注入，真实 Shell 启动失败另由原生用例验证。

## 失败记录

- `.artifacts/terminal-recovery/open-duplicate-red.json`：重复创建真实 UI 复现。
- `ui-first-failure.json`：5 项通过但整轮失败。夹具原来在 page.reload 前设置内存中的 project action，重载重置了该数据；改为发布与主进程一致的 terminal.created 事件，没有降低产品断言。
- `ui-recovery-green.json`：修正项目动作及剩余语言/主题用例通过。
- `ui-dialog-clipboard-green.json`、`ui-existing-green.json`、`native-green.json`：新增取消/剪贴板、既有面板和原生流程的实际命令及退出码。
- 类型检查曾两次发现新增测试的 page.evaluate 语言联合类型推导不匹配。依据已安装 Playwright 类型显式指定参数类型，最终 desktop:check 退出 0；没有通过类型断言隐藏错误。

## 清理与接续

新增 UI 夹具复用 TemporaryDirectories 所有权清理，原生用例关闭后断言 storage 不存在。`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/terminal-recovery.json` 退出 0，候选残留 0。

`terminal` 定向入口已纳入新的恢复用例，单一修改仍优先使用 `--file` / `--grep`。没有整仓/全套桌面检查、依赖安装、提交、发布或 EXE。下一项复核文件编辑的外部变更、任务/目录切换与关闭恢复；文件流程及整体 Goal 尚未在本轮完成验收。
