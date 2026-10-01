# 插件凭据与持久化恢复

属于持续 Goal 的 G-UX-03。本阶段完成插件安装、更新、回退、停用和卸载对应的凭据恢复与取消验证；整体 Goal 保持 active。

## 缺陷与修复

- 原生回归复现：卸载已登录的插件后，MCP 密钥与 OAuth 密文仍残留，重新安装会恢复旧授权。失败记录 `.artifacts/plugin-credentials/uninstall-red.json` 退出 1；修复后同一用例退出 0。
- 插件变更与设置变更共用已有主进程写入队列。插件配置成功落盘后才发布；保存失败仍使用原版本，排队中的旧后台快照不能把新配置覆盖回去。没有新增绕过主进程的通道。
- 卸载清除插件所属的 MCP 密钥与 OAuth 密文。启用更新或回退时，HTTP 地址、stdio 命令/参数变化清除旧通用密钥；OAuth 地址、客户端或 scope 变化清除旧令牌。准备候选版本本身不影响当前授权。
- 比较 stdio 配置时保留清单里的 `{pluginRoot}`，实际运行时才替换安装路径；仅更换版本目录不会误判为用户更换了服务端点。
- 暂时停用取消仍在进行的登录并关闭回调监听，但保留已提交的授权，重新启用及重启后可继续使用。取消尚未提交的排队操作不会停用当前插件；取消后的新操作可继续执行。已经完成的原子落盘不会因随后到达的取消而自动撤销。
- 凭据删除记录只保存密文和非敏感的配置指纹。失败时恢复原授权；如果配置已经成功改为新端点，残留恢复记录不会把旧请求头重新绑定到同 ID 的新端点。旧格式恢复记录仍可读取。
- 启动恢复后清理不再被当前基础 MCP 或已批准插件版本引用的 MCP/OAuth 凭据。保留已批准但停用的插件、供应商凭据及其他命名空间。清理失败保留原文件并进入既有可恢复启动错误流程，不静默丢弃设置。
- 尚未填完且停用的 OAuth 配置可正常保存；真正发起授权时仍严格校验地址。

## 定向验证

命令均从仓库根目录运行。通过用例去重：26 项单元、10 项 Electron 原生流程，共 36 项。两项既有插件流程包含真实管理界面操作，不另外重复计为 UI 测试。

| 命令 | 退出码与结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test apps/desktop/test/mcp-oauth.test.ts apps/desktop/test/plugins.test.ts apps/desktop/test/settings-persistence.test.ts` | 0；26 项通过 | 本轮完整终端输出 |
| `node --import tsx --test --test-name-pattern 'failed activation' apps/desktop/test/plugins.test.ts` | 0；补充取消断言后 1 项通过，已包含在上述 26 项中 | 本轮完整终端输出 |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts --grep 'uninstalling a plugin'` | 0；1 项通过 | `.artifacts/plugin-credentials/uninstall-green.json` |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts --grep 'plugin OAuth update\|disabling a plugin\|startup prunes'` | 0；3 项通过 | `.artifacts/plugin-credentials/lifecycle-green.json` |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts --grep 'require explicit trust\|catalog sources persist\|startup prunes'` | 0；3 项通过，启动用例补充旧恢复记录断言；去重新增 2 项 | `.artifacts/plugin-credentials/management-and-startup.json` |
| `npm run desktop:test:target -- --file test/e2e/plugins.nonvisual.spec.ts --grep 'cancelling a plugin change'` | 0；1 项通过 | `.artifacts/plugin-credentials/cancellation-green.json` |
| `npm run desktop:test:target -- --file test/e2e/settings-persistence.nonvisual.spec.ts --grep 'changing an MCP target'` | 0；1 项通过 | `.artifacts/plugin-credentials/headers-recovery.json` |
| `npm run desktop:test:target -- --file test/e2e/mcp-oauth.nonvisual.spec.ts --grep 'removing an MCP\|OAuth identity changes'` | 0；2 项基础 MCP 回归通过 | `.artifacts/plugin-credentials/oauth-regression.json` |
| `npm run desktop:check` | 0；最终桌面类型检查通过 | 本轮完整终端输出 |

取消测试第一次运行在注入故障时使用了 ESM 主进程没有的 `require`，退出 1，记录保留于 `.artifacts/plugin-credentials/cancel-harness-failure.json`。改为当前运行时的内置模块访问并同步 ESM 绑定后，该用例实际验证：阻塞密钥保存、排队停用、取消、解除阻塞、插件仍启用、再次停用成功。没有将测试夹具失败算作产品失败，也没有将失败运行改写为通过。

原生测试使用真实 Electron、系统加密存储和本地 OAuth 假服务；包括重启、失败落盘、恢复记录、正在运行的任务、插件版本切换和卸载后的重新安装。没有接触真实账号或供应商令牌。测试文件归入已有 plugins、oauth、settings-storage 入口，本轮没有修改依赖、锁文件或检查入口。

## 缓存与边界

- 新增原生用例结束后断言自有存储目录不存在。最终命令 `node apps/desktop/scripts/cleanup-desktop-temp.mjs --root D:/systemp --minimum-age-minutes 0 --report .artifacts/temp-cleanup/plugin-credentials.json` 退出 0；候选残留 0，未执行批量删除。
- 未生成整套截图、视频或 trace；未运行全项目检查、完整桌面回归、安装包制作、提交或发布。开发模式夹具构建中的既有 Zod 注释及 NO_COLOR 提示保留。
- 自动清理只判断凭据是否仍被有效配置引用，不能追溯仍在使用的同 ID 凭据在旧版本中究竟来自哪个历史端点。保留的未知来源不冒充已验证迁移。
- 本地清除不代表服务网站上的授权撤销；普通卸载和配置切换不自动调用远端撤销。未做真实第三方账号联调。
- 下一阶段进入 G-UX-04，核对其余功能的可操作入口与失败恢复；本轮不是整个 Goal 完成。开发启动命令仍为 `npm run desktop:dev`。
