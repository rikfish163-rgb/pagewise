'use client';

import { useLocale } from './LocaleProvider';
import { useEffect, useRef, useState } from 'react';
import type { PersonalProfile } from '../server/personal-api';
import './personal-api.css';
import {Magpie,type Gateway} from './Magpie';
import { Plug } from 'lucide-react';

type Protocol = 'chat' | 'responses' | 'anthropic' | 'gemini';
export type PublicProfile = Omit<PersonalProfile, 'key' | 'protocol' | 'models' | 'visionModels'> & { protocol: Protocol; models?: string[]; visionModels?: string[] };
type ProbeResult = { protocol: Protocol; ok: boolean; message: string };
type TestResult = ProbeResult & { label: string };
const protocols: { id: Protocol; label: string }[] = [{ id: 'chat', label: 'OpenAI 兼容' }, { id: 'responses', label: 'OpenAI Responses' }, { id: 'anthropic', label: 'Anthropic' }, { id: 'gemini', label: 'Gemini' }];

async function request<T>(path: string, method = 'POST', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/study/personal-api' + path, { method, cache: 'no-store', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw Error(data.error || '操作未完成，请稍后重试。');
  return data;
}
function Eye({ visible }: { visible: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible && <path d="m3 3 18 18"/>}</svg>;
}

