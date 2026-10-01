import { z } from 'zod';

export const browserUrlSchema = z.url().refine(value => { if (!URL.canParse(value)) return false; const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }, '请输入不含用户名和密码的 HTTP 或 HTTPS 地址');
export const browserOriginSchema = browserUrlSchema.refine(value => URL.canParse(value) && new URL(value).origin === value, '请使用完整的网站来源地址，不包含路径');
export const browserSitePoliciesSchema = z.record(browserOriginSchema, z.enum(['allow', 'deny']));
export function browserSiteOrigin(raw: string): string {
  const parsed = browserUrlSchema.safeParse(raw.trim());
  if (!parsed.success) throw new Error('请输入不含用户名和密码的 HTTP 或 HTTPS 地址');
  const url = new URL(parsed.data);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('请使用完整的网站来源地址，不包含路径');
  return url.origin;
}
export const browserToolSchema = z.object({
  action: z.enum(['tabs', 'navigate', 'inspect', 'click', 'type', 'scroll', 'wait', 'screenshot', 'close']),
  tabId: z.string().min(1).max(200).optional(), url: browserUrlSchema.optional(),
  ref: z.string().min(1).max(200).optional(), text: z.string().max(20000).optional(),
  direction: z.enum(['up', 'down']).optional(), milliseconds: z.number().int().min(1).max(10000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action !== 'tabs' && value.action !== 'navigate' && !value.tabId) context.addIssue({ code: 'custom', message: '请指定浏览器标签' });
  if (value.action === 'navigate' && !value.url) context.addIssue({ code: 'custom', message: '请指定网页地址' });
  if (['click', 'type'].includes(value.action) && !value.ref) context.addIssue({ code: 'custom', message: '请先检查页面并使用元素引用' });
  if (value.action === 'type' && value.text === undefined) context.addIssue({ code: 'custom', message: '请提供输入内容' });
});
export type BrowserToolRequest = z.infer<typeof browserToolSchema>;
