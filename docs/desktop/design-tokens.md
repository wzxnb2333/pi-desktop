# Codex 设计令牌 → Pi 令牌映射（WP1 实施表）

事实来源只有两个：`docs/desktop/design-tokens.json`（1,812 个令牌名 / 2,950 条声明，每个名字带
`value`、`family`、`scope`、`sources[{file,offset,selector,at}]`、主题覆盖）与
`docs/desktop/design-tokens.generated.css`（同一批声明的逐条抄本）。本文不引入截图、不引入推测。

证据引用格式：`shared@18485` = `.artifacts/codex-reference/26.915.4065.0/webview/assets/app-shared-11c21cbb0024.css`
的第 18,485 个 **UTF-8 字节**；`initial@` = `app-initial-19d25b9d212e.css`，`primary@` =
`app-primary-d77f37ba49ff.css`。字节下标同时出现在 generated.css 的 `/* source: …@N */` 注释里，
可逐字节复现（抽取方式见 `reference-extraction.md`）。注意：偏移一律指向**被引用那段文本的起始
字节**——引用声明就指声明起点（`--name` 的 `-`），引用整条规则或 at-rule 就指该规则起点，所以个别
偏移落在 `{` 之后而不是选择器上；文中写作“块首 `shared@N`”的即此类。JSON 里 `scope:"root"` 表示
“全局级”而非字面 `:root`，body 级声明也算 root（`reference-extraction.md` §9.3）。

## 0. 四条前提

**0.1 生成文件绝不 import。** `design-tokens.generated.css` 含 766 个名字的 `--color-*` 矩阵和
`soft|solid|outline|ghost|alpha` 按钮变体引擎；Pi 没有任何组件承载它们（`base.css` 只有一套
`button` 规则）。import 它等于凭空造出一套 Pi 并不具备的主题能力。本表是唯一允许进入
`apps/desktop/src/renderer/src/styles/tokens.css` 的内容。

**0.2 Pi 现有 13 个令牌名保持不变。** `--bg --panel --sidebar --surface --hover --selected --text
--muted --border --accent --accent-soft --danger --font-size`（定义在 `tokens.css:3-15`）。本表只改
它们的值，不改名字，也不用新名字替代；`tokens.css` 现有 13 个名字之外的名字一律以 `NEW` 标注。
（当前引用量：`--muted` 47、`--border` 36、`--accent` 13、`--danger` 9、`--panel` 8、`--surface` 6、
`--selected` 5、`--text` 11、`--bg` 3、`--sidebar` 3、`--hover` 2、`--accent-soft` 2、
`--font-size` 1。）

**0.3 主题机制不同，移植必须“一拆三”。** 参考的明暗值写在**同一条声明**里，靠 Lightning CSS 的
双值技巧二选一：

```
:where([data-theme=light]){--theme-variant:light;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light}   shared@23313
:where([data-theme=dark]) {--theme-variant:dark;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}    shared@23431
--app-color-text-foreground:var(--lightningcss-light,#1a1c1f)var(--lightningcss-dark,var(--gray-fixed-150))  shared@88701
```

参考**从不**用 `prefers-color-scheme` 决定令牌：46 条主题覆盖声明全部 `via: data-theme`，`via:
prefers-color-scheme` 0 条；三个输入 CSS 里 `prefers-color-scheme` 只出现 1 次（`shared@99180`，仅
服务 `--app-color-background-recovery` 的“未设 data-theme”回退）。Pi 的机制是
`[data-theme="dark"]`（`tokens.css:26-40`）+ 给 `[data-theme="system"]` 用的
`@media (prefers-color-scheme: dark)`（`tokens.css:41-57`）。所以每个移植色都要拆成 3 处（`:root`
明值、`[data-theme="dark"]`、`@media` 内的 `[data-theme="system"]`），且三处必须同源，否则
system 模式会与 dark 模式漂移。本表第 3 节已经给出拆好的两套值，WP1 直接抄。

**0.4 rem 基准 16px 已定且已上线，不再讨论。** `tokens.css:22` `:root{font-size:16px}` +
`base.css:6` `body{font-size:var(--font-size)}`。这条决定的正确性有参考侧证据：参考的
`html,:host`（Tailwind preflight，`shared@156019`）**只设 `line-height:1.5` 与 `font-family`，从不设
`font-size`**，即参考的 rem 基准就是 Chromium 默认的 16px。因此本表所有 rem 令牌按 16px 解析后与
参考逐像素相同。

移植后必须守住的后果：任何从参考移植的 rem 令牌**只能以 rem 或 px 落进
`:root`**，绝不能在 `body` 上用 `em` 表达。因为 `body` 的字号是用户设置（12–20，默认 14），
`em` 会把它变成用户可调的度量：`--padding-row-y` 在 14px 下会从 5px 变成 4.375px，行高随之缩短
12.5%。用户字号设置只允许影响文字，不允许影响几何。

## 1. 结构尺度映射表（Pi 现在完全没有的）

`port?` 列的“理由”一句说完；`Pi 值` 是移植后 `tokens.css` 里应写的值。

