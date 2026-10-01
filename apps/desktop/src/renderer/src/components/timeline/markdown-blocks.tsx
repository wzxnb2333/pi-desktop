import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { Check, Code2, Copy, WrapText, ChevronsUpDown } from 'lucide-react';
import { Children, cloneElement, isValidElement, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '../primitives/tooltip.tsx';

type MarkdownChild = { children?: ReactNode; className?: string; node?: { tagName?: string }; 'data-col-size'?: string };

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<MarkdownChild>(child)
    ? textContent(child.props.children)
    : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('');
}

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  useLocale();
  const code = Children.toArray(children).find(child => isValidElement<MarkdownChild>(child));
  const language = isValidElement<MarkdownChild>(code) ? /(?:^|\s)language-([^\s]+)/.exec(code.props.className ?? '')?.[1] : undefined;
  const text = textContent(children).replace(/\n$/, '');
  const [wrapped, setWrapped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const long = text.split('\n').length > 18;
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState('');
  const copying = useRef(false);
  const copy = async () => {
    if (copying.current) return;
    copying.current = true;
    setError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setError(tr("复制失败，请选择代码后重试。"));
    } finally {
      copying.current = false;
    }
  };
  return <div className="markdown-code-block" data-wrapped={wrapped} data-expanded={!long || expanded}>
    <div className="markdown-code-toolbar" data-markdown-copy="exclude">
      <Code2 size={16} aria-hidden="true" />
      <span className="markdown-code-language">{language || 'text'}</span>
      <div className="markdown-code-actions">
        {long && <Tooltip label={expanded ? tr('收起代码') : tr('展开全部代码')}><button type="button" aria-label={expanded ? tr('收起代码') : tr('展开全部代码')} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronsUpDown size={14} /></button></Tooltip>}
        <Tooltip label={wrapped ? tr("关闭自动换行") : tr("开启自动换行")}>
          <button type="button" aria-label={tr("代码自动换行")} aria-pressed={wrapped} onClick={() => setWrapped(!wrapped)}><WrapText size={16} /></button>
        </Tooltip>
        <Tooltip label={copied === text ? tr("已复制") : tr("复制代码")}>
          <button type="button" aria-label={copied === text ? tr("已复制代码") : tr("复制代码")} onClick={() => void copy()}>{copied === text ? <Check size={16} /> : <Copy size={16} />}</button>
        </Tooltip>
      </div>
    </div>
    <pre className="markdown-code-content" dir="ltr" tabIndex={0} aria-label={language ? language + tr(" 代码") : tr("代码")}>{children}</pre>
    {error && <p className="markdown-code-error" role="alert">{error}</p>}
  </div>;
}

export function MarkdownTable({ children }: { children?: ReactNode }) {
  useLocale();
  const lengths: number[] = [];
  function measure(nodes: ReactNode) {
    Children.forEach(nodes, child => {
      if (!isValidElement<MarkdownChild>(child)) return;
      if (child.type === 'tr' || child.props.node?.tagName === 'tr') {
        Children.toArray(child.props.children).filter(isValidElement<MarkdownChild>).forEach((cell, index) => {
          lengths[index] = Math.max(lengths[index] ?? 0, textContent(cell.props.children).length);
        });
      } else measure(child.props.children);
    });
  }
  measure(children);
  function annotate(nodes: ReactNode): ReactNode {
    return Children.map(nodes, child => {
      if (!isValidElement<MarkdownChild>(child)) return child;
      if (child.type === 'tr' || child.props.node?.tagName === 'tr') {
        let index = 0;
        return cloneElement(child, { children: Children.map(child.props.children, cell => {
          if (!isValidElement<MarkdownChild>(cell)) return cell;
          const length = lengths[index++] ?? 0;
          return cloneElement(cell, { 'data-col-size': length <= 40 ? 'sm' : length <= 100 ? 'md' : length <= 160 ? 'lg' : 'xl' });
        }) });
      }
      return cloneElement(child, { children: annotate(child.props.children) });
    });
  }
  return <div className="markdown-table-container"><div className="markdown-table-scroller" role="region" aria-label={tr("表格，可横向滚动")} tabIndex={0}><div className="markdown-table-wrapper"><table dir="auto">{annotate(children)}</table></div></div></div>;
}
