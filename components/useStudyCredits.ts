'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Pricing = { creditsPerUsd: number; answerCap: number; memoryCap: number };
export type CreditAccount = { balance: number; availableBalance: number; pricing: Pricing };
export const creditNumber = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function hasPricing(pricing?: Pricing): pricing is Pricing {
  return !!pricing && [pricing.creditsPerUsd, pricing.answerCap, pricing.memoryCap].every(n => Number.isFinite(n) && n > 0);
}

export function chargeLimit(account: CreditAccount | null, kind: 'answerCap' | 'memoryCap') {
  if (!account) return 0;
  const available = Math.min(account.availableBalance, account.pricing[kind]);
  // Discard any sub-millipoint remainder before displaying or authorizing a charge.
  return Math.max(0, Math.floor(Number((available * 1000).toPrecision(15))) / 1000);
}
export const creditsChangedEvent = 'pagewise:credits-changed';

export function useStudyCredits() {
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/study/account?view=quote', { cache: 'no-store' });
      if (!response.ok) throw Error(response.status === 401 ? '请先登录后查看积分。' : '积分暂时无法读取，请刷新后重试。');
      const data: CreditAccount = await response.json();
      if (!Number.isFinite(data.balance) || !Number.isFinite(data.availableBalance) || !hasPricing(data.pricing)) throw Error('积分价格暂时无法读取，请刷新后重试。');
      if (current !== sequence.current) return null;
      setAccount(data);
      return data;
    } catch (reason) {
      if (current === sequence.current) {
        setAccount(null);
        setError(reason instanceof Error ? reason.message : '积分暂时无法读取。');
      }
      return null;
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const version = sequence;
    const update = () => { void refresh(); };
    update();
    window.addEventListener(creditsChangedEvent, update);
    window.addEventListener('focus', update);
    return () => {
      ++version.current;
      window.removeEventListener(creditsChangedEvent, update);
      window.removeEventListener('focus', update);
    };
  }, [refresh]);
  return { account, loading, error, refresh };
}
