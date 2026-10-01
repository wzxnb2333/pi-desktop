# 主动审查：上下文隔离与操作恢复

G-UX-04 接续文件编辑阶段。本轮修复审查面板交互，不改变主动触发、独立只读会话、版本校验及真实 IPC。整体 Goal 保持 active。

## 实现

- 复现并修复主目录中同时显示附加目录评论的问题。行评论按当前目录展示，同名路径不会混在一起；切换目录与重启后仍保持各自来源，删除只作用于对应评论。
- 审查要求、所选记录、反馈草稿和进行中的操作按任务/目录保留在窗口会话内。关闭辅助栏、切换任务或审查记录后可继续；已保存反馈仍由真实主进程持久化。
- 启动、反馈保存、忽略/恢复、取消及评论删除同步登记进行中状态，快速重复点击不会重复发送。失败保留草稿并在来源上下文显示；重试清除旧错误，保存期间新增的输入不会被回执清空。
- 切换到旧审查记录不会开放第二次并行启动入口。已有运行记录仍可选择并取消；主进程原有独占校验保留。
- 捕获版本与定位结果带本地请求序号和来源检查。切换记录或关闭捕获内容后，迟到结果不能恢复旧内容；任务切换完成后，旧定位请求不能跳转新视图。
- 评论读取失败提供就地重试，即使该目录还没有审查记录。进度即时双语切换，沿用现有面板、字体和按钮，没有新增常驻顶部入口。

## 验证

以下命令均在仓库根目录执行。只重跑失败、未执行或本次新增的相关用例。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/review-recovery.spec.ts --grep 'review comments'` | 1 | 修正夹具后真实复现：主目录存在 1 条附加目录评论，预期 0 |
| `npm run desktop:test:target -- --file test/e2e/review-recovery.spec.ts` | 1 | 隔离/捕获 2 项通过；反馈测试使用的精确 label 定位不适用于已有值的隐式 textarea 标签，后续 1 项未运行 |
| `npm run desktop:test:target -- --file test/e2e/review-recovery.spec.ts --grep 'feedback submissions\|review setup'` | 0 | 2 项：反馈草稿、去重、重试，以及启动隐藏/恢复 |
| `npm run desktop:test:target -- --file test/e2e/review-recovery.spec.ts --grep 'cancellation\|comment removal\|comment read\|late review\|review progress'` | 1 | 取消、评论删除、读取恢复 3 项通过；定位测试未等待界面完成任务切换，4 项主题/语言未执行 |
| `npm run desktop:test:target -- --file test/e2e/review-recovery.spec.ts --grep 'late review\|review progress'` | 0 | 5 项：切换完成后的迟到定位、中英文 × 深浅主题 |
| `npm run desktop:test:target -- --file test/e2e/review.nonvisual.spec.ts` | 0 | 4 项真实 Electron 流程：只读发现/反馈、拒绝写工具/取消、过期评论、多目录与重启 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项定向入口检查 |
| `node --import tsx --test --test-name-pattern 'every translation' apps/desktop/test/localization.test.ts` | 0 | 1 项新增词条插值检查 |
| `npm run desktop:check` | 0 | 最终桌面类型检查 |

12 项 UI 与 4 项原生流程均取得通过证据；未把部分通过的失败整轮标记为成功。UI 检查覆盖 1440×940、1280×800、1000×700 的面板溢出、状态可见和语言切换草稿保留。没有截图、视频、trace 或像素验收。

原生用例使用本地假供应商、真实 IPC 和磁盘：只读审查没有写工具，工作文件及暂存区保持不变；外部修改后的发现/评论拒绝错误定位；反馈、忽略状态和目录选择重启后恢复。没有真实账号或外部模型调用。

报告目录 `.artifacts/review-recovery/` 包含 `comment-directory-red.json`、`ui-first-failed.json`、`ui-submit-green.json`、`ui-location-first-failed.json`、`ui-location-theme-green.json`、`native-green.json`。另保留最初两次夹具失败：漏填必需 automations 字段，以及 select 的精确 label 选择错误；均修复后重新执行，没有作为产品缺陷统计。

## 清理与后续

- 新 UI 夹具使用已有 TemporaryDirectories 所有权清理；原生用例在关闭后验证 storage 已删除。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/review-recovery.json` 退出 0，候选残留 0。
- `review` 定向入口已加入上述 UI，仍可用单文件/名称筛选。没有全套桌面/根检查、安装依赖、提交、发布或 EXE。
- 未提交审查表单与反馈草稿是本窗口会话内状态，不声称应用退出后恢复。上述阶段只验证 IPC 拒绝后的界面恢复；主进程磁盘失败原子性由下方接续阶段补充，Git 操作及差异块恢复尚未重新验收。

