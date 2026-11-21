'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { formatAdminCredits } from './AdminCreditsAmount';
import { AdminCreditsConfirmation } from './AdminCreditsConfirmation';
import { AdminCreditsForm, type AdjustmentDraft } from './AdminCreditsForm';
import { AdminCreditsHistory } from './AdminCreditsHistory';
import { AdminCreditsUsers } from './AdminCreditsUsers';
import './AdminCredits.css';

const endpoint = '/api/admin/credits';
const points = z.number().transform(value => Math.round(value * 1000)).pipe(z.int());
const userSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  balance: points,
  availableBalance: points,
});
const adjustmentSchema = z.object({
  id: z.string(),
  targetUserId: z.string(),
  adminUserId: z.string(),
  requestId: z.string(),
  deltaMilli: z.int(),
  reason: z.string(),
  createdAt: z.int().min(0).max(8.64e15),
});
const listSchema = z.object({
  users: z.array(userSchema),
  nextCursor: z.string().nullable(),
  adjustments: z.array(adjustmentSchema),
});
const receiptSchema = z.object({ adjustment: adjustmentSchema, replayed: z.boolean() });
const apiErrorSchema = z.object({ error: z.string() });

type View = { query: string; cursors: string[]; targetUserId: string | null };
type Snapshot = { view: View; data: z.output<typeof listSchema> };
type ReadResult = { view: View; snapshot: Snapshot | null; error: string };
type Review = AdjustmentDraft & {
  user: z.output<typeof userSchema>;
  requestId: string;
  balance: number;
  available: number;
};

class CreditsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(payload);
    throw new CreditsApiError(error.success ? error.data.error : '积分管理暂时不可用，请稍后重试。', response.status);
  }
  return payload;
}

