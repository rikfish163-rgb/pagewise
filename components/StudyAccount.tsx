'use client';

import { useLocale } from './LocaleProvider';
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
import LanguageSwitcher from './LanguageSwitcher';
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
const tierLabels: Record<string,string> = {default:'标准', fast:'Fast', ultrafast:'Ultrafast', flex:'Flex'};

function CallCharge({ call }: { call: ExpenseCall }) {
  const { t } = useLocale();
  const price=call.usagePricing;
  if(!price&&call.costUsd==null)return <p>{t("未回传费用，本次免计（0.000 分）")}</p>;
  const usd=price?.usd??call.costUsd??0;
  return <>
    <p>{price
      ? t('按用量结算 · {tier}档', { tier: t(tierLabels[price.tier] ?? price.tier) })
      : t('服务商回传费用')}
      {' · '}{t('US${usd} · 折合 {credits} 分', {
        usd: usdNumber.format(usd), credits: creditNumber.format(call.meteredCredits),
      })}
      {!call.chargeable && t(' · 本次免计（0.000 分）')}
    </p>
    {price&&<p>{t('官方单价（美元／百万 token） · 输入 {input} · 缓存读取 {cached} · 输出 {output}', {
      input: price.rates.input, cached: price.rates.cached, output: price.rates.output,
    })}
      {!!call.cacheWrite30mTokens && t(' · 30 分钟写入 {rate}', { rate: price.rates.write30m })}
      {!!call.cacheWrite12hTokens && t(' · 12 小时写入 {rate}', { rate: price.rates.write12h })}
      {' · '}{t('{version} 版', { version: price.rateVersion })}
    </p>}
  </>;
}

function ExpenseUsage({ entry }: { entry: LedgerEntry }) {
  const { t, locale } = useLocale();
  const tokenCount = (count?: number) => count == null ? t('未回传') : count.toLocaleString(locale);
  const detail = entry.detail;
  const charged = detail?.creditsCharged ?? Math.abs(entry.credits);
  return <div className="study-account__usage">
    <p><strong>{entry.kind === 'site_memory' || detail?.operation === 'index' ? t("记忆整理") : t("站点问答")}</strong>
      {t(" · 实扣 ")}{creditNumber.format(charged)}{t("分")}{detail?.cap != null && <>{t(" · 本次上限 ")}{creditNumber.format(detail.cap)}{t(" 分")}</>}
    </p>
    <p>{detail?.meteredCredits != null && <>{t("计费调用合计 ")}{creditNumber.format(detail.meteredCredits)}{t(" 分")}</>}
      {detail?.sponsoredCredits != null && <>{t(" · 站点承担 ")}{creditNumber.format(detail.sponsoredCredits)}{t(" 分")}</>}
      {detail?.creditsPerUsd != null && <>{t(" · 每美元 ")}{creditNumber.format(detail.creditsPerUsd)}{t(" 分")}</>}
    </p>
    {detail?.calls?.length ? detail.calls.map((call, i) => <div className="study-account__call" key={i}>
      <p><strong>{t(callsByPurpose[call.purpose] ?? call.purpose)}</strong> · {call.model || t("型号未回传")}{call.modelSource === 'requested' && t("（请求型号）")}</p>
      <CallCharge call={call}/>
      <p>{t('Token 用量 · 输入 {input} · 输出 {output} · 合计 {total}', {
        input: tokenCount(call.inputTokens), output: tokenCount(call.outputTokens), total: tokenCount(call.totalTokens),
      })}
        {call.usagePricing&&call.cachedTokens!=null&&t(' · 缓存读取 {count}', { count: tokenCount(call.cachedTokens) })}
        {!!call.cacheWrite30mTokens&&t(' · 30 分钟写入 {rate}', { rate: tokenCount(call.cacheWrite30mTokens) })}
        {!!call.cacheWrite12hTokens&&t(' · 12 小时写入 {rate}', { rate: tokenCount(call.cacheWrite12hTokens) })}
      </p>
    </div>) : <p>{t("这笔记录未提供逐次调用的费用与用量。")}</p>}
  </div>;
}
const studyDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

