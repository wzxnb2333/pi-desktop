#!/usr/bin/env node
// 从已抽取的 Codex 编译 CSS 中导出设计令牌，供 UI 重构代理使用。
//
//   node apps/desktop/scripts/extract-tokens.mjs [--in <dir>] [--out-dir docs/desktop]
//
// 输入是 codex-reference.mjs 抽出的 webview/assets/app-{shared,initial,primary}-*.css。
// 这些是 Tailwind v4 的编译产物：@theme{} 已被折进 @layer theme，所以只能读，绝不能重新生成。
//
// 关键点：
//   * 文件按 latin1 读，JS 字符串下标 == UTF-8 字节下标，因此证据里的 offset 可逐字节复现。
//   * 嵌套花括号用平衡切片；正则匹配块在嵌套时会截错。
//   * 只导出语义令牌；--tw-* 是 Tailwind 内部寄存器（实测 94 个名字），不属于设计语言。
//   * 同名令牌重复声明时所有 source 全保留，重声明顺序必须可审计。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BS = String.fromCharCode(92);
const SCRIPT_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

function parseArgs(argv) {
	const out = {in: undefined, outDir: path.join(REPO_ROOT, 'docs', 'desktop')};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--in') out.in = path.resolve(argv[++i]);
		else if (a === '--out-dir') out.outDir = path.resolve(argv[++i]);
		else if (a === '--help' || a === '-h') out.help = true;
		else fail(`未知参数：${a}`);
	}
	return out;
}

function fail(message) {
	console.error(`[extract-tokens] 失败：${message}`);
	process.exit(1);
}

/** 令牌族：按参考里实际存在的前缀分类，此顺序即 generated.css 的输出顺序。 */
const FAMILIES = [
	'--color-',
	'--font-',
	'--app-',
	'--control-',
	'--shadow-',
	'--radius-',
	'--height-',
	'--spacing',
	'--menu-',
	'--input-',
	'--switch-',
	'--sidebar-',
	'--thread-',
	'--badge-',
	'--tooltip-',
	'--elevation-',
	'--transition-',
];
const OTHER = '--(other)';

function familyOf(name) {
	for (const f of FAMILIES) if (name.startsWith(f)) return f;
	return OTHER;
}

const AT_RECURSE = /^@(media|supports|layer|scope|container|starting-style)/;

function skipComment(src, i, end) {
	const close = src.indexOf('*/', i + 2);
	return close < 0 || close > end ? end : close + 1;
}

function skipString(src, i, end) {
	const quote = src[i];
	for (let j = i + 1; j < end; j++) {
		if (src[j] === '\\') j++;
		else if (src[j] === quote) return j;
	}
	return end;
}

/** 与 src[i] 处 '{' 配对的 '}' 下标（跳过字符串、注释与转义字符）。 */
function matchBrace(src, i, end) {
	let depth = 0;
	for (let j = i; j < end; j++) {
		const ch = src[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '/' && src[j + 1] === '*') {
			j = skipComment(src, j, end);
			continue;
		}
		if (ch === '"' || ch === "'") {
			j = skipString(src, j, end);
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (!depth) return j;
		}
	}
	return end;
}