export function AdminCredits() {
  const [view, setView] = useState<View>({ query: '', cursors: [''], targetUserId: null });
  const [read, setRead] = useState<ReadResult | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [write, setWrite] = useState({ saving: false, error: '', rejected: false });
  const [savedRequestId, setSavedRequestId] = useState('');
  const saving = useRef(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: view.query });
    const cursor = view.cursors.at(-1);
    if (cursor) params.set('cursor', cursor);
    if (view.targetUserId) params.set('targetUserId', view.targetUserId);

    async function load() {
      try {
        const response = await fetch(`${endpoint}?${params}`, {
          cache: 'no-store', mode: 'same-origin', signal: controller.signal,
        });
        const result = listSchema.safeParse(await readJson(response));
        if (!result.success) throw new CreditsApiError('积分数据格式有误，请重试。', response.status);
        if (!controller.signal.aborted) {
          setRead({ view, snapshot: { view, data: result.data }, error: '' });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const unauthorized = error instanceof CreditsApiError && [401, 403].includes(error.status);
          setRead(previous => ({
            view,
            snapshot: unauthorized ? null : previous?.snapshot ?? null,
            error: error instanceof CreditsApiError ? error.message : '暂时无法读取积分数据，请重试。',
          }));
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [view]);

  const snapshot = read?.snapshot;
  const data = snapshot?.view === view ? snapshot.data : null;
  const directory = snapshot?.view.query === view.query && snapshot.view.cursors === view.cursors
    ? snapshot.data
    : null;
  const error = read?.view === view ? read.error : '';
  const loading = read?.view !== view;
  const selected = directory?.users.find(user => user.userId === view.targetUserId);

  function go(next: View) {
    setView(next);
    setSavedRequestId('');
    setReviewError('');
  }

  function selectUser(userId: string) {
    go({ ...view, targetUserId: userId });
    if (window.matchMedia('(max-width: 46rem)').matches) detailHeading.current?.focus();
  }

  function changePage(direction: -1 | 1) {
    const next = directory?.nextCursor;
    if (direction === 1 && next) {
      go({ ...view, targetUserId: null, cursors: [...view.cursors, next] });
    } else if (direction === -1 && view.cursors.length > 1) {
      go({ ...view, targetUserId: null, cursors: view.cursors.slice(0, -1) });
    }
  }

  function startReview(draft: AdjustmentDraft) {
    const user = data?.users.find(account => account.userId === view.targetUserId);
    if (!user) return;
    const balance = user.balance + draft.deltaMilli;
    const available = user.availableBalance + draft.deltaMilli;
    if (
      available < 0 || balance < 0 || !Number.isSafeInteger(balance) || !Number.isSafeInteger(available)
      || Math.round(draft.deltaMilli / 1000 * 1000) !== draft.deltaMilli
    ) {
      setReviewError('调整超出积分范围，请检查变动金额和可用积分。');
      return;
    }

    setReviewError('');
    setWrite({ saving: false, error: '', rejected: false });
    setReview({ ...draft, user, requestId: crypto.randomUUID(), balance, available });
  }

  function cancelReview() {
    setReview(null);
    if (write.error) setView({ ...view });
  }

  async function applyReview() {
    if (!review || saving.current || write.rejected) return;

    saving.current = true;
    setWrite({ saving: true, error: '', rejected: false });
    try {
      const { user, deltaMilli, reason, requestId } = review;
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.userId, delta: deltaMilli / 1000, reason, requestId }),
      });
      const result = receiptSchema.safeParse(await readJson(response));
      if (!result.success || result.data.adjustment.requestId !== requestId ||
          result.data.adjustment.targetUserId !== user.userId || result.data.adjustment.deltaMilli !== deltaMilli ||
          result.data.adjustment.reason !== reason) {
        throw new Error('Invalid credit adjustment receipt');
      }
      setReview(null);
      setSavedRequestId(requestId);
      setView({ ...view });
      setWrite({ saving: false, error: '', rejected: false });
    } catch (error) {
      const rejected = error instanceof CreditsApiError && error.status >= 400 && error.status < 500;
      setWrite({
        saving: false,
        rejected,
        error: rejected ? error.message : '暂时无法确认保存结果。可重试同一笔调整。',
      });
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="admin-credits-layout">
      <AdminCreditsUsers
        users={directory?.users ?? []}
        selectedId={view.targetUserId}
        loading={loading && !directory}
        error={directory ? '' : error}
        page={view.cursors.length}
        hasNext={Boolean(directory?.nextCursor)}
        onSearch={query => go({ query, cursors: [''], targetUserId: null })}
        onPage={changePage}
        onSelect={selectUser}
      />
      <aside className="admin-credits-panel" aria-labelledby="admin-credits-account-heading">
        <section className="admin-credits-section">
          <h2 id="admin-credits-account-heading" ref={detailHeading} tabIndex={-1}>用户积分</h2>
          {selected && (
            <div className="admin-credits-status admin-credits-identity">
              <strong>{selected.displayName}</strong>
              <p className="admin-credits-muted">{selected.userId}</p>
              <dl className="admin-credits-account">
                <div><dt>可用积分</dt><dd className="admin-credits-amount">{formatAdminCredits(selected.availableBalance)}</dd></div>
                <div><dt>积分余额</dt><dd className="admin-credits-amount">{formatAdminCredits(selected.balance)}</dd></div>
              </dl>
            </div>
          )}
          {!view.targetUserId && (
            <p className="admin-credits-status admin-credits-muted">选择用户以查看余额或调整积分。</p>
          )}
          {savedRequestId && <p className="admin-credits-status" role="status">已保存积分调整。</p>}
          {loading && <p className="admin-credits-status admin-credits-muted" role="status">正在读取积分记录…</p>}
          {error && directory && (
            <div className="admin-credits-status admin-credits-actions">
              <p className="admin-credits-error" role="alert">{error}</p>
              <button type="button" className="admin-credits-button" onClick={() => setView({ ...view })}>重新读取</button>
            </div>
          )}
          {selected && (
            <>
              <AdminCreditsForm key={`${selected.userId}:${savedRequestId}`} disabled={!data} onReview={startReview} />
              {reviewError && <p className="admin-credits-status admin-credits-error" role="alert">{reviewError}</p>}
            </>
          )}
        </section>
        {data && <AdminCreditsHistory adjustments={data.adjustments} showTargets={!view.targetUserId} />}
      </aside>
      {review && (
        <AdminCreditsConfirmation
          user={`${review.user.displayName}（${review.user.userId}）`}
          delta={formatAdminCredits(review.deltaMilli, true)}
          available={formatAdminCredits(review.available)}
          balance={formatAdminCredits(review.balance)}
          reason={review.reason}
          saving={write.saving}
          error={write.error}
          rejected={write.rejected}
          onCancel={cancelReview}
          onConfirm={() => void applyReview()}
        />
      )}
    </div>
  );
}
