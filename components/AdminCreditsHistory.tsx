import { useLocale } from './LocaleProvider';
import { formatAdminCredits } from './AdminCreditsAmount';

type Adjustment = {
  id: string;
  deltaMilli: number;
  reason: string;
  adminUserId: string;
  targetUserId: string;
  createdAt: number;
};

const historyDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function AdminCreditsHistory({ adjustments, showTargets }: { adjustments: Adjustment[]; showTargets: boolean }) {
  const { t } = useLocale();
  return (
    <section className="admin-credits-section" aria-labelledby="admin-credits-history">
      <h2 id="admin-credits-history">{t("近期调整")}</h2>
      {adjustments.length ? (
        <ol className="admin-credits-history">
          {adjustments.map(item => (
            <li key={item.id}>
              <div className="admin-credits-entry">
                <strong className="admin-credits-amount">{formatAdminCredits(item.deltaMilli, true)}</strong>
                <time className="admin-credits-muted" dateTime={new Date(item.createdAt).toISOString()}>
                  {historyDate.format(item.createdAt)}
                </time>
              </div>
              <p className="admin-credits-entry-reason">{item.reason}</p>
              {showTargets && <p className="admin-credits-muted admin-credits-identity">{t("用户 {0}", { 0: item.targetUserId })}</p>}
              <p className="admin-credits-muted admin-credits-identity">{t("操作人 {0}", { 0: item.adminUserId })}</p>
            </li>
          ))}
        </ol>
      ) : <p className="admin-credits-status admin-credits-muted">{t("暂无调整记录。")}</p>}
    </section>
  );
}
