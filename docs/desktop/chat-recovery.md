# 独立聊天创建、快捷窗口与目录绑定恢复

日期：2026-09-30。接续 2026-09-29 的窗口恢复阶段，仅验收本次受影响的流程，不代表整个持续目标完成。

## 修复行为

- 独立聊天在持久化成功后才公开。保存失败不留下聊天记录，收回本次新建的空工作目录；无法安全清理时保留内容并报告实际路径。
- 新建聊天使用请求标识。连续点击、在途重试及同一标识的重启后重试复用一次创建；成功后下一次新建使用新标识。原 thread.create 入口仍可创建独立聊天。
- 快捷聊天与其窗口记录一起保存。窗口加载失败后再次打开、或重启后再打开，复用原聊天和草稿，不产生第二份空聊天。
- 绑定项目目录先校验运行状态、实际目录和当前项目配置，保存成功后才切换执行目录和权限边界。失败后仍为独立聊天；相同目标重试幂等，不能借重试切到另一目录。
- 绑定期间阻止发送、恢复会话、工具重连及运行参数变更；发送等待仓库锁之后再次检查。允许继续编辑草稿，旧后台快照不会覆盖已经提交的绑定。
- 输入区同帧点击去重。新聊天迟到响应不抢走后来选择的聊天，即使用户离开后又返回原聊天；文件夹选择器迟到响应不绑定后来选择的聊天。保留未发送草稿、附件和即时双语错误。
- 退出等待创建和绑定的收尾，提交前再次检查关闭状态；取消的候选不会在重启时变成已创建或已绑定记录。

## 实际验证

以下命令从仓库根目录执行。没有全量桌面回归、截图、视频、trace、真实账号或付费供应商请求。原生用例使用实际 Electron、文件系统故障和本地假供应商。

| 命令 | 退出码 | 结果 / 证据 |
| --- | --- | --- |
| `npm run desktop:test:target -- --file test/chat-persistence.test.ts` 首次 | 1 | 6/7；首版夹具修改草稿后没有模拟对应保存，随后修正为真实写入顺序；unit-first-pass.json |
| `npm run desktop:test:target -- chats` | 1 | 单元阶段 7/7、退出 0；随后 UI 因夹具缺少必填数据启动失败。原整轮失败保留在 ui-first-pass.json，不能视为 quick 全过 |
| `npm run desktop:test:target -- chats --level ui` 最终 | 0 | 5 项新建/绑定 UI + 1 项既有未保存表单导航，共 6/6；ui-final.json |
| `npm run desktop:test:target -- --file test/e2e/chat-recovery.spec.ts` | 0 | 更正夹具错误本地化函数后，受影响的 5/5 重新通过；ui-localization-final.json |
| `npm run desktop:test:target -- chats --level native` | 0 | 7 项磁盘失败、请求去重、快捷窗口、并发绑定及退出恢复；2 项既有独立聊天真实运行和快捷键/草稿重启流程。共 9/9；native-final.json |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 选择器 16/16；selector-final.log |
| `npm run desktop:check` | 0 | 最终桌面类型检查；desktop-check.log |
| `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --report .artifacts/temp-cleanup/chat-recovery.json` | 0 | 只读审计：扫描 1、可清理 0、跳过 1，无本轮新增残留 |

去重后本阶段为 7 项业务单元、6 项 UI、9 项原生流程，另有 16 项选择器检查。报告位于 `.artifacts/chat-recovery/`。

保留 2026-09-29 的产品缺陷首次复现 create-red.json（保存失败后仍有一条独立聊天）及初步 native-first-pass.json。后续 UI 夹具曾猜错英文按钮名称（directory 与实际 folder 不同），ui-label-failure.json 保留失败；改为读取项目词条后通过。类型检查曾发现夹具对任意错误文本误用类型约束翻译函数，改为与产品一致的 localizeAppError；原失败保留在 desktop-check-fixture-error.log。未跳过断言或放宽权限限制。

## 清理与交付边界

原生用例每次退出后断言本次 storage 目录不存在；单元及 UI 使用既有所有权清理机制。仅保留旧 `D:/systemp/pi-acceptance-9NrmPU`，201,820 字节，缺少可验证归属签名，本次没有尝试删除。

启动命令：`npm run desktop:dev`。未提交、发布、安装依赖或制作 EXE；既有共享包与锁文件差异未修改。开发依赖既有 Rollup 注释警告保留，不把开发编译描述为无警告。

本次不声称项目任务、Worktree 任务或配置回调创建的恢复已全部通过。application.ts 的 createThread 项目/配置路径仍在 store.save 前插入公开记录；下一阶段需要分别验证项目任务、自动化和子任务关联，不能用独立聊天的证据替代。多目录配置保存/删除及其访问边界的恢复也仍需按原台账核对。

运行时 get_goal 在本轮两次返回 paused。本轮按继续请求完成已授权工作，没有改变目标内容、标记完成或声称已恢复自动续轮；目标状态不能仅通过文档修改。
