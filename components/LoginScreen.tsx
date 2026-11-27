'use client';

import { useLocale } from './LocaleProvider';
import { ArrowRight, BookOpen, CircleUserRound, GitFork, Globe, LockKeyhole, Mail } from 'lucide-react';
import Link from 'next/link';
import type { SiteAccount } from '../app/site-account';
import styles from '../app/login/login.module.css';
import LanguageSwitcher from './LanguageSwitcher';

const loginMethods = [
  { method: 'google', label: 'Google', Icon: Globe },
  { method: 'github', label: 'GitHub', Icon: GitFork },
] as const;

function EmailLoginForm({ ready, link, challenge, returnTo }: {
  ready: boolean;
  link?: boolean;
  challenge: boolean;
  returnTo?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={styles.emailMethods}>
      <form className={styles.emailForm} method="post" action="/api/auth/email">
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
        {link && <input type="hidden" name="intent" value="link" />}
        <label>
          <Mail size={16} aria-hidden="true" /> {t("邮箱地址")}
          <input type="email" name="email" autoComplete="email" maxLength={254} required disabled={!ready} />
        </label>
        <button className={styles.method} name="action" value="send" disabled={!ready}>{t(challenge ? "重新发送验证码" : "发送验证码")}</button>
      </form>
      {ready && challenge && (
        <form className={styles.emailForm} method="post" action="/api/auth/email">
          {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
          {link && <input type="hidden" name="intent" value="link" />}
          <label>
            {t("邮箱验证码")}
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
          </label>
          <button className={styles.method} name="action" value="verify">{t(link ? "验证并关联" : "验证并登录")}</button>
        </form>
      )}
    </div>
  );
}

export default function LoginScreen({ account, ready, emailChallenge, emailLink, returnTo, readerPath, returnQuery, message, linked, chatgptSignInUrl }: {
  account: Pick<SiteAccount, 'displayName' | 'email' | 'source'> | null;
  ready: { google: boolean; github: boolean; email: boolean };
  emailChallenge: boolean;
  emailLink: boolean;
  returnTo?: string;
  readerPath: string;
  returnQuery: string;
  message?: string;
  linked: boolean;
  chatgptSignInUrl: string;
}) {
  const { t } = useLocale();
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label={t("页边首页")}>
          <span className={styles.brandMark}><BookOpen size={20} aria-hidden="true" /></span>
          <span>{t("页边")}</span>
        </Link>
        <nav className={styles.nav} aria-label={t("页边导航")}>
          <a className={styles.navItem} href={readerPath}>
            <BookOpen size={16} aria-hidden="true" />{t("我的阅读器")}</a>
          <a className={styles.navItem} href={returnQuery ? `/login?${returnQuery}` : "/login"} aria-current="page">
            <CircleUserRound size={16} aria-hidden="true" /> {account ? t("我的账号") : t("登录")}
          </a>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.language}><LanguageSwitcher/></div>
        <div className={styles.content}>
          <h1>{account ? t("我的账号") : t("登录页边")}</h1>
          <p className={styles.intro}>
            {account ? t("你已登录，可以继续阅读。") : t("登录或创建账号，进入你的私人阅读器。")}
          </p>
          {message && <p className={styles.notice} role={linked ? "status" : "alert"}>{t(message)}</p>}
          {account ? (
            <>
              <section className={styles.panel} aria-label={t("当前账号")}>
                <div className={styles.identity}>
                  <CircleUserRound size={24} aria-hidden="true" />
                  <div>
                    <h2>{account.displayName || account.email || t("页边账号")}</h2>
                    {account.email && account.email !== account.displayName && <p>{account.email}</p>}
                  </div>
                </div>
                <a className={styles.primary} href={readerPath}>{t("继续阅读")}<ArrowRight size={16} aria-hidden="true" />
                </a>
              </section>
              {account.source === "chatgpt" && (
                <section className={styles.secondary} aria-labelledby="link-login-title">
                  <h2 id="link-login-title">{t("添加登录方式")}</h2>
                  <p>{t("关联新的登录方式，下次仍可进入同一资料库。")}</p>
                  <div className={styles.methods}>
                    {loginMethods.map(({ method, label, Icon }) => (
                      <form key={method} method="post" action={`/api/auth/login?intent=link&method=${method}`}>
                        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                        <button className={styles.method} type="submit" disabled={!ready[method]}>
                          <Icon size={18} aria-hidden="true" /> {label}
                        </button>
                      </form>
                    ))}
                  </div>
                  <EmailLoginForm ready={ready.email} link challenge={emailLink && emailChallenge} returnTo={returnTo} />
                </section>
              )}
            </>
          ) : (
            <>
              <section className={styles.panel} aria-labelledby="new-login-title">
                <h2 id="new-login-title">{t("登录与注册")}</h2>
                <p id="login-method-help" className={styles.methodHelp}>
                  {t("首次验证成功后会创建页边账号。")}
                </p>
                <div className={styles.methods}>
                  {loginMethods.map(({ method, label, Icon }) => ready[method] ? (
                    <a
                      key={method}
                      className={styles.method}
                      href={`/api/auth/login?method=${method}${returnQuery ? `&${returnQuery}` : ""}`}
                      aria-describedby="login-method-help"
                    >
                      <Icon size={18} aria-hidden="true" /> {t(label)}
                    </a>
                  ) : (
                    <button key={method} className={styles.method} type="button" disabled aria-describedby="login-method-help">
                      <Icon size={18} aria-hidden="true" /> {t(label)}
                    </button>
                  ))}
                </div>
                <EmailLoginForm ready={ready.email} challenge={!emailLink && emailChallenge} returnTo={returnTo} />
              </section>
              <section className={styles.secondary} aria-labelledby="legacy-login-title">
                <h2 id="legacy-login-title">{t("受邀使用过页边？")}</h2>
                <p>{t("用原账号登录，继续访问已有的资料和笔记。")}</p>
                <a className={styles.secondaryAction} href={chatgptSignInUrl} target="_top">{t("使用 ChatGPT 登录")}<ArrowRight size={16} aria-hidden="true" />
                </a>
              </section>
              <p className={styles.privacy}>
                <LockKeyhole size={15} aria-hidden="true" />{t("你的资料、笔记和讨论仅限你的账号访问。")}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