### 1.1 基准与圆角

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--spacing` | `.25rem` (4px) | `--spacing` **NEW** | `.25rem` | `shared@13926` (`:root,:host` `@layer theme`) | yes — 参考全部 `calc(var(--spacing)*N)` 度量的唯一基数 |
| `--radius-2xs-base..4xl-base` | `.125/.25/.375/.5/.625/.75/1/1.25/1.5rem` (2/4/6/8/10/12/16/20/24px) | `--radius-2xs..4xl` **NEW** | 直接落 9 个最终值，见下行 | `shared@17839,17865,17889,17914,17937,17962,17986,18009,18035` | yes，但**只落最终值**（scale=1） |
| `--radius-2xs..4xl` | `calc(var(--radius-*-base) * var(--corner-radius-scale))` | 同上（Pi 侧写成 `.125rem`…`1.5rem`） | 2/4/6/8/10/12/16/20/24px | `shared@16495,15097,15166,15235,15304,15373,15442,15513,15584` | yes |
| `--corner-radius-scale` | `1` | — | — | `shared@17815`；另一条 `shared@859644` 在 `@supports (corner-shape:supershape)` 内 | **no** — 恒为 1；唯一会改它的那条声明被 `@supports (corner-shape:…)` 门控，Chromium 为假（`extract-tokens.mjs:262` `SUPPORTS_FALSE`），留着只会诱导别人去乘 |
| `--radius-full` / `--radius-token-row` | `9999px` | `--radius-pill` **NEW** | `9999px` | `shared@16566` / `shared@857333` | yes — Pi 需要胶囊（用户气泡、徽章） |
| `--radius-token-row`（侧栏行实测值） | `10px`，作用域 `.sidebar-navigation` | `--radius-row` **NEW** | `10px` | `shared@475380`（`.sidebar-navigation{…}` `shared@475208` 块内） | yes — 这才是侧栏行真正生效的圆角；根级的 9999px 对它不成立 |
| `--radius-button-action` / `--radius-button-toolbar` | `var(--radius-lg)` (10px) | `--radius-button` **NEW** | `.625rem` | `shared@18980` / `shared@19020` | yes — Pi 的按钮当前硬编码 `border-radius:7px`（`base.css:22`） |
| `--border-width-hairline` | `.5px` | `--border-width-hairline` **NEW** | `.5px` | `shared@18060`；消费方 `--shadow-hairline`（`shared@18130`）、`--elevation-stroke`（`shared@856599`） | yes — 1px 边框在高 DPI 下比参考重 |
| `--border-width` | 参考无同名令牌 | `--border-width` **NEW** | `1px` | 参考侧 `1px` 只出现在 `box-shadow: 0 0 0 1px`（如 `--elevation-composer` `shared@856832`）与 `base.css:21` 式实线里，没有独立令牌 | 参考未建立：Pi 若集中该常量属于自有抽象，不与参考冲突 |

### 1.2 高度、行内距

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--height-toolbar` | `46px` | `--height-toolbar` **NEW** | `46px` | `shared@18485`；`browser` 分支的 `calc(var(--spacing)*13)` 在 `shared@850824`，属 `nonDesktopOverrides`，不是桌面值 | yes — Pi 现为 42px（`shell.css:8`） |
| `--height-toolbar-sm` | `36px` | `--height-toolbar-sm` **NEW** | `36px` | `shared@18507` | yes |
| `--height-toolbar-pane` | `40px` | `--height-toolbar-pane` **NEW** | `40px` | `shared@18532` | yes — 面板/分栏头 |
| `--height-token-nav-row` | `calc(var(--text-base) * 1.5 + var(--padding-row-y) * 2)` = 21+10 = **31px**（electron：`--text-base` 14px `shared@14377`，`--padding-row-y` 5px `shared@851966`） | `--height-row` **NEW** | `31px` 或直接写同式 | `shared@852010`（`:is(browser,chrome-extension,electron) body`） | yes，但侧栏另见下行 |
| `--height-token-nav-row`（侧栏实测） | `30px`，作用域 `.sidebar-navigation` | `--height-row-nav` **NEW** | `30px` | `shared@475260`（块首 `shared@475208`）；`browser` 的 `36px` 在 `shared@475484`，非桌面 | yes — 侧栏行高以这条为准 |
| `--height-token-row` | `var(--height-token-nav-row)` | — | 同上，不重复定义 | `shared@857286`（根）、`shared@475288`（侧栏块内） | no — 纯别名，Pi 只需 `--height-row*` |
| `--height-token-settings-row` | `4rem` (64px) | `--height-settings-row` **NEW** | `4rem` | `shared@18304` | yes — 设置/管理页双行项 |
| `--height-token-mode-switch` | `32px`，作用域 `.sidebar-navigation` | `--height-mode-switch` **NEW** | `32px` | `shared@475228` | yes — 侧栏顶部分段切换器 |
| `--padding-row-y` | `calc(var(--spacing) * 1.25)` = 5px | `--padding-row-y` **NEW** | `calc(var(--spacing) * 1.25)` | `shared@851966`；更晚的 `:root` 重声明 `calc(var(--spacing) * 1)` 在 `shared@857166`，被 body 规则的特异度压过（0-3-1 > 0-1-0），**不生效** | yes — 写公式而不是 px，便于连带核对行高 |
| `--padding-row-x` | `calc(var(--spacing) * 2)` = 8px | `--padding-row-x` **NEW** | `calc(var(--spacing) * 2)` | `shared@18212`；侧栏块内 `8px` `shared@475360` | yes |
| `--padding-panel-base` / `--padding-panel` | `calc(var(--spacing) * 5)` = 20px / `var(--padding-panel-base)` | `--padding-panel` **NEW** | `calc(var(--spacing) * 5)` | `shared@852089` / `shared@852135`（同一 body 块）；`:root` 的 `*3` 版在 `shared@857359`/`857405`，同理不生效 | yes |
| `--padding-toolbar` | `calc(var(--spacing) * 4)` = 16px | `--padding-toolbar` **NEW** | `calc(var(--spacing) * 4)` | `shared@857447` | yes |
| `--spacing-token-sidebar`（侧栏宽度钳制） | `clamp(240px, var(--codex-sidebar-preferred-width,275px), min(520px, calc(100vw - 320px)))` | — | — | `shared@18641` | **no** — 同一钳制已在 JS 侧唯一化：`contracts.ts:117` `SIDEBAR_WIDTH = {min:240,max:520,default:275}` + `lib/layout.ts:6-11` `Math.min(max, viewportWidth - 320)`。CSS 再写一遍就有两个真相源，且 `--codex-sidebar-preferred-width` 的运行时写入方不在抽取子集内（值 not established） |