export function PersonalApiEditor({ profile, onSave, onProfileChange, onRemove, onBusyChange = () => {} }: {
  profile: PublicProfile | null; onSave: (profile: PublicProfile) => void;
  onProfileChange: (profile: PublicProfile) => void; onRemove: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLocale();
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile?.name || ''), [base, setBase] = useState(profile?.base || ''), [key, setKey] = useState('');
  const [protocol, setProtocol] = useState<Protocol>(profile?.protocol || 'chat');
  const initialModels = profile?.models?.length ? profile.models : profile?.model ? [profile.model] : [];
  const [available, setAvailable] = useState<string[]>(initialModels), [selected, setSelected] = useState<string[]>(initialModels);
  const [model, setModel] = useState(profile?.model || ''), [manual, setManual] = useState(''), [visible, showKey] = useState(false);
  const [savedKey, showSavedKey] = useState<string | null>(null), [revealing, setRevealing] = useState(false);
  const [onlySelected, filterSelected] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [results, setResults] = useState<TestResult[]>([]), [confirmBulk, setConfirmBulk] = useState(false), [confirmRemove, setConfirmRemove] = useState(false);
  const [stopping, setStopping] = useState(false), stopRequested = useRef(false);
  const controller = useRef<AbortController | null>(null), revealRequest = useRef<AbortController | null>(null), running = useRef(false);
  const baseInput = useRef<HTMLInputElement>(null), keyInput = useRef<HTMLInputElement>(null), manualInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { controller.current?.abort(); revealRequest.current?.abort(); }, []);
  const canReuseKey = !!saved && base.trim().replace(/\/+$/, '') === saved.base.replace(/\/+$/, '');
  const unchanged = !!saved && name === saved.name && canReuseKey && !key.trim() && protocol === saved.protocol && model === saved.model
    && JSON.stringify([...selected].sort()) === JSON.stringify([...(saved.models?.length ? saved.models : [saved.model])].sort());
  const payload = (chosenModel = model) => ({ name, base: base.trim(), key: key.trim(), protocol, model: chosenModel, models: selected, ...(saved ? { revision: saved.revision } : {}) });
  function clearReveal() { revealRequest.current?.abort(); showSavedKey(null); showKey(false); setRevealing(false); }
  async function toggleSecret() {
    if (visible || savedKey || revealing) { clearReveal(); return; }
    if (key) { showKey(true); return; }
    if (!saved || !canReuseKey) { keyInput.current?.focus(); return; }
    const abort = new AbortController(); revealRequest.current = abort; setRevealing(true); setError('');
    try { const data = await request<{ key: string }>('/reveal', 'POST', { revision: saved.revision }, abort.signal); if (!abort.signal.aborted) showSavedKey(data.key); }
    catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '密钥暂时无法显示。'); }
    finally { if (!abort.signal.aborted) setRevealing(false); }
  }
  function credentials() {
    if (!base.trim()) { setError('填写完整的 HTTPS Base URL。'); baseInput.current?.focus(); return false; }
    try { if (new URL(base).protocol !== 'https:') throw Error(); } catch { setError('Base URL 需要以 https:// 开头。'); baseInput.current?.focus(); return false; }
    if (!key.trim() && !canReuseKey) { setError('填写 API Key；已保存的密钥仅能用于原地址。'); keyInput.current?.focus(); return false; }
    return true;
  }
  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    running.current = true; const abort = new AbortController(); controller.current = abort;
    setBusy(label); onBusyChange(true); setError(''); clearReveal();
    try { await task(abort.signal); } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); }
    finally { running.current = false; setBusy(''); onBusyChange(false); }
  }
  function invalidate() { setResults([]); setConfirmBulk(false); }
  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    setSelected(next); if (!next.includes(model)) setModel(next[0] || ''); setConfirmBulk(false);
  }
  function add() {
    const id = manual.trim();
    if (!/^[-\w./:@+]{1,180}$/.test(id)) { setError('填写有效的模型 ID，例如 gpt-5.4-mini。'); manualInput.current?.focus(); return; }
    setAvailable(value => value.includes(id) ? value : [...value, id]); setSelected(value => value.includes(id) ? value : [...value, id]);
    if (!model) setModel(id); setManual(''); setError(''); setConfirmBulk(false);
  }
  async function list() {
    if (!credentials()) return;
    await run('正在读取模型列表…', async signal => {
      const data = await request<{ models: string[] }>('/models', 'POST', payload(), signal);
      setAvailable([...new Set([...selected, ...data.models])]);
      if (!data.models.length) setError('服务商返回空列表。仍可手填模型 ID。');
    });
  }
  async function probe(kind: 'connect' | 'model' | 'protocol', chosenModel = model) {
    if (!credentials()) return;
    if (kind !== 'connect' && !chosenModel) { setError('先选择或手填一个模型 ID，再做测试。'); manualInput.current?.focus(); return; }
    setResults([]);
    await run(kind === 'protocol' ? '正在检测协议…' : '正在测试…', async signal => {
      const data = await request<{ results: ProbeResult[] }>('/probe', 'POST', { ...payload(chosenModel), kind }, signal);
      setResults(data.results.map(result => ({ ...result, label: kind === 'connect' ? '连通性' : chosenModel })));
    });
  }
  async function testSelected() {
    if (!credentials() || !selected.length) return;
    stopRequested.current = false; setStopping(false);
    setConfirmBulk(false); setResults([]);
    await run(`正在逐个测试 ${selected.length} 个模型…`, async signal => {
      for (const id of selected) {
        if (signal.aborted || stopRequested.current) break;
        try {
          const data = await request<{ results: ProbeResult[] }>('/probe', 'POST', { ...payload(id), kind: 'model' }, signal);
          if (!signal.aborted) setResults(previous => [...previous, ...data.results.map(result => ({ ...result, label: id }))]);
        } catch (reason) { if (!signal.aborted) setResults(previous => [...previous, { label: id, protocol, ok: false, message: reason instanceof Error ? reason.message : '测试失败。' }]); }
      }
    });
  }
  async function vision(id: string) {
    if (!saved) return;
    await run('正在验证图片输入…', async signal => {
      const data = await request<{ profile: PublicProfile }>('/vision', 'POST', { revision: saved.revision, model: id }, signal);
      setSaved(data.profile); onProfileChange(data.profile);
    });
  }
  const shown = onlySelected ? available.filter(id => selected.includes(id)) : available;
  return <form className="personal-editor" noValidate onSubmit={event => {
    event.preventDefault(); if (unchanged && saved) { clearReveal(); onSave(saved); return; } if (!credentials()) return;
    if (!model || !selected.includes(model)) { setError('至少选择一个模型，并指定默认模型。'); manualInput.current?.focus(); return; }
    void run('正在保存并测试默认模型图片输入…', async signal => { const data = await request<{ profile: PublicProfile }>('', 'POST', payload(), signal); onSave(data.profile); });
  }}>
    <fieldset className="personal-fields" disabled={!!busy}>
      <div className="personal-row"><label htmlFor="personal-name">{t("名称")}</label><div><input id="personal-name" value={name} maxLength={60} placeholder={t("我的学习模型（可选）")} onChange={event => setName(event.target.value)}/></div></div>
      <div className="personal-row"><span className="personal-label" id="personal-protocol-label">{t("接口协议")}</span><div><div className="personal-protocol" role="group" aria-labelledby="personal-protocol-label">{protocols.map(item => <button type="button" key={item.id} aria-pressed={protocol === item.id} onClick={() => { setProtocol(item.id); invalidate(); }}>{t(item.label)}</button>)}<button type="button" disabled title={t("分类决策接口，不生成学习讲解")}>System One</button></div><p className="personal-hint">{t("System One 是分类决策接口，不生成学习讲解。")}</p></div></div>
      <div className="personal-row"><label htmlFor="personal-base">Base URL</label><div><input ref={baseInput} id="personal-base" type="url" autoComplete="url" value={base} placeholder="https://api.example.com/v1" onChange={event => { clearReveal(); setBase(event.target.value); invalidate(); }}/></div></div>
      <div className="personal-row"><label htmlFor="personal-key">API Key</label><div><div className="personal-secret"><input ref={keyInput} id="personal-key" type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={key} placeholder={canReuseKey ? t("已保存 · 留空沿用此地址的密钥") : t("粘贴服务商提供的密钥")} onChange={event => { clearReveal(); setKey(event.target.value); invalidate(); }}/><button type="button" aria-label={visible || savedKey || revealing ? t("隐藏密钥") : t("显示密钥")} aria-pressed={!!(visible || savedKey || revealing)} onClick={() => void toggleSecret()}><Eye visible={!!(visible || savedKey)}/></button></div>{savedKey && <div className="personal-revealed"><output aria-label={t("已保存的密钥")}>{savedKey}</output><small>{t("仅供查看；不会作为新输入提交。")}</small></div>}{revealing && <p className="personal-hint" role="status">{t("正在读取本人保存的密钥…")}</p>}<p className="personal-hint">{t("按当前账户隔离保存。眼睛可查看本次输入；留空时查看此地址已保存的密钥。")}</p></div></div>
      <div className="personal-row"><span className="personal-label">{t("检测")}</span><div><div className="personal-tools"><button type="button" onClick={() => void probe('connect')}>{t("测试连通性")}</button><button type="button" onClick={() => void probe('protocol')}>{t("检测协议")}</button></div><p className="personal-hint">{t("连通性读取服务元数据；协议检测最多发送 4 次文字请求，按服务商计费。")}</p></div></div>
      <div className="personal-row personal-models-row"><span className="personal-label" id="personal-model-label">{t("模型")}</span><div>
        <div className="personal-model-toolbar"><div className="personal-view" role="group" aria-label={t("模型列表显示")}><button type="button" aria-pressed={!onlySelected} onClick={() => filterSelected(false)}>{t("供应商列表")}</button><button type="button" aria-pressed={onlySelected} onClick={() => filterSelected(true)}>{t("仅已选 ")}<span>{selected.length}</span></button></div><button type="button" className="personal-link" onClick={() => void list()}>{t("读取列表")}</button></div>
        <div className="personal-selection-tools"><button type="button" disabled={!available.length} onClick={() => { setSelected(available); if (!available.includes(model)) setModel(available[0] || ''); setConfirmBulk(false); }}>{t("全选")}</button><button type="button" disabled={!selected.length} onClick={() => { setSelected([]); setModel(''); setConfirmBulk(false); }}>{t("清除选择")}</button><span>{t("已选 {0} / {1}", { 0: selected.length, 1: available.length })}</span></div>
        <div className="personal-model-chips" role="group" aria-labelledby="personal-model-label">{shown.length ? shown.map(id => <button type="button" key={id} aria-pressed={selected.includes(id)} className="personal-model-chip" onClick={() => toggle(id)}><span className="personal-chip-check" aria-hidden="true">{selected.includes(id) ? '✓' : '+'}</span><span>{id}</span>{id === model && <small>{t("默认")}</small>}</button>) : <p className="personal-model-empty">{onlySelected ? t("还没有选择模型。") : t("读取供应商列表，或在下方添加模型 ID。")}</p>}</div>
        <div className="personal-add-model"><label className="sr-only" htmlFor="personal-manual-model">{t("添加模型 ID")}</label><input ref={manualInput} id="personal-manual-model" value={manual} maxLength={180} placeholder={t("添加模型 ID…")} onChange={event => setManual(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }}/><button type="button" onClick={add} disabled={!manual.trim()}>{t("添加模型")}</button></div>
        <div className="personal-default-model"><label htmlFor="personal-default-model">{t("默认模型")}</label><select id="personal-default-model" value={model} disabled={!selected.length} onChange={event => { setModel(event.target.value); invalidate(); }}>{!selected.length && <option value="">{t("先选择模型")}</option>}{selected.map(id => <option key={id} value={id}>{id}</option>)}</select></div>
        <div className="personal-tools"><button type="button" disabled={!model} onClick={() => void probe('model')}>{t("测试当前模型")}</button><button type="button" disabled={!selected.length} onClick={() => setConfirmBulk(value => !value)}>{t("逐个测试已选模型")}</button></div><p className="personal-hint">{t("当前模型测试发送 1 次文字请求；逐个测试按已选数量发送请求，均由服务商计费。")}</p>
        {confirmBulk && <div className="personal-confirm"><p>{t("将向 {0} 个模型各发送一次文字测试，可能产生费用。", { 0: selected.length })}</p><button type="button" className="personal-primary" onClick={() => void testSelected()}>{t("开始逐个测试")}</button><button type="button" onClick={() => setConfirmBulk(false)}>{t("取消")}</button></div>}
      </div></div>
    </fieldset>
    {!!results.length && <section className="personal-results" aria-label={t("检测结果")} aria-live="polite"><h3>{t("检测结果")}</h3>{results.map((result, index) => <div key={index} className={result.ok ? 'is-ok' : 'is-failed'}><span aria-hidden="true">{result.ok ? '✓' : '×'}</span><div><strong>{t(result.label)} <small>{result.protocol}</small></strong><p>{t(result.message)}</p></div>{result.ok && protocol !== result.protocol && <button type="button" disabled={!!busy} onClick={() => setProtocol(result.protocol)}>{t("使用此协议")}</button>}</div>)}</section>}
    {saved && <section className="personal-vision"><div><h3>{t("图片输入实测")}</h3><p>{t("仅测试色卡，不发送讲义。每次测试产生 1 次图片请求费用。")}</p></div>{(saved.models?.length ? saved.models : [saved.model]).map(id => <div className="personal-vision-model" key={id}><span>{id}<small>{saved.visionModels?.includes(id) || id === saved.model && saved.vision ? t("已通过图片实测") : t("未通过或尚未实测")}</small></span><button type="button" disabled={!!busy} onClick={() => void vision(id)}>{t("重测图片")}</button></div>)}</section>}
    {error && <p className="personal-error" role="alert">{t(error)}</p>}{!!busy && <div className="personal-progress" role="status"><span/>{t(busy)}{busy.startsWith('正在逐个') && <><small>{t("已发出的请求可能计费。")}</small><button type="button" disabled={stopping} onClick={() => { stopRequested.current = true; setStopping(true); }}>{stopping ? t("当前请求完成后停止") : t("停止后续测试")}</button></>}</div>}
    <footer className="personal-footer"><div className="personal-save-note"><strong>{unchanged ? t("直接使用已有配置，不重复测试或计费") : t("保存时实测默认模型的图片输入")}</strong><p>{unchanged ? t("连接后，选区、问题与相关记忆会发往此服务商。") : t("发送 1 次随机色卡请求，可能产生少量费用。讲义、问题与相关记忆会发往此服务商。")}</p></div><div className="personal-footer-actions">{saved && <button type="button" className="personal-remove" disabled={!!busy} onClick={() => setConfirmRemove(value => !value)}>{t("移除配置")}</button>}<button type="submit" className="personal-primary" disabled={!!busy || !selected.length}>{unchanged ? t("使用已保存配置") : t("保存并使用")}</button></div>{confirmRemove && <div className="personal-confirm"><p>{t("移除此账户保存的地址和密钥，并切回站点默认；已有讨论保留。")}</p><button type="button" disabled={!!busy} onClick={() => setConfirmRemove(false)}>{t("取消")}</button><button type="button" className="personal-danger" disabled={!!busy} onClick={() => void run('正在移除配置…', async signal => { await request('', 'DELETE', undefined, signal); onRemove(); })}>{t("确认移除配置")}</button></div>}</footer>
  </form>;
}

