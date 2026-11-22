'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  clampLeafCount,
  clampLeafSize,
  DEFAULT_LEAF_COUNT,
  DEFAULT_LEAF_SIZE,
  MAX_LEAF_COUNT,
  MAX_LEAF_SIZE,
  MIN_LEAF_COUNT,
  MIN_LEAF_SIZE,
} from './PaperLeaves';
import { useTheme } from './ThemeProvider';
import { creditNumber, hasPricing, type Pricing } from './useStudyCredits';
import './study-account.css';

type ExpenseCall = {
  purpose: string;
  model: string;
  modelSource?: 'reported' | 'requested';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  cachedTokens?: number;
  cacheWrite30mTokens?: number;
  cacheWrite12hTokens?: number;
  usagePricing?: {
    usd: number;
    tier: string;
    rateVersion: string;
    rates: { input: number; output: number; cached: number; write30m: number; write12h: number };
  };
  meteredCredits: number;
  chargeable: boolean;
};
type ExpenseDetail = {
  course?: string; documentId?: string; documentName?: string; threadId?: string;
  question?: string; model?: string; page?: number; source?: 'site';
  reason?: string;
  operation?: 'answer' | 'index'; calls?: ExpenseCall[]; creditsPerUsd?: number;
  meteredCredits?: number; cap?: number; sponsoredCredits?: number; creditsCharged?: number;
};

type LedgerEntry = {
  id: string; kind: string; label: string; credits: number; studyDate: string; createdAt: number; sourceId: string;
  detail?: ExpenseDetail | null;
};
type Account = {
  displayName: string | null;
  balance: number;
  availableBalance: number;
  totalEarned: number;
  totalSpent: number;
  pricing?: Pricing;
  today: { date: string; earned: number; dailyLimit: number };
  timezone: string;
  rules: { kind: string; label: string; credits: number; dailyLimit: number; earnedToday: boolean }[];
  ledger: LedgerEntry[];
  nextCursor?: string;
};

function discussionLink(detail: LedgerEntry['detail']) {
  if (!detail?.documentId || !detail.threadId) return null;
  const query = new URLSearchParams({ document: detail.documentId, discussion: detail.threadId });
  if (detail.page && Number.isSafeInteger(detail.page) && detail.page > 0) query.set('page', String(detail.page));
  return `/?${query}#reader`;
}

const callsByPurpose: Record<string, string> = { answer: '生成回答', retrieval: '检索项目记忆', index: '整理项目记忆' };
const usdNumber = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 17 });
const tokenCount = (count?: number) => count == null ? '未回传' : count.toLocaleString('zh-CN');

const tierLabels: Record<string,string> = {default:'标准', fast:'Fast', ultrafast:'Ultrafast', flex:'Flex'};

function CallCharge({ call }: { call: ExpenseCall }) {
  const price=call.usagePricing;
  if(!price&&call.costUsd==null)return <p>未回传费用，本次免计（0.000 分）</p>;
  const usd=price?.usd??call.costUsd??0;
  return <>
    <p>{price ? `按用量结算 · ${tierLabels[price.tier]??price.tier}档` : '服务商回传费用'} · US${usdNumber.format(usd)}
      {' · 折合 '}{creditNumber.format(call.meteredCredits)} 分{!call.chargeable&&' · 本次免计（0.000 分）'}</p>
    {price&&<p>官方单价（美元／百万 token） · 输入 {price.rates.input} · 缓存读取 {price.rates.cached} · 输出 {price.rates.output}
      {!!call.cacheWrite30mTokens&&` · 30 分钟写入 ${price.rates.write30m}`}
      {!!call.cacheWrite12hTokens&&` · 12 小时写入 ${price.rates.write12h}`}
      {' · '}{price.rateVersion} 版</p>}
  </>;
}