### 1.3 控件尺寸 / 沟槽 / 图标

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--control-size-4xs` | `1.25rem` (20px) | `--control-size-4xs` **NEW** | `1.25rem` | `shared@62589` | yes — 紧凑图标按钮下限 |
| `--control-size-3xs` | `1.375rem` (22px) | 同名 **NEW** | `1.375rem` | `shared@62616` | yes |
| `--control-size-2xs` | `1.5rem` (24px) | 同名 **NEW** | `1.5rem` | `shared@62644` | yes |
| `--control-size-xs` | `1.625rem` (26px) | 同名 **NEW** | `1.625rem` | `shared@62670` | yes |
| `--control-size-sm` | `1.75rem` (28px) | 同名 **NEW** | `1.75rem` | `shared@62697` | yes — 工具栏图标按钮 |
| `--control-size-md` | `2rem` (32px) | 同名 **NEW** | `2rem` | `shared@62723` | yes — 默认按钮 |
| `--control-size-lg` | `2.25rem` (36px) | 同名 **NEW** | `2.25rem` | `shared@62746` | yes |
| `--control-size-xl` | `2.5rem` (40px) | 同名 **NEW** | `2.5rem` | `shared@62772` | yes |
| `--control-size-2xl` | `2.75rem` (44px) | 同名 **NEW** | `2.75rem` | `shared@62797` | no — Pi 无 44px 级控件；需要时再补 |
| `--control-size-3xl` | `3rem` (48px) | 同名 **NEW** | `3rem` | `shared@62824` | no — 同上 |
| `--control-gutter-2xs` | `.375rem` (6px) | `--control-gutter-2xs` **NEW** | `.375rem` | `shared@62848` | yes |
| `--control-gutter-xs` | `.5rem` (8px) | 同名 **NEW** | `.5rem` | `shared@62877` | yes |
| `--control-gutter-sm` | `.625rem` (10px) | 同名 **NEW** | `.625rem` | `shared@62903` | yes |
| `--control-gutter-md` | `.75rem` (12px) | 同名 **NEW** | `.75rem` | `shared@62931` | yes |
| `--control-gutter-lg` | `.875rem` (14px) | 同名 **NEW** | `.875rem` | `shared@62958` | no — Pi 无该档 |
| `--control-gutter-xl` | `1rem` (16px) | 同名 **NEW** | `1rem` | `shared@62986` | no — 同上 |
| `--control-icon-size-xs` | `.875rem` (14px) | `--control-icon-size-xs` **NEW** | `.875rem` | `shared@63338` | yes |
| `--control-icon-size-sm` | `1rem` (16px) | 同名 **NEW** | `1rem` | `shared@63369` | yes |
| `--control-icon-size-md` | `1.125rem` (18px) | 同名 **NEW** | `1.125rem` | `shared@63397` | yes |
| `--control-icon-size-lg` | `1.25rem` (20px) | 同名 **NEW** | `1.25rem` | `shared@63429` | yes |
| `--control-icon-size-xl` | `1.375rem` (22px) | 同名 **NEW** | `1.375rem` | `shared@63460` | no |
| `--control-icon-size-2xl` | `1.5rem` (24px) | 同名 **NEW** | `1.5rem` | `shared@63492` | no |
| `--control-radius-sm/md/lg/xl` | `var(--radius-sm/md/lg/xl)` | — | 直接用 `--radius-*` | `shared@63046,63083,63120,63157` | no — 纯别名 |
| `--control-font-size-sm/md/lg` | `var(--text-xs)` / `var(--text-sm)` / `var(--text-base)` = 12/13/14px（electron，`shared@851740`、`shared@851755`、`shared@14377`） | — | 用 §1.4 的 `--font-text-*` | `shared@155728,155766,155804` | no — 参考里有**两条并行**字号梯（`--text-*` 走 px 且被 window-type 改写，`--font-text-*-*` 走 rem 设计语言梯）；Pi 只保留 rem 那条，避免二义 |
| `--control-gutter-pill-scaling` | `1.33` | — | — | `shared@63011` | no — 胶囊横向内缩的乘子，Pi 无胶囊按钮组件 |

### 1.4 文字比例（rem 设计语言梯）

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--font-text-3xs-size` / `-line-height` | `.5rem` / `.75rem` (8/12px) | `--font-3xs` / `--font-3xs-lh` **NEW** | `.5rem` / `.75rem` | `shared@62094` / `shared@62121` | no — 8px 文字在 Windows 上不可读，Pi 不使用该档（tracking 见 `shared@62156`/`62205`） |
| `--font-text-2xs-size` / `-line-height` | `.625rem` / `.875rem` (10/14px) | `--font-2xs` / `--font-2xs-lh` **NEW** | `.625rem` / `.875rem` | `shared@61934` / `shared@61963` | yes — 时间线次要标签、状态栏 |
| `--font-text-xs-size` / `-line-height` | `.75rem` / `1.125rem` (12/18px) | `--font-xs` / `--font-xs-lh` **NEW** | `.75rem` / `1.125rem` | `shared@61778` / `shared@61805` | yes |
| `--font-text-sm-size` / `-line-height` | `.875rem` / `1.25rem` (14/20px) | `--font-sm` / `--font-sm-lh` **NEW** | `.875rem` / `1.25rem` | `shared@61620` / `shared@61648` | yes — 正文档，与 Pi 现默认字号 14px 对齐 |
| `--font-text-md-size` / `-line-height` | `1rem` / `1.5rem` (16/24px) | `--font-md` / `--font-md-lh` **NEW** | `1rem` / `1.5rem` | `shared@61466` / `shared@61491` | yes — 标题/空态 |
| `--font-text-lg-size` / `-line-height` | `1.125rem` / `1.8125rem` (18/29px) | `--font-lg` / `--font-lg-lh` **NEW** | `1.125rem` / `1.8125rem` | `shared@61305` / `shared@61334` | yes |
| `--font-text-*-weight` | 全部 `var(--font-weight-normal)` = `400` | `--font-weight-normal` **NEW** | `400` | `shared@61371,61525,61683,61841,61999,62156`；基数 `shared@14840`；`--font-weight-medium` = `500`，`@layer theme` 与 electron 块是同值重声明（`shared@14865`、`shared@851770`） | yes（一个 `--font-weight-normal` + 一个 `--font-weight-medium:500` 足够） |
| `--font-text-xs/2xs/3xs-tracking` | `var(--tracking-wide)` = `.025em`；sm/md/lg = `var(--tracking-normal)` = `0em` | `--tracking-wide` / `--tracking-normal` **NEW** | `.025em` / `0em` | `shared@61889,62048,62205` / `shared@61731,61573,61419`；基数 `shared@14987`、`shared@14965` | yes — 小字号必须带 tracking，否则比参考挤 |

