import { useLocale } from "../../hooks/use-locale.ts";
import { clampLayout, type ResizeKey, resizeStep } from '../../lib/layout.ts';

export interface ResizerProps {
  label: string;
  axis: 'horizontal' | 'vertical';
  keyName: ResizeKey;
  value: number;
  invert?: boolean;
  overlayOffset?: number;
  onDrag(value: number): void;
  onCommit(value: number): void;
}

/**
 * Dragging keeps a local value so the panel tracks the pointer; the persisted write happens once on
 * pointerup. Emitting ui.update per frame would fight that local value with the state echo.
 */
export function Resizer({ label, axis, keyName, value, invert, overlayOffset, onDrag, onCommit }: ResizerProps) {
  useLocale();
  const viewport = axis === 'horizontal' ? window.innerWidth : window.innerHeight;
  const start = (event: React.PointerEvent) => {
    const origin = axis === 'horizontal' ? event.clientX : event.clientY;
    const sign = invert ? -1 : 1;
    const move = (next: PointerEvent) => {
      const delta = (axis === 'horizontal' ? next.clientX : next.clientY) - origin;
      onDrag(clampLayout(keyName, value + delta * sign, viewport));
    };
    const end = (next: PointerEvent) => {
      const delta = (axis === 'horizontal' ? next.clientX : next.clientY) - origin;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      onCommit(clampLayout(keyName, value + delta * sign, viewport));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  return (
    <div
      className={`resizer ${axis === 'vertical' ? 'resizer-h' : ''}`}
      style={overlayOffset === undefined ? undefined : { position: 'absolute', right: overlayOffset, top: 'var(--tool-overlay-top, 0px)', bottom: 'var(--tool-overlay-bottom, 0px)', zIndex: 21 }}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
          onCommit(resizeStep(keyName, value, invert ? 1 : -1, viewport));
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
          onCommit(resizeStep(keyName, value, invert ? -1 : 1, viewport));
      }}
    />
  );
}