function ExpenseUsage({ entry }: { entry: LedgerEntry }) {
  const detail = entry.detail;
  const charged = detail?.creditsCharged ?? Math.abs(entry.credits);
  return <div className="study-account__usage">
    <p><strong>{entry.kind === 'site_memory' || detail?.operation === 'index' ? '记忆整理' : '站点问答'}</strong>
      {' · 实扣 '}{creditNumber.format(charged)} 分
      {detail?.cap != null && <> · 本次上限 {creditNumber.format(detail.cap)} 分</>}
    </p>
    <p>{detail?.meteredCredits != null && <>计费调用合计 {creditNumber.format(detail.meteredCredits)} 分</>}
      {detail?.sponsoredCredits != null && <> · 站点承担 {creditNumber.format(detail.sponsoredCredits)} 分</>}
      {detail?.creditsPerUsd != null && <> · 每美元 {creditNumber.format(detail.creditsPerUsd)} 分</>}
    </p>
    {detail?.calls?.length ? detail.calls.map((call, i) => <div className="study-account__call" key={i}>
      <p><strong>{callsByPurpose[call.purpose] ?? call.purpose}</strong> · {call.model || '型号未回传'}{call.modelSource === 'requested' && '（请求型号）'}</p>
      <CallCharge call={call}/>
      <p>Token 用量 · 输入 {tokenCount(call.inputTokens)} · 输出 {tokenCount(call.outputTokens)} · 合计 {tokenCount(call.totalTokens)}
        {call.usagePricing&&call.cachedTokens!=null&&` · 缓存读取 ${tokenCount(call.cachedTokens)}`}
        {!!call.cacheWrite30mTokens&&` · 30 分钟写入 ${tokenCount(call.cacheWrite30mTokens)}`}
        {!!call.cacheWrite12hTokens&&` · 12 小时写入 ${tokenCount(call.cacheWrite12hTokens)}`}</p>
    </div>) : <p>这笔记录未提供逐次调用的费用与用量。</p>}
  </div>;
}
const studyDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timestamp = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

