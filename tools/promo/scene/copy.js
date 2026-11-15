/*
 * Every word that appears in the video.
 *
 * Kept in one file so a different language or a different tagline is a one-file
 * change. The Chinese matches the shipping UI's own strings (welcome.tsx), so
 * the video says what the product says.
 */
export const COPY = {
  product: 'Pi Desktop',
  tagline: '把想法变成代码',
  subtitle: '面向 Windows 的本地编码工作台',
  endCard: 'pi.dev',
  // Lower-third captions, each starting just after its scene cuts in (timeline.js).
  captions: [
    { time: 28.5, text: '真实改动，逐行可查' },
    { time: 31.7, text: '计划与产物，全程可见' },
    { time: 34.6, text: '内置终端' },
    { time: 38.0, text: '命令面板' },
    { time: 42.9, text: '模型与凭据，随你配置' },
    { time: 47.7, text: '浅色与深色' },
  ],
};
