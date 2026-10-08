# Pi Desktop Browser Bridge

开发模式启动：在仓库根目录运行 `npm run desktop:dev`。不需要制作 EXE。

1. 在 Chrome 的 `chrome://extensions` 页面开启开发者模式，选择“加载已解压的扩展程序”，加载本目录 `apps/desktop/chrome-extension`。
2. 在 Pi 的“设置 → 浏览器连接”，或浏览器面板“浏览器操作 → Chrome 浏览器连接”中生成配对码。
3. 打开 Pi Desktop Browser Bridge 扩展弹窗，输入 Pi 显示的随机端口和八位配对码，点击 Connect。显示 Connected 后返回 Pi。
4. 在 Pi 选择主任务，再对需要的 HTTP(S) 标签点击“授权给当前任务”。其他任务已占用的标签需要先撤销原授权。
5. 模型使用 `browser`，指定 `backend: "chrome"`。`tabs` 只返回当前任务已授权的标签。模型操作在后台执行；用户点击“打开浏览器查看”时才聚焦 Chrome。
6. 使用“撤销任务授权”或“断开全部连接”结束访问。重连需重新授权；旧引用、旧连接的标签 ID 和授权都不能继续使用。

协议版本为 2，开发扩展版本为 0.2.0（Pi 接受 0.2.x）。曾加载 0.1.x 的开发用户需要在 Chrome 扩展页重新加载本目录并重新配对；旧协议不支持授权身份检查，Pi 会明确拒绝连接。配对码五分钟过期，只能使用一次，八次错误尝试后失效。会话最长 24 小时，心跳失联 45 秒后失效；应用重启后需要重新配对。token 只保存在主进程和扩展自己的存储，不返回 Pi Renderer。

桥接只监听 `127.0.0.1` 的随机端口。配对完成后的页面数据、操作请求和截图使用 AES-GCM 加密载荷，并校验 token、Host 和扩展来源；Loopback 传输不使用 TLS。

扩展不会读取 Cookie、网页 Local Storage、密码值或浏览器配置。拒绝 `chrome://`、`file://` 和扩展内部页面，只检查主框架和可访问的同源嵌套框架。坐标操作不能绕过跨域框架限制。页面变化、刷新、任务归属变化、撤销后重新授权或断开连接后，旧 `ref` / `observationRevision` 失效，需要重新 `inspect`。重复批准同一份现有授权不会使正常引用失效。

自动回归使用项目提供的真实 MV3 扩展及本地 Chromium 测试配置，不接触日常浏览器配置。本次需在独立临时 Chrome 配置和本地测试页手动完成扩展加载、配对、授权、操作及撤销；自动 Chromium 回归不能代替该验收。接口、定向命令和持续 Goal 状态见 [浏览器控制台账](../../../docs/desktop/browser-control.md)。
