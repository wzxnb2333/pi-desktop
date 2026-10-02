import { tr } from "../../../shared/localization.ts";
import type { TimelineItem } from '../../../shared/contracts.ts';
import { itemSearchTexts, literalMatches } from '../../../shared/conversation-search.ts';
import { activity } from './activity.ts';
import { groupTurns, turnBlocks } from './timeline-groups.ts';

export { itemSearchTexts, literalMatches };

export interface ConversationSource {
  key: string;
  turnKey: string;
  target: string;
  label: string;
  text: string;
  folds: string[];
}

export interface ConversationMatch extends ConversationSource {
  start: number;
  end: number;
  occurrence: number;
}

/** The rendered block and field identify a target even when one message has several text blocks. */
export function conversationTarget(block: string, field: string): string {
  return JSON.stringify([block, field]);
}

export function conversationSources(items: TimelineItem[], running: boolean): ConversationSource[] {
  const sources: ConversationSource[] = [];
  for (const turn of groupTurns(items, running)) {
    const add = (block: string, field: string, text: string | undefined, label: string, folds: string[]) => {
      if (!text) return;
      const target = conversationTarget(block, field);
      sources.push({ key: JSON.stringify([turn.key, target]), turnKey: turn.key, target, text, label, folds });
    };
    if (turn.user) {
      const user = turn.user;
      add(user.id, 'text', user.input?.text ?? user.text, tr("你"), []);
      user.input?.parts.forEach((part, index) => add(user.id, 'input:' + index, user.text.slice(part.start, part.end), part.label, ['input:' + user.id + ':' + index]));
    }
    const blocks = turnBlocks(turn);
    const answerIndex = blocks.findIndex(block => block.kind === 'answer');
    blocks.forEach((block, index) => {
      const process = answerIndex < 0 || index < answerIndex ? ['process:' + turn.key] : [];
      if (block.kind === 'thinking') {
        add(block.key, 'thinking', block.text, tr("思考过程"), [...process, 'thinking:' + block.key]);
      } else if (block.kind === 'activity') {
        for (const item of block.tools) {
          const info = activity(item);
          const folds = [...process, 'group:' + block.key, 'tool:' + item.id];
          const raw = info.kind === 'command' || info.kind === 'tool' ? folds : [...folds, 'raw:' + item.id];
          add(item.id, 'args', item.args, info.label + tr(" · 参数"), raw);
          add(item.id, 'output', item.text, info.label + tr(" · 输出"), raw);
          if (info.kind === 'edit') add(item.id, 'diff', item.details?.diff, info.label + tr(" · 差异"), folds);
        }
      } else {
        for (const item of block.items) add(block.key, 'text:' + item.id, item.text, block.kind === 'notice' ? tr("通知") : block.kind === 'answer' ? tr("最终回复") : tr("过程说明"), process);
      }
    });
  }
  return sources;
}

export function findConversation(sources: ConversationSource[], query: string, limit = 200, offset = 0): { matches: ConversationMatch[]; total: number } {
  const needle = query.trim();
  const matches: ConversationMatch[] = [];
  let total = 0;
  if (!needle) return { matches, total };
  for (const source of sources) {
    let occurrence = 0;
    for (const match of literalMatches(source.text, needle)) {
      if (total >= offset && matches.length < limit) matches.push({ ...source, key: source.key + ':' + match.index, start: match.index!, end: match.index! + match[0].length, occurrence });
      occurrence++;
      total++;
    }
  }
  return { matches, total };
}