export default function StudyAccount({ onClose, showAdmin = false, accountSource = 'chatgpt' }: {
  onClose: () => void; showAdmin?: boolean; accountSource?: 'chatgpt' | 'oidc';
}) {
  const { theme, setTheme } = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const ledgerHeading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const titleId = useId(), descriptionId = useId(), rulesId = useId(), ledgerId = useId(), pricingId = useId();
  const [account, setAccount] = useState<Account | null>(null);
  // Only successful navigation changes the cursor stack, so retry never skips records.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCursors, setRetryCursors] = useState<(string | null)[]>([null]);
  const [leavesEnabled, setLeavesEnabled] = useState(true);
  const [leafCount, setLeafCount] = useState(DEFAULT_LEAF_COUNT);
  const [leafSize, setLeafSize] = useState(DEFAULT_LEAF_SIZE);

  function updateLeavesEnabled(enabled: boolean) {
    setLeavesEnabled(enabled);
    const value = enabled ? 'on' : 'off';
    try {
      localStorage.setItem('pagewise:background-motion', value);
    } catch {}
    document.documentElement.dataset.backgroundMotion = value;
  }

  function updateLeafCount(next: number) {
    const clamped = clampLeafCount(next);
    setLeafCount(clamped);
    try {
      localStorage.setItem('pagewise:leaf-count', String(clamped));
    } catch {}
    document.documentElement.dataset.leafCount = String(clamped);
  }

  function updateLeafSize(next: number) {
    const clamped = clampLeafSize(next);
    setLeafSize(clamped);
    try {
      localStorage.setItem('pagewise:leaf-size', String(clamped));
    } catch {}
    document.documentElement.dataset.leafSize = String(clamped);
  }

  async function load(target: (string | null)[] = [null], focusLedger = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort('timeout'), 20000);
    setLoading(true); setError(''); setRetryCursors(target);
    try {
      const cursor = target[target.length - 1];
      const response = await fetch(`/api/study/account${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? '登录状态已失效，请重新登录后查看。' : '账户暂时无法读取，请重试。');
      const data: Account = await response.json();
      if (!controller.signal.aborted) {
        setAccount(data); setCursors(target);
        if (focusLedger) window.requestAnimationFrame(() => {
          if (controller.signal.aborted) return;
          ledgerHeading.current?.focus({ preventScroll: true });
          ledgerHeading.current?.scrollIntoView({ block: 'start' });
        });
      }
    } catch (reason) {
      if (request.current === controller && (!controller.signal.aborted || controller.signal.reason === 'timeout')) {
        setError(controller.signal.reason === 'timeout' ? '读取超时，请检查网络后重试。' : reason instanceof Error ? reason.message : '账户暂时无法读取，请重试。');
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller && (!controller.signal.aborted || controller.signal.reason === 'timeout')) setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const enabled = localStorage.getItem('pagewise:background-motion') !== 'off';
      const storedCount = localStorage.getItem('pagewise:leaf-count');
      const storedSize = localStorage.getItem('pagewise:leaf-size');
      const resolvedCount = storedCount != null ? clampLeafCount(storedCount) : DEFAULT_LEAF_COUNT;
      const resolvedSize = storedSize != null ? clampLeafSize(storedSize) : DEFAULT_LEAF_SIZE;
      setLeavesEnabled(enabled);
      setLeafCount(resolvedCount);
      setLeafSize(resolvedSize);
      document.documentElement.dataset.backgroundMotion = enabled ? 'on' : 'off';
      document.documentElement.dataset.leafCount = String(resolvedCount);
      document.documentElement.dataset.leafSize = String(resolvedSize);
    } catch {}
  }, []);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = 'hidden';
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(initialLoad);
      request.current?.abort();
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialog} className="study-account" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    <header className="study-account__header">
      <div><h2 id={titleId}>{account?.displayName || '个人账户'}</h2><p id={descriptionId}>积分余额、收支与使用规则</p></div>
      <button ref={closeButton} type="button" className="study-account__close" aria-label="关闭个人账户" onClick={onClose}><span aria-hidden="true">×</span></button>
    </header>
    <div className="study-account__scroll">
      <section className="study-account__appearance" aria-labelledby="study-account-appearance">
        <div><h3 id="study-account-appearance">外观</h3><p>选择阅读时的明暗主题。</p></div>
        <div className="study-account__appearance-options" role="group" aria-label="外观主题">
          {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>{label}</button>)}
        </div>
      </section>
      <section className="study-account__appearance study-account__appearance--leaves" aria-labelledby="study-account-background">
        <div className="study-account__appearance-head">
          <div><h3 id="study-account-background">背景动效</h3><p>在首页和项目页显示缓缓飘落的秋叶，可调整叶片数量与平均大小。</p></div>
          <label className="study-account__switch"><input type="checkbox" checked={leavesEnabled} onChange={event => updateLeavesEnabled(event.currentTarget.checked)}/><span>显示叶片</span></label>
        </div>
        <div className={`study-account__leaf-controls${leavesEnabled ? '' : ' is-disabled'}`} aria-label="秋叶参数调节">
          <label className="study-account__range-row">
            <span className="study-account__range-label">
              <span>叶片数量</span>
              <strong>{leafCount} 片</strong>
            </span>
            <input
              type="range"
              min={MIN_LEAF_COUNT}
              max={MAX_LEAF_COUNT}
              step={2}
              value={leafCount}
              disabled={!leavesEnabled}
              aria-label="叶片数量"
              onChange={event => updateLeafCount(Number(event.currentTarget.value))}
            />
          </label>
          <label className="study-account__range-row">
            <span className="study-account__range-label">
              <span>叶片平均大小</span>
              <strong>{leafSize} px</strong>
            </span>
            <input
              type="range"
              min={MIN_LEAF_SIZE}
              max={MAX_LEAF_SIZE}
              step={0.5}
              value={leafSize}
              disabled={!leavesEnabled}
              aria-label="叶片平均大小"
              onChange={event => updateLeafSize(Number(event.currentTarget.value))}
            />
          </label>
          {(leafCount !== DEFAULT_LEAF_COUNT || leafSize !== DEFAULT_LEAF_SIZE) && (
            <div className="study-account__leaf-reset">
              <button
                type="button"
                disabled={!leavesEnabled}
                onClick={() => {
                  updateLeafCount(DEFAULT_LEAF_COUNT);
                  updateLeafSize(DEFAULT_LEAF_SIZE);
                }}
              >
                恢复默认（{DEFAULT_LEAF_COUNT} 片 · {DEFAULT_LEAF_SIZE} px）
              </button>
            </div>
          )}
        </div>
      </section>
      <nav className="study-account__auth" aria-label="账户操作">
        <a href="/login">登录方式</a>
        {showAdmin && <a href="/admin/credits">积分管理</a>}
        {accountSource==='oidc'
          ? <form method="post" action="/api/auth/logout"><button type="submit">退出登录</button></form>
          : <a href="/signout-with-chatgpt?return_to=%2Flogin" target="_top">退出登录</a>}
      </nav>
      <div className="study-account__toolbar"><span>学习积分</span><button type="button" disabled={loading} onClick={() => void load()}>{loading ? '正在读取…' : '刷新至最新'}</button></div>
      <p className="study-account__sr" role="status">{loading ? '正在读取账户和积分记录。' : account && !error ? `已显示第 ${cursors.length} 页，${account.ledger.length} 笔记录。` : ''}</p>
      {error && <div className="study-account__error" role="alert"><p>{error}</p>{account && <p>未切换页面，以下仍为上次读取的第 {cursors.length} 页记录。</p>}<button type="button" onClick={() => void load(retryCursors, !!account)} disabled={loading}>重试读取</button></div>}
      {!account && loading && <p className="study-account__empty">正在读取此账户的学习积分…</p>}
      {account && <div aria-busy={loading}>
        <section className="study-account__balance" aria-label="积分概览">
          <dl><div><dt>积分余额</dt><dd>{creditNumber.format(account.balance)}<span>分</span></dd></div></dl>
          <dl className="study-account__totals"><div><dt>累计获得</dt><dd>{creditNumber.format(account.totalEarned)}<span>分</span></dd></div><div><dt>累计支出</dt><dd>{creditNumber.format(account.totalSpent)}<span>分</span></dd></div></dl>

          {account.availableBalance < account.balance && <p className="study-account__note">可用 {creditNumber.format(account.availableBalance)} 分，处理中暂占 {creditNumber.format(account.balance - account.availableBalance)} 分。</p>}
          {account.availableBalance < 0.001 && <p className="study-account__low-balance">积分不足以使用站点额度回答。可先获得学习奖励，或切换个人 API、Magpie、本地模型等来源继续学习。</p>}
        </section>
        <section className="study-account__ledger" aria-labelledby={ledgerId}>
          <div className="study-account__section-heading"><h3 id={ledgerId} ref={ledgerHeading} tabIndex={-1}>收支明细</h3><span>北京时间 · 新到旧</span></div>
          {account.ledger.length ? <ol key={cursors[cursors.length - 1] || 'latest'}>{account.ledger.map(entry => {
            const spent = entry.credits < 0 || entry.kind === 'site_answer' || entry.kind === 'site_memory';
            const detail = entry.detail;
            const modelExpense=entry.kind==='site_answer'||entry.kind==='site_memory';
            const href = spent ? discussionLink(detail) : null;
            return <li key={entry.id}>
              <div className="study-account__entry">
                <div className="study-account__entry-heading"><strong>{href ? <a href={href} onClick={onClose}>{detail?.question || entry.label}</a> : detail?.question || entry.label}</strong><span className={spent ? 'study-account__debit' : 'study-account__credit'}><span className="study-account__sr">{spent ? '支出' : '获得'}</span>{spent ? (entry.credits ? '−' : '') : '+'}{creditNumber.format(Math.abs(entry.credits))}<small> 分</small></span></div>
                {(detail?.course || detail?.documentName) && <p className="study-account__context">{[detail.course, detail.documentName].filter(Boolean).join(' / ')}</p>}
                <p className="study-account__entry-meta"><time dateTime={new Date(entry.createdAt).toISOString()}>{timestamp.format(entry.createdAt)}</time>{detail?.model && <span>{detail.model}</span>}{studyDay.format(entry.createdAt) !== entry.studyDate && <span>计分日 {entry.studyDate}</span>}</p>
                {detail?.reason && <p className="study-account__context">调整原因 · {detail.reason}</p>}
                {modelExpense && <ExpenseUsage entry={entry}/>}
              </div>
            </li>;
          })}</ol> : <div className="study-account__empty"><p>{cursors.length > 1 ? '这一页没有记录' : '还没有收支记录'}</p><p>{cursors.length > 1 ? '返回上一页，或刷新至最新记录。' : '完成问答或修改并保存非空笔记后，可在这里查看学习奖励。'}</p></div>}
          <nav className="study-account__pagination" aria-label="收支明细分页">
            <button type="button" disabled={loading || cursors.length === 1} onClick={() => void load(cursors.slice(0, -1), true)}>上一页</button>
            <span>第 {cursors.length} 页</span>
            <button type="button" disabled={loading || !account.nextCursor} onClick={() => { if (account.nextCursor) void load([...cursors, account.nextCursor], true); }}>下一页</button>
          </nav>
          {!account.nextCursor && account.ledger.length > 0 && <p className="study-account__note">已到最早一笔记录。</p>}
        </section>
        <details className="study-account__disclosure">
          <summary id={pricingId}>积分使用规则</summary>
          <div className="study-account__disclosure-body" aria-labelledby={pricingId}>
            {hasPricing(account.pricing) ? <p>按实际 token 和 OpenAI 官方单价计费，每 1 美元折算为 {creditNumber.format(account.pricing.creditsPerUsd)} 分。每次回答最多 {creditNumber.format(account.pricing.answerCap)} 分，记忆整理另计，每批最多 {creditNumber.format(account.pricing.memoryCap)} 分。两项均以可用积分为限。</p> : <p>当前站点报价暂不可用。</p>}
            <p>问答的记忆检索和生成回答分别核价，合计后结算。超过本次上限的部分由站点承担。</p>
            <p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">OpenAI 官方价格表</a></p>
            <p>个人 API 与 Magpie 使用自己的模型额度，问答和记忆整理均为 0.000 站内积分。</p>
          </div>
        </details>
        <details className="study-account__disclosure">
          <summary id={rulesId}>免费获得积分</summary>
          <div className="study-account__disclosure-body" aria-labelledby={rulesId}>
            <div className="study-account__today"><span>今日奖励 <strong>{creditNumber.format(account.today.earned)} / {creditNumber.format(account.today.dailyLimit)}</strong> 分</span><time dateTime={account.today.date}>{account.today.date}</time></div>
            <ul className="study-account__reward-list">{account.rules.map(rule => <li key={rule.kind}>
              <div><strong>{rule.label}</strong><p>每日最多 {rule.dailyLimit} 次 · {rule.earnedToday ? '今日已获得' : '今日尚未获得'}</p></div>
              <span className="study-account__credit">+{creditNumber.format(rule.credits)}<small> 分</small></span>
            </li>)}</ul>
            <p className="study-account__note">每个账户一次性获赠 10.000 分。每日奖励按北京时间 00:00 重置。</p>
            <p className="study-account__note">阅读、上传、空白或未修改的笔记不计分。</p>
          </div>
        </details>
      </div>}
    </div>
    <footer className="study-account__footer"><button type="button" onClick={onClose}>返回学习</button></footer>
  </dialog>;
}