## 接续：审查反馈与行评论持久化

### 缺陷与修复

- 真实 Electron 用例阻塞 `desktop.json.tmp` 后，保存反馈报错，但 bootstrap 中已经出现未落盘的反馈。原实现先改 live Thread 再保存，后续重试会重复追加，其他自动保存也可能把失败操作写入磁盘。
- 反馈、忽略/恢复及评论新增/删除改为共用 JsonStore 写入队列：从队列执行时的最新状态生成候选，原子落盘成功后才发布相应字段。失败保持内存与已提交记录，保留输入框中的反馈，可直接重试。
- 已排队的旧后台快照按任务的注释修订号合并已提交字段，不能撤销新反馈、恢复已删除评论或串入其他任务。运行时保留的 Thread/Review 对象不替换，审查完成状态等非注释字段也不回退。
- 队列执行时重新检查任务及发现是否存在；写入期间删除任务不会被迟到保存复活。现有目录、文件版本及只读审查校验继续由原 IPC 执行。

### 定向证据

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/e2e/review.nonvisual.spec.ts --grep 'feedback disk failures'` | 1 | 修改前真实复现：预期反馈为空，live 状态却已有本次失败反馈 |
| `node --import tsx --test apps/desktop/test/review-persistence.test.ts apps/desktop/test/settings-persistence.test.ts apps/desktop/test/resource-persistence.test.ts apps/desktop/test/data-migrations.test.ts` | 1 | 既有 25 项通过；新增 7 项夹具漏填 thinking/policy，未进入业务断言 |
| `node --import tsx --test apps/desktop/test/review-persistence.test.ts` | 0 | 修正夹具后 7 项通过 |
| `npm run desktop:test:target -- --file test/e2e/review.nonvisual.spec.ts --grep 'disk failures'` | 0 | 2 项：反馈/忽略、评论新增/删除实际落盘失败，UI 保留与重试，重启后的唯一记录 |
| `npm run desktop:test:target -- --file test/review-persistence.test.ts` | 0 | 最终 9 项，另补临时文件写完后的备份失败及跨任务相同 ID 隔离 |
| `npm run desktop:test:target -- --file test/e2e/review.nonvisual.spec.ts --grep 'user starts\|diff line comments\|same-name file'` | 0 | 3 项既有原生流程：只读发现、版本过期、同名文件目录隔离及重启 |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项定向入口检查，新单测已加入 review |
| `npm run desktop:check` | 0 | 最终桌面类型检查 |

新增 9 项单测和 5 项原生流程均取得通过证据；既有设置/资源/迁移的 25 项在首轮通过，未无依据重复执行，首轮整体退出 1 保留为失败。没有重跑此前已验证且未修改的 12 项审查 UI。

本阶段报告位于 `.artifacts/review-persistence/`：`feedback-disk-red.json`、`unit-green.json`、`native-disk-green.json`、`native-existing-green.json`。实际临时路径写入/备份失败、排队保存、运行中对象引用及重启均已验证；不是断电、硬盘故障或全产品验收。原生必要构建仍有既有依赖的 Rollup 注释与 NO_COLOR 警告，不影响本次通过结果。

`node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/review-persistence.json` 退出 0，候选残留 0。新单测沿用临时目录所有权清理，原生用例退出后确认 storage 已删除；没有新增截图、视频或 trace。

下一项进入 Git 操作与差异块恢复。G-UX-04 与真实 Goal 保持 active；未提交、发布、制作 EXE 或执行全量检查。
