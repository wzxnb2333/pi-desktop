import { z } from 'zod';
import { browserUrlSchema } from './browser-tools.ts';

export const browserHistoryEntrySchema = z.object({ id: z.uuid(), url: browserUrlSchema.max(8192), title: z.string().max(2000), visitedAt: z.number().nonnegative() }).strict();
export const browserHistorySchema = z.object({ version: z.literal(1), entries: z.array(browserHistoryEntrySchema).max(10000) }).strict();
export const browserDataRangeSchema = z.enum(['hour', 'day', 'week', 'all']);
export const browserClearSchema = z.object({ range: browserDataRangeSchema, history: z.boolean(), siteData: z.boolean(), cache: z.boolean() }).strict().refine(value => value.history || value.siteData || value.cache, '请至少选择一种浏览数据');
export type BrowserHistoryEntry = z.infer<typeof browserHistoryEntrySchema>;
export type BrowserDataRange = z.infer<typeof browserDataRangeSchema>;
export type BrowserClearOptions = z.infer<typeof browserClearSchema>;
export interface BrowserHistoryPage { entries: BrowserHistoryEntry[]; total: number; error?: string; }
export function historyRangeStart(range: BrowserDataRange, now: number): number { return range === 'all' ? 0 : Math.max(0, now - ({ hour: 3600000, day: 86400000, week: 604800000 })[range]); }
