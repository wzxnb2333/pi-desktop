# 浏览历史与清理失败恢复（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。本轮检查浏览历史、时间范围、清理失败与面板交互，不把局部通过认定为全部浏览器功能验收。

## 实际改动

- 复现并修复清理落盘失败后记录已从内存消失、界面误呈现为空的问题。保存和清理共用写队列，轮到执行时读取当前状态，两份文件写入成功后才发布删除。
- 清理先更新恢复副本，再替换主文件；成功后不能通过普通备份恢复出已删记录。备份更新失败不发布删除，主文件替换失败保留当前可读记录并允许重试。两份文件不是一个文件系统事务，不声称失败时备份也完全回滚。
- 并发访问和标题更新按记录 ID 与版本处理，保留清理期间的新访问；清理计数不再随新增访问减少或变成负数。失败保存保留待写状态，后续写入可继续。
- 损坏或未来版本历史仍阻止自动覆盖，只有用户明确清理全部历史才能重置。重置失败在当前进程继续阻止普通访问写入；原损坏文件按既有规则保留恢复副本。
- 历史使用现有紧凑面板，搜索默认获得焦点；读取中不显示旧查询的可点击结果或“没有匹配”。查询、清理范围和操作错误分别处理，支持就地重试与即时语言切换，保留搜索内容。
- 修改时间范围后立即隐藏旧统计，范围读取成功前不能确认清理。打开页面、开始清理和取消去重；迟到完成不会关闭其他任务的新面板。其他窗口删除最后一页后回到有效页。
- 部分清理后失败时说明已完成部分不会撤销；继续使用主进程原生确认，没有降低浏览器权限。

主要源文件：apps/desktop/src/main/browser-history.ts、src/renderer/src/components/panels/browser-history.tsx、src/shared/browser-messages.ts。沿用原组件、主题和 CSS，没有新增常驻工具栏入口。

## 定向入口

    npm run desktop:test:target -- browser-history
    npm run desktop:test:target -- browser-history --level native

默认只运行 8 项历史单元和 8 项面板 UI；原生层级单独运行 4 项 Electron 用例。仅复核磁盘失败时：

    npm run desktop:test:target -- --file test/e2e/browser-history.nonvisual.spec.ts --grep 'history disk failure'

## 本轮验证

命令在仓库根目录执行，报告位于 .artifacts/browser-history-recovery/。失败记录保留原退出码。

| 命令 | 退出码与结果 | 证据 |
| --- | --- | --- |
| npm run desktop:test:target -- browser-history --level unit | 修复前 1：3 项新回归失败、2 项旧用例通过；首次修复后 0，5 项通过；补充备份/排队/重试后 0，8 项通过 | unit-red.json、unit-first-green.json、unit-green.json |
| npm run desktop:test:target -- browser-history --level ui | 首次 1：错误显示保留 Error 前缀；清理传输包装后 0，8 项通过 | ui-first.json、ui-second.json |
| npm run desktop:test:target -- browser-history --level native | 首次整体 1，前三项通过；第四项因切换英文后仍使用中文面板标题定位而失败 | native-first.json |
| npm run desktop:test:target -- --file test/e2e/browser-history.nonvisual.spec.ts --grep 'history disk failure' | 修正定位后 0，1 项通过；前三个已通过用例未重复运行 | native-retry.json |
| npm run desktop:check | 新增测试最初传入不完整 UI 状态时退出 2；修正为实际窗口完整状态后及最后修改后均退出 0 | desktop-check.log 为最后一次完整输出 |
| node --test scripts/desktop-test-target.test.mjs | 0，16 项定向选择器检查通过 | 本轮命令输出 |

去重为 8 项相关单元、8 项 UI、4 项真实 Electron 流程及 16 项选择器检查。原生覆盖实际访问/标题、中文输入法与地址建议、时间范围、Cookie/localStorage、缓存、清理取消、磁盘失败、即时双语反馈和重启重试。仅使用本地 HTTP 服务，无真实账号或付费模型。

UI 在深浅主题、中英文和 1440×940、1280×800、1000×700 下检查 DOM 尺寸、焦点、错误和滚动边界，不声称逐像素或人工视觉验收。原生复用中性复选框尺寸、键盘及强制颜色检查。

## 缓存与边界

- 原生夹具结束后逐个验证数据目录不存在；新 UI/单元夹具沿用所有权清理。截图、视频与 trace 关闭。
- 最终只读审计：node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/browser-history-recovery.json，退出 0。
- scanned=1、skipped=1，仍只有此前受阻的 D:/systemp/pi-acceptance-9NrmPU（201820 字节）。没有新增残留，没有重试或绕过旧删除拒绝。
- Chromium 网站数据、缓存与历史文件之间没有跨系统回滚。原生测试验证网站数据已经清除但历史落盘失败，历史仍保留且重试成功。
- 打开的网页再次导航会产生新的真实访问。损坏文件的显式恢复副本仍保留，不将普通历史清理描述为所有磁盘副本的安全擦除。
- 未验证整机断电、每个清理时点的强制退出或整套桌面回归；没有提交、发布或制作 EXE。原生夹具只构建必要的开发 main/preload。
- 下一项检查网站规则、网页标注的失败恢复，再推进 PDF/HTML 产物流程。整体 Goal 与 G-UX-04 继续 active。

开发启动：在仓库根目录运行 npm run desktop:dev。
