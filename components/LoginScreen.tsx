'use client';

import { useLocale } from './LocaleProvider';
import { ArrowRight, BookOpen, CircleUserRound, Globe, LockKeyhole, Mail, QrCode, Smartphone } from 'lucide-react';
import Link from 'next/link';
import type { SiteAccount } from '../app/site-account';
import styles from '../app/login/login.module.css';
import LanguageSwitcher from './LanguageSwitcher';

const loginMethods = [
  { method: 'google', label: 'Google', Icon: Globe },
  { method: 'wechat', label: '微信扫码', Icon: QrCode },
  { method: 'email', label: '邮箱验证码', Icon: Mail },
  { method: 'phone', label: '短信验证码', Icon: Smartphone },
];

export default function LoginScreen({ account, ready, returnTo, readerPath, returnQuery, message, linked, chatgptSignInUrl }: {
  account: Pick<SiteAccount, 'displayName' | 'email' | 'source'> | null;
  ready: boolean;
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
                  <p>
                    {ready ? t("在验证页关联一种新的登录方式，下次仍可进入同一资料库。") : t("外部登录服务开通后，即可关联新的登录方式。")}
                  </p>
                  <form noValidate method="post" action="/api/auth/login?intent=link">
                    {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                    <button className={styles.secondaryAction} type="submit" disabled={!ready}>{t("关联外部登录")}<ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </form>
                </section>
              )}
            </>
          ) : (
            <>
              <section className={styles.panel} aria-labelledby="new-login-title">
                <h2 id="new-login-title">{t("登录与注册")}</h2>
                <p id="login-method-help" className={styles.methodHelp}>
                  {ready ? t("前往 Authing 验证页，选择已开通的方式。首次验证成功即创建账号。") : t("以下方式将在认证服务正式开通后提供。")}
                </p>
                <div className={styles.methods}>
                  {loginMethods.map(({ method, label, Icon }) => ready ? (
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
