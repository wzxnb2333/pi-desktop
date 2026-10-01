# 桌面开发测试临时目录清理

## 当前结果（2026-09-27 第二轮）

第一轮只处理 acceptance fixture，遗漏了桌面启动、组件 harness、运行时和 Git 单元测试。
第二轮再次清理 **3,523 个目录 / 679,199,994 字节（647.74 MiB 文件内容）**，其中很多已经是空目录或只读 Git 残片。
重新核验后，第一轮保留的 111 个 acceptance 目录也确认来自测试并已清理。
最终扫描 D:\systemp 的 pi-*、pi diff *、pi git * 目录均为 0；复跑曾泄漏目录的 Git 差异测试后，新增残留仍为 0。

源头修复覆盖七组单元测试与九组端到端测试入口：

- 单元测试：agent、provider-protocols、core、services、diff、thread-storage、workbench-services。
- 端到端测试：composer、settings、sidebar、panels、primitives、desktop.nonvisual、desktop、visual、installer。
- 共用 test/fixtures/temporary-directories.ts；临时项目归入 pi-desktop-tests-* 父目录，所有权标记放在父目录，不污染项目文件和搜索结果。
- Node 测试通过 after 清理；Playwright 在浏览器/应用关闭后的 afterAll 清理，包括测试失败的收尾路径。
- 清理采用 Windows 文件占用重试。所有权标记包含 PID，历史清理工具会保留进程仍存活的测试目录。

本轮报告：

- .artifacts/temp-cleanup/desktop-sweep-result.json：3,504 个目录，677,202,314 字节。
- .artifacts/temp-cleanup/desktop-remnants-result.json：19 个目录，1,997,680 字节。
- .artifacts/temp-cleanup/leak-before.json：修复前单个差异测试成功，但留下 2 个目录。
- .artifacts/temp-cleanup/leak-after.json：同一测试成功，新增目录 0，全部 Pi 测试目录 0。

本轮验证（均为退出码 0）：

- 根目录：npm run desktop:check；node --check apps/desktop/scripts/cleanup-desktop-temp.mjs。
- apps/desktop：node --import tsx --test test/temporary-directories.test.ts test/agent.test.ts test/provider-protocols.test.ts test/core.test.ts test/services.test.ts test/diff.test.ts test/thread-storage.test.ts test/workbench-services.test.ts；53/53 通过。
- apps/desktop：node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts composer.spec.ts settings.spec.ts sidebar.spec.ts primitives.spec.ts panels.spec.ts desktop.nonvisual.spec.ts --reporter=list --output=../../.artifacts/temp-cleanup/scope-e2e；71/71 通过（文件匹配同时包含 MCP 设置测试）。
- apps/desktop：node --import tsx --test test/desktop-temp-cleanup.test.ts；1/1 通过。覆盖预览、存活 PID、外部数据、链接目标、Git 对象验证、首次启动空 profile 及报告路径保护。
- apps/desktop：node --import tsx --test --test-name-pattern 'empty and sentinel' test/diff.test.ts；1/1 通过，随后对目录实际复查为零。

日志：scope-unit.log、scope-e2e.log、scope-typecheck.log、desktop-sweep-safety.log，均位于 .artifacts/temp-cleanup/。
旧截图基线与 NSIS 安装/卸载流程未在本轮运行；对应入口使用相同且已验证的临时目录生命周期。未提交、打包或发布。

## 原因与修复

`test/e2e/fixtures/acceptance-app.ts` 为每个验收测试创建独立的
`pi-acceptance-*` 临时目录，包含 Electron 用户数据、缓存、测试 HOME 和测试 Git 项目。
旧实现只关闭 Electron 和本地假供应商，没有删除这些目录，重复运行后持续积累。

现在关闭 fixture 会按顺序销毁挂起的流式响应、关闭 Electron、本地 HTTP 服务，
然后递归清理临时目录。启动失败也会执行清理；重复关闭安全；测试内重启会保留
同一个 profile，最终关闭才删除。Windows 文件占用会重试，清理失败会报告具体路径。

强制终止整个测试进程时，清理函数可能没有机会运行。下面的工具用于处理历史残留。

## 手动清理

在项目根目录使用 PowerShell 7。默认只预览，默认保留最近 60 分钟的目录：

```powershell
Set-Location 'E:\AI_collection\Pi desktop'
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root 'D:\systemp'
```

关闭 Electron 和桌面测试后，再实际清理并保存逐目录结果：

```powershell
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root 'D:\systemp' --apply --report '.artifacts/temp-cleanup/manual-report.json'
```

只有需要处理刚结束的测试、且已经确认测试停止时，才加 `--minimum-age-minutes 0`。
报告必须写在临时根目录之外。查看报告的 `removed`、`skipped` 和每项 `reason`；
命令退出码 0 不代表所有目录都被删除。

## 识别边界

- 只检查指定临时根目录下的 Pi 临时目录；根目录及直接子目录不能是 junction 或符号链接。
- 非空目录需验证源码中的测试前缀及具体内容：本地测试项目路径、组件 bundle、已知假供应商数据、测试 Git 作者与对象 SHA-1，或带 PID 的新所有权标记。
- 不递归读取链接目标。只有确认整个目录属于测试后，才删除其中的链接本身；外部目标保留，回归测试对此有断言。
- 进程仍存活的新测试目录、未知非空目录、指向外部项目的 profile、损坏对象一律保留。
- 默认预览并保留最近 60 分钟的目录；应用清理前检查 Electron 进程。报告必须写在临时根目录之外。
- 原 cleanup-acceptance-temp.ps1 保留为第一轮的窄范围工具；后续统一使用 cleanup-desktop-temp.mjs。

## 第一轮历史目录处理结果

2026-09-27，扫描 `D:\systemp` 中 2,730 个验收测试目录，分两次清理：

- 完整测试目录及空目录树：750 个，14,527,837,666 字节。
- 验证初始 Git 对象后清理的旧残片目录：1,869 个，401,677 字节。
- 合计：2,619 个目录，14,528,239,343 字节，约 13.53 GiB 文件内容。
- 用户指出的 `D:\systemp\pi-acceptance-gYltad` 已删除，并重新确认不存在。
- 当时保留 111 个目录：30 个包含链接，81 个无法通过当时的归属规则；第二轮核验后已清理，见文首记录。

逐项证据：`.artifacts/temp-cleanup/cleanup-report.json` 与
`.artifacts/temp-cleanup/remnants-cleanup-report.json`。文件内容大小不等同于文件系统实际回收空间。

## 验证

2026-09-27 执行：

- `npm run desktop:check`：退出码 0。
- 在 apps/desktop 执行 `node --import tsx --test test/acceptance-temp-cleanup.test.ts`：退出码 0，1/1 通过；覆盖预览、实际清理、旧 Git 残片、外部数据和 junction 保护。
- 在 apps/desktop 执行 `node ../../node_modules/@playwright/test/cli.js test -c playwright.nonvisual.config.ts acceptance.spec.ts --reporter=list --output=../../.artifacts/temp-cleanup/acceptance-results`：退出码 0，19/19 通过；包含重启、重复关闭、启动失败及流式请求清理。

日志与本次清理报告保存在 `.artifacts/temp-cleanup/`。
