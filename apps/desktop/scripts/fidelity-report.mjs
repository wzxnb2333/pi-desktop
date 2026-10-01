import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
const workspace = resolve(root, 'apps/desktop');
const outputFlag = process.argv.indexOf('--out');
const output = resolve(
  root,
  outputFlag < 0 ? 'docs/desktop/fidelity-report.md' : process.argv[outputFlag + 1],
);
const resultsPath = resolve(root, '.artifacts/desktop-nonvisual-results.json');
mkdirSync(resolve(root, '.artifacts'), { recursive: true });
const resultsOnly = process.argv.includes('--results-only');
const run = resultsOnly ? undefined : spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/@playwright/test/cli.js'),
    'test',
    '-c',
    'playwright.nonvisual.config.ts',
    '--reporter=list,json',
  ],
  {
    cwd: workspace,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath },
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (run?.error) throw run.error;
const result = JSON.parse(readFileSync(resultsPath, 'utf8'));
if (!result.stats || !Array.isArray(result.suites) || !Array.isArray(result.errors)) throw new Error('Incomplete Playwright result');
const contract = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
const surfaces = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-surfaces.json'), 'utf8'));
const activity = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-activity.json'), 'utf8'));
const states = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-states.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(resolve(root, 'docs/desktop/satang-ui-image-ledger.json'), 'utf8'));
const satangContracts = ['satang-reference', 'satang-shell-reference', 'satang-palette-reference', 'satang-surfaces-reference', 'satang-review-reference', 'satang-management-reference', 'satang-workspace-reference'].map(
  name => JSON.parse(readFileSync(resolve(root, 'docs/desktop/' + name + '.json'), 'utf8')),
);
const sources = new Map(contract.sources.map(source => [source.file, source.sha256]));
for (const source of surfaces.sources) sources.set('webview/assets/' + source.file, source.sha256);
for (const source of activity.sources) sources.set('webview/assets/' + source.file, source.sha256);
for (const source of states.sources) sources.set('webview/assets/' + source.file, source.sha256);
for (const sourceContract of satangContracts) {
  for (const source of sourceContract.sources ?? []) sources.set('satang_code/' + source.file, source.sha256);
  for (const source of sourceContract.unavailable ?? []) sources.set('satang_code/' + source.file, source.sha256);
  for (const sample of sourceContract.samples) sources.set('satang_code/' + sample.file, sample.sha256);
}
const specs = [];
function collect(suite) {
  for (const spec of suite.specs ?? []) specs.push(spec);
  for (const child of suite.suites ?? []) collect(child);
}
collect(result);
const rows = specs.map(
  (spec) =>
    '| ' +
    spec.title.replaceAll('|', '/') +
    ' | ' +
    (spec.tests.every((test) => test.status === 'expected') ? '通过' : '失败或跳过') +
    ' |',
);
const lines = [
  '# Pi Desktop 非视觉验收报告',
  '',
  '源码基准：Windows ' + contract.msixVersion + '；归档应用 ' + contract.appVersion + '。Satang 捕获基准：26.915.4065.0 / app 26.915.31945；两版分别验证，不合并为一个整窗像素基准。',
  '测试开始时间：' + result.stats.startTime + '。生成命令：node apps/desktop/scripts/fidelity-report.mjs' + (resultsOnly ? ' --results-only' : '') + '。',
  '',
  '## 实际结果',
  '',
  '- 通过 ' +
    result.stats.expected +
    '；失败 ' +
    result.stats.unexpected +
    '；跳过 ' +
    result.stats.skipped +
    '；重试后通过 ' +
    result.stats.flaky +
    '。',
  '- ' + (resultsOnly ? '读取已完成的机器结果，不重新运行用例' : '进程退出码：' + run.status) + '。机器结果：.artifacts/desktop-nonvisual-results.json。',
  '- 截图、视频、trace 均关闭；不加载旧 visual.spec.ts 或 desktop.spec.ts。',
  '',
  '## 比较范围',
  '',
  '参考侧使用原始 CSS、源码确定的桌面 DOM、宿主属性和白名单纯主题函数。Pi 侧加载实际 App 和实际样式；合同不读取 Pi 组件或 Pi 样式。',
  '浅色、深色、system-light、system-dark × 1000×640、1280×800、1440×940，共 12 组。',
  '26.917 合同继续比较工作栏、主区域矩形及对话输入框、发送按钮、设置行的 computed style。标题栏、侧栏、首页和 Review 条改用下述 Satang 捕获合同。26.917 被比较的 CSS px 和矩形属性容差为 0.5px，其他值精确比较。',
  'Satang 保存 ' + satangContracts.reduce((count, sourceContract) => count + sourceContract.samples.length, 0) + ' 组独立 DOM 捕获：欢迎页4组、外壳/侧栏4组、命令面板4组、设置/终端/浏览器12组、Review4组、管理4组、workspace2组。除 workspace 为宽窗明暗样式外，其余均为浅色/深色 × 1440×940 / 1000×700。外壳与首页所列矩形容差0.5px；命令面板比较位置/宽度、输入行/结果行高度及所列样式；辅助面板比较条高与内边距，地址输入框另比较高度与所列样式；设置比较标题纵向位置、字体、容器宽度上限和卡片圆角，宽度允许1px滚动条差异。这里没有比较每页所有节点或完整页面高度。',
  '22组样本使用pinned记录；命令面板的2组1000px及Review/管理/workspace的10组采用较早有效捕获。Review比较两行标题、过滤、文件头及右侧文件树；管理比较标题、搜索、分段过滤和空态；workspace比较气泡、通知、计划及正文间距，并验证有界计划可滚动到最后步骤。原始文件SHA-256、节点索引及矩形/样式保存在各satang-*-reference.json和satang-reference.json；命令、搜索结果、设置字段和管理功能仍使用Pi真实语义。',
  '另有 ' + surfaces.samples.length + ' 组原始源码表面样本：菜单及选中/禁用行、Tooltip、确认框及按钮、用户消息气泡、助手正文、普通表格和默认代码块。逐节点比较矩形、字体、颜色、圆角、阴影、内外边距、溢出与状态；对话框另比较 hover、disabled 和 focus-visible。代码块复制失败恢复、键盘换行、表格列对齐及窄宿主滚动另作行为回归。',
  '对话折叠另有 ' + activity.samples.length + ' 组独立源码样本：标题/正文、活动组、文件行、diff外框及文件头。比较所列节点的矩形与21项计算样式；原始折叠箭头路径、300ms过渡曲线、1000ms摘要节流及即时完成另作断言。diff内部使用Pi真实工具结果，不在厂商完整diff几何等同性范围。',
  '审批与加载另有 ' + states.samples.length + ' 组26.917源码补充样本，明确不冒充缺失的26.915现场捕获。审批比较宽/窄容器、明暗及跟随系统的卡片、文本、操作区和按钮样式；四种真实Pi回复类型另测IPC内容、重复提交、失败保留草稿与重试。加载比较居中容器、56px标识及间距，保留Pi品牌与状态/错误文本，并验证bootstrap完成和失败。',
  '真实Electron另验证延迟工具调用、思考、审批、编辑diff、文件打开、停止/失败恢复，以及展开选择在任务切换、renderer重载和进程重启后恢复。见 conversation-folding.md。',
  '另测组合面板、键盘及指针拖动、任务布局、实时系统主题、图标路径和提示浮层。Electron 以开发模式加载当前源码，使用临时项目、临时用户目录和假供应商。',
  '',
  '## 边界',
  '',
  '本报告不是整窗像素一致率。代码块合同不覆盖全部图标和语法高亮；表格合同不覆盖粘性表头和实验分支。字体栅格化、原版功能旗标及Pi专用表单没有端到端等同性证据。Satang pinned workspace/management实际显示旧会话加载失败，pinned review缺失；已用较早有效DOM和已有实现继续移植。workspace参考图可视区只有通知和diff，正文与计划的来源为屏外DOM。审批/加载使用独立26.917源码补充。本请求累计' + ledger.requests[0].recognitionCount + '/20次图像识别，逐次登记见satang-ui-image-ledger.json；全范围复核及限制见satang-completion-audit.md、satang-b09.md与remaining-differences.md。',
  '',
  '## 用例',
  '',
  '| 用例 | 结果 |',
  '| --- | --- |',
  ...rows,
  '',
  '## 参考来源',
  '',
  '| 归档路径 | SHA-256 |',
  '| --- | --- |',
  ...[...sources].map(([file, sha256]) => '| ' + file + ' | ' + sha256 + ' |'),
  '',
];
writeFileSync(output, lines.join(String.fromCharCode(10)));
console.log('[fidelity] ' + output);
process.exitCode =
  run?.status || (result.stats.unexpected || result.stats.flaky || result.stats.skipped || result.errors.length ? 1 : 0);
