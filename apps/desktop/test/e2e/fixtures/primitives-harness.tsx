import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu } from '../../../src/renderer/src/components/primitives/menu.tsx';
import { Button } from '../../../src/renderer/src/components/primitives/button.tsx';
import { ConfirmDialog } from '../../../src/renderer/src/components/primitives/dialog.tsx';
import { Tooltip } from '../../../src/renderer/src/components/primitives/tooltip.tsx';
import { useContentMotion } from '../../../src/renderer/src/hooks/use-content-motion.ts';
import '../../../src/renderer/src/styles/index.css';

/*
 * Real primitives and the shipped cascade in isolation, for keyboard, geometry and motion checks.
 */
function Harness() {
  const [value, setValue] = useState('b');
  const [selections, setSelections] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [category, setCategory] = useState(0);
  const [updates, setUpdates] = useState(0);
  const content = useRef<HTMLElement>(null);
  useContentMotion(content, String(category));
  return (
    <main style={{ padding: 20 }}>
      <p data-testid="selections">{selections}</p>
      <Menu
        label="模型"
        value={value}
        options={[
          { value: 'a', label: '选项 A' },
          { value: 'b', label: '选项 B' },
          { value: 'c', label: '选项 C' },
          { value: 'd', label: '选项 D', disabled: true },
          { value: 'e', label: '选项 E' },
        ]}
        onChange={(next) => {
          setValue(next);
          setSelections((count) => count + 1);
        }}
      />
      <Button onClick={() => setDialog(true)}>打开确认弹窗</Button>
      <Button disabled>禁用操作</Button>
      <Tooltip label="操作说明"><Button>测试提示</Button></Tooltip>
      <Button onClick={() => setCategory(value => value + 1)}>切换内容</Button>
      <Button onClick={() => setUpdates(value => value + 1)}>流式更新</Button>
      <section ref={content} data-testid="motion-content">
        <span>{category} · {updates}</span><input aria-label="保留草稿" defaultValue="" />
      </section>
      <section className="settings-page" style={{ padding: 20 }}>
        <div className="field-row"><label htmlFor="motion-switch">测试开关</label>
          <div className="field-row-control"><input id="motion-switch" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /></div>
        </div>
      </section>
      {dialog && <ConfirmDialog title="确认操作" description="请确认当前操作。" confirmLabel="确认"
        onConfirm={() => setDialog(false)} onCancel={() => setDialog(false)} />}
      <button type="button" data-testid="outside" style={{ position: 'fixed', right: 20, bottom: 20 }}>
        outside
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