export default function PersonalApi({ active, onChange, connection, gatewayActive, onGateway }: { connection:Gateway|null; gatewayActive:boolean; onGateway:(connection:Gateway|null)=>void; active: PublicProfile | null; onChange: (profile: PublicProfile | null) => void }) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<PublicProfile | null>(null), [tab, setTab] = useState<'default' | 'personal' | 'magpie'>('default');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [opened, setOpened] = useState(false);
  const loadingRequest = useRef<AbortController | null>(null);
  useEffect(() => () => loadingRequest.current?.abort(), []);
  function close() { if (busy) return; loadingRequest.current?.abort(); dialog.current?.close(); setOpened(false); setSaved(null); }
  async function open() {
    setSaved(null); setError(''); setTab(gatewayActive?'magpie':active ? 'personal' : 'default'); setOpened(true); setLoading(true); dialog.current?.showModal();
    const abort = new AbortController(); loadingRequest.current = abort;
    try { const data = await request<{ profile: PublicProfile | null }>('', 'GET', undefined, abort.signal); if (!abort.signal.aborted) setSaved(data.profile); }
    catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '配置暂时无法读取。'); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }
  return <><button className="import-button source-trigger" type="button" aria-label={t("模型来源")} title={t("模型来源")} onClick={() => void open()}><Plug size={16}/><span>{t("模型来源")}</span></button><dialog ref={dialog} className="personal-dialog" aria-labelledby="personal-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { setOpened(false); setSaved(null); loadingRequest.current?.abort(); }}>
    <header className="personal-header"><div><h2 id="personal-title">{t("模型来源")}</h2><p>{t("为你的学习空间连接模型")}</p></div><button type="button" className="personal-close" aria-label={t("关闭模型来源")} disabled={busy} onClick={close}>×</button></header>
    <div className="personal-tabs" role="tablist" aria-label={t("模型来源")} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); if (busy) return;
      const tabs=['default','personal','magpie'] as const;
      const next=tabs[event.key==='Home'?0:event.key==='End'?2:(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:2))%3];
      setTab(next);event.currentTarget.querySelector<HTMLButtonElement>(`#personal-tab-${next}`)?.focus();
    }}>{(['default','personal','magpie'] as const).map(id=><button key={id} type="button" id={`personal-tab-${id}`} role="tab" aria-controls={`personal-panel-${id}`} aria-selected={tab===id} tabIndex={tab===id?0:-1} disabled={busy} onClick={()=>setTab(id)}>{t({default:'站点默认',personal:'自带 API',magpie:'本机 Magpie'}[id])}</button>)}</div>
    <div className="personal-content">{tab==='personal' && error && <p className="personal-error" role="alert">{t(error)}</p>}{opened && (tab==='magpie'?<Magpie connection={connection} change={value=>{onGateway(value);close()}}/>:tab === 'default' ? <section id="personal-panel-default" role="tabpanel" aria-labelledby="personal-tab-default" className="personal-site-default"><h3>{t("站点提供的模型与额度")}</h3><p>{t("无需填写密钥。在提问区选择模型、思考强度与速度。")}</p><button type="button" className="personal-primary" onClick={() => { onChange(null); close(); }}>{t("使用站点默认")}</button></section> : <section id="personal-panel-personal" role="tabpanel" aria-labelledby="personal-tab-personal">{loading ? <p className="personal-loading" role="status">{t("正在读取此账户的配置…")}</p> : error ? <button type="button" className="personal-retry" onClick={() => void open()}>{t("重新读取配置")}</button> : <PersonalApiEditor key={saved?.revision || 'new'} profile={saved} onBusyChange={setBusy} onSave={profile => { onChange(profile); dialog.current?.close(); setOpened(false); setSaved(null); }} onProfileChange={profile => { setSaved(profile); if (active?.revision === saved?.revision) onChange(profile); }} onRemove={() => { setSaved(null); onChange(null); dialog.current?.close(); setOpened(false); }}/>}</section>)}</div>
  </dialog></>;
}
