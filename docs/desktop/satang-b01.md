# B01：项目欢迎页与首页输入区

此文保留 B01 当时的验收状态；后续 B02–B05 接续结果见 [satang-b02-b05.md](satang-b02-b05.md)，当前总表见 [satang-ui-migration.md](satang-ui-migration.md)。

日期：2026-09-26。状态：本页范围已验证，整体 UI 移植尚未完成。顶部外壳与侧栏留在 B02 联动处理。

## 实现与来源

- 来源为 Satang 保存的 Codex 26.915.4065.0 pinned welcome：深浅两主题 × 1440×940 / 1000×700，共四份 DOM。`satang-reference.json` 保存每份截图及 DOM 的 SHA-256、节点索引、矩形和样式；源归档 SHA-256 引用供体取证记录，本轮未重新计算归档。
- 新增只读导入器 `apps/desktop/scripts/satang-reference.mjs`，不移入捕获的真实对话和账户内容。四份来源文件也分别登记 SHA-256。
- 项目欢迎页采用 56px 标记、24px 标题间距、28px 标题、两段 flex 分配以及 96px 中间留白；输入列上限 768px、两侧内缩 16px，环境条内缩 13px、与输入框重叠 4px，输入框圆角 22px。单个空任务不显示额外标签条，多任务和恢复关闭标签仍保留。
- 接入实际项目选择、模型与思考级别、执行策略、附件、计划模式、Worktree、草稿恢复和首次发送；原有建议问题移入“新任务选项”。空会话存在用量记录时仍可查看。
- 未配置模型时显示真实 Pi 配置引导；没有项目时保留“添加本地项目”。没有复制参考中的 Windows 设置状态、账户资料或虚构订阅。Pi 标记、中文内容和已有实际功能保留。

## 实际验证

| 命令 | 退出码 | 结果与边界 |
| --- | --- | --- |
| `node apps/desktop/scripts/satang-reference.mjs E:/AI_collection/satang_code` | 0 | 四组测量及四份源文件摘要导入成功；未识别图片 |
| `npm run desktop:check` | 0 | 最终代码 TypeScript 检查通过 |
| `npm run desktop:test:nonvisual -- reference.spec.ts composer.spec.ts workbench.nonvisual.spec.ts` | 0 | 57/57；涵盖首页交互、原输入框、真实工作台草稿、队列、恢复、终端及浏览器操作 |
| `npm run desktop:test:nonvisual -- reference.spec.ts` | 0 | 补充空会话用量保留后复验 24/24；结果归档到 `.artifacts/desktop-visual/satang-b01-reference-results.json` |

最初两项交互失败来自新增测试夹具未提供必填 `thinking`、`policy`；修正夹具并初始化实际打开的任务列表后通过。初始测试注册位置错误也已修正，均不计为通过证据。实际工作台回归使用既有开发测试启动器，不生成发行包。

四个首页场景验证：输入框及环境条 x/y/宽/高与来源差异不超过 0.5px；标题纵向位置、字号、字重和颜色匹配；输入文本颜色匹配。还验证 620px 窗口超长项目名、多行草稿、菜单可达、分栏极值、系统主题变化、旧 26.917 对话源码合同及首次发送后的会话切换。不能据此推断全窗口逐像素一致。

## 图像验收

本批计 5 次：两张原始来源图、三次输出图检查；其中一次浅色截图恰逢主题过渡，保留记录并由稳定后重拍替代。沿用前一视觉循环 13 次计数时保守合计 18 次，本循环不再识别图片。

- 有效深色输出：`.artifacts/desktop-visual/satang-b01-home-dark-1440.jpg`。
- 有效浅色模型引导：`.artifacts/desktop-visual/satang-b01-setup-light-1000-settled.jpg`。
- 过渡帧（不作为通过证据）：`.artifacts/desktop-visual/satang-b01-setup-light-1000.jpg`。

有效输出已人工查看：首页标题、输入框、环境条与模型引导可见，没有重叠或横向溢出。窄至 620px、长项目名、多行草稿和交互状态使用 DOM 与动作回归验证，不伪称另有已查看截图。

## 未完成范围

- B01 中的顶部外壳细节随 B02 继续；当前全窗口截图仍含旧 Pi 标题栏、侧栏结构及工具栏，不是最终 Codex 整窗复刻。
- B02 对话、工具状态与搜索；B03 辅助面板；B04 设置与管理页；B05 完整验收均待执行。
- 参考已知缺口：pinned review 与窄窗口 palette 未到达，审批同态截图未取得；后续需明确采用的替代源码/旧截图证据。
- 未提交、未制作发行包、未发布；持续目标保持 active。
