import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../../src/renderer/src/state/app.tsx';
import { Menu } from '../../../src/renderer/src/components/primitives/menu.tsx';
import { Tooltip } from '../../../src/renderer/src/components/primitives/tooltip.tsx';
import { ConfirmDialog } from '../../../src/renderer/src/components/primitives/dialog.tsx';
import { Message } from '../../../src/renderer/src/components/timeline/message.tsx';
import { dataSchema, defaultData, type DesktopBridge } from '../../../src/shared/contracts.ts';
import '../../../src/renderer/src/styles/index.css';

const params = new URLSearchParams(location.search);
const initial = defaultData();
const data = dataSchema.parse({ ...initial, settings: { ...initial.settings, theme: params.get('theme') || 'light' } });
const bridge: DesktopBridge = {
  async invoke(request) {
    if (request.op === 'bootstrap') return { data, approvals: [], terminals: [], version: 'surface-test' };
    return null;
  },
  onEvent() { return () => {}; },
};
window.desktop = bridge;

function Harness() {
  const { ready } = useApp();
  const [value, setValue] = useState('b');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState('');
  const scene = params.get('scene');
  if (!ready) return null;
  return <main data-surface-ready="true">
    {scene === 'menu' && <div className="surface-anchor">
      <Menu label="菜单" value={value} matchTriggerWidth options={[
        { value: 'a', label: '选项 A' }, { value: 'b', label: '选项 B' }, { value: 'c', label: '不可用选项', disabled: true },
      ]} onChange={setValue} />
    </div>}
    {scene === 'tooltip' && <div className="surface-anchor"><Tooltip label="切换辅助面板"><button>提示</button></Tooltip></div>}
    {scene === 'dialog' && <>
      <button onClick={() => setDialogOpen(true)}>打开确认</button>
      {dialogOpen && <ConfirmDialog title="删除自动化？" description="这将永久删除此自动化，并停止之后的定时运行。" confirmLabel="删除自动化" danger onCancel={() => { setDialogOpen(false); setResult('cancelled'); }} onConfirm={() => { setDialogOpen(false); setResult('confirmed'); }} />}
      <output>{result}</output>
    </>}
    {scene === 'user' && <div style={{ width: 'min(768px, calc(100vw - 64px))', margin: '32px auto' }}>
      <Message item={{ id: 'm1', role: 'user', timestamp: 0, thinking: '', state: 'done', text: '请检查项目中的设置保存流程，并保留中文文案。第二行用于验证换行后的气泡宽度与间距。' }} />
    </div>}
    {scene === 'prose' && <div style={{ width: 'min(768px, calc(100vw - 64px))', margin: '32px auto' }}>
      <Message item={{ id: 'm2', role: 'assistant', timestamp: 0, thinking: '', state: 'done', text: [
        '# 验收结果', '', '第一段中文，检查段落和行距。', '', '第二段包含**重点**，以及 English text。', '',
        '## 检查项目', '', '- 菜单与键盘', '- 对话框与焦点', '  - 恢复触发器', '', '3. 保存设置', '',
        '> 仅比较源码中已经确定的结构。', '', '---', '', '### 下一步', '', '#### 明细', '', '##### 记录', '', '###### 结束',
      ].join(String.fromCharCode(10)) }} />
    </div>}
    {(scene === 'table' || scene === 'code' || scene === 'wide-table' || scene === 'long-code') && <div style={{ width: 'min(768px, calc(100vw - 64px))', margin: '32px auto' }}>
      <Message item={{ id: 'rich', role: 'assistant', timestamp: 0, thinking: '', state: 'done', text: scene === 'table'
        ? '| 检查项目 | 状态 |\n| --- | --- |\n| 保存与重启 | 已通过 |\n| 中文输入 | 已通过 |'
        : scene === 'wide-table'
          ? '| 左侧 | 中间 | 右侧 | 额外列 | 更多列 |\n| :--- | :---: | ---: | --- | --- |\n| ' + '长内容'.repeat(60) + ' | **强调** | `代码` | 更多内容 | 末尾 |'
          : '```text\nnpm run desktop:check\n' + (scene === 'long-code' ? 'long_unbroken_value_'.repeat(50) : '设置已恢复') + '\n```' }} />
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Harness /></AppProvider>);
