import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { Layers, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ResourceInspection, type Settings, bootstrapSchema, resourceInspectionSchema, resourceSchema } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { Button, IconButton } from '../primitives/button.tsx';
import { FieldRow } from '../primitives/field-row.tsx';
import { Menu } from '../primitives/menu.tsx';
import { UnsavedNavigation } from '../primitives/unsaved-navigation.tsx';
import { ManagementEmpty, ManagementFilters, ManagementSearch } from './chrome.tsx';
import { PluginsSection } from './plugins-section.tsx';

type Resource = Settings['resources'][number];

type Detail = { resource: Resource; pending: boolean; text: string; error: string };

function currentResource(resources: Resource[], selected: Resource): Resource {
  const current = resources.find(item => item.id === selected.id && item.path === selected.path && item.kind === selected.kind);
  if (!current) throw new Error('资源不存在');
  return current;
}

export function SkillsPage() {
  useLocale();
  const { data, selectThread, registerViewGuard } = useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const skillTemplate = tr("---\nname: my-skill\ndescription: 描述这个 Skill 的用途\n---\n\n");
  const [content, setContent] = useState(skillTemplate);
  const contentBaseline = useRef(skillTemplate);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'skill' | 'extension'>('all');
  const [detail, setDetail] = useState<Detail>();
  const detailRequest = useRef(0);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const restoreCreateFocus = useRef(false);
  const inspectionRef = useRef<HTMLElement>(null);
  const [inspection, setInspection] = useState<ResourceInspection>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const inspectionRequest = useRef(0);
  const inspectionInFlight = useRef(-1);
  const resourceKey = JSON.stringify([data.settings.resources.map(({ id, path, kind, name, enabled }) => [id, path, kind, name, enabled]), data.settings.ignoredSkillPaths]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; detailRequest.current++; inspectionRequest.current++; };
  }, []);
  const inspect = useCallback(async (replace = false) => {
    if (!replace && inspectionInFlight.current === inspectionRequest.current) return;
    const request = ++inspectionRequest.current;
    inspectionInFlight.current = request;
    setChecking(true); setCheckError('');
    try {
      const result = resourceInspectionSchema.safeParse(await window.desktop.invoke({ op: 'resource.inspect' }));
      if (!result.success) throw new Error('资源内容格式无效');
      if (mounted.current && request === inspectionRequest.current) setInspection(result.data);
    } catch (reason) {
      if (mounted.current && request === inspectionRequest.current) setCheckError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current && request === inspectionRequest.current) { inspectionInFlight.current = -1; setChecking(false); }
    }
  }, []);
  useEffect(() => {
    setInspection(undefined);
    void inspect(true);
    return () => { inspectionRequest.current++; };
  }, [resourceKey, inspect]);
  useLayoutEffect(() => { if (creating) nameRef.current?.focus(); }, [creating]);
  useLayoutEffect(() => {
    if (!creating && !busy && restoreCreateFocus.current) {
      restoreCreateFocus.current = false;
      createRef.current?.focus();
    }
  }, [creating, busy]);
  useLayoutEffect(() => { if (detail?.pending) detailRef.current?.focus(); }, [detail?.resource.id, detail?.pending]);
  const closeDetail = () => {
    detailRequest.current++;
    setDetail(undefined);
    (detailTrigger.current?.isConnected ? detailTrigger.current : searchRef.current)?.focus();
  };
  useEffect(() => {
    if (detail && !data.settings.resources.some(item => item.id === detail.resource.id && item.path === detail.resource.path)) {
      detailRequest.current++;
      setDetail(undefined);
      searchRef.current?.focus();
    }
  }, [resourceKey, detail?.resource.id, detail?.resource.path]);
  const readDetail = async (resource: Resource) => {
    const request = ++detailRequest.current;
    setDetail({ resource, pending: true, text: '', error: '' });
    try {
      const text = await window.desktop.invoke({ op: 'resource.open', id: resource.id, reveal: false });
      if (typeof text !== 'string') throw new Error('资源内容格式无效');
      if (mounted.current && request === detailRequest.current) setDetail({ resource, text, pending: false, error: '' });
    } catch (reason) {
      if (mounted.current && request === detailRequest.current) setDetail({ resource, text: '', pending: false, error: reason instanceof Error ? reason.message : String(reason) });
    }
  };
  const run = async (operation: () => Promise<string | undefined>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFeedback(undefined);
    try {
      const text = await operation();
      if (mounted.current && text) setFeedback({ text, error: false });
    } catch (reason) {
      if (mounted.current) setFeedback({ text: reason instanceof Error ? reason.message : String(reason), error: true });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const saveResources = async (update: (resources: Resource[]) => Resource[]) => {
    // The store can be ahead of its debounced broadcast; always merge against its current settings.
    const current = bootstrapSchema.parse(await window.desktop.invoke({ op: 'bootstrap' }));
    await window.desktop.invoke({ op: 'settings.patch', patch: { resources: update(current.data.settings.resources) }, base: { resources: current.data.settings.resources } });
  };
  const pick = (kind: Resource['kind']) => run(async () => {
    const value = await window.desktop.invoke({ op: 'resource.pick', kind });
    if (!value) return;
    const picked = resourceSchema.parse(value);
    let imported = picked;
    await saveResources(resources => {
      const existing = resources.find(item => item.id === picked.id || (item.kind === picked.kind && item.path === picked.path));
      if (!existing) return [...resources, picked];
      imported = { ...currentResource(resources, { ...picked, id: existing.id }), enabled: true };
      return resources.map(item => item.id === existing.id ? imported : item);
    });
    return tr("已导入 ") + imported.name;
  });
  const create = () => {
    if (!name.trim() || !content.trim()) {
      setFeedback({ text: tr("请填写名称和 SKILL.md 内容"), error: true });
      if (!name.trim()) nameRef.current?.focus();
      return;
    }
    void run(async () => {
      const created = resourceSchema.parse(await window.desktop.invoke({ op: 'resource.create', name: name.trim(), content }));
      if (mounted.current) { restoreCreateFocus.current = true; contentBaseline.current = skillTemplate; setCreating(false); setName(''); setContent(skillTemplate); }
      return tr("已创建 ") + created.name;
    });
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = data.settings.resources.filter(resource => (kind === 'all' || resource.kind === kind) && [resource.name, resource.path, inspection?.descriptions[resource.id] ?? ''].join(' ').toLocaleLowerCase().includes(query));
  const loaded = data.threads.filter(thread => !thread.deletedAt && thread.resourceLoad?.diagnostics.length);

  return <section className="management-page skills-page">
    <UnsavedNavigation register={registerViewGuard} busy={busy && creating} dirty={!!name || content !== contentBaseline.current} />
    <header className="page-heading">
      <h1>{tr("Skills 与扩展")}</h1><p>{tr("为 Pi 加入可复用的流程和工具。")}</p>
    </header>
    <PluginsSection />
    <ManagementSearch label={tr("搜索 Skills 与扩展")} placeholder={tr("搜索名称、描述或来源路径")} value={search} onChange={setSearch} inputRef={searchRef}>
      <Button size="sm" disabled={busy} onClick={() => void run(async () => { await window.desktop.invoke({ op: 'resource.refresh' }); await inspect(true); return tr("已刷新资源，空闲会话将在下次运行重新加载"); })}>{tr("刷新")}</Button>
    </ManagementSearch>
    <ManagementFilters<typeof kind> label={tr("资源类型")} value={kind} onChange={setKind} options={[{ value: 'all', label: tr("全部") }, { value: 'skill', label: 'Skills' }, { value: 'extension', label: tr("扩展") }]} />
    <div className="section-heading">
      <div><h2>{tr("已安装 ·")} {data.settings.resources.length}</h2><p className="hint">{tr("停用或移除仅影响 Pi，不删除共享文件。")}{tr("改动在下次任务运行时生效，详情查看不会执行扩展。")}</p></div>
      <div className="row">
        <Menu label={tr("导入")} size="sm" value="" placeholder={tr("导入")} disabled={busy}
          options={[{ value: 'skill', label: tr("导入 SKILL.md") }, { value: 'extension', label: tr("导入 Pi 扩展") }]}
          onChange={kind => { if (kind === 'skill' || kind === 'extension') void pick(kind); }} />
        <Button ref={createRef} size="sm" disabled={busy} aria-expanded={creating} aria-controls={creating ? 'create-skill-form' : undefined} onClick={() => setCreating(!creating)}><Plus size={15} />{tr("创建 Skill")}</Button>
      </div>
    </div>
    {creating && <section className="config-card" id="create-skill-form" aria-label={tr("创建 Skill")}>
      <h2>{tr("创建 Skill")}</h2>
      <fieldset disabled={busy} className="resource-create-fields">
        <FieldRow label={tr("名称")} htmlFor="skill-name" description={tr("显示在 Skills 列表中的名字")}><input ref={nameRef} id="skill-name" value={name} onChange={event => setName(event.target.value)} /></FieldRow>
        <div className="field-block"><label htmlFor="skill-content">SKILL.md<small>{tr("front matter 需包含 name 与 description")}</small></label><textarea id="skill-content" className="code-input" rows={10} value={content} onChange={event => setContent(event.target.value)} /></div>
        <div className="row"><Button variant="primary" size="sm" onClick={create}>{tr("创建")}</Button><Button size="sm" onClick={() => { setCreating(false); createRef.current?.focus(); }}>{tr("取消")}</Button></div>
      </fieldset>
    </section>}
    <section ref={inspectionRef} tabIndex={-1} className="resource-inspection" aria-label={tr("资源源文件检查")} aria-busy={checking}>
      <p className="hint">{tr("默认目录：~/.agents/skills。启动时加载通用 Skills，新建 Skill 也保存到这里。")}</p>
      {checking && <p className="hint">{tr("正在检查资源源文件…")}</p>}
      {checkError && <div className="row"><p className="form-feedback" data-error role="alert">{tr("源文件检查失败：")}{localizeAppError(checkError)}</p><Button size="sm" onClick={() => { inspectionRef.current?.focus(); void inspect(); }}>{tr("重试检查")}</Button></div>}
      {!checking && !checkError && inspection && <p className="hint">{tr("源文件检查完成 ·")} {inspection.diagnostics.length}  {tr("条诊断。扩展是否成功执行以任务加载记录为准。")}</p>}
      {!checking && !checkError && inspection && inspection.diagnostics.length > 0 && <details className="resource-diagnostics" open>
        <summary>{tr("源文件诊断 ·")} {inspection.diagnostics.length}</summary>
        <ul>{inspection.diagnostics.map((item, index) => <li key={index}><strong>{item.kind === 'skill' ? 'Skill' : tr("扩展")} · {{ warning: tr("警告"), error: tr("错误"), collision: tr("名称冲突") }[item.type]}</strong><p>{item.message}</p>{item.path && <code>{item.path}</code>}</li>)}</ul>
      </details>}
    </section>
    <div className="field-stack resource-list" aria-label={tr("已安装资源")}>
      {visible.map(resource => <FieldRow key={resource.id} label={resource.name} description={<><span className="badge">{resource.kind === 'skill' ? 'SKILL' : 'EXTENSION'}</span><span className="resource-path">{resource.path}</span>{inspection?.descriptions[resource.id] && <span>{inspection.descriptions[resource.id]}</span>}</>}>
        <Button size="sm" aria-expanded={detail?.resource.id === resource.id} aria-controls={detail?.resource.id === resource.id ? 'resource-detail' : undefined} onClick={event => { detailTrigger.current = event.currentTarget; void readDetail(resource); }}>{tr("详情")}</Button>
        <Button size="sm" disabled={busy} onClick={() => void run(async () => { await window.desktop.invoke({ op: 'resource.open', id: resource.id, reveal: true }); return undefined; })}>{tr("打开文件位置")}</Button>
        <input type="checkbox" aria-label={tr("启用 ") + resource.name} checked={resource.enabled} disabled={busy} onChange={event => {
          const enabled = event.currentTarget.checked;
          void run(async () => { await saveResources(resources => { currentResource(resources, resource); return resources.map(item => item.id === resource.id ? { ...item, enabled } : item); }); return resource.name + (enabled ? tr(" 已启用") : tr(" 已停用")); });
        }} />
        <IconButton label={tr("移除 ") + resource.name} variant="danger" disabled={busy} onClick={() => void run(async () => { await saveResources(resources => { currentResource(resources, resource); return resources.filter(item => item.id !== resource.id); }); return tr("已移除 ") + resource.name; })}><Trash2 size={15} /></IconButton>
      </FieldRow>)}
    </div>
    {!visible.length && <ManagementEmpty icon={<Layers size={32} aria-hidden="true" />} title={query || kind !== 'all' ? tr("没有匹配的资源") : tr("把你的经验变成工作流")} description={query || kind !== 'all' ? tr("试试其他类型、名称、描述或来源路径。") : tr("导入 SKILL.md，或创建第一个 Skill。")} />}
    {detail && <section ref={detailRef} id="resource-detail" className="config-card resource-detail-panel" tabIndex={-1} aria-label={tr("资源详情 ") + detail.resource.name} aria-busy={detail.pending} onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); closeDetail(); }
    }}><div className="row"><h2>{detail.resource.name}</h2><Button size="sm" onClick={closeDetail}>{tr("关闭详情")}</Button></div><p className="resource-path">{detail.resource.path}</p>
      {detail.pending ? <p>{tr("正在读取资源…")}</p> : detail.error ? <><p role="alert" className="form-feedback" data-error>{localizeAppError(detail.error)}</p><Button size="sm" onClick={() => void readDetail(detail.resource)}>{tr("重试读取")}</Button></> : <pre className="resource-detail">{detail.text}</pre>}
    </section>}
    {loaded.length > 0 && <section className="resource-runtime" aria-label={tr("任务资源加载记录")}><h2>{tr("任务加载诊断")}</h2><p className="hint">{tr("显示最近一次任务加载的实际结果。刷新源文件后需再次运行任务，旧记录不会被当作当前成功状态。")}</p>{loaded.map(thread => <details key={thread.id}><summary>{thread.title} · {thread.resourceLoad!.diagnostics.length}  {tr("条诊断 ·")} <time dateTime={new Date(thread.resourceLoad!.checkedAt).toISOString()}>{new Date(thread.resourceLoad!.checkedAt).toLocaleString()}</time></summary>
      <ul>{thread.resourceLoad!.diagnostics.map((item, index) => <li key={index}><strong>{item.kind === 'skill' ? 'Skill' : tr("扩展")} · {{ warning: tr("警告"), error: tr("错误"), collision: tr("名称冲突") }[item.type]}</strong><p>{item.message}</p>{item.path && <code>{item.path}</code>}</li>)}</ul><Button size="sm" onClick={() => selectThread(thread)}>{tr("打开任务")}</Button>
    </details>)}</section>}
    <p className="form-feedback" data-error={feedback?.error || undefined} role="status">{feedback?.error ? localizeAppError(feedback.text) : feedback?.text ?? ''}</p>
  </section>;
}