### 1.5 菜单

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--menu-gutter` | `calc(var(--spacing) * 1.5)` (6px) | `--menu-gutter` **NEW** | `calc(var(--spacing) * 1.5)` | `shared@70432` | yes |
| `--menu-radius` | `var(--radius-2xl)` (16px) | `--menu-radius` **NEW** | `1rem` | `shared@70473` | yes |
| `--menu-font-size` | `var(--font-text-sm-size)` (14px) | 复用 `--font-sm` | `.875rem` | `shared@70505` | yes（不新增名字） |
| `--menu-line-height` | `var(--font-text-sm-line-height)` (20px) | 复用 `--font-sm-lh` | `1.25rem` | `shared@70547` | yes |
| `--menu-item-background-color` | 明 `var(--alpha-08)` / 暗 `var(--alpha-10)`，其中 `--alpha-base = var(--color-text)`（`shared@99431`） | `--menu-item-bg` **NEW** | `color-mix(in oklab, var(--text) 8%, transparent)` 明 / `10%` 暗 | `shared@70598`；`--alpha-08` `shared@26757`、`--alpha-10` `shared@26953` | yes |
| `--menu-item-padding` | `calc(var(--spacing) * 2) calc(var(--spacing) * 3)` (8px 12px) | `--menu-item-padding` **NEW** | 同式 | `shared@70709` | yes |
| `--menu-item-gap` | `calc(var(--spacing) * 1.5)` (6px) | `--menu-item-gap` **NEW** | 同式 | `shared@70779` | yes |
| `--menu-separator-gutter` | `var(--menu-gutter) calc(-1 * var(--menu-gutter))` | `--menu-separator-gutter` **NEW** | 同式 | `shared@70822` | yes |
| `--menu-separator-background-color` | `var(--color-border)` | — | 用 `var(--border)` | `shared@70895` | yes（引用 Pi 现有名） |
| `--spacing-menu-row-content` | `calc(var(--spacing) * 2)` (8px)；`browser` 分支 `*3` 在 `shared@850404` | `--menu-row-content-gap` **NEW** | `calc(var(--spacing) * 2)` | `shared@19107` | yes |
| `--menu-radio-indicator-size` / `--menu-checkbox-indicator-size` | `var(--font-text-lg-size)` (18px) | — | — | `shared@70949` / `shared@71061` | **no** — Pi 菜单里没有可选/单选条目（renderer 全量检索 `menuitemradio`、`aria-checked` 命中 0），照搬就是伪造能力 |
| `--menu-radio-indicator-hole-size` | `var(--font-text-3xs-size)` (8px) | — | — | `shared@71002` | no — 同上 |

### 1.6 侧栏族令牌（`--sidebar-*` 9 个）与侧栏宽度

`--sidebar-*` 这一族**不是**设计语言层：9 个名字的作用域全是 CSS Module 类或单元素内联工具类，
JSON 里 `scope` 一律 `element-only`（因此 `value` 为空，值只能按 offset 回读 CSS；见
`reference-extraction.md` §9.2）。逐个核实结果：

| Codex token | reference value | evidence | port? |
| --- | --- | --- | --- |
| `--sidebar-customization-row-height` | `var(--height-token-row)` | `initial@163667`（类内） | no — 别名，Pi 用 `--height-row-nav` |
| `--sidebar-customization-height` | `min(calc(var(--sidebar-customization-row-count) * … ))` | `initial@163726` | no — 依赖厂商“侧栏个性化条目数”运行时变量，Pi 无该面 |
| `--sidebar-scroll-footer-edge` | `100%` | `initial@167118` | no |
| `--sidebar-scroll-footer-fade-distance` | `calc(var(--spacing) * 10)` (40px) | `initial@167152` | 可选 — 仅当 WP1 实现侧栏滚动渐隐遮罩；否则 no |
| `--sidebar-scroll-footer-fade-start` | `calc(var(--sidebar-scroll-footer-edge) - var(--sidebar-scroll-footer-fade-distance))` | `initial@167216` | 同上 |
| `--sidebar-scroll-header-mask-distance` | `var(--sidebar-scroll-header-fade-distance,var(--sidebar-scroll-header-spacing,calc(var(--spacing) * 2)))` | `initial@167336` | 同上 |
| `--sidebar-scroll-header-mask-start` | `var(--sidebar-scroll-header-fade-start,0px)` | `initial@167479` | 同上 |
| `--sidebar-scroll-mask-image` | `linear-gradient(to bottom, transparent 0, …)` | `initial@167558` | 同上 |
| `--sidebar-footer-height` | `0px`，且声明在选择器 `.\[--sidebar-footer-height\:0px\]`（Tailwind 任意值工具类）里 | `shared@483246` | no — 这是工具类，不是默认值 |

侧栏宽度的真正钳制在 `--spacing-token-sidebar`（`shared@18641`，值见 §1.2 末行），本表判为 **no**，
理由：Pi 已在 JS 侧唯一实现同一钳制（`contracts.ts:117` 的 240/520/275 + `lib/layout.ts:8` 的
`viewportWidth - 320`），与参考常数逐字相同；再写进 CSS 会产生两个真相源。

### 1.7 阴影与海拔

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--shadow-color` | `0 0 0`（配合 `rgb(… / alpha)` 使用） | — | — | `shared@40209` | no — Pi 直接写带 alpha 的 hex，不需要分量变量 |
| `--elevation-100-geo` | `0 1px 2px -1px` | `--shadow-100-geo` **NEW** | 同值 | `shared@40230` | 几何部分见下 4 行 |
| `--elevation-200-geo` | `0 2px 4px -1px` | `--shadow-200-geo` **NEW** | 同值 | `shared@40265` | yes |
| `--elevation-300-geo` | `0 4px 8px -2px` | `--shadow-300-geo` **NEW** | 同值 | `shared@40300` | yes |
| `--elevation-400-geo` | `0 8px 16px -4px` | `--shadow-400-geo` **NEW** | 同值 | `shared@40335` | yes |
| `--shadow-alpha-100..400` | 明 `.08/.08/.1/.12`，暗 `.2/.2/.36/.3` | `--shadow-alpha-100..400` **NEW** | 两套各 4 个 | 明 `shared@40412,40435,40458,40480`（`:where(:root),:where([data-theme=light])`），暗 `shared@40743,40765,40787,40810`（`:where([data-theme=dark])`） | yes — 这是参考海拔唯一真正随主题变的量 |
| `--shadow-100/200/300/400` | `var(--elevation-N00-geo) rgb(var(--shadow-color) / var(--shadow-alpha-N00))` | `--shadow-100..400` **NEW** | 展开成 `0 2px 4px -1px rgb(0 0 0 / .08)` 等；暗侧换 alpha | `shared@64048,64356,64664,64972` | yes — 100 档与 200 档 alpha 相同（`.08`），差别只在几何 |
| `--shadow-N00-strong/-stronger` | alpha `*1.25` / `*1.6` | — | — | `shared@64137,64246,64445,64554,64753,64862,65061,65170` | no — 12 个派生档位，Pi 的浮层只用一档；需要时按公式临时算 |
| `--shadow-sm/md/lg/xl/2xl` | `0px 1px 2px -1px #00000014` / `2px 4px -1px #00000014` / `4px 8px -2px #0000001a` / `8px 16px -4px #0000001f` / `16px 32px -8px #00000030` | `--shadow-sm..2xl` **NEW** | 逐字照抄 | `shared@15655,15694,15733,15772,15812` | yes — 与 `--shadow-100..400` 几何一致、alpha 固定不随主题，是 Pi 更省事的一档；**两套只选一套**，建议 sm..2xl |
| `--shadow-card` | `0px 4px 16px 0px #0000000d` | `--shadow-card` **NEW** | 同值 | `shared@18089` | yes — 面板/卡片 |
| `--shadow-hairline` | `0px 0px 0px .5px #0000001a`；高 DPI 下宽 `.5px`、色明 `#0000001a` / 暗 `#ffffff1f` | `--shadow-hairline` **NEW** | `0 0 0 var(--border-width-hairline) var(--hairline-color)` | `shared@18130`；`--shadow-hairline-width` 明 `shared@40653` 暗 `shared@40967`（两条都在 `@media (resolution>=150dpi)` 内），`--shadow-hairline-color` 明 `shared@40682` 暗 `shared@40996` | yes — Pi 现在用 `1px solid` 描边，比参考重一档 |
| `--elevation-stroke` | `0 0 0 .5px var(--color-border-strong)` | `--elevation-stroke` **NEW** | 同值 | `shared@856599` | yes — 浮层 1px 视觉描边的基元 |
| `--elevation-prominent` | `var(--elevation-stroke), 0 3px 7.5px #0000000a, 0 0 20px #0000000d` | `--elevation-popover` **NEW** | 同值 | `shared@856656` | yes — 弹层/命令面板 |
| `--elevation-sidebar` | `var(--elevation-stroke), 0 3px 7.5px #00000008, 0 0 16px #00000005` | `--elevation-sidebar` **NEW** | 同值 | `shared@856745` | yes — 替换 `sidebar.css:13` 的 `0 1px 2px #00000006` |
| `--elevation-composer` | `0 0 0 1px #0000000a, 0 2px 8px 0 #0000000a, 0 4px 80px 8px #00000006` | `--elevation-composer` **NEW** | 同值 | `shared@856832`；窄窗变体（`0 4px 40px 8px`）在 `shared@857010`，条件 `@media not all and (width>=40rem)` | yes，窄窗那条以 `@media` 形式落，不要当成默认值 |
| `--elevation-composer-dark` | `inset 0 0 1px 0 #fff3` | `--elevation-composer-inner` **NEW** | 暗色块内追加 | `shared@856922` | yes — 名字里的 dark 靠 Pi 的 `[data-theme="dark"]` 块叠在 `--elevation-composer` 之后 |
| `--shadow` | `0 10px 15px -3px 明#0000001a/暗#0003, 0 4px 6px -4px 同上` | — | — | `shared@63792` | no — Tailwind 默认 `--shadow`，与参考自有海拔梯并存，属噪音 |
| `--shadow-tooltip` | `0 8px 18px #0f172a33` | `--shadow-tooltip` **NEW** | 同值 | `shared@119808` | 可选 — 仅当 WP1 做 tooltip；Pi 当前无 tooltip 组件则 no |
| `--shadow-mode-toggle-selected` | `var(--shadow-md)` | — | — | `shared@114180` | no — 别名 |

