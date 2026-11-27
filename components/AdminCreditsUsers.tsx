import { useLocale } from './LocaleProvider';
type User = {
  userId: string;
  displayName: string;
};

type Props = {
  users: User[];
  selectedId: string | null;
  loading: boolean;
  error: string;
  page: number;
  hasNext: boolean;
  onSearch: (query: string) => void;
  onPage: (direction: -1 | 1) => void;
  onSelect: (id: string) => void;
};

export function AdminCreditsUsers({
  users, selectedId, loading, error, page, hasNext, onSearch, onPage, onSelect,
}: Props) {
  const { t } = useLocale();
  return (
    <section className="admin-credits-panel" aria-labelledby="admin-credits-users-heading">
      <div className="admin-credits-section">
        <h2 id="admin-credits-users-heading">{t("用户")}</h2>
        <form
          className="admin-credits-search"
          role="search"
          onSubmit={event => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('q');
            onSearch(typeof value === 'string' ? value.trim() : '');
          }}
        >
          <label className="sr-only" htmlFor="admin-credits-query">{t("搜索用户")}</label>
          <div className="admin-credits-actions">
            <input
              className="admin-credits-input"
              type="search"
              id="admin-credits-query"
              name="q"
              placeholder={t("姓名、完整邮箱或用户 ID")}
              maxLength={320}
            />
            <button className="admin-credits-button" type="submit">{t("搜索")}</button>
          </div>
        </form>
      </div>
      {loading && <p role="status" className="admin-credits-section admin-credits-muted">{t("正在读取用户…")}</p>}
      {!loading && error && <p role="alert" className="admin-credits-section admin-credits-error">{t(error)}</p>}
      {!loading && !error && !users.length && (
        <p role="status" className="admin-credits-section admin-credits-muted">{t("未找到用户。")}</p>
      )}
      {!loading && !error && users.length > 0 && (
        <ul className="admin-credits-users">
          {users.map(user => (
            <li key={user.userId}>
              <button
                className="admin-credits-user"
                type="button"
                aria-pressed={selectedId === user.userId}
                onClick={() => onSelect(user.userId)}
              >
                <strong>{user.displayName}</strong>
                <span className="admin-credits-muted">{user.userId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(page > 1 || hasNext) && (
        <nav className="admin-credits-section admin-credits-pagination" aria-label={t("用户列表分页")}>
          <button className="admin-credits-button" type="button" disabled={loading || page === 1} onClick={() => onPage(-1)}>{t("上一页")}</button>
          <span className="admin-credits-muted" aria-live="polite">{t("第 {0} 页", { 0: page })}</span>
          <button className="admin-credits-button" type="button" disabled={loading || !hasNext} onClick={() => onPage(1)}>{t("下一页")}</button>
        </nav>
      )}
    </section>
  );
}