export default function StudyAccount({ onClose, showAdmin = false, accountSource = 'chatgpt' }: {
  onClose: () => void; showAdmin?: boolean; accountSource?: 'chatgpt' | 'oidc';
}) {
  const { t, locale } = useLocale();
  const timestamp = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
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
  const [leavesEnabled, setLeavesEnabled] = useState(()=>{
    try{return localStorage.getItem('pagewise:background-motion')!=='off';}catch{return true;}
  });
  const [leafCount, setLeafCount] = useState(()=>{
    try{return clampLeafCount(localStorage.getItem('pagewise:leaf-count')??DEFAULT_LEAF_COUNT);}catch{return DEFAULT_LEAF_COUNT;}
  });
  const [leafSize, setLeafSize] = useState(()=>{
    try{return clampLeafSize(localStorage.getItem('pagewise:leaf-size')??DEFAULT_LEAF_SIZE);}catch{return DEFAULT_LEAF_SIZE;}
  });

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
      <div><h2 id={titleId}>{account?.displayName || t("个人账户")}</h2><p id={descriptionId}>{t("积分余额、收支与使用规则")}</p></div>
      <button ref={closeButton} type="button" className="study-account__close" aria-label={t("关闭个人账户")} onClick={onClose}><span aria-hidden="true">×</span></button>
    </header>
    <div className="study-account__scroll">
      <section className="study-account__appearance" aria-labelledby="study-account-appearance">
        <div><h3 id="study-account-appearance">{t("外观")}</h3><p>{t("选择阅读时的明暗主题。")}</p></div>
        <div className="study-account__appearance-options" role="group" aria-label={t("外观主题")}>
          {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>{t(label)}</button>)}
        </div>
      </section>
      <section className="study-account__appearance" aria-labelledby="study-account-language">
        <div><h3 id="study-account-language">{t('语言')}</h3><p>{t('选择界面语言。')}</p></div>
        <LanguageSwitcher/>
      </section>
      <section className="study-account__appearance study-account__appearance--leaves" aria-labelledby="study-account-background">
        <div className="study-account__appearance-head">
          <div><h3 id="study-account-background">{t("背景动效")}</h3><p>{t("在宽屏学习首页显示落叶，可调整叶片数量与平均大小。")}</p></div>
          <label className="study-account__switch"><input type="checkbox" checked={leavesEnabled} onChange={event => updateLeavesEnabled(event.currentTarget.checked)}/><span>{t("显示叶片")}</span></label>
        </div>
        <div className={`study-account__leaf-controls${leavesEnabled ? '' : ' is-disabled'}`} aria-label={t("秋叶参数调节")}>
          <label className="study-account__range-row">
            <span className="study-account__range-label">
              <span>{t("叶片数量")}</span>
              <strong>{t("{0} 片", { 0: leafCount })}</strong>
            </span>
            <input
              type="range"
              min={MIN_LEAF_COUNT}
              max={MAX_LEAF_COUNT}
              step={2}
              value={leafCount}
              disabled={!leavesEnabled}
              aria-label={t("叶片数量")}
              onChange={event => updateLeafCount(Number(event.currentTarget.value))}
            />
          </label>
          <label className="study-account__range-row">
            <span className="study-account__range-label">
              <span>{t("叶片平均大小")}</span>
              <strong>{leafSize} px</strong>
            </span>
            <input
              type="range"
              min={MIN_LEAF_SIZE}
              max={MAX_LEAF_SIZE}
              step={0.5}
              value={leafSize}
              disabled={!leavesEnabled}
              aria-label={t("叶片平均大小")}
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
              >{t("恢复默认（{0} 片 · {1}px）", { 0: DEFAULT_LEAF_COUNT, 1: DEFAULT_LEAF_SIZE })}</button>
            </div>
          )}
        </div>
      </section>
      <nav className="study-account__auth" aria-label={t("账户操作")}>
        <a href="/login">{t("登录方式")}</a>
        {showAdmin && <a href="/admin/credits">{t("积分管理")}</a>}
        {accountSource==='oidc'
          ? <form method="post" action="/api/auth/logout"><button type="submit">{t("退出登录")}</button></form>
          : <a href="/signout-with-chatgpt?return_to=%2Flogin" target="_top">{t("退出登录")}</a>}
      </nav>
      <div className="study-account__toolbar"><span>{t("学习积分")}</span><button type="button" disabled={loading} onClick={() => void load()}>{loading ? t("正在读取…") : t("刷新至最新")}</button></div>
      <p className="study-account__sr" role="status">{loading ? t("正在读取账户和积分记录。") : account && !error ? t("已显示第 {0} 页，{1} 笔记录。", { 0: cursors.length, 1: account.ledger.length }) : ''}</p>
      {error && <div className="study-account__error" role="alert"><p>{t(error)}</p>{account && <p>{t("未切换页面，以下仍为上次读取的第 {0} 页记录。", { 0: cursors.length })}</p>}<button type="button" onClick={() => void load(retryCursors, !!account)} disabled={loading}>{t("重试读取")}</button></div>}
      {!account && loading && <p className="study-account__empty">{t("正在读取此账户的学习积分…")}</p>}
      {account && <div aria-busy={loading}>
        <section className="study-account__balance" aria-label={t("积分概览")}>
          <dl><div><dt>{t("积分余额")}</dt><dd>{creditNumber.format(account.balance)}<span>{t("分")}</span></dd></div></dl>
          <dl className="study-account__totals"><div><dt>{t("累计获得")}</dt><dd>{creditNumber.format(account.totalEarned)}<span>{t("分")}</span></dd></div><div><dt>{t("累计支出")}</dt><dd>{creditNumber.format(account.totalSpent)}<span>{t("分")}</span></dd></div></dl>

          {account.availableBalance < account.balance && <p className="study-account__note">{t("可用 {0} 分，处理中暂占 {1} 分。", { 0: creditNumber.format(account.availableBalance), 1: creditNumber.format(account.balance - account.availableBalance) })}</p>}
          {account.availableBalance < 0.001 && <p className="study-account__low-balance">{t("积分不足以使用站点额度回答。可先获得学习奖励，或切换个人 API、Magpie、本地模型等来源继续学习。")}</p>}
        </section>
        <section className="study-account__ledger" aria-labelledby={ledgerId}>
          <div className="study-account__section-heading"><h3 id={ledgerId} ref={ledgerHeading} tabIndex={-1}>{t("收支明细")}</h3><span>{t("北京时间 · 新到旧")}</span></div>
          {account.ledger.length ? <ol key={cursors[cursors.length - 1] || 'latest'}>{account.ledger.map(entry => {
            const spent = entry.credits < 0 || entry.kind === 'site_answer' || entry.kind === 'site_memory';
            const detail = entry.detail;
            const modelExpense=entry.kind==='site_answer'||entry.kind==='site_memory';
            const href = spent ? discussionLink(detail) : null;
            return <li key={entry.id}>
              <div className="study-account__entry">
                <div className="study-account__entry-heading"><strong>{href ? <a href={href} onClick={onClose}>{detail?.question || t(entry.label)}</a> : detail?.question || t(entry.label)}</strong><span className={spent ? 'study-account__debit' : 'study-account__credit'}><span className="study-account__sr">{spent ? t("支出") : t("获得")}</span>{spent ? (entry.credits ? '−' : '') : '+'}{creditNumber.format(Math.abs(entry.credits))}<small>{t(" 分")}</small></span></div>
                {(detail?.course || detail?.documentName) && <p className="study-account__context">{[detail.course, detail.documentName].filter(Boolean).join(' / ')}</p>}
                <p className="study-account__entry-meta"><time dateTime={new Date(entry.createdAt).toISOString()}>{timestamp.format(entry.createdAt)}</time>{detail?.model && <span>{detail.model}</span>}{studyDay.format(entry.createdAt) !== entry.studyDate && <span>{t("计分日 {0}", { 0: entry.studyDate })}</span>}</p>
                {detail?.reason && <p className="study-account__context">{t("调整原因 · {0}", { 0: detail.reason })}</p>}
                {modelExpense && <ExpenseUsage entry={entry}/>}
              </div>
            </li>;
          })}</ol> : <div className="study-account__empty"><p>{cursors.length > 1 ? t("这一页没有记录") : t("还没有收支记录")}</p><p>{cursors.length > 1 ? t("返回上一页，或刷新至最新记录。") : t("完成问答或修改并保存非空笔记后，可在这里查看学习奖励。")}</p></div>}
          <nav className="study-account__pagination" aria-label={t("收支明细分页")}>
            <button type="button" disabled={loading || cursors.length === 1} onClick={() => void load(cursors.slice(0, -1), true)}>{t("上一页")}</button>
            <span>{t("第 {0} 页", { 0: cursors.length })}</span>
            <button type="button" disabled={loading || !account.nextCursor} onClick={() => { if (account.nextCursor) void load([...cursors, account.nextCursor], true); }}>{t("下一页")}</button>
          </nav>
          {!account.nextCursor && account.ledger.length > 0 && <p className="study-account__note">{t("已到最早一笔记录。")}</p>}
        </section>
        <details className="study-account__disclosure">
          <summary id={pricingId}>{t("积分使用规则")}</summary>
          <div className="study-account__disclosure-body" aria-labelledby={pricingId}>
            {hasPricing(account.pricing) ? <p>{t("按实际 token 和 OpenAI 官方单价计费，每 1 美元折算为 {0} 分。每次回答最多 {1} 分，记忆整理另计，每批最多 {2} 分。两项均以可用积分为限。", { 0: creditNumber.format(account.pricing.creditsPerUsd), 1: creditNumber.format(account.pricing.answerCap), 2: creditNumber.format(account.pricing.memoryCap) })}</p> : <p>{t("当前站点报价暂不可用。")}</p>}
            <p>{t("问答的记忆检索和生成回答分别核价，合计后结算。超过本次上限的部分由站点承担。")}</p>
            <p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">{t("OpenAI 官方价格表")}</a></p>
            <p>{t("个人 API 与 Magpie 使用自己的模型额度，问答和记忆整理均为 0.000 站内积分。")}</p>
          </div>
        </details>
        <details className="study-account__disclosure">
          <summary id={rulesId}>{t("免费获得积分")}</summary>
          <div className="study-account__disclosure-body" aria-labelledby={rulesId}>
            <div className="study-account__today"><span>{t("今日奖励 ")}<strong>{creditNumber.format(account.today.earned)} / {creditNumber.format(account.today.dailyLimit)}</strong>{t(" 分")}</span><time dateTime={account.today.date}>{account.today.date}</time></div>
            <ul className="study-account__reward-list">{account.rules.map(rule => <li key={rule.kind}>
              <div><strong>{t(rule.label)}</strong><p>{t("每日最多 {0} 次 · {1}", { 0: rule.dailyLimit, 1: rule.earnedToday ? t('今日已获得') : t('今日尚未获得') })}</p></div>
              <span className="study-account__credit">+{creditNumber.format(rule.credits)}<small>{t(" 分")}</small></span>
            </li>)}</ul>
            <p className="study-account__note">{t("每个账户一次性获赠 10.000 分。每日奖励按北京时间 00:00 重置。")}</p>
            <p className="study-account__note">{t("阅读、上传、空白或未修改的笔记不计分。")}</p>
          </div>
        </details>
      </div>}
    </div>
    <footer className="study-account__footer"><button type="button" onClick={onClose}>{t("返回学习")}</button></footer>
  </dialog>;
}
