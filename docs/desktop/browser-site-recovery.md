# 网站规则与权限撤销恢复（2026-09-29）

继续 G-UX-04，真实 Goal 保持 active。本轮沿用现有网站规则、任务权限和主进程设置写队列，没有增加权限通道或使用开发子代理。

## 复现与修复

- 复现：用户在浏览器等待期间将网站改为拒绝，旧流程仍先读取 DOM，再拒绝返回；截图期间改为拒绝时，旧流程直接返回图片。现在在授权后启动导航前、等待完成后、截图返回后及 DOM 结果返回前重新检查当前网站规则，拒绝后不再执行后续页面读取或向任务交付图片。
- 同一次操作的一次性网站批准仍可使用，不要求保存“始终允许”；拒绝或失败后释放标签占用，后续明确授权的操作可继续。浏览器网站规则仍不能越过任务的“请求批准”与禁止执行限制。
- 复现并修复同一轮连续点击发出两次网站规则写入。保存采用同步操作锁，期间禁用相关控件及关闭入口，完成或失败后恢复。失败保留输入与选择，提供绑定原网站/原动作的重试；不会因用户后来编辑另一个地址而重试到错误网站。
- 网站表单按已保存规则初始化，当前网站已有拒绝规则时不再默认选中允许。来源输入只规范化完整 origin（支持首尾空白、大小写、默认端口和根斜杠）；拒绝路径、查询、片段、凭据及非 HTTP(S) 输入，避免把一个页面地址静默扩大成整站授权。
- 使用既有紧凑面板、原主题和控件；输入自动聚焦，Enter 可保存，原位置显示保存进度、成功和可重试错误。错误与反馈即时双语切换，保留草稿，没有新增常驻工具栏入口。
- 原生磁盘失败证据确认主进程已有设置事务会保留原规则，本轮没有另建持久化实现；面板重试、不同网站并发更新与重启恢复通过真实 IPC 验证。

主要源文件：apps/desktop/src/main/browser-tools.ts、src/shared/browser-tools.ts、src/shared/browser-messages.ts、src/renderer/src/components/panels/browser-sites.tsx。

## 定向入口

    npm run desktop:test:target -- browser-sites
    npm run desktop:test:target -- browser-sites --level native

默认仅 7 项单元与 8 项 UI，实测约 6 秒；native 只选 3 项网站管理、撤销和磁盘恢复场景。若修改 BrowserTools 通用执行边界，再单独选择现有完整 DOM/图片/重定向/取消原生用例。不会随网站表单改动运行历史、标注、产物或整套桌面测试。

## 本轮证据

报告目录：.artifacts/browser-site-recovery/。下列命令从仓库根目录执行，失败记录保留原退出码。

| 命令 | 结果 | 报告 |
| --- | --- | --- |
| npm run desktop:test:target -- --file test/browser-site-policy.test.ts | 修复前退出 1，两项分别复现拒绝后仍读取 DOM、仍返回图片 | unit-red.json |
| npm run desktop:test:target -- --file test/e2e/browser-sites-recovery.spec.ts --grep 'website saves deduplicate' | 修复前退出 1，同一轮点击产生两次请求 | ui-red.json |
| npm run desktop:test:target -- browser-sites | 退出 0，7 项单元、8 项 UI 通过 | quick-first.json |
| npm run desktop:test:target -- --file test/e2e/browser-tools.nonvisual.spec.ts | 退出 0，4 项真实 Electron 流程通过，包含 1 项通用浏览器回归 | native-first.json |
| npm run desktop:test:target -- --file test/e2e/browser-sites-recovery.spec.ts --grep 'website feedback' | 补充无效来源的英文说明后退出 0，仅复核受影响的 4 项语言/主题用例 | locale-final.json |
| npm run desktop:check | 最后一次代码/测试修改后退出 0 | desktop-check.log |
| node --test scripts/desktop-test-target.test.mjs | 退出 0，16 项选择器检查通过 | 本轮命令输出 |

去重为 7 项单元、8 项 UI、4 项原生流程和 16 项选择器检查。原生截图来自本地实际 Chromium 页面，仅延迟交付以注入撤销；没有用合成图片替代这项证据。页面访问、任务供应商和测试账号均为本地夹具，没有真实网站账号或付费模型。

深浅主题 × 中英文检查 1440×940、1280×800、1000×700 的 DOM 尺寸、焦点、草稿和提示；未进行逐像素或人工视觉验收。

## 清理与边界

- 新 UI 夹具沿用现有临时目录所有权清理，所有原生夹具结束后检查数据目录不存在。未保存截图、视频或 trace；截图工具结果只存在该临时测试会话。
- 只读审计：node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/browser-site-recovery.json，退出 0。
- scanned=1、skipped=1；仅保留此前受阻的 D:/systemp/pi-acceptance-9NrmPU，201820 字节，没有新增测试目录残留，也没有绕过旧删除拒绝。
- 已经完成的网页交互不能撤回。等待中的拒绝在等待结束后的操作边界生效；不声称立即撤销所有浏览器内部工作或回滚此前网页副作用。
- 没有提交、发布、制作 EXE 或运行全套测试。原生夹具仅构建必要的开发 main/preload，复用原生回归中仍有效的功能证据。
- 下一项：网页标注捕获、保存、删除及失败恢复，再推进 PDF/HTML 产物流程；整体 Goal 保持 active。

开发启动：在仓库根目录运行 npm run desktop:dev。
