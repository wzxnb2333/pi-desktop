# OAuth 凭据生命周期与过期表单恢复

属于持续 Goal 的 G-UX-03。本轮修复凭据生命周期及并发设置边界；Goal 保持 active，不代表全部功能完成。

## 复现与实现

- 修复前，删除 MCP 配置只清除环境变量/请求头密钥，未删除对应 OAuth 密文；重新添加同 ID、地址和 OAuth 配置会恢复旧授权。原生回归实际出现预期 1 个凭据、实际 2 个的失败，退出码 1，记录为 `.artifacts/oauth-lifecycle/native-red.json`。
- 删除服务、改变地址、客户端 ID、scope 或关闭 OAuth 时，将旧 OAuth 密文纳入设置删除事务。保存失败恢复旧配置和密文；重启按照已经落盘的配置恢复日志。改显示名称或暂时停用服务不删除授权。
- 设置变更先取消旧配置的授权操作，等待旧登录、刷新及撤销的写入结束，再进入凭据事务。进行中的旧回调会关闭；迟到写入不能在清理完成后重建旧授权。保存失败时旧授权仍可使用，已取消的登录需重新点击。
- OAuth 读取、刷新与写入复核当前有效配置；跨窗口过期表单的登录、刷新、撤销请求在主进程拒绝。配置校验和任务启动使用既有设置写入队列，未新增绕过主进程的通道。
- 模型密钥与 MCP 密钥保存携带用户编辑时的配置基线。即使无改动的偏好保存返回另一窗口的新配置，也不会把旧密钥草稿静默绑定到新端点/模型。冲突保留未保存密钥，展示新配置及错误后可以显式重试；动态 hasKey 状态不会误报冲突。
- 新错误支持中英文；凭据仍仅由主进程加密保存，Renderer 不读取 OAuth 令牌。

## 验证证据

以下命令均在仓库根目录运行。成功结果按案例去重，共 20 项单元、6 项 UI、8 项原生流程，即 34 项；最初失败记录保留。

| 命令 | 退出码与结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/mcp-oauth.test.ts apps/desktop/test/settings-persistence.test.ts` | 0；17 项通过 | 本轮终端完整输出 |
| `node --import tsx --test apps/desktop/test/localization.test.ts` | 0；3 项通过 | 本轮终端完整输出 |
| `npm run desktop:test:target -- --file test/e2e/mcp-oauth.nonvisual.spec.ts --grep 'removing an MCP\|changing an authorizing'` | 0；2 项通过，已包含在后续 5 项中 | `.artifacts/oauth-lifecycle/native-green.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-oauth.nonvisual.spec.ts` | 0；当时 5 项通过 | `.artifacts/oauth-lifecycle/native-oauth.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-oauth.nonvisual.spec.ts --grep 'OAuth identity changes'` | 0；随后新增的 1 项通过 | `.artifacts/oauth-lifecycle/native-rollback.json` |
| `npm run desktop:test:target -- --file test/e2e/settings-persistence.nonvisual.spec.ts --grep 'reconfigured\|concurrent model'` | 0；2 项通过 | `.artifacts/oauth-lifecycle/native-stale-forms.json` |
| `npm run desktop:test:target -- --file test/e2e/settings.spec.ts --grep 'key drafts\|failed key saves'` | 0；2 项通过 | `.artifacts/oauth-lifecycle/ui-keys.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-settings.spec.ts --grep 'OAuth'` | 0；3 项通过 | `.artifacts/oauth-lifecycle/ui-oauth.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-settings.spec.ts --grep 'MCP secret saves'` | 0；1 项通过 | `.artifacts/oauth-lifecycle/ui-mcp-secrets.json` |
| `npm run desktop:check` | 0；最终桌面类型检查通过 | 本轮终端完整输出 |

原生测试使用真实 Electron、系统加密存储、OAuth/PKCE/刷新/撤销协议适配器和本地假服务。覆盖已授权服务删除后重启、旧回调取消、新登录重试、同 ID 配置变化、失败落盘回滚、运行中登录及工具令牌使用。跨窗口冲突通过主进程插入并发配置变更复现，包含真实设置界面保留密钥草稿及用户显式重试；没有把模拟主进程的 UI harness 作为原生证据。

新增测试归入已有 oauth、mcp、settings-storage 定向入口；没有修改选择器或检查入口，没有重新运行全套回归。开发启动命令仍为 `npm run desktop:dev`。

## 边界与后续

- 删除/改变服务时清除的是本地凭据，不代表服务网站上的授权已经撤销。用户主动点击“撤销授权”仍调用远端撤销接口。测试验证普通删除不会隐式发起远端撤销。
- 本轮没有执行真实第三方账号联调、完整桌面回归、视觉验收、提交、发布或安装包制作。开发模式构建中原有 Zod 注释及 NO_COLOR 提示保留，未修改依赖或锁文件。
- 本轮新增原生用例均断言自有存储目录被清理；单元和 UI fixture 复用既有所有权目录机制。最终审计命令为 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/oauth-lifecycle.json`，退出 0、候选残留 0；没有进行批量删除或生成整套截图、视频和 trace。
- 下一项继续检查插件来源的 MCP 在卸载、回滚和启停后的凭据生命周期，以及旧版本留下的不可直接归属的 OAuth 密文；未验证部分不算通过。完成管理流程复核后进入 G-UX-04。
