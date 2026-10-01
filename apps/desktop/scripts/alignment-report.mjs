import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const directory = join(root, '.artifacts/codex-26915-alignment');
const manifest = JSON.parse(await readFile(join(root, 'docs/desktop/codex-26915-reference-manifest.json'), 'utf8'));
const { results: rows } = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
const summary = {
  reference: manifest.msixVersion, app: manifest.appVersion,
  captures: rows.length, scenes: [...new Set(rows.map(row => row.surface))].length,
  pageErrors: rows.filter(row => row.errors.length).length,
  horizontalOverflow: rows.filter(row => row.geometry.pageOverflow > 1).length,
  controlOverflow: rows.filter(row => row.geometry.controlOverflow?.some(control => control.pixels > 1)).length,
  wrappedBreadcrumbs: rows.filter(row => row.geometry.wrappedBreadcrumbs?.length).length,
  clippedIcons: rows.filter(row => row.geometry.clippedIcons?.length).length,
  pixelPass: rows.filter(row => row.comparison === 'pixel-pass').length,
  pixelFail: rows.filter(row => row.comparison === 'pixel-fail').length,
  invalidBodyDiagnostics: rows.filter(row => row.comparison === 'diagnostic-invalid-reference-body').length,
  noMatchingReference: rows.filter(row => row.comparison === 'adapted-no-matching-scene').length,
  localizedOnly: rows.filter(row => row.comparison === 'localized-layout-only').length,
  measuredRegions: rows.reduce((count, row) => count + (row.regions?.length || 0), 0),
  passedRegions: rows.reduce((count, row) => count + (row.regions?.filter(region => region.passed).length || 0), 0),
  acceptedAsOneToOne: false,
  acceptanceMode: 'visual-ux-functional',
  pixelThresholdIsBlocking: false,
};
const newline = String.fromCharCode(10);
await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + newline);
const escaped = JSON.stringify({ summary, rows }).replaceAll('<', String.fromCharCode(92) + 'u003c');
const html = [
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Desktop · 26.915 UI 验收</title>',
  '<style>:root{font:14px/1.55 system-ui,sans-serif;color:#eee;background:#181818;color-scheme:dark}*{box-sizing:border-box}body{max-width:1560px;margin:auto;padding:24px}h1{font-size:24px;margin:0 0 12px}h2{font-size:16px}p{color:#bbb}header{position:sticky;top:0;z-index:2;background:#181818;padding:10px 0;border-bottom:1px solid #444}select{font:inherit;padding:7px 12px;margin:0 10px 8px 0;border:1px solid #555;border-radius:8px;background:#292929;color:inherit}section{margin:22px 0;padding:16px;border:1px solid #444;border-radius:12px}a{color:#a8ceff}figure{margin:0;min-width:0}figcaption{margin-bottom:6px;color:#aaa}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.images img{display:block;width:100%;height:auto;border:1px solid #555}.flag{color:#ffd080;font-weight:600}pre{overflow:auto;font-size:12px;background:#222;padding:12px}.note{padding:12px;background:#29251e;border-radius:8px}details{margin-top:12px}summary{cursor:pointer}#count{color:#aaa}label{display:inline-block}@media(max-width:700px){body{padding:12px}.images{grid-template-columns:1fr}header{position:static}}</style>',
  '<h1>Pi Desktop 与 Codex 26.915 对照</h1><p>MSIX 26.915.4065.0 / app 26.915.31945 · Satang 只读参考 · 开发模式本地假供应商</p>',
  '<p class="note">当前以视觉接近、用户体验和功能完整性验收，像素误差不再作为交付阻断条件。本页保留旧门槛下的原始差分，辅助发现布局问题，不把缺少参考的页面宣称为像素通过。品牌、真实内容和 Pi 功能差异单独登记；错误正文与透明底色参考有使用限制。迭代任务与行为证据见 docs/desktop/iteration-goal.md。</p>',
  '<header><label>场景 <select id="surface"></select></label><label>主题 <select id="theme"></select></label><label>语言 <select id="locale"></select></label><label>窗口 <select id="size"></select></label><label>结果 <select id="status"></select></label><div id="count"></div></header><main id="results"></main>',
  '<script>const data=' + escaped + ';',
  'const labels={"pixel-pass":"像素诊断：旧门槛内","pixel-fail":"像素诊断：差异超旧门槛","adapted-no-matching-scene":"适配 / 缺少同场景参考","localized-layout-only":"中文布局检查","diagnostic-invalid-reference-body":"错误正文，仅比较独立组件"};',
  'for(const [id,values] of Object.entries({surface:data.rows.map(r=>r.surface),theme:["light","dark"],locale:["zh-CN","en-US"],size:data.rows.map(r=>r.viewport.width+"×"+r.viewport.height),status:data.rows.map(r=>r.comparison)})){const select=document.getElementById(id);for(const value of ["",...new Set(values)]){const option=document.createElement("option");option.value=value;option.textContent=labels[value]||value||"全部";select.append(option)}select.addEventListener("change",render)}',
  'document.getElementById("surface").value="welcome";document.getElementById("locale").value="en-US";document.getElementById("size").value="1440×940";',
  'function render(){const value=id=>document.getElementById(id).value;const selected=data.rows.filter(r=>(!value("surface")||r.surface===value("surface"))&&(!value("theme")||r.theme===value("theme"))&&(!value("locale")||r.locale===value("locale"))&&(!value("size")||r.viewport.width+"×"+r.viewport.height===value("size"))&&(!value("status")||r.comparison===value("status")));document.getElementById("count").textContent="显示 "+selected.length+" / "+data.rows.length+" 张实现图；像素通过 "+data.summary.pixelPass+"，像素未通过 "+data.summary.pixelFail;const output=document.getElementById("results");output.replaceChildren();for(const row of selected){const section=document.createElement("section"),heading=document.createElement("h2");heading.textContent=row.name;section.append(heading);const state=document.createElement("p");state.className="flag";state.textContent=(labels[row.comparison]||row.comparison)+(row.pixel?" · 整窗原始差异 "+(row.pixel.fraction*100).toFixed(3)+"%":"");section.append(state);const images=document.createElement("div");images.className="images";for(const [suffix,label] of row.pixel?[[".reference.png","同版本参考"],[".png","Pi 实现"],[".diff.png","未遮罩差分"]]:[[".png","Pi 实现"]]){const figure=document.createElement("figure"),caption=document.createElement("figcaption"),link=document.createElement("a"),img=document.createElement("img");caption.textContent=label;link.href=row.name+suffix;link.target="_blank";img.src=link.href;img.alt=row.name+" "+label;img.loading="lazy";link.append(img);figure.append(caption,link);images.append(figure)}section.append(images);const details=document.createElement("details"),title=document.createElement("summary"),pre=document.createElement("pre");title.textContent="几何、圆角、颜色、来源哈希与错误";pre.textContent=JSON.stringify({reference:row.reference,geometry:row.geometryComparisons,regions:row.regions,controlOverflow:row.geometry.controlOverflow,overflow:row.geometry.pageOverflow,errors:row.errors,comparison:row.comparison,capturedAt:row.capturedAt},null,2);details.append(title,pre);section.append(details);output.append(section)}}render();</script></html>',
].join(newline);
await writeFile(join(directory, 'gallery.html'), html);
const table = ['# 同场景视觉诊断结果', '', '固定版本：Codex ' + manifest.msixVersion + ' / app ' + manifest.appVersion + '。', '', '**当前以视觉、体验和功能验收；像素误差不再阻断交付。** 下表保留旧像素门槛诊断，功能与体验进度另见 docs/desktop/iteration-goal.md。', '', '| 场景 | 主题 | 语言 | 尺寸 | 诊断 | 未遮罩差异 |', '| --- | --- | --- | --- | --- | --- |', ...rows.map(row => '| ' + [row.surface, row.theme, row.locale, row.viewport.width + '×' + row.viewport.height, row.comparison, row.pixel ? (row.pixel.fraction * 100).toFixed(3) + '%' : '无可比像素结果'].join(' | ') + ' |'), '', '原始数据：results.json。查看 gallery.html 可并排打开参考、实现、差分和几何数据。', '品牌、项目/任务/模型名称、会话与文件内容保持产品真实来源；缺少有效参考的页面不计为像素通过。'];
await writeFile(join(directory, 'acceptance.md'), table.join(newline) + newline);
console.log(JSON.stringify({ ...summary, gallery: join(directory, 'gallery.html') }));
