# 侧栏聊天入口与项目合集

日期：2026-09-30。仅实现本轮用户指定的侧栏调整；沿用 Codex 26.915 设计语言和 Pi Desktop 业务，不代表全部持续目标完成。

## 实际行为

- 顺序调整为主要导航 → 最近任务 → 项目聊天。项目聊天是独立合集，保留项目折叠、筛选、新建、归档、回收站及任务操作。
- 新建聊天右侧只保留一个 24px 快捷聊天按钮。鼠标悬浮整行或键盘聚焦时显示；触摸设备保持可见。提示使用实际配置的快捷键。
- 移除聊天类型下拉和独立聊天合集；欢迎页也不再提供无项目创建入口。底层 chat.create、历史记录、草稿和目录绑定继续保留，既有记录仍可恢复或通过全局历史搜索找到。
- 普通新建按钮和新建快捷键创建当前项目聊天；没有当前项目时打开目录选择器。取消或选择失败不创建独立聊天，也不产生空记录。
- 移除新建旁的重复搜索按钮、侧栏内搜索框及其局部筛选状态。顶部搜索、Ctrl+K 和已有搜索命令统一使用命令面板，保留可配置快捷键；不改变当前页面和项目折叠偏好。
- 新建行预留快捷按钮和快捷键提示的位置，出现时只改变透明度。聊天行同样固定尾部操作空间，省略菜单出现时标题和未读点不位移。

## 实现位置

- apps/desktop/src/renderer/src/components/sidebar/sidebar.tsx：合集顺序、入口合并和悬浮快捷操作。
- apps/desktop/src/renderer/src/styles/sidebar.css：稳定行尺寸、控件显隐和合集间距；测试不再叠加已经退出运行时的 sidebar-satang.css。
- apps/desktop/src/renderer/src/components/timeline/welcome.tsx：隐藏无项目创建入口。
- apps/desktop/src/renderer/src/components/shell/commands.tsx 与 state/app.tsx：统一搜索入口，移除废弃侧栏搜索状态，项目创建快捷键保持权限边界。

## 定向验证

下列命令最终退出码均为 0；没有运行全量桌面回归、根级完整检查或安装包构建。

| 命令 | 结果 | 本轮证据 |
| --- | --- | --- |
| npm run desktop:check | 桌面类型检查通过 | 本轮命令输出 |
| npm run desktop:test:target -- sidebar | 14 项单元 + 11 项侧栏 UI | .artifacts/sidebar-navigation/sidebar-tests.json |
| npm run desktop:test:target -- --file test/e2e/turn-changes.spec.ts | 7 项实际 App 界面用例 | .artifacts/sidebar-navigation/creation-tests.json |
| npm run desktop:test:target -- --file test/e2e/reference.spec.ts --grep 'Satang shell\|sidebar headings\|existing search\|resize merges' | 8 项外壳、主题、尺寸及菜单用例 | .artifacts/sidebar-navigation/reference-tests.json |
| npm run desktop:test:target -- --file test/e2e/conversation-ui.spec.ts --grep 'conversation chrome' | 6 项未读点/布局矩阵 | .artifacts/sidebar-navigation/conversation-layout-tests.json |
| npm run desktop:test:target -- --file test/e2e/search.nonvisual.spec.ts --grep 'command palette navigates\|unified task search' | 2 项 Electron 搜索、可配置快捷键及重启 | .artifacts/sidebar-navigation/search-native-tests.json |
| npm run desktop:test:target -- --file test/e2e/acceptance.spec.ts --grep 'standalone chats retain\|quick chat keeps' | 2 项 Electron 独立记录保留及快捷窗口草稿恢复 | .artifacts/sidebar-navigation/chat-native-tests.json |

去重合计 14 项单元、32 项浏览器 UI、4 项 Electron 用例。深浅主题及中英文覆盖 1440×940、1280×800、1000×700，创建行另测 620×700；小高度侧栏可滚动，底部操作仍可到达。实际原生流程使用本地假供应商，没有调用真实模型账号。

首次类型检查发现新增保留记录夹具缺少必填 requestId；补齐后重新运行类型检查和相应原生流程通过。依赖已有 NO_COLOR/FORCE_COLOR 与 Zod 注释提示不作为功能失败；本轮未改依赖。

仅为当前侧栏保留两张核对图：[浅色](../../.artifacts/sidebar-navigation/light-sidebar.png)、[深色](../../.artifacts/sidebar-navigation/dark-sidebar.png)。采用 PI_DESKTOP_CAPTURE_SIDEBAR=1 定向运行 turn-changes.spec.ts 的 compact chat entry fit 两项场景，已清除临时环境变量，报告为 .artifacts/sidebar-navigation/bilingual-layout-tests.json。图中蓝色轮廓为键盘焦点。没有生成整套截图、视频或 trace，也未声称像素级验收。

## 缓存与启动

测试沿用所有权临时目录及结束清理断言。最终只读审计命令：node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/sidebar-navigation.json。退出 0，eligible=0；仅保留之前缺少可信签名的 pi-acceptance-9NrmPU（201820 字节），没有新增本轮测试目录残留。

开发启动：在仓库根目录运行 npm run desktop:dev。本轮不提交、不发布、不重新制作 EXE；独立聊天为隐藏入口，未删除其服务及历史数据。
