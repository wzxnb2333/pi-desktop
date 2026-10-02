import { useEffect, useRef, useState } from 'react';
import { browserSiteOrigin, browserUrlSchema } from '../../../../shared/browser-tools.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { Menu } from '../primitives/menu.tsx';
import { useApp } from '../../state/app.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

export function BrowserSites({ url, onClose }: { url: string; onClose(): void }) {
  useLocale();
  const { data, invoke } = useApp();
  const [origin, setOrigin] = useState(() => browserUrlSchema.safeParse(url).success ? new URL(url).origin : '');
  const [policy, setPolicy] = useState<'allow' | 'deny'>(() => data.settings.browserSitePolicies[origin] ?? 'allow');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [retry, setRetry] = useState<{ origin: string; policy: 'ask' | 'allow' | 'deny' }>();
  const [saved, setSaved] = useState<{ origin: string; removed: boolean }>();
  const saving = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async (raw: string, value: 'ask' | 'allow' | 'deny') => {
    if (saving.current) return;
    setError(''); setSaved(undefined); setRetry(undefined);
    let address: string;
    try { address = browserSiteOrigin(raw); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    saving.current = true; setPending(true);
    try {
      await invoke({ op: 'browser.site', origin: address, policy: value });
      if (mounted.current) setSaved({ origin: address, removed: value === 'ask' });
    } catch (reason) {
      if (mounted.current) {
        setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, ''));
        setRetry({ origin: address, policy: value });
      }
    } finally { saving.current = false; if (mounted.current) setPending(false); }
  };
  return <ConfirmDialog presentation="panel" pending={pending} title={tr('网站访问权限')} confirmLabel={tr('关闭')} onConfirm={onClose} onCancel={onClose} description={<div className="browser-site-settings">
    <p>{tr('网站规则立即生效，不能扩大任务本身的权限。未设置的网站每次操作前询问。')}</p>
    <form className="row" onSubmit={event => { event.preventDefault(); if (origin.trim()) void save(origin, policy); }}><input data-dialog-autofocus aria-label={tr('网站来源')} placeholder="https://example.com" maxLength={8192} value={origin} onChange={event => setOrigin(event.target.value)} disabled={pending} />
      <Menu label={tr('网站规则')} value={policy} disabled={pending} matchTriggerWidth
        options={[{ value: 'allow', label: tr('始终允许此网站') }, { value: 'deny', label: tr('始终拒绝此网站') }]}
        onChange={value => setPolicy(value as 'allow' | 'deny')} />
      <Button type="submit" size="sm" disabled={pending || !origin.trim()}>{tr('添加网站规则')}</Button>
    </form>
    <ul>{Object.entries(data.settings.browserSitePolicies).map(([origin, value]) => <li className="row" key={origin}><code>{origin}</code>
      <Menu label={tr('网站规则') + ' ' + origin} value={value} disabled={pending} matchTriggerWidth
        options={[{ value: 'allow', label: tr('始终允许此网站') }, { value: 'deny', label: tr('始终拒绝此网站') }]}
        onChange={next => void save(origin, next as 'allow' | 'deny')} />
      <Button size="sm" disabled={pending} aria-label={tr('移除网站规则') + ' ' + origin} onClick={() => void save(origin, 'ask')}>{tr('移除网站规则')}</Button>
    </li>)}</ul>
    {pending && <p role="status">{tr('正在保存网站规则…')}</p>}
    {saved && <p role="status">{tr(saved.removed ? '已移除网站规则：{p0}' : '已保存网站规则：{p0}', { p0: saved.origin })}</p>}
    {error && <p role="alert">{localizeAppError(error)}</p>}
    {retry && <Button size="sm" disabled={pending} onClick={() => void save(retry.origin, retry.policy)}>{tr('重试保存网站规则')}</Button>}
    <div className="row"><Button disabled={pending} onClick={onClose}>{tr('关闭')}</Button></div>
  </div>} />;
}
