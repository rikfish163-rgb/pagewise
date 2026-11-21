import { useState, type FormEvent } from 'react';
import { parseAdminCreditsDelta } from './AdminCreditsAmount';

export type AdjustmentDraft = { deltaMilli: number; reason: string };

export function AdminCreditsForm({
  disabled, onReview,
}: {
  disabled: boolean;
  onReview: (draft: AdjustmentDraft) => void;
}) {
  const [error, setError] = useState('');

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const deltaMilli = parseAdminCreditsDelta(String(values.get('delta') ?? ''));
    const reason = String(values.get('reason') ?? '').trim();

    if (deltaMilli === null) {
      setError('请输入非零积分，最多保留三位小数。');
      return;
    }
    if (!reason || reason.includes('\0')) {
      setError('请填写调整原因。');
      return;
    }

    setError('');
    onReview({ deltaMilli, reason });
  }

  return (
    <form className="admin-credits-form" onSubmit={review}>
      <label>
        <span>变动积分</span>
        <input
          className="admin-credits-input"
          name="delta"
          type="text"
          placeholder="+10 或 -2.5"
          maxLength={32}
          disabled={disabled}
          required
        />
      </label>
      <label>
        <span>调整原因</span>
        <textarea className="admin-credits-input" name="reason" rows={2} maxLength={500} disabled={disabled} required />
      </label>
      {error && <p className="admin-credits-error" role="alert">{error}</p>}
      <button className="admin-credits-button" type="submit" disabled={disabled}>核对调整</button>
    </form>
  );
}
