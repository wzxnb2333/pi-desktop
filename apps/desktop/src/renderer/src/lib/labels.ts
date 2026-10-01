import { tr } from "../../../shared/localization.ts";
export const statusText: Record<string, string> = {
  get idle() { return tr("就绪"); },
  get running() { return tr("正在运行"); },
  get waiting() { return tr("等待确认"); },
  get error() { return tr("运行出错"); },
  get interrupted() { return tr("已中断"); },
};

export const thinkingLabels: Record<string, string> = {
  get off() { return tr("关闭思考"); },
  get minimal() { return tr("极低"); },
  get low() { return tr("低"); },
  get medium() { return tr("中等"); },
  get high() { return tr("高"); },
  get xhigh() { return tr("极高"); },
  get max() { return tr("最高"); },
};

export const policyLabels: Record<string, string> = {
  get ask() { return tr("请求批准"); },
  get auto() { return tr("替我批准"); },
  get full() { return tr("完全访问"); },
  get deny() { return tr("只读模式"); },
};

export const permissionModes = ['ask', 'auto', 'full'] as const;
export const policyDescriptions = {
  get ask() { return tr('沙箱内执行；修改文件和运行命令前请求批准。'); },
  get auto() { return tr('独立 LLM 审查操作；低风险自动批准，危险或无法判断时由你批准。'); },
  get full() { return tr('以本机用户权限执行，可访问项目外文件和网络。'); },
  get deny() { return tr('只读会话；禁止修改文件和运行命令。'); },
};

export const reviewTabs: { id: 'changes' | 'files' | 'browser' | 'review'; name: string }[] = [
  { id: 'changes', get name() { return tr("变更"); } },
  { id: 'files', get name() { return tr("文件"); } },
  { id: 'browser', get name() { return tr("浏览器"); } },
  { id: 'review', get name() { return tr('审查'); } },
];

export const filename = (path: string) => path.split(/[\\/]/).at(-1);
