# 设置与凭据：保存失败和重启恢复

本轮接续 G-UX-03，真实 Goal 保持 active。三档执行权限不变，没有启用开发子代理、提交、发布或制作 EXE。

## 实际修复

- 模型、MCP 与外观等混合设置统一在原子写入成功后发布。失败保留原设置、原任务思考程度和运行中的 worker；排队中的旧 UI/任务快照不能覆盖已经提交的设置。
- 删除模型或 MCP 配置时，先保存仅包含密文的恢复记录。配置写入失败恢复原凭据；恢复本身受阻则保留记录，后续凭据访问与重启重新处理。不会把暂时失败解释为密钥不存在。
- 重启按照实际持久配置处理未完成的删除：配置仍引用时恢复缺失凭据，配置已移除时清理旧副本；不覆盖外部写入的新凭据。恢复记录损坏时显示可重试的启动错误，保留原文件与聊天草稿。
- 凭据队列中的一次写入错误不再使后续读取持续失败。普通主题、通知等偏好保存不依赖系统解密；模型的“已保存密钥”标记在启动时从加密存储重新同步。
- 过期模型/MCP 表单不能写入未配置的凭据。插件贡献的 MCP 仍通过现有已安装配置查询，不新增绕过主进程的通道。
- 保存后才释放语音模型缓存、更新空闲任务及失效 worker；worker 清理警告不把已经落盘的设置或密钥误报为需要重新保存。进行中的任务继续使用原模型与密钥，新一轮应用新配置。

## 验证

以下都是本轮实际执行的定向检查。Node 单测命令在 `apps/desktop` 下执行，其他命令在仓库根目录执行。重复用例仅统计最后有效结果；首轮部分失败不改写为整次通过。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run desktop:check` | 0 | 最后一次代码及测试修改后的桌面类型检查 |
| `node --import tsx --test test/settings-persistence.test.ts test/resource-persistence.test.ts test/core.test.ts test/data-migrations.test.ts` | 0 | 25 项；其中早期 5 项设置用例以后续结果为准，其余 20 项存储、资源与迁移证据继续有效 |
| `node --import tsx --test test/settings-persistence.test.ts test/settings-save.test.ts test/settings-updates.test.ts test/mcp-oauth.test.ts` | 0 | 23 项，包含 4 项本地 OAuth/MCP 协议回归；设置测试以后续 quick 结果为准 |
| `npm run desktop:test:target -- settings-storage` | 0 | 19 项设置单测 + 2 项凭据草稿 UI；`quick.json` |
| `npm run desktop:test:target -- settings-storage --level native` | 1 | 初次运行前 2 项混合保存/删除恢复通过，第 3 项预期错误反馈未出现而失败，剩余未执行；`native-initial-failure.json` |
| `npm run desktop:test:target -- --file test/e2e/settings-persistence.nonvisual.spec.ts --grep 'credential write failures'` | 0 | 1 项受控密钥草稿、失败重试、加密不可用时保存偏好及重启；`native-key-retry.json` |
| `npm run desktop:test:target -- --file test/e2e/settings-persistence.nonvisual.spec.ts --grep 'stale model|Electron restart'` | 0 | 2 项过期配置拒绝和跨文件恢复；`native-recovery.json` |
| `npm run desktop:test:target -- --file test/e2e/acceptance.spec.ts --grep 'saving settings and credentials preserves'` | 0 | 1 项运行中 worker、引导队列、下一轮新配置/密钥及重启；`native-active-worker.json` |
| `npm run desktop:test:target -- models --level native` | 0 | 2 项连接模式、模型与允许思考程度原生回归；`native-models.json` |
| `npm run desktop:test:target -- --file test/e2e/data-recovery.nonvisual.spec.ts --grep credentials` | 0 | 1 项损坏恢复记录的真实启动错误、修复后重试及草稿保留；`native-startup.json` |
| `node --test scripts/desktop-test-target.test.mjs` | 0 | 最终映射的 16 项选择器自测 |

表中 JSON 位于 `.artifacts/settings-persistence/`。去重后本轮共 43 项相关单元、2 项 UI、9 项原生流程取得有效通过证据；另有 16 项选择器检查。没有执行全量桌面、共享包或根级完整检查。

原生测试使用拥有的临时目录，在 `desktop.json.tmp` / `secrets.json.tmp` 放置目录复现真实写入错误；模型调用只到本地假供应商。启动测试通过本地 hook 记录真实错误对话框并模拟用户修复文件后点击重试，不替代主进程恢复逻辑。

## 失败记录与边界

- 新增单测最初 5 项失败，其中凭据写入失败确实使后续读取拒绝，其余用例等待新的保存/恢复接口实现。修复后全部通过。
- 首轮原生凭据 UI 用例没有明确确认受控输入的新值就保存，收到“设置已保存”。补充输入前后值检查后只复验该项并通过；原先反馈差异的根因未单独确认，不将其描述为已修复的产品缺陷，其余未运行用例之后分别执行。
- 一次类型检查发现测试使用了超出当前 ES2023 类型目标的 `Promise.withResolvers`；改成显式 Promise 完成回调，未改依赖或编译目标。修改后的测试及最终类型检查均通过。
- 沿用构建工具对上游 Zod 注释的警告，没有将必要的开发 main/preload 构建描述为零警告。
- 这里验证了手动构造中断持久状态后的真实应用重启，未做物理断电、Windows 强制断电或实际账号联调。
- 配置提交与随后逐项更新密钥仍是现有独立操作。成功的密钥不重复提交，未完成的密钥草稿保留；没有宣称整张设置表单与所有凭据为单个跨文件事务。

## 定向入口与缓存

- `npm run desktop:test:target -- settings-storage`：只执行相关设置单测和 2 项凭据 UI。
- `npm run desktop:test:target -- settings-storage --level native`：只执行保存恢复、运行中配置隔离和凭据启动恢复；模型切换单独用 `models --level native`。
- 新测试复用临时目录所有权和退出清理。原生每例包含真实目录消失断言；未生成截图、视频或 trace。
- `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/settings-persistence.json` 退出 0，扫描到 0 个候选目录。
- 启动仍为仓库根目录 `npm run desktop:dev`。

## 后续

G-UX-03 继续复核模型/MCP 删除时的 OAuth 凭据生命周期、进行中的授权取消与跨窗口过期表单；之后进入 G-UX-04 其他功能和用户体验复核。尚未完成的内容不计为范围排除，也不据本轮证据关闭整个 Goal。
