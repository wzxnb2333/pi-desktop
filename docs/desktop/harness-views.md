# 模型打开 Pi Desktop 视图

H-05 新增模型工具 open_in_pi，复用现有文件编辑器、右侧工具标签及独立摘要。沿用 Worker → 受校验的桌面工具协议 → 主进程，不开放通用 Renderer IPC。

## 可用操作

| kind | 行为 | 可选参数 |
| --- | --- | --- |
| file | 打开项目内普通文件；文本可以定位行列 | path 必填；directoryId、line、column 可选，列必须同时指定行 |
| changes | 显示指定目录的变更面板 | directoryId |
| review | 显示审查表单，等待用户主动启动 | directoryId |
| subtasks | 显示子代理只读列表 | 无 |
| summary | 显示右上角独立摘要；已打开工具面板继续保留 | 无 |

~~~json
{ "kind": "file", "path": "src/main.ts", "line": 24, "column": 5 }
{ "kind": "changes", "directoryId": "已配置的目录 ID" }
{ "kind": "summary" }
~~~

directoryId 默认使用调用任务捕获的执行目录；附加目录沿用项目已有访问校验。文件名的前导空格保留，不能误打开另一个同名文件。路径穿越、链接指向项目外、目录、缺失文件、超出预览上限，以及给二进制文件指定代码位置都会被拒绝。普通预览上限 10 MB，PDF 50 MB；HTML 指定代码位置时使用现有源码视图。

## 导航与权限

- 仅普通主会话注册此工具。子代理、审查任务和临时侧聊没有入口；主进程再次校验调用归属。不会让子代理自行打开或接管用户窗口。
- 只更新当前显示该聊天的所属窗口。用户已经切去设置、其他聊天，或校验期间改变导航/窗口归属，返回 not_opened，不强行切回，不自动重试。
- 复用已有同类标签，不关闭其他工具和浏览器标签；保留聊天草稿、阅读位置、附件及未保存编辑缓冲。目录内文件状态分别维护。
- 不启动命令、审查或外部应用，不创建窗口，不扩大任务权限。网页导航继续使用既有 browser 工具。
- opened 表示导航状态已应用；文件实际加载仍由原编辑器处理，不能据此声称渲染完成。状态沿用现有延迟保存机制，不能把此结果当作同步落盘凭据。

## 定向验证

以下命令均在仓库根目录执行，标明例外。使用本地假供应商与真实 Electron、Worker、IPC、文件和独立窗口，没有真实模型账号调用。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| npm run desktop:check | 0 | 最后一次修改后的桌面类型检查 |
| npm run desktop:test:target -- harness-views | 0 | 12 项：7 项视图/导航/目录单元与 5 项协议单元 |
| node --import tsx --test --test-name-pattern="leading spaces" test/desktop-views.test.ts（apps/desktop） | 0 | 最终断言类型修正后，文件名空格回归单独复核 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "a model opens" | 0 | 实际模型打开文件、定位、未保存缓冲、草稿及重启恢复 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "desktop view tools&#124;desktop view path&#124;child asks and receives" | 1 | 多窗口隔离与主子代理通信通过；路径用例因测试读取未初始化 UI 状态失败 |
| npm run desktop:test:target -- --file test/e2e/harness-tools.nonvisual.spec.ts --grep "desktop view path" | 0 | 修正上述测试基线后，越界拒绝和有效路径重试通过 |
| node --test scripts/desktop-test-target.test.mjs | 0 | 16 项定向选择器回归 |

三个新增原生场景和一个关联子代理场景分别取得通过证据，不声称四项在同一次执行通过。新增 native 入口为 npm run desktop:test:target -- harness-views --level native，仅选三个视图场景；harness 原生入口继续只选原有四个查询/通信场景。

保留失败过程：最初尚未注册工具的原生用例失败；编辑缓冲未恢复时重启触发测试关闭对话框错误，测试在证明缓冲保留后恢复原文再重启；路径测试使用可缺省的原 UI 状态；新增前导空格用例真实复现了路径 trim 导致打开错误文件，现已移除 trim。最后类型检查发现测试直接访问未收窄的返回类型，改为比较完整对象后通过。

证据：[单元](../../.artifacts/harness-views/unit.json)、[文件与重启](../../.artifacts/harness-views/native-file.json)、[包含失败的隔离批次](../../.artifacts/harness-views/native-isolation-initial.json)、[路径重试](../../.artifacts/harness-views/native-path-retry.json)。

## 缓存与范围

首次关闭失败留下本轮 pi-acceptance-eauY01，19,541,438 字节。核对项目、测试草稿、代码文件、进程及调试端口后，仅清理该目录；清理结果单独保存，不把首次失败说成自动清理成功。后续通过场景均检查自有目录不存在。最终审计保留在 [目录审计](../../.artifacts/harness-views/temp-audit-final.json)，定向删除证据见 [清理结果](../../.artifacts/harness-views/cleanup-owned.json)。之前遗留且身份无法确认的 pi-acceptance-9NrmPU 未改动。

原生测试关闭截图、视频和 trace。本轮没有全套桌面测试、根级完整检查、依赖变更、提交、发布或 EXE。沿用现有视图，未进行新增视觉验收；PDF/HTML 的广泛预览能力仍引用此前对应模块证据，不算本轮新增验证。

启动：npm run desktop:dev。需要重启开发应用后发起新轮次，已在运行的 Worker 不热替换工具。整体 Goal 继续 active；本页只登记 H-05，未完成的原功能验收没有变更为完成或排除。
