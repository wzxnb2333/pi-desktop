import { ArrowUp, ChevronDown, ChevronRight, PanelBottom, PanelLeft, PanelRight, Paperclip, Plus, Square } from 'lucide-react';

const icons = { sidebar: PanelLeft, review: PanelRight, plus: Plus, send: ArrowUp, stop: Square, down: ChevronDown, right: ChevronRight, terminal: PanelBottom, attachment: Paperclip };

/** Pi glyph adaptations in the measured 26.915 slots; no verified old SVG paths are available. */
export function ReferenceIcon({ name, size = 20 }: { name: keyof typeof icons; size?: number }) {
  const Icon = icons[name];
  return <Icon width={size} height={size} strokeWidth={1.5} fill={name === 'stop' ? 'currentColor' : 'none'} aria-hidden="true" data-reference-icon={name} data-icon-origin="pi-adaptation" />;
}