### 1.8 过渡

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--transition-duration-basic` | `.15s` | `--duration-fast` **NEW** | `.15s` | `shared@19725` | yes |
| `--transition-duration-relaxed` | `.3s` | `--duration-slow` **NEW** | `.3s` | `shared@19758` | yes |
| `--transition-ease-basic` | `ease` | `--ease-basic` **NEW** | `ease` | `shared@63729` | yes — 替换 `timeline.css:185` 的字面 `0.12s ease` |

### 1.9 输入框与 composer

| Codex token | reference value | Pi token | Pi 值 | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--radius-token-composer-single-line` | `calc(var(--spacing) * 5.5)` = 1.375rem = **22px** | `--radius-composer-single` **NEW** | `calc(var(--spacing) * 5.5)` | `shared@19343` | yes — 单行态 composer 的胶囊圆角 |
| `--spacing-token-button-composer` | `calc(var(--spacing) * 7)` = 1.75rem = **28px** | `--control-size-composer` **NEW** | `calc(var(--spacing) * 7)` | `shared@18755`；`browser` 分支 `shared@850867` 属 `nonDesktopOverrides`，非桌面值 | yes — composer 内圆按钮直径 |
| `--spacing-token-button-composer-sm` | `calc(var(--spacing) * 7)`（28px，与 `--spacing-token-button-composer` 同值） | — | — | 生效值 `shared@852824`（body 块，压过 `@layer theme` 里 `calc(var(--spacing) * 5)` 的 `shared@18812`） | no — 桌面生效值与上行完全相同，不必新增名字 |
| `--spacing-token-button-composer-gap` | `var(--spacing)` (4px) | `--gap-composer` **NEW** | `var(--spacing)` | `shared@18872` | yes |
| `--input-*`（18 个名字 / 76 条声明） | 多为 `element-only`，`value` 为空 | — | — | 见 `design-tokens.generated.css` 的 `family --input-*` 块 | no — 参考把输入框尺寸写在组件类里，非全局规格；本表无法在不猜的前提下给出根级值 |

## 2. Pi 现有 13 个令牌的映射