/** 只取块内深度 0 的声明；嵌套块交给递归，避免重复计数。offset 为声明起始的字节下标。 */
function topLevelDecls(src, start, end) {
	const out = [];
	let p = start;
	let i = start;
	const emit = stop => {
		const raw = src.slice(p, stop);
		const text = raw.trim();
		// 值允许为空：`--lightningcss-dark: ` 这类空值是参考里真实存在的开关（light/dark 二选一技巧）
		const m = /^(--[A-Za-z0-9-]+)\s*:([\s\S]*)$/.exec(text);
		if (m) out.push({name: m[1], value: m[2].trim(), offset: p + (raw.length - raw.trimStart().length)});
	};
	while (i < end) {
		const ch = src[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (ch === '/' && src[i + 1] === '*') {
			i = skipComment(src, i, end) + 1;
			continue;
		}
		if (ch === '"' || ch === "'") {
			i = skipString(src, i, end) + 1;
			continue;
		}
		if (ch === '{') {
			i = matchBrace(src, i, end) + 1;
			p = i;
			continue;
		}
		if (ch !== ';') {
			i++;
			continue;
		}
		emit(i);
		i++;
		p = i;
	}
	// 压缩后的 CSS 最后一条声明没有分号：这里必须补一次，否则每个块的尾令牌都会丢
	if (p < end) emit(end);
	return out;
}

/** 递归下降，收集所有声明块（含嵌套规则与 at-rule 内部）。 */
function parseStylesheet(src) {
	/** @type {{selector:string, chain:string[], atChain:string[], decls:{name:string,value:string,offset:number}[]}[]} */
	const rules = [];
	(function walk(start, end, chain, atChain) {
		let cursor = start;
		for (let i = start; i < end; i++) {
			const ch = src[i];
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === '/' && src[i + 1] === '*') {
				i = skipComment(src, i, end);
				cursor = i + 1;
				continue;
			}
			if (ch === '"' || ch === "'") {
				i = skipString(src, i, end);
				cursor = i + 1;
				continue;
			}
			if (ch === ';') {
				cursor = i + 1;
				continue;
			}
			if (ch !== '{') continue;
			const prelude = src.slice(cursor, i).trim();
			const close = matchBrace(src, i, end);
			if (AT_RECURSE.test(prelude)) walk(i + 1, close, chain, [...atChain, prelude.replace(/\s+/g, ' ')]);
			else if (!prelude.startsWith('@')) {
				const nextChain = [...chain, prelude];
				rules.push({selector: prelude, chain: nextChain, atChain, decls: topLevelDecls(src, i + 1, close)});
				walk(i + 1, close, nextChain, atChain);
			}
			i = close;
			cursor = close + 1;
		}
	})(0, src.length, [], []);
	return rules;
}

