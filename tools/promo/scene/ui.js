/*
 * Rebuilds the Pi Desktop window in canvas 2D.
 *
 * Rebuilt rather than screenshotted so that every pixel and every frame is
 * under our control: text stays crisp at any zoom, elements can animate
 * independently, and the render is a pure function of time.
 *
 * The window is drawn at its native 1440x940 CSS size. The camera (see
 * timeline.js) handles all scaling, so nothing here knows about the video's
 * 1920x1080 frame.
 */
import { GEOMETRY, TYPE, mixColor } from './theme.js';

/** The seeded conversation the video shows, matching the real fixture. */
export const CONVERSATION = {
  threadTitle: '整理示例项目文档',
  project: '示例项目',
  userTurns: ['请阅读 README，并补充安装步骤。', '再加一个 hello 示例。'],
  assistantTurns: [
    '我先看一下项目结构。',
    '已完成。\n\n- README 增加了安装步骤\n- 新建了 `hello.txt`\n- 右侧 Review 可以看到两处差异',
  ],
  thinking: '需要确认 README 的现有章节层级。',
  tools: [
    { name: 'read', args: '{"path":"README.md"}', output: '# 示例项目' },
    { name: 'powershell', args: '{"command":"Set-Content hello.txt"}', output: 'DESKTOP_COMMAND_OK' },
  ],
  notice: '上下文已压缩。',
  plan: [
    { text: '阅读 README', status: 'completed' },
    { text: '补充安装步骤', status: 'in_progress' },
  ],
  navItems: ['新建聊天', '待审阅', '自动化', 'Skills 与扩展'],
  threads: ['整理示例项目文档', '重构日志模块', '修复终端闪烁', '整理模型配置', '补充端到端测试', '设计插件加载流程'],
};

const SIDEBAR_ROWS = [
  { kind: 'nav', label: '新建聊天', hint: 'Ctrl N' },
  { kind: 'nav', label: '待审阅' },
  { kind: 'nav', label: '自动化' },
  { kind: 'nav', label: 'Skills 与扩展' },
];

/**
 * Everything that can change during the video. Kept as plain data so a scene in
 * the timeline can be a diff rather than a pile of imperative draw calls.
 */
export function initialState() {
  return {
    view: 'home', // 'home' | 'workbench' | 'settings' | 'terminal' | 'palette'
    revealUser: 1, // how much of the transcript is visible, 0..1
    typed: '', // composer text being typed
    toolOpen: 0, // 0..1 expansion of the first tool card
    diffOpen: 0, // 0..1 expansion of the README diff
    reviewTab: 'changes', // 'changes' | 'plan'
    reviewOpen: true,
    sidebarOpen: true,
    planProgress: 0, // 0..1 of the second plan step
    terminalLines: 3,
    paletteQuery: '',
    streamText: '', // partial assistant text while it streams
  };
}

// ---------------------------------------------------------------- primitives

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

/** Draw text, optionally clipped to a width with an ellipsis. */
function text(ctx, value, x, y, opts = {}) {
  const font = opts.font ?? `${TYPE.uiWeight} ${TYPE.ui}px ${TYPE.sans}`;
  ctx.font = font;
  ctx.fillStyle = opts.color ?? '#000';
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'middle';
  if (opts.maxWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - (opts.align === 'right' ? opts.maxWidth : 0), y - 20, opts.maxWidth, 40);
    ctx.clip();
    ctx.fillText(value, x, y);
    ctx.restore();
  } else {
    ctx.fillText(value, x, y);
  }
  return ctx.measureText(value).width;
}

