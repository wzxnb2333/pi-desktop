# 本机 Codex 前端提取与复现

固定参考：Windows MSIX 26.917.9434.0；归档应用 26.917.71314。归档 SHA-256 为 d4234b03eb532fe0f3e9a7d90caad51edb68af45f771cc786d966377e7446f5a。

## 原始证据

提取器通过 Get-AppxPackage OpenAI.Codex 查询固定版本的 InstallLocation，再定位 app/resources/app.asar；支持 --archive 显式输入。安装路径不写死，版本不符会失败。参考缺失时默认发现模式退出 0 并说明跳过；正常启动、类型检查和测试均不调用提取器。

原始文件、归档路径、字节数、SHA-256、MSIX/app 版本及提取时间保存在忽略目录 .artifacts/codex-reference/26.917.9434.0。元数据 package.json 落盘改名 codex-package.json，避免根依赖校验扫描厂商依赖。

| 分类 | 文件数 |
| --- | ---: |
| CSS | 256 |
| 桌面分支 local-/electron JS | 34 |
| 入口及命名相关 JS | 165 |
| 其余前端 JS 依赖 | 11002 |
| SVG、WOFF/WOFF2、TTF/OTF | 2399 |
| preload 等宿主证据 | 12 |
| HTML、元数据 | 2 |

合计 13870 个原始文件、250223498 bytes。467 份美化副本，0 份美化失败。app-initial、app-primary、app-shared 均包含在内，动态导入依赖一并保留。全部前端 JS 留档不意味着执行或引入这些模块。后台 main/worker 仅登记，位图、音频和 WASM 不作为本轮依据。

## 参考分支与运行时样式

reference-contract.mjs 只读原始三份入口 CSS 与源码，固定 electron / win32 / opaque / application-menu 宿主属性。zra、jda、Rda 确定 Windows 外壳；k9s、z9s 确定上下文设置导航和内容列；local-conversation-thread 与 app-primary 确定本地 multiline composer。

静态 CSS 不是完整主题：qQo 会注入由 YQo / XQo / ZQo / $Qo 等纯函数生成的值。脚本只将逐项白名单中的纯颜色函数及其常量放入无宿主接口的 vm 上下文，不启动厂商应用、不导入认证/遥测/网络模块。页面网络请求全部阻断。

默认 UI 字号 14px，导航小号 13px、行高 18.5714px、常规字重 430；Windows 字体链以 Segoe UI 开头。原包字体已留档，但正常桌面 UI 使用系统字体链，因此未将无关 KaTeX 字体带入应用。

## 复现命令

在仓库根运行：

~~~powershell
node apps/desktop/scripts/codex-reference.mjs
node apps/desktop/scripts/reference-contract.mjs
node apps/desktop/scripts/reference-theme.mjs
node apps/desktop/scripts/reference-icons.mjs
node apps/desktop/scripts/reference-surfaces.mjs
~~~

提取、合同再生成和SVG再提取需要固定参考归档；reference-theme 只读已保存的 reference-contract.json。reference-surfaces 使用相同主题输出、原始入口与用户消息CSS、追踪后的菜单/Tooltip/Dialog/正文DOM，生成 reference-surfaces.json 和应用内 surface-theme.css。脚本核对三份入口CSS哈希，拒绝跨版本混合主题。

应用运行只依赖整理后的 React/CSS、9个常用SVG路径以及菜单选中/弹窗关闭的原始路径，不依赖厂商JS。reference-icons.json、reference-surfaces.json 保存来源位置、哈希和必要的测量结果。

不依赖 Codex 安装的正常验证：

~~~powershell
npm run desktop:check
npm run desktop:test
npm run desktop:test:nonvisual
node apps/desktop/scripts/fidelity-report.mjs
npm run check
~~~

最后两种非视觉入口执行同一套行为/几何测试；fidelity-report 额外写机器结果和 Markdown 报告。不要为本轮验收运行旧 visual.spec.ts 或 desktop.spec.ts。

## 证据边界

reference-contract.json 保存来源哈希、JS 字节锚点、隔离参考 DOM、宿主字体、主题输出和12组原始测量。reference-surfaces.json 另含7类表面的84组原始测量，包括真实按钮内部样式、交互状态和原始关闭图标，以及普通表格、默认代码块的结构与样式。Pi侧加载真正的App和组件，不使用Pi截图或Pi自身快照生成预期值。合同只覆盖明确列出的属性，不代表原版全部DOM或所有功能旗标。

2026-09-26 增补人工视觉检查，见 visual-acceptance.md。在根目录运行 `node apps/desktop/scripts/visual-preview.mjs`，打开打印的本机地址即可并列查看固定源码参考和实际 Pi 组件。预览使用合成数据，不执行厂商 JavaScript；参考页使用原版主内容区域背景，避免把外壳背景与正文背景混比。此预览需要忽略目录中的固定厂商 CSS，启动时逐文件校验哈希；正常应用和自动化回归仍不依赖该目录。

旧 design-tokens.*、interaction-inventory.md 等文档保留为26.915历史调查材料。本轮当前依据是本文件、component-source-map.md、reference-contract.json、reference-surfaces.json、reference-icons.json、remaining-differences.md 和 fidelity-report.md。