/** :root / :host / [data-theme] 这类全局作用域（不含 class、id、其它属性） */
function isRootScope(selector) {
	const stripped = selector.replace(/\[[^\]]*\]/g, '');
	if (/[.#]/.test(stripped)) return false;
	return /:root|:host/.test(stripped) || /\[data-theme|\[data-codex/.test(selector);
}

function themeBySelector(selector) {
	if (/data-theme\s*=\s*["']?dark/i.test(selector)) return 'dark';
	if (/data-theme\s*=\s*["']?light/i.test(selector)) return 'light';
	if (/--theme-variant\s*:\s*dark/.test(selector)) return 'dark';
	if (/--theme-variant\s*:\s*light/.test(selector)) return 'light';
	return undefined;
}

function themeByAtRule(atChain) {
	if (/prefers-color-scheme\s*:\s*dark/.test(atChain)) return 'dark';
	if (/prefers-color-scheme\s*:\s*light/.test(atChain)) return 'light';
	return undefined;
}

/**
 * 参考用 data-codex-window-type 区分宿主：electron / browser / chrome-extension / extension。
 * Pi Desktop 对应 electron。选择器若只提到 browser 或 extension，则该值不是桌面值，
 * 不能当成 value 导出（例如 --height-toolbar 在 browser 分支被改成 calc(var(--spacing)*13)）。
 */
const WINDOW_TYPE_RE = /data-codex-window-type\s*=\s*["']?([a-z-]+)/g;
function windowTypes(selector) {
	const out = new Set();
	for (const m of selector.matchAll(WINDOW_TYPE_RE)) out.add(m[1]);
	return out;
}

function desktopApplies(selector) {
	// A host test inside :not(...) *excludes* that host; anywhere else it is required. Reading both
	// as required made `:root:not([data-codex-window-type=extension])` look extension-only and
	// silently dropped the value for 621 of 1812 tokens.
	const excluded = new Set();
	const rest = selector.replace(/:not\(([^()]*)\)/g, (_block, inner) => {
		for (const match of inner.matchAll(WINDOW_TYPE_RE)) excluded.add(match[1]);
		return '';
	});
	const required = new Set();
	for (const match of rest.matchAll(WINDOW_TYPE_RE)) required.add(match[1]);
	if (excluded.has('electron')) return false;
	return required.size === 0 || required.has('electron');
}

/**
 * lightningcss encodes a light/dark pair as two stacked var() fallbacks. Left raw, 180 tokens
 * carried a value no consumer can use, so the fidelity report would have compared scaffolding.
 */
function unwrapThemePair(value) {
	const head = 'var(--lightningcss-light,';
	const sep = ')var(--lightningcss-dark,';
	if (!value.startsWith(head) || !value.endsWith(')') || !value.includes(sep)) return null;
	const split = value.indexOf(sep);
	return { light: value.slice(head.length, split), dark: value.slice(split + sep.length, -1) };
}

/**
 * 近似特异度，只用于在同一令牌的多条根级声明里挑出“桌面环境下真正生效”的那条。
 * 不追求规范级精确：:where() 计 0，:is()/:not() 内部按字面计数（会高估，但排序结果一致）。
 */
function specificityApprox(selector) {
	const s = selector.replace(/:where\([^()]*\)/g, '');
	const ids = (s.match(/#[^\s.:[\]>()+]+/g) || []).length;
	const classes = (s.match(/\.[^\s.:[\]>()+]+/g) || []).length;
	const attrs = (s.match(/\[[^\]]*\]/g) || []).length;
	const pseudos = (s.match(/:(?!where\b|is\b|not\b)[a-z-]+(?:\([^)]*\))?/gi) || []).length;
	const types = (s.match(/(?:^|[\s>+~])(?:[a-z][a-z0-9-]*)/gi) || []).length;
	return ids * 1_000_000 + (classes + attrs + pseudos) * 1_000 + types;
}

/** 层叠排序：无 @layer 的普通声明优先于有层声明；再比特异度；最后文档顺序后者胜。 */
function rankOf(decl, order) {
	return [decl.at.includes('@layer') ? 0 : 1, specificityApprox(decl.full), order];
}

function greater(a, b) {
	if (!b) return true;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/**
 * @supports 条件在 Electron（Chromium）里的真假判定表。
 * 判错的后果是把“浏览器里根本不生效的值”当成桌面规格，因此宁可标 unknown 也不猜。
 */
const SUPPORTS_FALSE = ['corner-shape', '-webkit-hyphens', '-moz-orient'];
const SUPPORTS_TRUE = ['color-mix(', 'linear-gradient(in lab', 'contain-intrinsic-size', 'animation-timeline:'];

function supportsIsFalse(prelude) {
	return SUPPORTS_FALSE.some(s => prelude.includes(s)) && !SUPPORTS_TRUE.some(s => prelude.includes(s));
}

/** 把 at 链分类，用来判断某条声明是否真的参与桌面环境的根级取值。 */
function classifyConditions(atList) {
	const out = {layer: [], media: [], container: [], supportsFalse: [], supportsPass: []};
	for (const p of atList) {
		if (p.startsWith('@layer')) out.layer.push(p);
		else if (p.startsWith('@media')) out.media.push(p);
		else if (p.startsWith('@container')) out.container.push(p);
		else if (p.startsWith('@supports')) (supportsIsFalse(p) ? out.supportsFalse : out.supportsPass).push(p);
	}
	return out;
}

/** 朴素统计：全文（含被跳过的 at 块）里的自定义属性声明数，用于给解析器做覆盖率自检。 */
function naiveDeclCount(src) {
	const all = (src.match(/--[A-Za-z][A-Za-z0-9-]*(?=\s*:)/g) || []).filter(n => !n.startsWith('--tw-'));
	// 排除 @container style(--x:...) / @supports style(...) 里的条件式写法：它们不是声明
	const styleQueries = (src.match(/\(\s*--[A-Za-z][A-Za-z0-9-]*\s*:/g) || []).length;
	return Math.max(0, all.length - styleQueries);
}

/** 解析器有意跳过的 at 块（@property/@font-face/@keyframes 等）范围，用于覆盖率自检。 */
function skippedAtRanges(src) {
	const ranges = [];
	for (const at of ['@property', '@font-face', '@keyframes', '@font-feature-values', '@page', '@color-profile', '@font-palette-values', '@position-try']) {
		for (let i = src.indexOf(at); i >= 0; i = src.indexOf(at, i + 1)) {
			const open = src.indexOf('{', i);
			if (open < 0) break;
			const close = matchBrace(src, open, src.length);
			ranges.push([open, close]);
			i = close;
		}
	}
	return ranges;
}

function insideRanges(ranges, offset) {
	return ranges.some(([a, b]) => offset > a && offset < b);
}

/** 合并/去包含，避免嵌套的跳过块被重复计数。 */
function mergeRanges(ranges) {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const out = [];
	for (const [s, e] of sorted) {
		const last = out[out.length - 1];
		if (last && s <= last[1]) {
			if (e > last[1]) last[1] = e;
			continue;
		}
		out.push([s, e]);
	}
	return out;
}

function countInRanges(src, ranges) {
	let total = 0;
	for (const [a, b] of ranges) total += naiveDeclCount(src.slice(a + 1, b));
	return total;
}

/** 覆盖率不达标时打印漏读样本，便于定位解析器与真实语法的分歧。 */
function reportMissing(src, parsedOffsets, ranges, file) {
	const samples = [];
	for (const m of src.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)(?=\s*:)/g)) {
		if (m[1].startsWith('--tw-') || parsedOffsets.has(m.index) || insideRanges(ranges, m.index)) continue;
		// 跳过 style(--x:...) 条件式（非声明）
		const before = src.slice(Math.max(0, m.index - 8), m.index);
		if (/\(\s*$/.test(before)) continue;
		if (samples.length < 10)
			samples.push({offset: m.index, name: m[1], context: JSON.stringify(src.slice(Math.max(0, m.index - 100), m.index + 40))});
	}
	console.error(`[extract-tokens] ${file} 漏读样本：`);
	for (const s of samples) console.error(`  @${s.offset} ${s.name} :: ${s.context}`);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log('用法：node apps/desktop/scripts/extract-tokens.mjs [--in <抽取目录>] [--out-dir docs/desktop]');
		return 0;
	}
	const inDir = args.in ?? path.join(REPO_ROOT, '.artifacts', 'codex-reference', '26.915.4065.0');
	const assetsDir = path.join(inDir, 'webview', 'assets');
	if (!fs.existsSync(assetsDir))
		fail(`找不到抽取目录 ${assetsDir}；先运行 node apps/desktop/scripts/codex-reference.mjs`);

	const PREFIXES = ['app-shared-', 'app-initial-', 'app-primary-'];
	const inputs = fs
		.readdirSync(assetsDir)
		.filter(f => f.endsWith('.css') && !f.endsWith('.pretty.css') && PREFIXES.some(p => f.startsWith(p)))
		.sort();
	if (inputs.length === 0) fail(`${assetsDir} 中没有 app-shared-*/app-initial-*/app-primary-*.css`);

	/** @type {{file:string, selector:string, full:string, at:string, name:string, value:string, offset:number}[]} */
	const decls = [];
	const perFile = {};
	for (const file of inputs) {
		const src = fs.readFileSync(path.join(assetsDir, file), 'latin1');
		const rules = parseStylesheet(src);
		let n = 0;
		const parsedOffsets = new Set();
		for (const r of rules) {
			const full = r.chain.join(' ');
			const at = r.atChain.join(' ');
			for (const d of r.decls) {
				if (d.name.startsWith('--tw-')) continue;
				decls.push({file, selector: r.selector, full, at, atList: r.atChain, name: d.name, value: d.value, offset: d.offset});
				parsedOffsets.add(d.offset);
				n++;
			}
		}
		perFile[file] = {bytes: Buffer.byteLength(src, 'latin1'), blocks: rules.length, semanticDecls: n};
		// 覆盖率自检：解析器漏读整块时（历史上 escaped-quote 选择器曾吞掉 487 KB）必须立刻暴露
		const ranges = mergeRanges(skippedAtRanges(src));
		const expected = naiveDeclCount(src) - countInRanges(src, ranges);
		const coverage = expected > 0 ? n / expected : 1;
		perFile[file].expectedDecls = expected;
		perFile[file].coverage = Number(coverage.toFixed(4));
		if (coverage < 0.98) {
			reportMissing(src, parsedOffsets, ranges, file);
			fail(`${file} 只解析到 ${n}/${expected} 条语义声明（覆盖率 ${(coverage * 100).toFixed(1)}%），解析器漏读，结果不可用`);
		}
		console.log(
			`[extract-tokens] ${file}: ${perFile[file].bytes} bytes / ${rules.length} 块 / ${n} 条语义声明（朴素应有 ${expected}，覆盖率 ${(coverage * 100).toFixed(1)}%）`,
		);
	}
	if (decls.length === 0) fail('解析出 0 条语义声明（解析器与参考格式不符）');

	// ---- 归并令牌表
	/** @type {Record<string, any>} */
	const tokens = {};
	let order = 0;
	for (const d of decls) {
		order++;
		let t = tokens[d.name];
		if (!t)
			t = tokens[d.name] = {
				value: '',
				family: familyOf(d.name),
				scope: 'element-only',
				sources: [],
			};
		const source = {file: d.file, offset: d.offset, selector: d.full, at: d.at.slice(0, 180)};
		t.sources.push(source);
		const viaAttribute = themeBySelector(d.full);
		const viaMedia = !viaAttribute && isRootScope(d.selector) ? themeByAtRule(d.at) : undefined;
		const theme = viaAttribute ?? viaMedia;
		const rank = rankOf(d, order);
		if (theme) {
			t.themeOverrides ??= {};
			const prev = t.themeOverrides[theme];
			const entry = {
				value: d.value,
				file: d.file,
				offset: d.offset,
				selector: d.full,
				at: source.at,
				via: viaAttribute ? 'data-theme' : 'prefers-color-scheme',
				rank,
			};
			// data-theme 属性覆盖永远优先于 prefers-color-scheme 回退；同类之间比较层叠秩
			const wins = !prev || (entry.via === 'data-theme' && prev.via === 'data-theme' && greater(rank, prev.rank));
			if (!prev || (prev.via !== 'data-theme' && entry.via === 'data-theme') || wins) t.themeOverrides[theme] = entry;
		} else if (isRootScope(d.selector) && !themeByAtRule(d.at)) {
			if (!desktopApplies(d.full)) {
				// 非桌面宿主（browser / extension）的根级改写：保留但绝不当作 Pi 的目标值
				(t.nonDesktopOverrides ??= []).push({...source, windowTypes: [...windowTypes(d.full)].join(',')});
				continue;
			}
			const cond = classifyConditions(d.atList);
			if (cond.media.length || cond.container.length || cond.supportsFalse.length) {
				// @media / @container / Electron 里为假的 @supports：值真实存在但不参与根级默认取值
				(t.conditionalOverrides ??= []).push({
					...source,
					because: [...cond.media, ...cond.container, ...cond.supportsFalse].join(' ').slice(0, 160),
				});
				continue;
			}
			if (greater(rank, t._rank)) {
				const pair = unwrapThemePair(d.value);
				t.value = pair ? pair.light : d.value;
				if (pair && !(t.themeOverrides ??= {}).dark)
					t.themeOverrides.dark = { value: pair.dark, via: 'lightningcss-pair' };
				t.scope = 'root';
				t.valueSource = source;
				t._rank = rank;
			}
			(t.rootCandidates ??= []).push({value: d.value, ...source});
		}
	}
	for (const t of Object.values(tokens)) {
		delete t._rank;
		if (t.themeOverrides) for (const key of Object.keys(t.themeOverrides)) delete t.themeOverrides[key].rank;
	}
	const rootScoped = Object.values(tokens).filter(t => t.scope === 'root').length;

	// ---- generated.css
	const lines = [];
	const shared = Object.keys(perFile).find(f => f.startsWith('app-shared-'));
	lines.push('/*');
	lines.push(' * 由 apps/desktop/scripts/extract-tokens.mjs 生成。不要手工编辑，也不要被应用 import：');
	lines.push(' * 这是 Codex 编译产物的逐条令牌抄本，包含 1,600+ 个 Pi 没有组件承载的变量（例如按钮');
	lines.push(' * soft/solid/outline/ghost/alpha 变体引擎）。Pi 的映射表见 docs/desktop/design-tokens.md。');
	lines.push(` * 语义令牌 ${Object.keys(tokens).length} 个名字 / ${decls.length} 条声明；--tw-* 已排除。`);
	lines.push(` * source 注释的 offset 是 UTF-8 字节偏移（${shared} = ${perFile[shared].bytes} 字节）。`);
	lines.push(' * 每个块保留原始选择器与 at 条件，因此作用域与参考一致；族内按文档顺序排列，');
	lines.push(' * 同名令牌的重复声明全部保留，用于审计重声明顺序。');
	lines.push(' */');
	lines.push('');
	const byFamily = new Map();
	for (const d of decls) {
		const fam = familyOf(d.name);
		if (!byFamily.has(fam)) byFamily.set(fam, []);
		byFamily.get(fam).push(d);
	}
	const stats = {};
	for (const fam of [...FAMILIES, OTHER]) {
		const group = byFamily.get(fam);
		if (!group) continue;
		const uniq = new Set(group.map(d => d.name));
		stats[fam] = {names: uniq.size, declarations: group.length};
		lines.push(`/* ============ family ${fam}* : ${uniq.size} 个名字 / ${group.length} 条声明 ============ */`);
		let current = null;
		for (const d of group) {
			const key = `${d.file}\u0000${d.full}\u0000${d.at}`;
			if (key !== current) {
				if (current !== null) lines.push('}');
				lines.push('');
				lines.push(`/* file: ${d.file}${d.at ? ` | 条件: ${d.at}` : ''} */`);
				lines.push(`${d.full}{`);
				current = key;
			}
			lines.push(`  /* source: ${d.file}@${d.offset} */`);
			lines.push(`  ${d.name}:${d.value ? ` ${d.value}` : ''};`);
		}
		if (current !== null) lines.push('}');
		lines.push('');
	}
	fs.mkdirSync(args.outDir, {recursive: true});
	const cssPath = path.join(args.outDir, 'design-tokens.generated.css');
	fs.writeFileSync(cssPath, lines.join('\n'));
	const jsonPath = path.join(args.outDir, 'design-tokens.json');
	fs.writeFileSync(jsonPath, `${JSON.stringify(tokens, undefined, 1)}\n`);

	// ---- 供文档引用的统计
	const names = Object.keys(tokens);
	const variantWords = names.filter(n => /soft|solid|outline|ghost|alpha/.test(n));
	const stateWords = names.filter(n => /-(hover|active|focus|disabled|selected|pressed)$/.test(n));
	const twNames = new Set();
	for (const file of inputs) {
		const src = fs.readFileSync(path.join(assetsDir, file), 'latin1');
		for (const m of src.matchAll(/--tw-[a-z0-9-]+(?=\s*:)/g)) twNames.add(m[0]);
	}
	console.log(`[extract-tokens] 语义令牌 ${names.length} 个名字 / ${decls.length} 条声明（root 作用域 ${rootScoped} 个）`);
	console.log(`[extract-tokens] --tw-* 名字（已排除） ${twNames.size} 个`);
	console.log(`[extract-tokens] 族分布 ${JSON.stringify(stats)}`);
	console.log(
		`[extract-tokens] 变体引擎：含 soft|solid|outline|ghost|alpha 的名字 ${variantWords.length} 个，其中 --color-* ${variantWords.filter(n => n.startsWith('--color-')).length} 个；带状态后缀的名字 ${stateWords.length} 个`,
	);
	console.log(`[extract-tokens] 主题覆盖令牌 ${names.filter(n => tokens[n].themeOverrides).length} 个（data-theme 或 prefers-color-scheme）`);
	console.log(
		`[extract-tokens] 被排除出根级取值的声明：非桌面宿主(browser/extension) ${names.filter(n => tokens[n].nonDesktopOverrides).length} 个令牌，@media/@container/Chromium 不支持的 @supports ${names.filter(n => tokens[n].conditionalOverrides).length} 个令牌`,
	);
	console.log(`[extract-tokens] 写出 ${path.relative(REPO_ROOT, cssPath).split(BS).join('/')} ${fs.statSync(cssPath).size} bytes`);
	console.log(`[extract-tokens] 写出 ${path.relative(REPO_ROOT, jsonPath).split(BS).join('/')} ${fs.statSync(jsonPath).size} bytes`);
	if (names.length < 500) fail('令牌数远低于预期，疑似解析器漏读');
	return 0;
}

process.exitCode = main();