/** A lucide-style 14px stroked icon, drawn from simple primitives. */
function icon(ctx, name, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size / 16;
  ctx.scale(s, s);
  ctx.beginPath();
  switch (name) {
    case 'chat': // square with a tail
      ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.lineTo(6, 3); ctx.lineTo(1, 3); ctx.lineTo(-2, 6); ctx.lineTo(-2, 3); ctx.lineTo(-6, 3); ctx.closePath();
      break;
    case 'inbox':
      ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath();
      ctx.moveTo(-6, 1); ctx.lineTo(-2, 1); ctx.lineTo(-1, 3); ctx.lineTo(1, 3); ctx.lineTo(2, 1); ctx.lineTo(6, 1);
      break;
    case 'zap':
      ctx.moveTo(2, -7); ctx.lineTo(-4, 0); ctx.lineTo(0, 0); ctx.lineTo(-2, 7); ctx.lineTo(4, -1); ctx.lineTo(0, -1); ctx.closePath();
      break;
    case 'layers':
      ctx.moveTo(0, -6); ctx.lineTo(6, -2.5); ctx.lineTo(0, 1); ctx.lineTo(-6, -2.5); ctx.closePath();
      ctx.moveTo(-6, 1.5); ctx.lineTo(0, 5); ctx.lineTo(6, 1.5);
      ctx.moveTo(-6, 4.5); ctx.lineTo(0, 8); ctx.lineTo(6, 4.5);
      break;
    case 'folder':
      ctx.moveTo(-6, -4); ctx.lineTo(-2, -4); ctx.lineTo(-0.5, -2); ctx.lineTo(6, -2); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath();
      break;
    case 'search':
      ctx.arc(-1, -1, 4.5, 0, Math.PI * 2);
      ctx.moveTo(2.5, 2.5); ctx.lineTo(6, 6);
      break;
    case 'branch':
      ctx.arc(-3, -4, 2, 0, Math.PI * 2);
      ctx.arc(-3, 4, 2, 0, Math.PI * 2);
      ctx.moveTo(-3, -2); ctx.lineTo(-3, 2);
      ctx.moveTo(-1, -4); ctx.quadraticCurveTo(4, -4, 4, 0); ctx.quadraticCurveTo(4, 3, 1, 3);
      break;
    case 'chevron':
      ctx.moveTo(-3, -2); ctx.lineTo(0, 1.5); ctx.lineTo(3, -2);
      break;
    case 'plus':
      ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      break;
    case 'send':
      ctx.moveTo(0, -5); ctx.lineTo(0, 4); ctx.moveTo(-4, 0); ctx.lineTo(0, -5); ctx.lineTo(4, 0);
      break;
    case 'panel':
      ctx.moveTo(-6, -5); ctx.lineTo(6, -5); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath();
      ctx.moveTo(1, -5); ctx.lineTo(1, 5);
      break;
    case 'list':
      ctx.moveTo(-5, -4); ctx.lineTo(6, -4); ctx.moveTo(-5, 0); ctx.lineTo(6, 0); ctx.moveTo(-5, 4); ctx.lineTo(6, 4);
      ctx.moveTo(-6.5, -4); ctx.lineTo(-6.5, -4.01); ctx.moveTo(-6.5, 0); ctx.lineTo(-6.5, 0.01); ctx.moveTo(-6.5, 4); ctx.lineTo(-6.5, 4.01);
      break;
    case 'dots':
      for (const dx of [-5, 0, 5]) { ctx.moveTo(dx, 0); ctx.lineTo(dx + 0.01, 0); }
      ctx.lineWidth = 2.2;
      break;
    case 'check':
      ctx.moveTo(-5, 0); ctx.lineTo(-1.5, 3.5); ctx.lineTo(5, -3.5);
      break;
    case 'circle':
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      break;
    case 'dot':
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    case 'shield':
      ctx.moveTo(0, -6); ctx.lineTo(5, -3.5); ctx.lineTo(5, 1); ctx.quadraticCurveTo(5, 5, 0, 6.5); ctx.quadraticCurveTo(-5, 5, -5, 1); ctx.lineTo(-5, -3.5); ctx.closePath();
      break;
    case 'settings':
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.moveTo(0, -6.5); ctx.lineTo(0, -4);
      ctx.moveTo(0, 6.5); ctx.lineTo(0, 4);
      ctx.moveTo(-6.5, 0); ctx.lineTo(-4, 0);
      ctx.moveTo(6.5, 0); ctx.lineTo(4, 0);
      break;
    default:
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Multi-line markdown-ish text with `code` runs and bullet points. */
function markdown(ctx, value, x, y, width, theme, lineHeight = 26, size = TYPE.ui) {
  const lines = value.split('\n');
  let cursor = y;
  for (const line of lines) {
    if (line.trim() === '') { cursor += lineHeight * 0.45; continue; }
    const bullet = line.startsWith('- ');
    const body = bullet ? line.slice(2) : line;
    let textX = x;
    if (bullet) {
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      ctx.arc(x + 4, cursor, 2.4, 0, Math.PI * 2);
      ctx.fill();
      textX = x + 18;
    }
    // Split on `code` spans and render each with its own background.
    const parts = body.split(/(`[^`]+`)/g).filter(Boolean);
    let px = textX;
    for (const part of parts) {
      const isCode = part.startsWith('`') && part.endsWith('`');
      const content = isCode ? part.slice(1, -1) : part;
      const font = isCode ? `${size}px ${TYPE.mono}` : `${TYPE.uiWeight} ${size}px ${TYPE.sans}`;
      ctx.font = font;
      const w = ctx.measureText(content).width;
      if (isCode) fillRound(ctx, px - 3, cursor - 11, w + 6, 22, 5, theme.codeBg);
      ctx.fillStyle = theme.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(content, px, cursor);
      px += w;
    }
    cursor += lineHeight;
  }
  return cursor - y;
}

// ---------------------------------------------------------------- chrome bits

function drawTitlebar(ctx, theme, state) {
  const h = 30;
  ctx.fillStyle = theme.sidebar;
  ctx.fillRect(0, 0, 1440, h);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h + 0.5);
  ctx.lineTo(1440, h + 0.5);
  ctx.stroke();

  text(ctx, '文件', 60, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '编辑', 108, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '视图', 156, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '帮助', 204, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });

  // Window controls: minimize, maximize, close.
  const baseX = 1440 - 96;
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(baseX - 12, h / 2); ctx.lineTo(baseX - 4, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(baseX + 26, h / 2 - 4.5, 9, 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseX + 64, h / 2 - 4.5); ctx.lineTo(baseX + 73, h / 2 + 4.5);
  ctx.moveTo(baseX + 73, h / 2 - 4.5); ctx.lineTo(baseX + 64, h / 2 + 4.5);
  ctx.stroke();
}

function drawSidebar(ctx, theme, state) {
  const w = GEOMETRY.sidebar;
  const top = 30;
  ctx.fillStyle = theme.sidebar;
  ctx.fillRect(0, top, w, 940 - top);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w + 0.5, top);
  ctx.lineTo(w + 0.5, 940);
  ctx.stroke();

  // Brand row: wordmark plus the search affordance.
  text(ctx, 'Pi Desktop', 16, top + 26, { font: `600 17px ${TYPE.sans}`, color: theme.text });
  icon(ctx, 'chevron', 122, top + 26, 14, theme.muted);
  icon(ctx, 'search', w - 26, top + 26, 16, theme.muted);

  let y = top + 62;
  for (const row of SIDEBAR_ROWS) {
    const icons = { 新建聊天: 'chat', 待审阅: 'inbox', 自动化: 'zap', 'Skills 与扩展': 'layers' };
    icon(ctx, icons[row.label] ?? 'circle', 24, y, 16, theme.muted);
    text(ctx, row.label, 44, y, { color: theme.text, font: `${TYPE.uiWeight} 14px ${TYPE.sans}` });
    if (row.hint) text(ctx, row.hint, w - 16, y, { color: theme.tertiary, align: 'right', font: `12px ${TYPE.sans}` });
    y += 32;
  }

  y += 18;
  text(ctx, '项目聊天', 16, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  icon(ctx, 'plus', w - 22, y, 15, theme.muted);
  y += 24;

  // Project row with a disclosure triangle.
  icon(ctx, 'chevron', 22, y, 13, theme.muted);
  icon(ctx, 'folder', 40, y, 15, theme.muted);
  text(ctx, CONVERSATION.project, 54, y, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
  text(ctx, '7', w - 16, y, { color: theme.tertiary, align: 'right', font: `12px ${TYPE.sans}` });
  y += 26;

  const activeTitle = state.view === 'home' ? '新任务' : CONVERSATION.threadTitle;
  CONVERSATION.threads.forEach((label, index) => {
    const active = label === activeTitle;
    if (active) fillRound(ctx, 8, y - 13, w - 16, 28, GEOMETRY.radiusRow, theme.selected);
    text(ctx, label, 30, y, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`, maxWidth: w - 60 });
    // Unread marker on every row except the active one.
    if (!active && index < 4) {
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(w - 20, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    y += 30;
  });

  y += 22;
  text(ctx, '最近任务', 16, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  icon(ctx, 'chevron', w - 34, y, 13, theme.muted);
  y += 24;
  CONVERSATION.threads.forEach((label) => {
    const active = label === activeTitle;
    if (active) fillRound(ctx, 8, y - 13, w - 16, 28, GEOMETRY.radiusRow, theme.selected);
    text(ctx, label, 30, y, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`, maxWidth: w - 60 });
    if (!active) {
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(w - 20, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    y += 30;
  });

  // Footer: local workspace indicator with the serif glyph.
  text(ctx, 'π', 20, 908, { font: `bold 16px ${TYPE.serif}`, color: theme.text });
  text(ctx, '本地工作区', 40, 908, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
  icon(ctx, 'circle', w - 24, 908, 15, theme.muted);
}

function drawToolbar(ctx, theme, state) {
  const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
  const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;
  const h = GEOMETRY.toolbar;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(x0, 30, right - x0, h);

  // Breadcrumb.
  text(ctx, CONVERSATION.project, x0 + 18, 30 + h / 2, { color: theme.tertiary, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  icon(ctx, 'chevron', x0 + 74, 30 + h / 2, 13, theme.tertiary);
  text(ctx, state.view === 'home' ? '新任务' : CONVERSATION.threadTitle, x0 + 94, 30 + h / 2, {
    color: theme.text, font: `500 ${TYPE.uiSmall}px ${TYPE.sans}`,
  });

  // Right-side controls: an action pill plus panel toggles.
  const pillW = 112;
  const pillX = right - 18 - pillW - 90;
  fillRound(ctx, pillX, 30 + h / 2 - 15, pillW, 30, 15, theme.surface);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  roundRect(ctx, pillX + 0.5, 30 + h / 2 - 14.5, pillW - 1, 29, 14.5);
  ctx.stroke();
  text(ctx, '项目动作', pillX + 14, 30 + h / 2, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', pillX + pillW - 16, 30 + h / 2, 13, theme.muted);

  icon(ctx, 'panel', right - 84, 30 + h / 2, 17, theme.muted);
  icon(ctx, 'list', right - 54, 30 + h / 2, 17, theme.muted);
  icon(ctx, 'dots', right - 24, 30 + h / 2, 16, theme.muted);
}

// ---------------------------------------------------------------- main views

function drawHome(ctx, theme, state) {
  const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
  const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;
  const cx = (x0 + right) / 2;

  // Serif π above the heading, matching welcome.tsx's 48px Georgia glyph.
  text(ctx, 'π', cx, 520, { font: `48px ${TYPE.serif}`, color: theme.tertiary, align: 'center' });
  text(ctx, `在 ${CONVERSATION.project} 中构建`, cx, 596, {
    font: `600 30px ${TYPE.sans}`, color: theme.text, align: 'center',
  });
  text(ctx, '从一个问题开始，让 Pi 帮你把想法变成代码。', cx, 640, {
    font: `${TYPE.uiWeight} 15px ${TYPE.sans}`, color: theme.muted, align: 'center',
  });

  // Composer with its utility bar.
  const cw = Math.min(760, right - x0 - 80);
  const cxp = cx - cw / 2;
  const cy = 790;
  const ch = 96;

  // Utility bar sits above the input, flush with its edges.
  fillRound(ctx, cxp, cy - 44, cw, 40, 12, theme.selected);
  icon(ctx, 'folder', cxp + 22, cy - 24, 15, theme.muted);
  text(ctx, CONVERSATION.project, cxp + 38, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + 38 + ctx.measureText(CONVERSATION.project).width + 10, cy - 24, 12, theme.muted);
  icon(ctx, 'panel', cxp + 158, cy - 24, 15, theme.muted);
  text(ctx, '本地', cxp + 176, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'branch', cxp + 232, cy - 24, 15, theme.muted);
  text(ctx, '新建 Worktree', cxp + 250, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  text(ctx, '任务选项', cxp + cw - 62, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + cw - 22, cy - 24, 13, theme.muted);

  // Composer body with the 22px pill radius from tokens.css.
  ctx.save();
  ctx.shadowColor = theme.shadow;
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 4;
  fillRound(ctx, cxp, cy, cw, ch, GEOMETRY.radiusComposer, theme.surface);
  ctx.restore();
  roundRect(ctx, cxp + 0.5, cy + 0.5, cw - 1, ch - 1, GEOMETRY.radiusComposer);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const typedColor = state.typed ? theme.text : theme.tertiary;
  text(ctx, state.typed || '描述任务，或提出一个问题…', cxp + 26, cy + 30, {
    color: typedColor, font: `${TYPE.uiWeight} 15px ${TYPE.sans}`,
  });

  icon(ctx, 'plus', cxp + 32, cy + 68, 17, theme.muted);
  icon(ctx, 'shield', cxp + 62, cy + 68, 16, theme.muted);
  text(ctx, '请求批准', cxp + 78, cy + 68, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + 132, cy + 68, 12, theme.muted);
  text(ctx, 'Local Test 中等', cxp + cw - 96, cy + 68, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + cw - 60, cy + 68, 12, theme.muted);
  // Send button, enabled only when there is text.
  ctx.fillStyle = state.typed ? theme.bubble : theme.selected;
  ctx.beginPath();
  ctx.arc(cxp + cw - 28, cy + 68, 16, 0, Math.PI * 2);
  ctx.fill();
  icon(ctx, 'send', cxp + cw - 28, cy + 68, 17, state.typed ? theme.bubbleText : theme.muted);
}

function drawUserBubble(ctx, theme, value, x0, right, y) {
  const maxW = Math.min(620, right - x0 - 120);
  ctx.font = `${TYPE.uiWeight} 15px ${TYPE.sans}`;
  const w = Math.min(maxW, ctx.measureText(value).width + 44);
  const x = right - 60 - w;
  fillRound(ctx, x, y, w, 46, 23, theme.bubble);
  text(ctx, value, x + 22, y + 23, { color: theme.bubbleText, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
  return y + 46;
}

function drawToolCard(ctx, theme, tool, x, y, width, open) {
  const collapsedH = 38;
  const expandedH = collapsedH + 96 * open;
  fillRound(ctx, x, y, width, collapsedH + (expandedH - collapsedH), 10, theme.surface);
  roundRect(ctx, x + 0.5, y + 0.5, width - 1, collapsedH + (expandedH - collapsedH) - 1, 10);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  text(ctx, tool.name, x + 16, y + collapsedH / 2, { font: `${TYPE.uiWeight} 13px ${TYPE.mono}`, color: theme.text });
  // Result summary sits on the right, as the real activity row does.
  text(ctx, open > 0.5 ? '已完成' : '1 次读取', x + width - 62, y + collapsedH / 2, {
    color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}`,
  });
  icon(ctx, 'chevron', x + width - 20, y + collapsedH / 2, 13, theme.muted);

  if (open > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + collapsedH, width, (expandedH - collapsedH));
    ctx.clip();
    ctx.globalAlpha = Math.min(1, open);
    fillRound(ctx, x + 10, y + collapsedH + 2, width - 20, 82, 8, theme.codeBg);
    text(ctx, `> ${tool.args}`, x + 22, y + collapsedH + 22, { font: `12.5px ${TYPE.mono}`, color: theme.muted });
    text(ctx, tool.output, x + 22, y + collapsedH + 48, { font: `12.5px ${TYPE.mono}`, color: theme.text });
    ctx.restore();
  }
  return collapsedH + (expandedH - collapsedH);
}

/**
 * The transcript as a list of blocks.
 *
 * Each block reports its own height and then draws itself at a given y. Splitting
 * it this way is what lets the column scroll: the total height is known before
 * anything is painted, so the newest block can be pinned above the composer
 * exactly as the real timeline does, instead of running off the window.
 */
function transcriptBlocks(x0, right, contentW, state) {
  const blocks = [];

  blocks.push({
    height: 80,
    draw(ctx, theme, y) {
      drawUserBubble(ctx, theme, CONVERSATION.userTurns[0], x0, right, y);
    },
  });

  if (state.revealUser > 0.15) {
    blocks.push({
      height: state.thinkingShown ? 118 : 92,
      draw(ctx, theme, y) {
        text(ctx, '处理过程', x0 + 60, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
        icon(ctx, 'chevron', x0 + 122, y, 13, theme.muted);
        text(ctx, '思考过程', x0 + 70, y + 30, { color: theme.text, font: `500 ${TYPE.uiSmall}px ${TYPE.sans}` });
        if (state.thinkingShown) {
          text(ctx, CONVERSATION.thinking, x0 + 70, y + 54, {
            color: theme.muted, font: `${TYPE.uiWeight} ${TYPE.uiSmall}px ${TYPE.sans}`,
          });
        }
      },
    });
  }

  if (state.revealUser > 0.22) {
    blocks.push({
      height: 38 + 96 * state.toolOpen + 24,
      draw(ctx, theme, y) {
        drawToolCard(ctx, theme, CONVERSATION.tools[0], x0 + 60, y, contentW, state.toolOpen);
      },
    });
  }

  if (state.revealUser > 0.35) {
    blocks.push({
      height: 42,
      draw(ctx, theme, y) {
        text(ctx, CONVERSATION.assistantTurns[0], x0 + 60, y, {
          color: theme.text, font: `${TYPE.uiWeight} 15px ${TYPE.sans}`,
        });
      },
    });
  }

  if (state.revealUser > 0.5) {
    blocks.push({
      height: 72,
      draw(ctx, theme, y) {
        // Compression notice: a bordered pill, not a bubble.
        const nw = 470;
        fillRound(ctx, x0 + 60, y, nw, 46, 12, theme.surface);
        roundRect(ctx, x0 + 60.5, y + 0.5, nw - 1, 45, 12);
        ctx.strokeStyle = theme.border;
        ctx.stroke();
        icon(ctx, 'circle', x0 + 88, y + 23, 16, theme.muted);
        text(ctx, CONVERSATION.notice, x0 + 108, y + 23, {
          color: theme.muted, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`,
        });
      },
    });
  }

  if (state.revealUser > 0.62) {
    blocks.push({
      height: 82,
      draw(ctx, theme, y) {
        drawUserBubble(ctx, theme, CONVERSATION.userTurns[1], x0, right, y);
      },
    });
  }

  if (state.revealUser > 0.78) {
    blocks.push({
      height: 36,
      draw(ctx, theme, y) {
        text(ctx, '处理过程 1 个操作', x0 + 60, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
        icon(ctx, 'chevron', x0 + 172, y, 13, theme.muted);
      },
    });
  }

  if (state.revealUser > 0.85 && (state.streamText || state.revealUser > 0.9)) {
    const body = state.streamText || CONVERSATION.assistantTurns[1];
    blocks.push({
      height: 150,
      draw(ctx, theme, y) {
        markdown(ctx, body, x0 + 60, y + 6, contentW, theme, 27, 15);
      },
    });
  }

  return blocks;
}

function drawWorkbench(ctx, theme, state) {
  const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
  const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;

  const top = 72;
  const bottom = 782; // above the pinned plan strip and composer
  const blocks = transcriptBlocks(x0, right, Math.min(700, right - x0 - 120), state);

  // Lay the blocks out, then scroll so the newest content sits just above the
  // composer. Negative offset would mean the content is shorter than the pane,
  // so it stays top-aligned instead.
  const gap = 26;
  let cursor = 0;
  const placed = blocks.map((block) => {
    const item = { block, y: cursor };
    cursor += block.height + gap;
    return item;
  });
  const total = Math.max(0, cursor - gap);
  const available = bottom - top;
  const scroll = Math.max(0, total - available);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 30, right - x0, 940 - 30);
  ctx.clip();
  for (const item of placed) {
    const y = top + item.y - scroll;
    // Skip blocks entirely outside the pane, and skip anything that would still
    // be sliding in, so nothing is half-drawn at the top edge.
    if (y + item.block.height < top - 4 || y > bottom + 4) continue;
    item.block.draw(ctx, theme, y);
  }
  ctx.restore();

  // Plan strip: pinned above the composer, not part of the scroll.
  if (state.revealUser > 0.95) {
    const contentW = Math.min(700, right - x0 - 120);
    const pw = contentW;
    const py = 794;
    fillRound(ctx, x0 + 60, py, pw, 40, 10, theme.surface);
    roundRect(ctx, x0 + 60.5, py + 0.5, pw - 1, 39, 10);
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    icon(ctx, 'list', x0 + 84, py + 20, 15, theme.muted);
    text(ctx, '计划 · 1/2 · 补充安装步骤', x0 + 104, py + 20, {
      color: theme.muted, font: `${TYPE.uiWeight} 13px ${TYPE.sans}`,
    });
  }

  drawComposer(ctx, theme, state, x0, right);
}

function drawComposer(ctx, theme, state, x0, right) {
  const cw = Math.min(760, right - x0 - 80);
  const cxp = (x0 + right) / 2 - cw / 2;
  const cy = 812;
  const ch = 88;

  ctx.save();
  ctx.shadowColor = theme.shadow;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 3;
  fillRound(ctx, cxp, cy, cw, ch, GEOMETRY.radiusComposer, theme.surface);
  ctx.restore();
  roundRect(ctx, cxp + 0.5, cy + 0.5, cw - 1, ch - 1, GEOMETRY.radiusComposer);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const placeholder = state.typed ? '' : '描述任务，或提出一个问题…';
  text(ctx, placeholder, cxp + 26, cy + 30, { color: theme.tertiary, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
  if (state.typed) {
    text(ctx, state.typed, cxp + 26, cy + 30, { color: theme.text, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
    // Caret pulses on a 1s cycle.
    const caretX = cxp + 26 + ctx.measureText(state.typed).width + 2;
    if (state.caretOn !== false) {
      ctx.fillStyle = theme.text;
      ctx.fillRect(caretX, cy + 20, 1.6, 20);
    }
  }

  icon(ctx, 'plus', cxp + 32, cy + 64, 17, theme.muted);
  icon(ctx, 'shield', cxp + 62, cy + 64, 16, theme.muted);
  text(ctx, '请求批准', cxp + 78, cy + 64, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + 132, cy + 64, 12, theme.muted);
  text(ctx, 'Local Test 中等', cxp + cw - 96, cy + 64, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + cw - 60, cy + 64, 12, theme.muted);
  ctx.fillStyle = state.typed ? theme.bubble : theme.selected;
  ctx.beginPath();
  ctx.arc(cxp + cw - 28, cy + 64, 16, 0, Math.PI * 2);
  ctx.fill();
  icon(ctx, 'send', cxp + cw - 28, cy + 64, 17, state.typed ? theme.bubbleText : theme.muted);
}

function drawReviewPane(ctx, theme, state) {
  const x0 = 1440 - GEOMETRY.review;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(x0, 30, GEOMETRY.review, 940 - 30);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, 30);
  ctx.lineTo(x0 + 0.5, 940);
  ctx.stroke();

  const pad = 18;
  const cxp = x0 + pad;
  const cw = GEOMETRY.review - pad * 2;

  // Summary card: project, branch, diff counters.
  const cardH = 150;
  fillRound(ctx, cxp, 54, cw, cardH, 14, theme.surface);
  roundRect(ctx, cxp + 0.5, 54.5, cw - 1, cardH - 1, 14);
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  text(ctx, CONVERSATION.project, cxp + 18, 78, { color: theme.text, font: `500 14px ${TYPE.sans}` });
  icon(ctx, 'dots', cxp + cw - 22, 78, 15, theme.muted);
  icon(ctx, 'branch', cxp + 26, 106, 15, theme.muted);
  text(ctx, 'main', cxp + 42, 106, { color: theme.text, font: `600 14px ${TYPE.sans}` });
  text(ctx, '+7', cxp + cw - 62, 106, { color: theme.success, font: `600 13.5px ${TYPE.sans}`, align: 'right' });
  text(ctx, '-0', cxp + cw - 20, 106, { color: theme.danger, font: `600 13.5px ${TYPE.sans}`, align: 'right' });

  text(ctx, '来源', cxp + 18, 138, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '暂无外部来源', cxp + 18, 162, { color: theme.tertiary, font: `${TYPE.uiWeight} ${TYPE.uiSmall}px ${TYPE.sans}` });
  icon(ctx, 'chevron', cxp + cw - 22, 162, 13, theme.muted);

  // Review suggestion button.
  fillRound(ctx, cxp + 18, 184, 108, 28, 14, theme.selected);
  text(ctx, '建议审查改动', cxp + 72, 198, { color: theme.text, font: `${TYPE.uiWeight} 12.5px ${TYPE.sans}`, align: 'center' });

  // Tabs: 变更 / 文件 / 计划.
  let ty = 250;
  const tabs = [
    { id: 'changes', label: '变更' },
    { id: 'files', label: '文件' },
    { id: 'plan', label: '计划' },
  ];
  let tx = cxp;
  for (const tab of tabs) {
    const active = state.reviewTab === tab.id;
    ctx.font = `${TYPE.uiWeight} 13.5px ${TYPE.sans}`;
    const tw = ctx.measureText(tab.label).width + 20;
    if (active) fillRound(ctx, tx, ty - 14, tw, 28, 8, theme.selected);
    text(ctx, tab.label, tx + tw / 2, ty, {
      color: active ? theme.text : theme.muted, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`, align: 'center',
    });
    tx += tw + 6;
  }
  ty += 32;
  if (state.reviewTab === 'plan') {
    CONVERSATION.plan.forEach((step, index) => {
      const done = step.status === 'completed' || (index === 1 && state.planProgress > 0.5);
      icon(ctx, done ? 'check' : 'dot', cxp + 12, ty, 15, done ? theme.accent : theme.muted);
      text(ctx, step.text, cxp + 32, ty, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
      ty += 30;
    });
  } else {
    // Changed-file list with per-file counters.
    const files = [
      { name: 'README.md', adds: 7, dels: 0, selected: state.diffOpen > 0.2 },
      { name: 'hello.txt', adds: 1, dels: 0, selected: !state.diffOpen },
    ];
    for (const file of files) {
      if (file.selected) fillRound(ctx, cxp - 6, ty - 15, cw + 12, 34, 8, theme.selected);
      text(ctx, file.name, cxp + 6, ty, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
      text(ctx, `+${file.adds}`, cxp + cw - 48, ty, { color: theme.success, font: `600 12.5px ${TYPE.sans}`, align: 'right' });
      text(ctx, `-${file.dels}`, cxp + cw - 8, ty, { color: theme.danger, font: `600 12.5px ${TYPE.sans}`, align: 'right' });
      ty += 38;
    }

    if (state.diffOpen > 0.01) {
      const dh = 300 * state.diffOpen;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cxp, ty, cw, dh);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, state.diffOpen);

      fillRound(ctx, cxp, ty, cw, dh, 10, theme.surface);
      roundRect(ctx, cxp + 0.5, ty + 0.5, cw - 1, dh - 1, 10);
      ctx.strokeStyle = theme.border;
      ctx.stroke();

      let dy = ty + 26;
      const rows = [
        { n: 1, t: ' # 示例项目', kind: 'ctx' },
        { n: 2, t: '', kind: 'ctx' },
        { n: 3, t: ' 一个用于演示的本地项目。', kind: 'ctx' },
        { n: 4, t: '', kind: 'ctx' },
        { n: 5, t: '+', kind: 'add', t2: '## 安装' },
        { n: 6, t: '+', kind: 'add', t2: '' },
        { n: 7, t: '+', kind: 'add', t2: '```bash' },
        { n: 8, t: '+', kind: 'add', t2: 'npm install' },
        { n: 9, t: '+', kind: 'add', t2: 'npm run dev' },
        { n: 10, t: '+', kind: 'add', t2: '```' },
      ];
      for (const row of rows) {
        const isAdd = row.kind === 'add';
        if (isAdd) {
          ctx.fillStyle = theme.diffAdded;
          ctx.fillRect(cxp + 1, dy - 9, cw - 2, 20);
        }
        text(ctx, String(row.n), cxp + 12, dy, { color: theme.tertiary, font: `11.5px ${TYPE.mono}` });
        if (isAdd) {
          text(ctx, '+', cxp + 34, dy, { color: theme.success, font: `11.5px ${TYPE.mono}` });
          text(ctx, row.t2, cxp + 48, dy, { color: theme.text, font: `11.5px ${TYPE.mono}` });
        } else {
          text(ctx, row.t, cxp + 48, dy, { color: theme.muted, font: `11.5px ${TYPE.mono}` });
        }
        dy += 24;
      }
      ctx.restore();
    }
  }
}

function drawSettings(ctx, theme, state) {
  const top = 30;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, top, 1440, 940 - top);

  // Settings has its own sidebar with grouped sections.
  ctx.fillStyle = theme.sidebar;
  ctx.fillRect(0, top, 380, 940 - top);
  text(ctx, '← 返回工作台', 28, top + 34, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
  fillRound(ctx, 20, top + 60, 340, 34, 10, theme.surface);
  icon(ctx, 'search', 42, top + 77, 15, theme.muted);
  text(ctx, '搜索设置', 62, top + 77, { color: theme.tertiary, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });

  const groups = [
    { title: '个人', items: ['通用', '外观', '键盘快捷键', '跨会话记忆', '离线语音'], icons: ['settings', 'circle', 'list', 'circle', 'circle'] },
    { title: '集成', items: ['MCP', '浏览器连接'], icons: ['circle', 'circle'] },
    { title: '编码', items: ['模型', '审批与信任'], icons: ['layers', 'shield'] },
  ];
  let sy = top + 124;
  for (const group of groups) {
    text(ctx, group.title, 28, sy, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    sy += 26;
    group.items.forEach((item, index) => {
      const active = item === '模型';
      if (active) fillRound(ctx, 14, sy - 15, 352, 30, 8, theme.selected);
      icon(ctx, group.icons[index], 34, sy, 15, theme.muted);
      text(ctx, item, 56, sy, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
      sy += 32;
    });
    sy += 14;
  }

  // Main pane: model settings, matching the captured layout.
  const mx = 460;
  text(ctx, '模型', mx, 106, { font: `600 22px ${TYPE.sans}`, color: theme.text });
  text(ctx, '管理模型连接、凭据和能力，供任务选择。', mx, 140, { color: theme.muted, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });

  // Provider list column.
  text(ctx, '提供商', mx, 182, { font: `500 14px ${TYPE.sans}`, color: theme.text });
  text(ctx, '1 个连接', mx, 208, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '1', 862, 182, { color: theme.muted, align: 'right', font: `${TYPE.uiSmall}px ${TYPE.sans}` });

  fillRound(ctx, mx, 232, 300, 68, 12, theme.surface);
  roundRect(ctx, mx + 0.5, 232.5, 299, 67, 12);
  ctx.strokeStyle = theme.borderStrong;
  ctx.stroke();
  text(ctx, 'Local Test', mx + 16, 256, { color: theme.text, font: `500 14px ${TYPE.sans}` });
  text(ctx, '自定义接口 · 1 个模型', mx + 16, 278, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, '当前默认', mx + 284, 256, { color: theme.muted, align: 'right', font: `12px ${TYPE.sans}` });

  fillRound(ctx, mx, 316, 300, 32, 10, theme.surface);
  roundRect(ctx, mx + 0.5, 316.5, 299, 31, 10);
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  text(ctx, '+ 添加提供商', mx + 150, 332, { color: theme.text, align: 'center', font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });

  // Detail column.
  const dx = 900;
  text(ctx, '自定义接口', dx, 208, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
  text(ctx, 'Local Test', dx, 234, { font: `600 20px ${TYPE.sans}`, color: theme.text });
  text(ctx, 'http://127.0.0.1:9/v1 · 1 个模型', dx, 260, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });

  text(ctx, '连接与凭据', dx, 300, { font: `500 14px ${TYPE.sans}`, color: theme.text });
  const fields = [
    ['显示名称', 'Local Test'],
    ['API 协议', 'OpenAI 兼容（Chat Completion）'],
    ['Base URL', 'http://127.0.0.1:9/v1'],
    ['API Key', '输入 API Key'],
  ];
  let fy = 330;
  for (const [label, value] of fields) {
    text(ctx, label, dx, fy + 16, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
    fillRound(ctx, dx + 180, fy, 340, 34, 10, theme.surface);
    roundRect(ctx, dx + 180.5, fy + 0.5, 339, 33, 10);
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    text(ctx, value, dx + 194, fy + 17, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    fy += 56;
  }
}

function drawTerminal(ctx, theme, state) {
  // The terminal occupies the review pane, as the real Ctrl+J does.
  const x0 = 1440 - GEOMETRY.review;
  ctx.fillStyle = 'rgb(24,24,24)';
  ctx.fillRect(x0, 30, GEOMETRY.review, 940 - 30);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, 30);
  ctx.lineTo(x0 + 0.5, 940);
  ctx.stroke();

  const lines = [
    { t: 'PS E:\\示例项目> git status', c: 'rgb(223,223,223)' },
    { t: 'On branch main', c: 'rgb(223,223,223)' },
    { t: 'Changes not staged for commit:', c: 'rgb(223,223,223)' },
    { t: '        modified:   README.md', c: 'rgb(250,66,62)' },
    { t: 'Untracked files:', c: 'rgb(223,223,223)' },
    { t: '        hello.txt', c: 'rgb(64,201,119)' },
    { t: 'PS E:\\示例项目> _', c: 'rgb(223,223,223)' },
  ];
  let ty = 66;
  lines.slice(0, state.terminalLines).forEach((line) => {
    text(ctx, line.t, x0 + 18, ty, { font: `12.5px ${TYPE.mono}`, color: line.c });
    ty += 22;
  });
}

function drawPalette(ctx, theme, state) {
  // Dim the app behind the palette.
  ctx.fillStyle = theme.isDark ? 'rgba(0,0,0,.5)' : 'rgba(26,28,31,.18)';
  ctx.fillRect(0, 30, 1440, 940 - 30);

  const w = 620;
  const x = (1440 - w) / 2;
  const y = 140;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.32)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 16;
  fillRound(ctx, x, y, w, 60, 16, theme.surface);
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, 59, 16);
  ctx.strokeStyle = theme.borderStrong;
  ctx.stroke();

  icon(ctx, 'search', x + 30, y + 30, 17, theme.muted);
  text(ctx, state.paletteQuery || '搜索命令或最近任务', x + 52, y + 30, {
    color: state.paletteQuery ? theme.text : theme.tertiary,
    font: `${TYPE.uiWeight} 15px ${TYPE.sans}`,
  });

  const results = [
    { label: '新建任务', keys: 'Ctrl N', icon: 'chat' },
    { label: '搜索任务', keys: 'Ctrl K', icon: 'search' },
    { label: '打开设置', keys: 'Ctrl ,', icon: 'settings' },
    { label: '切换集成终端', keys: 'Ctrl J', icon: 'list' },
    { label: '命令面板', keys: 'Ctrl Shift P', icon: 'layers' },
  ];
  const lh = 46;
  const listH = results.length * lh + 16;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  fillRound(ctx, x, y + 68, w, listH, 16, theme.surface);
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 68.5, w - 1, listH - 1, 16);
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  results.forEach((result, index) => {
    const ry = y + 84 + index * lh;
    if (index === 0) fillRound(ctx, x + 8, ry, w - 16, 40, 10, theme.hover);
    icon(ctx, result.icon, x + 30, ry + 20, 16, theme.muted);
    text(ctx, result.label, x + 52, ry + 20, { color: theme.text, font: `${TYPE.uiWeight} 14px ${TYPE.sans}` });
    text(ctx, result.keys, x + w - 24, ry + 20, { color: theme.tertiary, align: 'right', font: `12px ${TYPE.sans}` });
  });
}

// ---------------------------------------------------------------- entry point

/**
 * Draw the whole window into ctx. `state` is a plain object from initialState()
 * with whatever the current scene has changed, and `theme` is LIGHT or DARK.
 */
export function drawApp(ctx, theme, state) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, 1440, 940);

  if (state.view === 'settings') {
    drawTitlebar(ctx, theme, state);
    drawSettings(ctx, theme, state);
    return;
  }

  if (state.sidebarOpen) drawSidebar(ctx, theme, state);
  drawToolbar(ctx, theme, state);

  if (state.view === 'home') drawHome(ctx, theme, state);
  else drawWorkbench(ctx, theme, state);

  if (state.view === 'terminal') drawTerminal(ctx, theme, state);
  else if (state.reviewOpen) drawReviewPane(ctx, theme, state);

  if (state.view === 'palette') drawPalette(ctx, theme, state);

  drawTitlebar(ctx, theme, state);
}

/** Convenience for scenes that need to know the light/dark blend. */
export { mixColor };
