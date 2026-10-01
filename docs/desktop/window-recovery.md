# 多窗口打开、回滚与重启恢复

日期：2026-09-29。本次为持续 Goal 的定向阶段；独立/快捷聊天的创建与目录绑定持久化仍待接续复核。

## 本次完成

- 原生复现：独立窗口保存失败后，原窗口恢复任务，但新窗口仍存在，形成两个编辑视图。现在失败会释放并销毁未完成的目标窗口，恢复原所有权；任务执行、历史与共享草稿保持不变。
- 打开期间预留任务所有权，同一请求等待同一次提交，不能通过导航抢回另一编辑视图。窗口实际提交后才显示；最大化恢复也延后，避免 Windows 的 maximize 提前显示未完成窗口。
- 回滚只恢复仍空闲的来源选择，不覆盖等待期间新选的聊天、语言和布局。旧释放回调不能取消新一轮预留；退出等待已经接受的打开请求收尾，取消的目标不会在重启时复活。
- 原独立窗口已经转到另一个聊天时，再次打开原任务会定位真正的任务所有者或创建新的独立窗口，不再仅凭窗口旧标识聚焦错误聊天。
- 修复主窗口空选择在启动时抢占应恢复到独立窗口的任务。恢复一个窗口失败时保留主应用及其他恢复流程；原任务可以在主窗口继续，并提供可重试、即时双语的错误反馈。
- 保留全局快捷聊天、关闭窗口不停止任务、草稿/布局重启恢复及原生浏览器视图迁移。

## 已执行验证

从仓库根目录运行，只选择相关用例。新增测试文件最终 8 项均取得通过证据，来自下列分次运行；没有把失败的整轮改写成通过。

| 命令/范围 | 退出码 | 证据与结果 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/window-state.test.ts` | 0 | 最终 3/3；导航、共享草稿、语言、预留和释放，unit-final.log |
| `--file test/e2e/window-recovery.nonvisual.spec.ts` 首次修复运行 | 0 | 当时 2/2：磁盘失败回滚、旧窗口转到其他聊天；native-first-pass.json |
| 同文件：pending window transfer / duplicate window opens / shutdown waits | 1 | 第一项并发导航回滚通过；第二项复现启动抢占任务，第三项未执行；restart-red.json |
| 同文件：duplicate window opens / shutdown waits | 0 | 修复后 2/2；restart-final.json |
| 同文件：renderer loading failure / restoring a maximized | 1 | 第一项加载失败重试通过；第二项复现最大化提前显示；maximized-red.json |
| 同文件：restoring a maximized | 0 | 1/1；maximized-final.json |
| 同文件：one failed restored window / duplicate window opens | 0 | 最终 2/2：恢复失败保留主窗口、双语提示、重试及正常独立窗口恢复；restoration-final.json |
| `--file test/e2e/acceptance.spec.ts`：separate task windows share / quick chat keeps | 0 | 既有 2/2：运行、布局、草稿、重启和全局快捷键恢复；behavior-final.json |
| `--file test/e2e/browser.nonvisual.spec.ts`：browser pages move to the task window | 0 | 既有 1/1：真实原生网页视图移动、关闭及窗口隔离；browser-final.json |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 定向选择器 16/16 |
| `npm run desktop:check` | 0 | 最终类型检查，desktop-check.log |

上表的 --file 范围均通过 `npm run desktop:test:target --` 执行；名称筛选使用 --grep，多个名称以引号内的正则竖线连接。可直接复用：

```powershell
npm run desktop:test:target -- windows
npm run desktop:test:target -- --file test/e2e/window-recovery.nonvisual.spec.ts --grep 'one failed restored window|duplicate window opens'
```

本轮去重后 3 项单元、11 项原生流程通过，另有 16 项选择器检查。证据位于 `.artifacts/window-recovery/`。没有运行完整桌面/根级回归，没有使用真实供应商、付费模型、截图、视频或 trace。

保留首次失败记录：native-red 是保存失败仍有两个窗口；restart-red 是重启只剩一个窗口；maximized-red 是未提交目标已显示；startup-red 是恢复失败导致整个应用退出。测试夹具首版只阻断一次 HTTP 请求，被 Chromium 重试恢复；随后改为持续阻断目标加载。另一处夹具曾停在后台保存而非显式打开提交，改为保持存储故障直到操作返回。慢速运行时 Playwright 的 Page 通知晚于原生窗口注册，改为等待实际窗口事件完成；没有放宽所有权、持久化或可见性断言。

## 清理与后续

每项原生测试退出后断言其所有权目录不存在。最终只读审计 `.artifacts/temp-cleanup/window-recovery.json`：扫描 1、可清理 0、跳过 1，仅旧 `D:/systemp/pi-acceptance-9NrmPU`，无已验证签名，未删除；本轮没有新增残留。

启动：仓库根目录 `npm run desktop:dev`。未提交、发布或制作 EXE，既有共享包和依赖差异没有改动。

真实 Goal 保持 active。下一项独立/快捷聊天的创建、目录绑定和失败重试：当前代码仍在部分 store.save 前修改公开任务状态，需要用真实磁盘故障复现并完成恢复，不能由本轮窗口验收代替。
