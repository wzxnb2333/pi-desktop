# Pi Desktop Windows 实施记录

目标：在 Pi v0.86.1（13cbf77）上实现完整 Windows 本地工作台，复刻 Codex 公开 GUI，使用真实 SDK、原生终端与 Git，交付安装包和验证证据。

## 已批准范围

项目/任务、流式会话、计划与审批、API Key/自定义模型、文件与差异、Git/worktree、终端、localhost 浏览器、Skills/扩展/MCP、持久化自动化、设置、深浅色与键盘操作。

## 实施顺序

- [x] 1. 仓库与桌面构建入口
- [x] 2. IPC、存储、审批策略及回归测试
- [x] 3. Pi worker、事件转换、会话恢复/分叉/压缩
- [x] 4. Windows 服务：终端、文件、Git/worktree、预览
- [x] 5. Codex 风格完整界面
- [x] 6. 模型设置、Skills/扩展、MCP、自动化
- [x] 7. 打包、恢复、首次运行与文档
- [x] 8. 类型检查、测试、UI 和安装包验收

## 决定

- 主智能体独立完成，不启用子代理，不自动推送或创建 PR。
- 当前目录是空目录，克隆完整上游提交历史作为可回滚基线，在 feature/desktop-windows 开发；不创建孤立空提交。
- 新应用目录按批准方案使用 apps/desktop，并加入上游 npm workspaces。
- 本地元数据使用带版本和原子替换的 JSON；Pi JSONL 作为会话的原始记录。
- 本机执行确认不等于 OS 沙箱；计划模式只暴露内置只读工具，禁用可执行扩展与 MCP。
- UI 参照 https://learn.chatgpt.com/docs/windows/windows-app 和 https://openai.com/index/codex-for-almost-everything/ ，品牌替换为 Pi Desktop，默认中文。
- npm 依赖锁定，先 ignore-scripts 安装，只运行桌面启动和打包确实需要的 Electron 安装步骤。

## 验证记录

已完成验证：IPC、审批/计划/拒绝策略、路径安全、加密存储、Pi 假供应商流式响应、会话恢复/分叉/压缩、Git/worktree、MCP stdio、调度器、Electron UI 和 Windows 安装包。截图保存在 `.artifacts/screenshots`；安装/升级/卸载验收脚本在 `apps/desktop/test/e2e/installer.spec.ts`，需要提供两个本地安装程序路径后执行。
