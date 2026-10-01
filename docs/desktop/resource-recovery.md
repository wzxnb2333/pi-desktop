# Skills 与扩展：保存和失败恢复

本轮属于 G-UX-03，真实 Goal 保持 active。沿用现有管理页和三档权限，没有增加常驻按钮、改变模型权限或自动批准外部扩展。

## 实际修复

- 新建 Skill、刷新发现结果和仅资源分组的设置更新，使用同一 JSON 写入队列。原子替换成功后才发布资源及忽略路径；写入失败保留原状态，界面保留创建草稿。
- 排队中的旧 UI/任务快照不会覆盖刚提交的资源设置。仅资源更新不重写其他偏好，也不停止正在执行的任务。
- 新建文件失败或配置保存失败时回收本次独占创建的文件及空目录。不会递归删除其他进程新增的内容；检测到外部修改或清理失败时保留文件并报告路径，不能伪装成清理成功。
- 从最新状态校验待操作资源的 ID、类型和来源，阻止旧控件修改替换后的资源。重新导入只启用最新记录，保留其他窗口修改的名称和列表顺序。
- 源文件检查连续重试只发送一次请求；语言或属性顺序变化不重复检查。格式错误改为简短反馈，应用错误随语言即时更新；文件内容和外部诊断保留原文。
- 折叠的创建表单、保存失败和并发冲突保留草稿；现有未保存导航确认继续有效。

## 验证范围

实际执行命令如下。每个失败或未完成的运行单独保留，不将整次运行改写为通过。重复执行的同一用例仅统计最后有效结果。

| 命令 | 退出码 | 结果 / 报告 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最后一次代码修改后的桌面类型检查通过 |
| `npm run desktop:test:target -- --file test/resource-persistence.test.ts --file test/data-migrations.test.ts --file test/core.test.ts` | 0 | 19 项；其中原有存储、迁移等 14 项复用本轮有效证据，资源用例以后续结果为准；`.artifacts/resource-recovery/unit-store.json` |
| `npm run desktop:test:target -- resources --level unit` | 0 | 10 项资源持久化、检查和实际 Worker 加载回归；`unit.json` |
| `npm run desktop:test:target -- --file test/resource-inspection.test.ts` | 0 | 采用所有权清理 fixture 后的 4 项复验；`unit-owned-cleanup.json` |
| `npm run desktop:test:target -- --file test/e2e/resources.spec.ts` | 0 | 9 项 UI 回归；`ui.json` |
| `npm run desktop:test:target -- --file test/e2e/form-navigation.spec.ts --grep 'MCP secrets and a collapsed Skill'` | 0 | 1 项折叠草稿及离开确认回归；`navigation.json` |
| `npm run desktop:test:target -- resources --level native` | 0 | 6 项真实 Electron / 文件系统 / IPC / 重启流程；`native.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 16 项选择器回归通过，含新增 resources 映射 |

除表中完整路径外，报告均位于 `.artifacts/resource-recovery/`。本轮去重后共 24 项相关单元、10 项 UI/导航、6 项原生流程，另有 16 项选择器验证。没有执行全项目检查、全量桌面测试、真实供应商调用或打包 EXE。

原生流程以本轮拥有的临时目录阻塞 JSON 临时文件，验证真实写入错误；修复后重试并重新启动应用。检查创建不重复、刷新和启停仅在落盘后确认、移除失败不留下忽略记录、成功移除后重启不会自动恢复、共享文件仍然存在，以及运行中任务继续使用原配置。

UI 覆盖迟到结果、源文件读取重试、中文输入法 Escape、焦点恢复、中英文错误切换、深浅及系统主题、长路径和三个既有窗口尺寸。属于 DOM/交互回归，不是截图或逐像素验收。

## 失败复现与修复过程

1. 原生首次新增用例的名称定位包含说明文字，修正为既有输入 ID；最初失败记录为 `initial-selector-failure.json`，不作为产品缺陷证据。
2. 真正的保存失败复现中，IPC 已报错，bootstrap 仍包含已启用的新 Skill；`native-red.json`。修复为落盘后发布，并清理本次创建文件。
3. UI 新用例对受控且尚在保存的开关使用了立即校验状态的 uncheck，改为点击再显式等待；`ui-selector-failure.json`。随后复现已删除资源仍显示“已停用”；`ui-red.json`。
4. 语言切换时相同资源的属性顺序差异导致多余检查并清空错误；`ui-language-failure.json`。资源依赖改为固定字段序列，复验不再多发读取。
5. 原生旧扩展用例及 Worker 单测没有响应现有外部工具审批，分别超时和等待。前者为 `native-approval-failure.json`；后者在前三项通过后主动中断，整次不计通过。仅为本地测试扩展明确回复审批，保留产品审批；原生用例同时断言批准前扩展没有执行，重启后的再次授权也经过真实 IPC。

## 缓存与后续

- 修改的资源单测接入现有临时目录所有权机制；正常通过、文件系统错误、重试和原生重启均完成清理。
- 中断的旧 Worker fixture 留下一个目录。逐项核对路径、测试文件和进程退出后，使用只删除已验证文件及空目录的方式清理；记录为 `interrupted-fixture-cleanup.json`。一次组合清理命令被自动审核拒绝，未执行；后续改用上述更小范围方式成功完成。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/resource-recovery.json` 退出 0，最终扫描到 0 个候选目录。没有生成截图、视频或 trace。
- 新入口：`npm run desktop:test:target -- resources` 只跑该模块的单元与 UI；`resources --level native` 单独检查真实桌面流程。开发启动仍使用 `npm run desktop:dev`。
- 此次保证的是资源管理入口使用的资源分组更新；模型、凭据及混合分组保存的完整事务恢复仍需继续复核。没有把进程被强制终止或掉电期间的跨文件一致性认定为已验证。G-UX-03 整体及 G-UX-04 均未关闭。