| Codex token | reference value（根级表达式） | Pi token | Pi 值（明 / 暗） | evidence | port? |
| --- | --- | --- | --- | --- | --- |
| `--color-text` | `var(--app-color-text-foreground)` | `--text` | `#1a1c1f` / `#dfdfdf` | `shared@99348` → `shared@88701`（`--gray-fixed-150` = `#dfdfdf` `shared@29332`） | yes，现值 `#292a28`/`#e6e6e3` → 换 |
| `--color-text-secondary` | `var(--app-color-text-secondary,color-mix(in srgb, var(--app-color-text-foreground) 65%, transparent))`（前者无定义，实际走 fallback） | `--muted` | `rgba(26,28,31,.65)` / `rgba(223,223,223,.65)` | `shared@99696` | yes，现值 `#777975`/`#969893` → 换成半透明；注意 Pi 有 47 处引用，透明度会让底层文字/纹理透出 |
| `--color-text-tertiary` | `var(--app-color-text-foreground-tertiary)` = `color-mix(in oklab, …50%, transparent)` | — | 明 `rgba(26,28,31,.5)` / 暗 `rgba(255,255,255,.5)`（暗侧基色是 `--gray-fixed-0`，不是前景色） | `shared@99849` → `shared@89739` | **no** — Pi 只有一级弱化色；三档弱化没有对应槽位（见 §4） |
| `--color-border` | `var(--app-color-border,color-mix(in oklab, var(--app-color-text-foreground) 8%, transparent))` | `--border` | `rgba(26,28,31,.08)` / `rgba(255,255,255,.08)` | `shared@113987` → `shared@94159` | yes，现值 `#e2e3de`/`#343537` → 换 |
| `--app-color-background-surface` | 明 `var(--gray-fixed-0)` / 暗 `var(--gray-fixed-900)` | `--bg` | `#fff` / `#181818` | `shared@75547`；`--color-token-main-surface-primary` 这条语义别名在 `shared@22785` | yes，现值 `#ffffff`/`#1c1d1f` → 暗侧下压到 `#181818` |
| `--app-color-background-surface-under` | 明 `var(--gray-fixed-50)` / 暗 `black` | `--sidebar` | `#f9f9f9` / `#000000` | `shared@75670`；语义别名 `--color-token-side-bar-background` `shared@22385` | yes，现值 `#f2f2ef`/`#171819` → 换 |
| `--app-color-background-elevated-primary` | 明 `color-mix(in oklab, var(--gray-fixed-0) 70%, transparent)` / 暗 `…var(--gray-fixed-800) 96%…` | `--surface` | 明 `rgba(255,255,255,.70)`、暗 `rgba(33,33,33,.96)`；不透明版 `--app-color-background-elevated-primary-opaque` = `#fff` / `#282828`（`shared@78445`） | `shared@78123`（不透明版 `shared@78445`） | 部分 — Pi 的 `--surface` 被当不透明底色用（按钮 `base.css:20`、输入框 `base.css:46`、侧栏行 `sidebar.css:10`、composer `composer.css:5`），直接改成半透明会透出背景。移植**不透明版** `#fff`/`#282828`，把半透明版留在参考侧 |
| `--app-color-background-button-secondary-hover` | 明 `…var(--app-color-text-foreground) 5%…` / 暗 `…var(--gray-fixed-0) 8%…` | `--hover` | `rgba(26,28,31,.05)` / `rgba(255,255,255,.08)` | `shared@82855`；语义入口 `--color-token-list-hover-background` `shared@22243` | yes，现值 `#e9e9e5`/`#2d2e30` → 换成半透明 |
| `--color-background-segmented-selected` | `color-mix(in oklab, var(--color-text) 5%, transparent)`（hover 档 10%） | `--selected` | 明 `rgba(26,28,31,.05)` / 暗 `rgba(223,223,223,.05)` | `shared@111011`；hover 档 `shared@111267`；另一候选 `--app-color-background-button-secondary-active` `shared@83501`（明 4% / 暗 12%） | yes，但**明侧与 `--hover` 同值**（都 5%），照抄会让选中态在明色下不可见；实施时暗/明都用 `--color-text` 作基色，并给选中行额外保留描边或字重区分（参考侧靠 `--font-weight-medium`/描边） |
| `--color-text-danger` | `var(--app-color-text-error)` = 明 `var(--red-500)` / 暗 `var(--red-300)` | `--danger` | `#e02e2a` / `#ff6764` | `shared@100537` → `shared@90989`；`--red-500` `shared@31447`、`--red-300` `shared@31411` | yes，现值 `#b1453e`/`#eb9690` → 换 |
| `--color-text-info` → `--app-color-text-accent` | 明 `var(--blue-300)` `#339cff` / 暗 `var(--blue-100)` `#99ceff` | `--accent` | `#339cff` / `#99ceff` | `shared@100438` → `shared@90388`（明）与 `shared@90566`（暗，`:where(…):where([data-theme=dark])` 块） | yes — 这是本表**唯一改变品牌色相**的一项：Pi 现值 `#387252`/`#9bc8aa` 是绿，参考的强调色是蓝。保名换值，13 处引用一次改完 |
| `--app-color-background-accent` | 明 `var(--blue-50)` `#e5f3ff` / 暗 `var(--blue-900)` `#00284d` | `--accent-soft` | `#e5f3ff` / `#00284d` | `shared@86415` | yes，现值 `#e8f1eb`/`#2b3d31` → 随 `--accent` 一起转蓝 |
| `--font-ui-size` → `--text-base` | `var(--text-base)` = **14px**（桌面生效链，见 §5） | `--font-size` | `14px`（用户设置槽，默认值不变） | `shared@852649`（body 块）→ `shared@14377`；另一并行梯 `--font-text-sm-size` = `.875rem` = 14px `shared@61620` | **no** — Pi 的 `--font-size` 是 12–20 的用户偏好槽（`base.css:6` 消费），不是参考令牌；只记录“参考桌面正文基准 14px 与 Pi 默认值相同” |

参考侧不 port 的字号说明：`--text-sm`/`--text-xs` 在 electron 根块被重声明为 `13px`/`12px`
（`shared@851740`、`shared@851755`，选择器 `[data-codex-window-type=electron]`），而
`--font-text-sm-size` 是 `.875rem`=14px。两套并存且不同值；Pi 只取 §1.4 的 rem 梯，避免把
window-type 条件逻辑搬进 Pi。

## 3. 颜色：移植后的明 / 暗解析值

`--app-color-*` 在 JSON 里 `value` 全为空（68 个，抽取器把 `:not(…=extension)` 误判为
extension-only；见 `reference-extraction.md` §9.1），所以下列值全部按字节偏移回读原始 CSS 求得，
并按
`:where([data-theme=light]){--theme-variant:light;--lightningcss-light:initial;--lightningcss-dark: ;…}`
（其中 `--lightningcss-light` 声明在 `shared@23335`，块起点 `shared@23313`）/ 暗侧反之
（`shared@23431`）解析双值。`color-mix(… , transparent)` 记为
`基色 @p%`（与透明混合只改 alpha，色相不变）。

| Pi token | Codex 链（终→初） | 明 | 暗 |
| --- | --- | --- | --- |
| `--text` | `--color-text` `shared@99348` → `--app-color-text-foreground` `shared@88701` | `#1a1c1f` | `#dfdfdf`（`--gray-fixed-150` `shared@29332`） |
| `--muted` | `--color-text-secondary` `shared@99696` | `#1a1c1f @65%` → `rgba(26,28,31,.65)` | `#dfdfdf @65%` → `rgba(223,223,223,.65)` |
| `--border` | `--color-border` `shared@113987` → `--app-color-border` `shared@94159` | `#1a1c1f @8%` → `rgba(26,28,31,.08)` | `#fff @8%` → `rgba(255,255,255,.08)` |
| `--bg` | `--app-color-background-surface` `shared@75547` | `#fff`（`--gray-fixed-0` `shared@29215`） | `#181818`（`--gray-fixed-900` `shared@29707`） |
| `--sidebar` | `--app-color-background-surface-under` `shared@75670` | `#f9f9f9`（`--gray-fixed-50` `shared@29259`） | `#000000`（`--black` `shared@29846`） |
| `--surface` | `--app-color-background-elevated-primary-opaque` `shared@78445` | `#fff`（`--gray-fixed-0` `shared@29215`） | `#282828`（`--gray-fixed-750` `shared@29632`） |
| `--hover` | `--app-color-background-button-secondary-hover` `shared@82855` | `#1a1c1f @5%` | `#fff @8%` |
| `--selected` | `--color-background-segmented-selected` `shared@111011`（基色 `--color-text`，主题自适应） | `#1a1c1f @5%` | `#dfdfdf @5%` |
| `--danger` | `--color-text-danger` `shared@100537` → `--app-color-text-error` `shared@90989` | `#e02e2a`（`--red-500` `shared@31447`） | `#ff6764`（`--red-300` `shared@31411`） |
| `--accent` | `--color-text-info` `shared@100438` → `--app-color-text-accent` `shared@90388` / 暗覆盖 `shared@90566` | `#339cff`（`--blue-300` `shared@38741`） | `#99ceff`（`--blue-100` `shared@38703`） |
| `--accent-soft` | `--app-color-background-accent` `shared@86415` | `#e5f3ff`（`--blue-50` `shared@38667`） | `#00284d`（`--blue-900` `shared@38855`） |
| `--font-size` | 无对应参考令牌（默认值与 `--text-base` `shared@14377` / `--font-text-sm-size` `shared@61620` 同为 14px） | `14px` | `14px` |

