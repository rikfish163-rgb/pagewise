'use client';

import { useLocale } from './LocaleProvider';
import { useEffect, useRef } from 'react';

type Props = {
  user: string;
  delta: string;
  available: string;
  balance: string;
  reason: string;
  saving: boolean;
  error: string;
  rejected: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AdminCreditsConfirmation({
  user, delta, available, balance, reason, saving, error, rejected, onCancel, onConfirm,
}: Props) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();

    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="admin-credits-dialog"
      aria-labelledby="admin-credits-confirm-heading"
      aria-describedby="admin-credits-confirm-user"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <h2 id="admin-credits-confirm-heading">{t("确认积分调整")}</h2>
      <p id="admin-credits-confirm-user" className="admin-credits-status">{user}</p>
      <dl className="admin-credits-summary">
        <div><dt>{t("变动积分")}</dt><dd className="admin-credits-amount">{delta}</dd></div>
        <div><dt>{t("预计可用积分")}</dt><dd className="admin-credits-amount">{available}</dd></div>
        <div><dt>{t("预计积分余额")}</dt><dd className="admin-credits-amount">{balance}</dd></div>
      </dl>
      <dl className="admin-credits-reason">
        <div><dt className="admin-credits-muted">{t("调整原因")}</dt><dd>{reason}</dd></div>
      </dl>
      {error && <p className="admin-credits-status admin-credits-error" role="alert">{error}</p>}
      <div className="admin-credits-actions">
        <button ref={cancelRef} type="button" className="admin-credits-button" disabled={saving} onClick={onCancel}>{t("返回修改")}</button>
        <button type="button" className="admin-credits-button is-primary" disabled={saving || rejected} onClick={onConfirm}>
          {saving ? t("正在保存…") : t("确认调整")}
        </button>
      </div>
    </dialog>
  );
}
