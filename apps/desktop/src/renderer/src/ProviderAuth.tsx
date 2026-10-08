import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DesktopRequest, ModelProvider, ProviderAuthStatus } from '../../shared/contracts.ts';
import { providerAuthStatusSchema } from '../../shared/provider-auth.ts';
import { getLocale, localizeAppError, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';

type Invoke = (request: DesktopRequest) => Promise<unknown>;
type AuthMethod = ModelProvider['authMethod'];

export function ProviderAuth({ id, name, oauth, authMethod, apiKeyAvailable, baseUrl, persisted, invoke, persist, onAuthMethodChange, onBusyChange }: {
  id: string;
  name: string;
  oauth: { name: string; loginLabel?: string; isSubscription?: boolean };
  authMethod: AuthMethod;
  apiKeyAvailable: boolean;
  baseUrl: string;
  persisted: boolean;
  invoke: Invoke;
  persist(): Promise<boolean>;
  onAuthMethodChange(method: AuthMethod): void;
  onBusyChange?(busy: boolean): void;
}) {
  useLocale();
  const locale = getLocale();
  const [status, setStatus] = useState<ProviderAuthStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [actionError, setActionError] = useState('');
  const [openError, setOpenError] = useState('');
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [answer, setAnswer] = useState('');
  const promptRef = useRef<HTMLFormElement>(null);
  const loginButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const logoutButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const starting = useRef(false);
  const readRevision = useRef(0);
  const actionRevision = useRef(0);
  const eventRevision = useRef(0);
  const statusRef = useRef<ProviderAuthStatus | null>(null);
  const operationId = useRef<string | undefined>(undefined);
  const lastOperationId = useRef<string | undefined>(undefined);
  const staleOperationIds = useRef(new Set<string>());
  const startingEvents = useRef(new Map<string, ProviderAuthStatus>());
  const invokeRef = useRef(invoke);
  const persistRef = useRef(persist);
  const focusAfterAction = useRef<'login' | null>(null);
  invokeRef.current = invoke;
  persistRef.current = persist;
  const canUseOAuth = authMethod === 'oauth';
  const baseUrlBlocked = !!baseUrl.trim();
  const authErrorId = 'provider-' + id + '-auth-error';

  const acceptStatus = (next: ProviderAuthStatus, replaceOperation = false) => {
    if (!alive.current || next.id !== id) return;
    if (next.operationId && staleOperationIds.current.has(next.operationId)) return;
    if (!next.operationId) {
      const previousOperation = operationId.current ?? lastOperationId.current;
      if (previousOperation) staleOperationIds.current.add(previousOperation);
      operationId.current = undefined;
      lastOperationId.current = undefined;
      statusRef.current = next;
      setStatus(next);
      setStatusError('');
      return;
    }
    const knownOperation = operationId.current ?? lastOperationId.current;
    if (!replaceOperation && !starting.current && knownOperation && next.operationId !== knownOperation) return;
    operationId.current = next.operationId;
    lastOperationId.current = next.operationId;
    statusRef.current = next;
    setStatus(next);
    setStatusError('');
  };

  const readStatus = async () => {
    const currentRevision = ++readRevision.current;
    const observedEvents = eventRevision.current;
    setReading(true);
    try {
      const next = providerAuthStatusSchema.parse(await invokeRef.current({ op: 'provider.oauthStatus', id }));
      if (alive.current && currentRevision === readRevision.current && observedEvents === eventRevision.current) acceptStatus(next);
    } catch (reason) {
      if (alive.current && currentRevision === readRevision.current) setStatusError(localizeAppError(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (alive.current && currentRevision === readRevision.current) setReading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.desktop.onEvent(event => {
      if (event.type !== 'provider.auth' || event.status.id !== id) return;
      eventRevision.current++;
      if (starting.current) {
        startingEvents.current.set(event.status.operationId ?? '', event.status);
        return;
      }
      acceptStatus(event.status);
    });
    return () => {
      alive.current = false;
      readRevision.current++;
      actionRevision.current++;
      unsubscribe();
    };
  }, [id]);

  // Newly created providers exist only in the settings draft until a successful save.
  // Keep this separate from the subscription so saving during login cannot invalidate the action.
  useEffect(() => { if (persisted) void readStatus(); }, [id, persisted]);

  useEffect(() => {
    onBusyChange?.(pending || status?.phase === 'logging_in');
    return () => onBusyChange?.(false);
  }, [pending, status?.phase, onBusyChange]);

  const prompt = status?.prompt;
  const promptKey = prompt && status?.operationId ? `${status.operationId}:${prompt.id}` : '';
  const previousPromptKey = useRef('');
  useEffect(() => {
    setAnswer(prompt?.type === 'select' ? prompt.options?.[0]?.id ?? '' : '');
  }, [promptKey]);
  useEffect(() => {
    if (promptKey) {
      previousPromptKey.current = promptKey;
      if (!pending) requestAnimationFrame(() => promptRef.current?.querySelector<HTMLElement>('input:not(:disabled), .menu-trigger:not(:disabled)')?.focus());
      return;
    }
    if (!previousPromptKey.current) return;
    previousPromptKey.current = '';
    requestAnimationFrame(() => {
      const current = statusRef.current;
      if (current?.phase === 'logging_in') cancelButton.current?.focus();
      else if (current?.connected) logoutButton.current?.focus();
      else loginButton.current?.focus();
    });
  }, [promptKey, pending]);

  useEffect(() => {
    if (pending || !focusAfterAction.current) return;
    focusAfterAction.current = null;
    requestAnimationFrame(() => loginButton.current?.focus());
  }, [pending]);

  const perform = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError('');
    const currentAction = ++actionRevision.current;
    try { await action(); }
    catch (reason) {
      if (alive.current && currentAction === actionRevision.current) setActionError(localizeAppError(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (alive.current && currentAction === actionRevision.current) { busy.current = false; setPending(false); }
    }
  };

  const start = () => void perform(async () => {
    if (!canUseOAuth || baseUrlBlocked || statusRef.current?.phase === 'logging_in') return;
    if (!await persistRef.current()) return;
    startingEvents.current.clear();
    starting.current = true;
    operationId.current = undefined;
    const observedEvents = eventRevision.current;
    try {
      const next = providerAuthStatusSchema.parse(await invokeRef.current({ op: 'provider.oauthStart', id }));
      const eventStatus = startingEvents.current.get(next.operationId ?? '');
      const receivedDuringStart = eventRevision.current !== observedEvents && statusRef.current?.operationId === next.operationId
        ? statusRef.current : undefined;
      acceptStatus(eventStatus ?? receivedDuringStart ?? next, true);
    } finally {
      starting.current = false;
      startingEvents.current.clear();
    }
  });

  const cancel = () => {
    const current = statusRef.current;
    if (!current?.operationId || current.phase !== 'logging_in') return;
    const requestOperationId = current.operationId;
    focusAfterAction.current = 'login';
    void perform(async () => {
      await invokeRef.current({ op: 'provider.oauthCancel', id, operationId: requestOperationId });
      if (statusRef.current?.operationId === requestOperationId) await readStatus();
    });
  };

  const logout = () => {
    focusAfterAction.current = 'login';
    void perform(async () => {
      await invokeRef.current({ op: 'provider.oauthLogout', id });
      await readStatus();
    });
  };

  const open = () => {
    const current = statusRef.current;
    if (!current?.operationId) return;
    const requestOperationId = current.operationId;
    const manualInstructions = locale === 'en-US'
      ? 'The browser did not open. Open the authorization link below manually.'
      : '无法自动打开浏览器，请手动打开下面的授权链接。';
    setOpenError('');
    void perform(async () => {
      try {
        const result = await invokeRef.current({ op: 'provider.oauthOpen', id, operationId: requestOperationId });
        if (result === false || (result && typeof result === 'object' && 'opened' in result && result.opened === false)) setOpenError(manualInstructions);
      } catch (reason) {
        setOpenError(manualInstructions);
        throw reason;
      }
    });
  };

  const submitAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = statusRef.current;
    const currentPrompt = current?.prompt;
    if (!current?.operationId || current.id !== id || !currentPrompt || currentPrompt.id !== prompt?.id || (prompt?.type !== 'text' && !answer.trim())) return;
    const requestOperationId = current.operationId;
    const requestPromptId = currentPrompt.id;
    const value = answer;
    void perform(async () => {
      const latest = statusRef.current;
      if (latest?.operationId !== requestOperationId || latest.prompt?.id !== requestPromptId) return;
      const result = await invokeRef.current({ op: 'provider.oauthAnswer', id, operationId: requestOperationId, promptId: requestPromptId, value });
      if (statusRef.current?.operationId !== requestOperationId || statusRef.current.prompt?.id !== requestPromptId) return;
      const parsed = providerAuthStatusSchema.safeParse(result);
      if (parsed.success) acceptStatus(parsed.data);
      else await readStatus();
    });
  };

  const safeLink = (() => {
    try {
      const url = new URL(status?.link ?? '');
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  })();
  const stateLabel = status?.connected ? tr('已连接') : status?.phase === 'logging_in' ? tr('等待浏览器授权') : status?.phase === 'error' ? tr('连接异常') : tr('未连接');
  const authMethods: AuthMethod[] = [...(apiKeyAvailable ? ['api_key' as const] : []), 'oauth'];

  return <section className="provider-auth" aria-label={oauth.name + ' · ' + name}>
    <fieldset className="connection-modes">
      <legend>{locale === 'en-US' ? 'Authentication method' : '认证方式'}</legend>
      {authMethods.map(method => <label key={method} className="connection-mode" data-selected={authMethod === method}>
        <input type="radio" name={'provider-' + id + '-auth'} value={method} checked={authMethod === method}
          disabled={pending || status?.phase === 'logging_in'}
          onChange={() => onAuthMethodChange(method)} />
        <span>{method === 'api_key' ? 'API Key' : oauth.loginLabel ?? oauth.name}</span>
      </label>)}
    </fieldset>
    {canUseOAuth && <div className="provider-auth-oauth" aria-describedby={actionError ? authErrorId : undefined}>
      <p className="hint provider-auth-status" role="status" aria-live="polite">
        {reading ? tr('读取授权状态…') : oauth.name + ' · ' + stateLabel}
      </p>
      {oauth.isSubscription && <p className="hint">{locale === 'en-US' ? 'This OAuth login uses a subscription account.' : '此 OAuth 登录使用订阅账户。'}</p>}
      {status?.instructions && <p className="hint">{status.instructions}</p>}
      {status?.userCode && <FieldRow label={locale === 'en-US' ? 'Device login code' : '设备登录代码'} description={tr('等待浏览器授权')}>
        <output className="provider-auth-code" aria-label={locale === 'en-US' ? 'Device login code' : '设备登录代码'}>{status.userCode}</output>
      </FieldRow>}
      {safeLink && <div className="provider-auth-link">
        <Button size="sm" disabled={pending || !status?.operationId} onClick={open}>{tr('在浏览器中打开')}</Button>
        <FieldRow label={locale === 'en-US' ? 'Authorization link' : '授权链接'} htmlFor={'provider-' + id + '-auth-link'}>
          <input id={'provider-' + id + '-auth-link'} aria-label={locale === 'en-US' ? 'Authorization link' : '授权链接'} type="text" inputMode="url" readOnly
            aria-describedby={openError ? 'provider-' + id + '-auth-open-error' : undefined}
            value={safeLink} onFocus={event => event.currentTarget.select()} />
        </FieldRow>
        <p className="hint provider-auth-manual-link">
          {locale === 'en-US' ? 'If the browser does not open, copy the link and open it manually.' : '如果浏览器未打开，请复制链接手动打开。'}
        </p>
      </div>}
      {openError && <p id={'provider-' + id + '-auth-open-error'} role="alert" className="form-feedback" data-error="true">{openError}</p>}
      {prompt && <form ref={promptRef} className="provider-auth-prompt" onSubmit={submitAnswer}
        aria-describedby={actionError ? authErrorId : undefined}>
        <FieldRow label={prompt.message} htmlFor={prompt.type === 'select' ? undefined : 'provider-' + id + '-auth-prompt'}>
          {prompt.type === 'select' ? <Menu id={'provider-' + id + '-auth-prompt'} label={prompt.message} value={answer}
            options={(prompt.options ?? []).map(option => ({ value: option.id, label: option.label }))}
            title={actionError || null} disabled={pending || !prompt.options?.length} onChange={setAnswer} /> : <input
            id={'provider-' + id + '-auth-prompt'} type={prompt.type === 'secret' ? 'password' : 'text'} autoComplete="off"
            required={prompt.type !== 'text'} aria-invalid={!!actionError || undefined} aria-describedby={actionError ? authErrorId : undefined}
            value={answer} placeholder={prompt.placeholder} disabled={pending}
            onChange={event => setAnswer(event.target.value)} />}
        </FieldRow>
        <Button size="sm" variant="primary" type="submit" disabled={pending || (prompt.type !== 'text' && !answer.trim())}>{locale === 'en-US' ? 'Submit' : '提交'}</Button>
      </form>}
      <div className="row provider-auth-actions">
        <Button ref={loginButton} size="sm" variant="primary" disabled={pending || reading || baseUrlBlocked || status?.phase === 'logging_in'} onClick={start}>
          {status?.connected ? (locale === 'en-US' ? 'Sign in again' : '重新登录') : tr('保存并登录')}
        </Button>
        {status?.phase === 'logging_in' && <Button ref={cancelButton} size="sm" disabled={pending || !status.operationId} onClick={cancel}>{tr('取消授权')}</Button>}
        {status?.connected && <Button ref={logoutButton} size="sm" disabled={pending} onClick={logout}>{locale === 'en-US' ? 'Exit OAuth' : '退出 OAuth'}</Button>}
        {statusError && <Button size="sm" disabled={reading || pending} onClick={() => void readStatus()}>{tr('重试读取授权状态')}</Button>}
      </div>
      {baseUrlBlocked && <p className="form-feedback" role="alert" data-error="true">
        {locale === 'en-US' ? 'Clear Base URL to sign in with OAuth.' : 'OAuth 需要清空 Base URL 才能登录。'}
      </p>}
      {status?.error && <p className="form-feedback" role="alert" data-error="true">{localizeAppError(status.error)}</p>}
      {statusError && <p className="form-feedback" role="alert" data-error="true">{statusError}</p>}
      {actionError && <p id={authErrorId} className="form-feedback" role="alert" data-error="true">{actionError}</p>}
    </div>}
  </section>;
}
