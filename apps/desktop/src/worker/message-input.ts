import { createHash } from 'node:crypto';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { MessageInput } from '../shared/message-input.ts';

export function inputSignature(text: string, images: readonly ImageContent[]): string {
  const hash = createHash('sha256').update(JSON.stringify(text));
  for (const image of images) hash.update(JSON.stringify([image.mimeType, image.data]));
  return hash.digest('hex');
}

/** Match actual emitted content, including image bytes, without guessing after extension transforms. */
export class PendingMessageInputs {
  private pending = new Map<string, { signature: string; input: MessageInput }>();
  set(id: string, prompt: string, images: readonly ImageContent[], input: MessageInput): void {
    this.pending.set(id, { signature: inputSignature(prompt, images), input });
  }
  delete(id: string): void { this.pending.delete(id); }
  order(ids: string[]): void {
    const wanted = new Set(ids);
    this.pending = new Map([...this.pending].filter(([id]) => !wanted.has(id)).concat(ids.flatMap(id => { const value = this.pending.get(id); return value ? [[id, value] as const] : []; })));
  }
  take(message: unknown): MessageInput | undefined {
    if (!message || typeof message !== 'object' || !('role' in message) || message.role !== 'user' || !('content' in message)) return;
    const parts = message.content;
    let text = '', images: ImageContent[] = [];
    if (typeof parts === 'string') text = parts;
    else if (Array.isArray(parts)) {
      const texts: string[] = [];
      for (const part of parts as unknown[]) {
        if (!part || typeof part !== 'object' || !('type' in part)) continue;
        if (part.type === 'text' && 'text' in part && typeof part.text === 'string') texts.push(part.text);
        else if (part.type === 'image' && 'data' in part && 'mimeType' in part && typeof part.data === 'string' && typeof part.mimeType === 'string') images.push({ type: 'image', data: part.data, mimeType: part.mimeType });
      }
      text = texts.join('\n');
    } else return;
    const signature = inputSignature(text, images);
    const entry = [...this.pending].find(([, value]) => value.signature === signature);
    if (!entry) return;
    this.pending.delete(entry[0]);
    return entry[1].input;
  }
}
