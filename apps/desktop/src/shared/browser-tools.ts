import { z } from 'zod';

export const browserUrlSchema = z.url().refine(value => { if (!URL.canParse(value)) return false; const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }, '请输入不含用户名和密码的 HTTP 或 HTTPS 地址');
export const browserOriginSchema = browserUrlSchema.refine(value => URL.canParse(value) && new URL(value).origin === value, '请使用完整的网站来源地址，不包含路径');
export const browserSitePoliciesSchema = z.record(browserOriginSchema, z.enum(['allow', 'deny']));
export const browserBackendSchema = z.enum(['in-app', 'chrome']);
export const browserPointSchema = z.object({ x: z.number().finite().min(0).max(100000), y: z.number().finite().min(0).max(100000) }).strict();
export const browserLocatorSchema = z.object({
  role: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(500).optional(),
  text: z.string().trim().min(1).max(500).optional(),
  placeholder: z.string().trim().min(1).max(500).optional(),
}).strict().refine(value => Object.values(value).some(Boolean), '请提供可用的页面元素定位');
export const browserTargetSchema = z.object({
  ref: z.string().min(1).max(200).optional(),
  locator: browserLocatorSchema.optional(),
  x: z.number().finite().min(0).max(100000).optional(),
  y: z.number().finite().min(0).max(100000).optional(),
}).strict().superRefine((value, context) => {
  const hasSemanticTarget = Boolean(value.ref || value.locator);
  const hasPoint = value.x !== undefined && value.y !== undefined;
  if (!hasSemanticTarget && !hasPoint) context.addIssue({ code: 'custom', message: '拖拽终点需要元素引用、定位条件或完整坐标' });
  if ((value.x === undefined) !== (value.y === undefined)) context.addIssue({ code: 'custom', message: '拖拽终点坐标必须同时提供 x 和 y' });
});
export const browserWaitConditionSchema = z.object({
  kind: z.enum(['url', 'text', 'role', 'ref', 'load']),
  value: z.string().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind !== 'load' && !value.value) context.addIssue({ code: 'custom', message: '等待条件需要提供值' });
});
export function browserSiteOrigin(raw: string): string {
  const parsed = browserUrlSchema.safeParse(raw.trim());
  if (!parsed.success) throw new Error('请输入不含用户名和密码的 HTTP 或 HTTPS 地址');
  const url = new URL(parsed.data);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('请使用完整的网站来源地址，不包含路径');
  return url.origin;
}
export const browserToolSchema = z.object({
  backend: browserBackendSchema.optional(),
  action: z.enum(['tabs', 'open', 'navigate', 'inspect', 'click', 'type', 'key', 'hover', 'drag', 'scroll', 'wait', 'screenshot', 'close']),
  tabId: z.string().min(1).max(200).optional(), url: browserUrlSchema.optional(),
  ref: z.string().min(1).max(200).optional(), observationRevision: z.string().min(1).max(200).optional(), locator: browserLocatorSchema.optional(),
  x: z.number().finite().min(0).max(100000).optional(), y: z.number().finite().min(0).max(100000).optional(),
  target: browserTargetSchema.optional(),
  text: z.string().max(20000).optional(), append: z.boolean().optional(),
  key: z.string().min(1).max(100).optional(), keys: z.array(z.string().min(1).max(100)).max(20).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(), amount: z.number().finite().min(1).max(100000).optional(),
  milliseconds: z.number().int().min(1).max(10000).optional(), condition: browserWaitConditionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!['tabs', 'open', 'navigate'].includes(value.action) && !value.tabId) context.addIssue({ code: 'custom', message: '请指定浏览器标签' });
  if (['open', 'navigate'].includes(value.action) && !value.url) context.addIssue({ code: 'custom', message: '请指定网页地址' });
  if (value.action === 'click' && !value.ref && !value.locator && (value.x === undefined || value.y === undefined)) context.addIssue({ code: 'custom', message: '请提供元素引用、定位条件或坐标' });
  if (['type', 'hover'].includes(value.action) && !value.ref && !value.locator && (value.x === undefined || value.y === undefined)) context.addIssue({ code: 'custom', message: '请提供元素引用、定位条件或坐标' });
  if (value.action === 'type' && value.text === undefined) context.addIssue({ code: 'custom', message: '请提供输入内容' });
  if (value.action === 'key' && !(value.key || value.keys?.length)) context.addIssue({ code: 'custom', message: '请提供键盘按键' });
  if (value.action === 'drag' && !value.ref && !value.locator && (value.x === undefined || value.y === undefined)) context.addIssue({ code: 'custom', message: '请提供拖拽起点' });
  if (value.action === 'drag' && !value.target) context.addIssue({ code: 'custom', message: '请提供拖拽终点' });
  if (value.action === 'wait' && !value.condition && value.milliseconds === undefined) context.addIssue({ code: 'custom', message: '请提供等待条件或时长' });
  if (value.action === 'scroll' && !value.direction) context.addIssue({ code: 'custom', message: '请提供滚动方向' });
});
export type BrowserToolRequest = z.infer<typeof browserToolSchema>;
