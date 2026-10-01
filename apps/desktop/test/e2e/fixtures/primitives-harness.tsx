import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu } from '../../../src/renderer/src/components/primitives/menu.tsx';

/*
 * Test-only mount point. The primitive has no call site in the app yet (the composer still renders its
 * native selects until WP3 swaps them), so this harness exists purely so the keyboard contract can be
 * driven in a real browser against the real component instead of a re-implementation.
 */
function Harness() {
  const [value, setValue] = useState('b');
  const [selections, setSelections] = useState(0);
  return (
    <main>
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
      <button type="button" data-testid="outside" style={{ position: 'fixed', right: 20, bottom: 20 }}>
        outside
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