**没有 Pi 槽位、因此不移植的参考颜色族**（数量按 `design-tokens.json` 的 `family` 统计）：

- `--app-color-*` 全部 68 个（除上表已引用的 9 个终值）：它们需要
  `background-button-tertiary / status-success|warning|error / tip-badge /
  background-application-menu / border-error / background-recovery / text-on-accent` 等 8–10 个
  Pi 不存在的角色槽位。举例并留证：`--app-color-background-button-tertiary`
  `shared@84792`（明 `#1a1c1f @0%` / 暗 `#fff @3%`）、`--app-color-background-status-error`
  `shared@87478`（`#ffd9d9` / `#4d100e`）、`--app-color-text-on-accent` `shared@90719`
  （单条声明 `var(--gray-fixed-1000)`，无明暗双值，两主题恒 `#0d0d0d`）。
- `--color-*` 变体矩阵 766 个名字：`primary|secondary|…` × `soft|solid|outline|ghost|alpha` ×
  `-hover|-active`，Pi 无按钮变体组件；整族不 port（§0.1）。其中 `--color-background-primary-solid`
  `shared@110174`（=`--app-color-text-foreground`）+ `--color-text-primary-solid` `shared@101039`
  这一对（明 `#1a1c1f`/`#fff`，暗 `#dfdfdf`/`#181818`）是参考主按钮的墨色配对；若 WP1 要实现同款
  反色主按钮，用 `--text` 作底、`--bg` 作字，**不要新增颜色名**。
- `--color-border-strong` `shared@114693`（明 fg 12% / 暗 white 16%）与
  `--color-border-subtle` `shared@114385`（明 5% / 暗 4%）：Pi 只有一级边框，不 port；但
  `--elevation-stroke` 引用了 strong，落 `--elevation-stroke` 时按上表把公式内联进去。
- `--color-ring` `shared@114932` / `--app-color-border-focus` `shared@97042`（明 `#339cff` / 暗
  `#339cff @70%`）：Pi 的焦点环用 `outline: 2px solid var(--accent)`（`base.css:40`），随
  `--accent` 一起转蓝即可，不新增 ring 名。
- `--gray-*`（25 档，其中 24 档是明暗反色双值，唯一单值档 `--gray-500:#5d5d5d` `shared@24464`；区间
  `shared@23548`–`shared@25330`）、`--gray-fixed-*`、`--blue-*`、
  `--red-*`、`--green-*`、`--alpha-*`（`--alpha-base = var(--color-text)` `shared@99431`）：
  原始调色板，Pi 只需要最终语义值，不搬基色阶。
- `--color-token-*`（VS Code 主题名映射层，如
  `--color-token-list-active-selection-background`、`--color-token-menu-selection-background`）：
  `scope` 全为 `element-only` 且 `value` 为空，实际值由宿主运行时注入 `--vscode-*`；**桌面端实测值
  not established**，不 port。
- `--loading-*`、`--shimmer-*`、`--referral-rate-limit-*`、`--inline-mention-*`、
  `--thread-*`、`--badge-*`、`--tooltip-*`、`--switch-*`、`--app-*`（80 个名字，根级取值 **0** 个）：
  组件局部或厂商业务面，`--app-*` 尤其要注意——它一个都没有根级值，全部挂在元素作用域，无法在不
  猜的前提下当规格使用。

## 4. DO NOT PORT（明确清单）

| 对象 | 理由 |
| --- | --- |
| `design-tokens.generated.css` 整个文件 | §0.1：766 个 `--color-*` 名 + 5 种按钮变体引擎，Pi 无组件承载；import 即伪造主题能力 |
| `--tw-*`（94 个名字，已被抽取器排除） | Tailwind 内部寄存器，不是设计语言（`extract-tokens.mjs:12` 注释） |
| `--corner-radius-scale` 及其 `@supports (corner-shape:…)` 分支 | 恒 1；那条改它的声明在 Chromium 里为假（`shared@859644`，`SUPPORTS_FALSE` 判定见 `extract-tokens.mjs:262`） |
| `--color-*` 的 `soft/solid/outline/ghost/alpha` 矩阵 | Pi 无按钮变体组件 |
| `--menu-radio-indicator-size`、`--menu-radio-indicator-hole-size`、`--menu-checkbox-indicator-size` | Pi 菜单无单选/勾选项（renderer 检索 `menuitemradio`/`aria-checked` 命中 0） |
| `--sidebar-*` 9 个名字 | 全部 CSS Module / 工具类作用域，非全局规格（§1.6 逐个取证） |
| `--spacing-token-sidebar` 的 `clamp(...)` | 与 `lib/layout.ts:6-11` + `contracts.ts:117` 的 JS 钳制重复，且 `--codex-sidebar-preferred-width` 的写入方不在抽取子集（not established） |
| `--font-ui-family` / `--vscode-font-family` | electron 下 `--font-ui-family: inherit`（`shared@846896`，零特异度非分层，压过 `@layer theme`）：参考自己不决定桌面字体面；`--vscode-*` 只在 extension 块（`shared@119917`、`shared@119876`）。`--font-ui-size` 则要 port 其**结果**（14px，见 §5），不是 port 名字 |
| `--height-token-row`、`--control-radius-*`、`--shadow-mode-toggle-selected`、`--spacing-token-button-composer-sm` | 纯别名或与源令牌同值，新增名字只会稀释可搜索性 |
| `--control-size-2xl/3xl`、`--control-gutter-lg/xl`、`--control-icon-size-xl/2xl`、`--font-text-3xs-*` | 抽取子集里找不到 Pi 对应面（无 44/48px 控件、无 8px 文字）；`--control-gutter-pill-scaling` 同理 |
| `--shadow-100..400` 与 `--shadow-sm..2xl` 同时移植 | 两套海拔梯几何相同、alpha 策略不同（随主题 vs 固定）；只选一套，否则 13 个阴影令牌里永远有一半没人用 |
| `--shadow-N00-strong/-stronger` | 12 个派生档，Pi 浮层单档够用 |
| `--input-*`（18 名 / 76 声明）、`--thread-*`、`--badge-*`、`--tooltip-*`、`--switch-*`、`--app-*` | 组件局部值，根级取值 0 个或近乎 0；照搬等于搬厂商内部实现 |
| `--color-token-*`（VS Code 映射层） | 值由运行时注入，桌面端实测值 not established |
| `--lightningcss-light` / `--lightningcss-dark` / `--theme-variant` | 参考的编译期双值开关，Pi 用 `[data-theme]` 块表达同一件事；搬过来只会造成两套主题机制并存 |
| `--loading-*`、`--shimmer-*`、`--referral-rate-limit-*`、`--inline-mention-*` | 厂商业务面（推荐码限流弹窗、行内提及、骨架微光），Pi 无对应界面 |

