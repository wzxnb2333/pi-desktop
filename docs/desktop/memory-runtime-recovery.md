# 记忆生成与清除恢复（2026-09-29）

本轮接续 G-UX-04，复核记忆的生成、取消、清除、存储故障和重启；沿用原有本机用户/项目隔离、候选确认和默认关闭设置。

## 本轮修复

1. **取消仍保存候选。** 原来只在调用保存前检查取消，排队或写入临时文件期间的取消没有传给存储层。现在在队列开始及原子替换前检查信号，取消不发布候选、不标记来源已处理；可以重新生成。已经提交的操作保留提交结果，不承诺撤回已完成的文件替换。
2. **不完整模型响应被接受。** 即使模型以长度截断结束，只要其中 JSON 可解析就会被保存。现在必须正常结束且不含工具调用，来源校验和凭据过滤继续执行。
3. **旧清除确认覆盖新内容。** 确认框以前提交点击时的最新版本，可能清除打开后另一窗口新增的记忆。现在保存打开时的修订号，由主进程拒绝过期确认；单条删除同样保留原版本。
4. **失败退出收尾被中断。** 已经向调用方报告的写入失败仍留在队列尾部，导致退出等待再次抛出并跳过后续清理和状态保存。现在等待队列排空不重复抛出旧错误；原请求仍收到真实失败，后续写入可恢复。
5. **准备阶段没有取消入口。** 记忆生成原来在等待设置/凭据队列后才创建操作。现在先登记操作、固定来源和记忆版本，显示“正在准备记忆来源”，允许取消；等待完成后复核取消、来源、偏好和记忆修订，再调用模型。

删除确认采用原有紧凑组件，默认聚焦取消。提交时锁定确认框，失败保留目标和原因，可以直接重试；双击只提交一次。准备、提取及取消阶段显示实际进度，错误和状态随语言切换即时更新。没有新增常驻按钮或新弹窗体系。

## 文件

- `apps/desktop/src/main/memories.ts`：取消检查、提交与队列排空。
- `apps/desktop/src/main/memory-generation.ts`：模型响应完整性校验。
- `apps/desktop/src/main/application.ts`：准备阶段操作、来源快照与取消传递。
- `apps/desktop/src/renderer/src/MemorySettings.tsx`、`src/shared/memory-messages.ts`：版本绑定的确认、失败重试及双语进度。
- `apps/desktop/test/memory-generation.test.ts`、`test/memories.test.ts`、`test/e2e/memory-settings.spec.ts`、`test/e2e/memories.nonvisual.spec.ts`：协议、存储、UI 及真实主进程回归。
- `scripts/desktop-test-targets.mjs`：现有 `memory` 入口纳入独立生成协议测试，仍按层级选择。

## 实际验证

以 `--file` 开头的命令使用 `npm run desktop:test:target --` 前缀，从仓库根目录执行。命令、退出码和耗时保存在 `.artifacts/memory-runtime-recovery/`。

| 命令 | 退出码与结果 | 记录 |
| --- | --- | --- |
| `--file test/memory-generation.test.ts --file test/memories.test.ts` | 1；5 项通过、2 项复现取消仍保存和接受截断结果 | unit-red.json |
| `--file test/e2e/memory-settings.spec.ts --grep 'clear confirmation'` | 1；复现旧确认清空后来新增内容 | ui-red.json |
| `npm run desktop:test:target -- memory` | 0；首次修复后 7 项单元、8 项 UI 通过 | quick-first.json |
| `--file test/memories.test.ts --grep 'shutdown settlement'` | 1；复现已报告失败阻断退出等待 | settlement-red.json |
| `npm run desktop:test:target -- memory` | 0；扩充后 8 项单元、9 项 UI 通过 | quick-final.json |
| `npm run desktop:test:target -- memory --level native` | 0；原有 3 项与新增 2 项共 5 项原生流程通过 | native-first.json |
| `--file test/e2e/memories.nonvisual.spec.ts --grep 'memory preparation'` | 1；复现等待凭据时未创建可取消操作 | native-preparation-red.json |
| `--file test/e2e/memories.nonvisual.spec.ts --grep 'memory preparation\|opt-in background generation\|actual memory inference\|memory cancellation\|memory disk failures'` | 0；修复准备阶段后仅重跑相关 5 项流程 | native-generation-final.json |
| `--file test/e2e/memory-settings.spec.ts --grep 'memory generation keeps'` | 0；增加实际准备进度及即时双语断言后通过 | ui-generation-final.json |
| `npm run desktop:check` | 0；最终桌面代码与测试类型检查通过 | desktop-check.log |
| `node --test scripts/desktop-test-target.test.mjs` | 0；16 项选择器检查通过 | 本轮命令输出 |

去重为 **8 项单元、9 项 UI、6 项原生流程**，另有 16 项选择器检查。没有将失败运行改写为成功，也没有因为一个场景改变重跑其他模块。

原生流程通过真实 Electron/IPC 和本地假供应商验证：用户/项目上下文、停用及删除后不再注入、来源与凭据过滤、候选确认、后台生成、取消、存储失败、清除重试、重启及凭据排队。磁盘测试使用真实阻塞目录和实际临时文件写入；取消测试在文件已写入而尚未发布时拦住调用，确认候选和已处理标记未提交。

UI 检查中英文、深浅主题、1440×940 / 1000×700 / 1280×800 的确认框溢出、键盘焦点、重复点击、失败重试及即时翻译；原生已有双语设置矩阵也通过。本轮没有执行像素对比或声明人工视觉验收。

## 边界与后续

未调用真实付费供应商，不声称测得任意模型的事实提取准确率或秘密识别完整率。用户已经发送的模型请求及原始聊天不被撤回；取消生成不取消另一项用户主动提交的凭据保存。准备等待取消后不会开始推理。

所有新增测试沿用临时目录所有权及统一清理，原生用例退出后断言目录不存在。只读审计 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/memory-runtime-recovery.json` 退出 0：scanned=1、eligible=0、skipped=1。没有新增残留；既有 `pi-acceptance-9NrmPU` 保留，没有绕过此前删除拒绝。

开发启动：`npm run desktop:dev`。没有修改依赖、锁文件或共享包，没有全套测试、提交、发布或制作 EXE。整体 Goal 继续 active；下一项为可选子任务的运行恢复，之后按原功能台账复核仍未证明的验收项。
