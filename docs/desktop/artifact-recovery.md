# PDF/HTML 预览与标注恢复（2026-09-29）

属于 G-UX-04 的接续验收。本轮完成产物预览、标注和删除的失败恢复；整体 Goal 保持 active，不把本模块验证等同于全部功能完成。

## 实际修复

- 标注元数据成功落盘后才发布；旧后台快照不会覆盖刚提交的记录。保存失败保留截图、选择区域和说明，重试同一截图不会重复创建记录；文件内容不匹配时不会覆盖已有截图。
- 删除先持久化删除意图，再删除截图及记录。磁盘失败和应用重启后仍显示重试入口；待删除记录不能重新查看或加入草稿。已附加到聊天的独立截图副本保留。
- 预览、捕获和标注操作按任务、目录和文件隔离。取消后的迟到打开结果及切换文件后的迟到截图不能污染当前界面；重复点击只执行一次。网络授权失败可重试，保留真实主进程确认。
- HTML 截图有 30 秒超时及可重试反馈；迟到结果不进入保存列表。临时恢复视图可见性时，保留期间收到的更新请求，避免截图结束把用户刚打开的网页再次隐藏。
- PDF 只允许捕获当前页、当前缩放已完成的渲染；搜索词变化立即清除旧结果及旧搜索进度。Worker 初始化、解析和渲染错误显示在原面板，修复文件后可重新加载。
- 标注使用既有紧凑面板；保存成功后的版本复核失败有独立重试入口。错误可即时切换语言，失败保留草稿，重复加入不会重复追加说明。

沿用现有 HTML 隔离环境、默认禁止外部网络、文件范围校验及 PDF 本地渲染，没有新增依赖或扩大预览权限。

## 定向验证

命令从仓库根目录执行，报告保存在 `.artifacts/artifact-recovery/`。原生用例使用真实 Electron、IPC、持久化和本地 PDF.js；UI 夹具中的受控 PDF 适配器仅用于稳定复现迟到搜索、渲染及初始化失败，不冒充真实 PDF 渲染证据。

| 实际命令 | 退出码与结果 | 记录 |
| --- | --- | --- |
| `npm run desktop:test:target -- artifacts --level unit` | 0；5 项单元通过 | unit-first.json |
| `npm run desktop:test:target -- artifacts --level ui`（首次） | 1；夹具项目字段缺少 trusted/createdAt，未取得功能通过证据 | ui-fixture-failure.json |
| `npm run desktop:test:target -- artifacts --level ui`（修正后） | 0；10 项 UI 通过，约 6 秒 | ui-first.json |
| `npm run desktop:test:target -- artifacts --level native` | 0；当时的 5 项原生流程通过，约 29 秒 | native-first.json |
| `npm run desktop:test:target -- --file test/e2e/artifacts.nonvisual.spec.ts --grep 'HTML capture timeout'` | 0；新增真实 30 秒超时场景通过，约 36 秒 | native-timeout.json |
| `npm run desktop:check` | 0；最后代码修改后的桌面类型检查 | desktop-check.log |
| `node --test scripts/desktop-test-target.test.mjs` | 0；16 项选择器检查通过 | 本轮命令输出 |

去重为 5 项相关单元、10 项 UI 和 6 项原生流程；另有 16 项测试入口检查。没有为了新增超时用例重复运行已通过且不受后续修改影响的原生场景。

原生流程覆盖：HTML 隔离与授权、真实 PDF 翻页/缩放/搜索、截图归属与文件范围、元数据写入失败、截图删除失败、删除意图重启恢复、重复保存、保留已附加副本、损坏 PDF 修复后重新加载、截图超时后重试以及较新的视图可见状态。UI 检查中英文、深浅主题及 1000×700、1280×800、1440×940 的 DOM 尺寸、溢出和草稿保留；不声称像素或人工视觉验收。

## 缓存与边界

本轮原生夹具关闭时确认自己的目录已删除。只读审计：

```powershell
node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/artifact-recovery.json
```

退出 0，scanned=1、eligible=0、skipped=1；只有此前已有且缺少可验证所有权签名的 `pi-acceptance-9NrmPU`（201820 字节），没有新增残留，也没有再次尝试删除该目录。

本轮没有验证系统断电时 PNG 创建的事务恢复，没有调用远程网站或真实供应商，也没有运行全量桌面回归、提交、发布或制作 EXE。下一项推进产品 Goal、自动化、记忆和可选子任务的运行及恢复复核；既有历史通过项按实际变化复用，不反复运行完整脚本。

开发启动：在仓库根目录运行 `npm run desktop:dev`。