## 5. UI 字体：无需移植（已按 JSON 核实）

核实结果，与题面结论一致，但有一处必须记清的偏差：

- `--font-sans-default` 的根级值确为 `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  （`shared@17350`，`:root,:host` `@layer theme`）。Windows 上前两项不存在，实际命中 Segoe UI。
  另一条含 `-apple-system-body, ui-sans-serif, system-ui, … "Segoe UI", "Helvetica", "Apple Color
  Emoji"…` 的双值是 `[data-codex-window-type=browser]` 专属（`shared@849252`，在
  `nonDesktopOverrides` 里），**不是桌面值**。
- 桌面侧 body 的 `font-family` 走 `body{color:var(--color-text);font-family:var(--font-ui-family);
  font-weight:var(--font-ui-weight)}`（`shared@860375`），而 electron 下
  `--font-ui-family: inherit`（`shared@846896`，零特异度、非分层，压过 `@layer theme`）。也就是说
  **参考桌面端最终用哪个字面字体，仅凭 CSS 无法确立（not established）**；能在 CSS 里确立的是
  `--font-sans-default`（`shared@17350`）与 preflight 的 `html,:host` 字体栈（`shared@156019`），
  两者在 Windows 上都落到 Segoe UI。题面“参考解析到 Segoe UI”对**令牌值**成立，对 **body 继承链**
  不成立，这个区别要记住，否则会被用来论证一个不存在的字体规格。
- 字号一侧则是**已确立**的：`--font-ui-size: var(--text-base)`（`shared@852649`，
  `:is(browser,chrome-extension,electron) body` 块）→ `--text-base` 根值 `14px`
  （`shared@14377`），经 `--codex-chat-font-size-override: var(--font-ui-size)`（`shared@852713`）
  被 `font-size: var(--codex-chat-font-size-override, var(--font-ui-size, 13px))`（`shared@858388`）
  消费。即参考桌面正文 = 14px，与 Pi `--font-size` 默认值一致；`13px` 只是变量缺失时的兜底字面量。
- electron 还有 `--font-ui-weight: 430`（`shared@851795`，块首 `[data-codex-window-type=electron]`
  `shared@851740`）。这是 Pi 没有的概念（Pi 用 400/500），属参考内部实现，不 port；但它说明参考在
  Windows 上刻意用了比 400 更细的 Regular 字重（配合 `--font-ui-family: inherit` 落到的系统字体），
  WP1 若发现正文比参考“偏粗”，那是字重问题，不是字号问题。
- Pi 的栈是 `"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif`
  （`tokens.css:16`）。结论：**字体不 port**。唯一偏差是 Win11 上 Pi 会命中
  `Segoe UI Variable`（可变字重版）而参考的文字面最终依赖宿主默认，两者同属 Segoe UI 家族，视觉
  差异不构成需要改栈的证据；Pi 栈里的 `Microsoft YaHei` 中文回退是必要的（默认语言中文），参考侧
  没有对应条目。

## 6. 实施注意

1. **`color-mix` 是硬依赖。** 参考的弱化色、边框、菜单底色、海拔描边全部写作
   `color-mix(in oklab, … , transparent)`（例如 `shared@94159`、`shared@856599`）。它在
   `@supports (color:color-mix(in lab, red, red))` 块里（`extract-tokens.mjs:263` 判为真）。Pi 若要
   写成静态 rgba，就用 §3 已解析出的值，并把公式留在注释里以便复核。
2. **oklab 与 srgb 的差**：`--color-text-secondary` 用的是 `in srgb`（`shared@99696`），边框/选中
   用 `in oklab`。混合到透明只改 alpha，两者结果差异可忽略；但**不要**把它们合并成一个“8% 灰”式
   常量，那会把主题自适应关系（暗侧基色换成 `--white` 或 `--gray-fixed-0`）丢掉——这正是 §3 里
   `--border` 暗侧基色是 `#fff` 而 `--selected` 暗侧基色是 `#dfdfdf` 的原因。
3. **三处同源**：每个移植色都要同时写进 `:root`（明）、`:root[data-theme="dark"]`、
   `@media (prefers-color-scheme: dark) { :root[data-theme="system"] }`。参考没有第三处；这一处是
   Pi 的机制要求（`tokens.css:41-57`），值必须与 dark 块逐字相同。
4. **半透明槽位风险**：`--muted`、`--hover`、`--selected`、`--border` 转成半透明后，Pi 现有
   `background: var(--surface)` + `border: 1px solid var(--border)` 的组合（`base.css:20-21`、
   `base.css:46-48`）会叠出与参考不同的深度。移植顺序必须先换 `--surface`/`--bg` 的不透明值，再换
   半透明槽位，最后才调 §1 的几何，否则叠色问题会被误判成几何问题。
5. **`--font-size` 与 `--font-*` 是两回事**：`--font-size` 是用户偏好（body 文字），`--font-sm` 等是
   设计梯（`:root` rem）。任何组件都不允许用 `var(--font-size)` 推几何。
6. **本表覆盖度**：13 个现有令牌逐个给出映射（其中 `--font-size`、`--surface` 为部分/不 port 并附
   理由）；结构尺度逐项覆盖题面点名的 `--spacing`、radius 梯、hairline、toolbar 三高度、nav /
   settings / mode-switch 行高、`--padding-row-y`、control size/gutter/icon、`--font-text-*`、
   composer 半径与直径、`--menu-*`、`--sidebar-*`（含宽度钳制判定）、`--elevation-*`/`--shadow-*`、
   `--transition-*`。

## 7. 复核记录

抽查 32 个令牌，逐条同时比对 `design-tokens.json`（`value` + `valueSource.offset`）与
`design-tokens.generated.css`（同一 offset 的 `/* source: …@N */` 注释 + 声明行）：31 条双路一致；
唯一不一致是 `--app-color-text-foreground`（JSON `value` 为空、generated.css 有值 `shared@88701`），
即 §3 首行与 `reference-extraction.md` §9.1 记录的抽取器限制，不是本文取值错误。

本文引用的其余数字均直接来自工件：令牌总量 1,812 名 / 2,950 声明（`scope:root` 1,191；带主题覆盖
28 个 / 46 条，全部 `via: data-theme`）；`--color-*` 766 名；`--app-*` 80 名且根级 0 个；
`value` 为空的令牌 621 个。抽取参数与来源清单见 `reference-extraction.md`。
