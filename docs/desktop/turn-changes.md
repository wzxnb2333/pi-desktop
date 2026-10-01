# 编辑预览与新建聊天入口

日期：2026-09-30。对应用户指定的末尾文件卡片和重复创建入口；不扩展其他功能范围。

后续用户调整已实现：[侧栏聊天入口与项目合集](sidebar-navigation.md)。下文聊天类型下拉和独立创建入口属于当时交付，现已隐藏；末尾编辑预览维持不变，历史验收记录保留。

## 实际变化

- 末尾不再显示打开文件/外部打开快捷卡片，改为本轮编辑预览：文件数、已记录的增删行数、前三个文件、展开剩余文件和查看变更。点击文件直接展开编辑内容，无需切换辅助面板。
- 预览使用成功工具调用中已经保存的内容。edit 的标准补丁转换为现有差异组件的格式；write / project_write 显示当时写入的内容。不会使用当前磁盘内容冒充过去的编辑，也不会把其他人的工作区修改并入本轮。
- 同一路径的多次编辑按顺序保留，不同 directoryId 分开。计数为记录中的增删行数，不是工作区净差异；纯写入没有旧版本时不伪造增删数字，部分统计在提示中说明。旧记录缺少预览内容时显示明确说明。
- 左侧合并为一个“新建聊天”入口，旁边下拉选择“项目聊天 / 新建独立聊天”，并用一句话解释区别。直接点击沿用当前项目；当前没有关联项目时创建独立聊天。快捷聊天继续单独保留。
- 项目聊天可在对应目录内处理文件与代码，仍受权限模式约束；独立聊天先不绑定目录，需要时使用现有绑定入口。没有删除会话类型、修改 IPC 或重置用户数据。

## 关键实现

- `apps/desktop/src/renderer/src/components/timeline/turn-changes.tsx` 与 `styles/turn-changes.css`：折叠列表、历史内容和差异预览。
- `apps/desktop/src/renderer/src/lib/turn-changes.ts`：只提取成功编辑，解析真实补丁并保留缺失信息。
- `apps/desktop/src/renderer/src/components/timeline/turn.tsx`：替换原末尾卡片；移除 `turn-artifacts.tsx` 及对应样式。
- `apps/desktop/src/renderer/src/components/sidebar/sidebar.tsx`、`styles/sidebar.css`：统一创建入口及带说明的类型菜单。
- `apps/desktop/src/shared/feature-messages.ts`：即时中英文词条。
- `apps/desktop/test/turn-changes.test.ts`、`test/e2e/turn-changes.spec.ts`：纯逻辑与界面定向回归。相关原生/导航旧断言随入口变化更新。

## 实际验证

本轮下列命令最终均退出 0；按影响范围选择，没有执行完整桌面或根级测试。重复验证不累加到独立用例数量。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run desktop:check` | 最后代码修改后通过 | 本轮命令输出 |
| `npm run desktop:test:target -- turn-changes` | 6 项单元、5 项界面通过 | `.artifacts/turn-changes/quick.json` |
| `npm run desktop:test:target -- turn-changes --level native` | 1 项真实写入、编辑、删除源文件及重启后的历史预览 | `.artifacts/turn-changes/native.json` |
| `npm run desktop:test:target -- --file test/e2e/acceptance.spec.ts --grep 'standalone chats retain'` | 1 项真实独立聊天、草稿隔离、权限和目录绑定流程 | `.artifacts/turn-changes/standalone.json` |
| `npm run desktop:test:target -- --file test/e2e/reference.spec.ts --grep 'Satang shell'` | 4 项深浅主题/窗口宽度导航布局 | `.artifacts/turn-changes/navigation-layout.json` |
| `npm run desktop:test:target -- --file test/e2e/final-ui.nonvisual.spec.ts --grep 'final bilingual'` | 1 项真实窗口双语/主题/尺寸场景 | `.artifacts/turn-changes/bilingual-native.json` |
| `npm run desktop:test:target -- --file test/e2e/message-rendering.nonvisual.spec.ts --grep '1000 turns retain'` | 1 项千轮消息流式更新、阅读位置和选择回归 | `.artifacts/turn-changes/streaming.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 16 项测试入口检查通过 | 本轮命令输出 |

合计 6 项功能单元、10 项浏览器 UI、3 项 Electron 场景、16 项测试选择器检查。原生执行使用本地假供应商，未访问真实模型账号。新入口通过真实原生创建/草稿/绑定流程，而不只验证按钮存在。

初次单测夹具缺少必填 text 字段，修正后 6 项通过；一次类型检查发现测试的 ui.update 缺少完整 UI 字段，修正后重跑受影响主题用例及类型检查。初次失败记录保留为 `.artifacts/turn-changes/initial-unit.json`，没有改写为通过。

最终视觉核对仅保留 [浅色折叠](../../.artifacts/turn-changes/light.png)、[深色折叠](../../.artifacts/turn-changes/dark.png)、[深色展开](../../.artifacts/turn-changes/dark-expanded.png)。在 apps/desktop 临时设置 PI_DESKTOP_CAPTURE=1，定向执行 turn-changes.spec.ts 的 both languages 场景，退出 0，随后移除环境变量。常规测试仍不生成截图、视频或 trace。

界面测试覆盖中英文、深浅主题、1440×940、1000×700、620×700；原生既有矩阵同时检查 1280×800 过渡布局。未声称严格像素或全产品验收。

## 清理与启动

测试沿用临时目录所有权与结束清理断言。最终执行 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/turn-changes.json`，退出 0，eligible=0、skipped=1；仅此前缺少可验证签名的 pi-acceptance-9NrmPU 保留，没有新增本轮测试目录残留。

仓库根目录开发启动：`npm run desktop:dev`。没有提交、发布或重新制作 EXE。未变更真实 Goal 状态。
