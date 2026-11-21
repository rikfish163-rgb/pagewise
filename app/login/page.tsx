import {
  ArrowRight,
  BookOpen,
  CircleUserRound,
  Globe,
  LockKeyhole,
  Mail,
  QrCode,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { externalLoginReady, getSiteAccount } from "@/app/site-account";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "登录 · 页边" };

const loginMethods = [
  { method: "google", label: "Google", Icon: Globe },
  { method: "wechat", label: "微信扫码", Icon: QrCode },
  { method: "email", label: "邮箱验证码", Icon: Mail },
  { method: "phone", label: "短信验证码", Icon: Smartphone },
];

const authMessages = new Map([
  ["cancelled", "验证已取消。你可以重新选择登录方式。"],
  ["failed", "验证未成功，请重新尝试。"],
  ["unavailable", "外部登录暂时不可用，请稍后重试。"],
  ["link_denied", "无法关联登录方式。请先用受邀的 ChatGPT 账号登录。"],
  ["link_conflict", "这个外部账号已关联其他页边账号。请用另一种方式验证。"],
  ["linked", "外部登录已关联。下次可以用它访问原来的资料库。"],
]);

function getReturnTo(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^\/(?![/\\])/.test(value)) return;

  const origin = "https://pagewise.invalid";
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return;
  }

  if (
    url.origin !== origin ||
    url.pathname.startsWith("//") ||
    /^\/(?:login|signin-with-chatgpt|signout-with-chatgpt|callback|api)(?:\/|$)/.test(url.pathname)
  ) return;

  return `${url.pathname}${url.search}${url.hash}`;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string | string[]; return_to?: string | string[] }>;
}) {
  const [account, query] = await Promise.all([getSiteAccount(), searchParams]);
  const ready = externalLoginReady();
  const returnTo = getReturnTo(query.return_to);
  const readerPath = returnTo ?? "/";
  const returnQuery = returnTo ? `return_to=${encodeURIComponent(returnTo)}` : "";
  const status = typeof query.auth === "string" ? query.auth : "";
  const linked = status === "linked";
  const message = linked && account?.source !== "chatgpt" ? undefined : authMessages.get(status);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label="页边首页" prefetch={false}>
          <span className={styles.brandMark}><BookOpen size={20} aria-hidden="true" /></span>
          <span>页边</span>
        </Link>
        <nav className={styles.nav} aria-label="页边导航">
          <Link className={styles.navItem} href={readerPath} prefetch={false}>
            <BookOpen size={16} aria-hidden="true" /> 我的阅读器
          </Link>
          <Link className={styles.navItem} href={returnQuery ? `/login?${returnQuery}` : "/login"} aria-current="page" prefetch={false}>
            <CircleUserRound size={16} aria-hidden="true" /> {account ? "我的账号" : "登录"}
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <h1>{account ? "我的账号" : "登录页边"}</h1>
          <p className={styles.intro}>
            {account ? "你已登录，可以继续阅读。" : "登录或创建账号，进入你的私人阅读器。"}
          </p>
          {message && <p className={styles.notice} role={linked ? "status" : "alert"}>{message}</p>}
          {account ? (
            <>
              <section className={styles.panel} aria-label="当前账号">
                <div className={styles.identity}>
                  <CircleUserRound size={24} aria-hidden="true" />
                  <div>
                    <h2>{account.displayName || account.email || "页边账号"}</h2>
                    {account.email && account.email !== account.displayName && <p>{account.email}</p>}
                  </div>
                </div>
                <Link className={styles.primary} href={readerPath} prefetch={false}>
                  继续阅读 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </section>
              {account.source === "chatgpt" && (
                <section className={styles.secondary} aria-labelledby="link-login-title">
                  <h2 id="link-login-title">添加登录方式</h2>
                  <p>
                    {ready ? "在验证页关联一种新的登录方式，下次仍可进入同一资料库。" : "外部登录服务开通后，即可关联新的登录方式。"}
                  </p>
                  <form method="post" action="/api/auth/login?intent=link">
                    {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                    <button className={styles.secondaryAction} type="submit" disabled={!ready}>
                      关联外部登录 <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </form>
                </section>
              )}
            </>
          ) : (
            <>
              <section className={styles.panel} aria-labelledby="new-login-title">
                <h2 id="new-login-title">登录与注册</h2>
                <p id="login-method-help" className={styles.methodHelp}>
                  {ready ? "前往 Authing 验证页，选择已开通的方式。首次验证成功即创建账号。" : "以下方式将在认证服务正式开通后提供。"}
                </p>
                <div className={styles.methods}>
                  {loginMethods.map(({ method, label, Icon }) => ready ? (
                    <a
                      key={method}
                      className={styles.method}
                      href={`/api/auth/login?method=${method}${returnQuery ? `&${returnQuery}` : ""}`}
                      aria-describedby="login-method-help"
                    >
                      <Icon size={18} aria-hidden="true" /> {label}
                    </a>
                  ) : (
                    <button key={method} className={styles.method} type="button" disabled aria-describedby="login-method-help">
                      <Icon size={18} aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
              </section>
              <section className={styles.secondary} aria-labelledby="legacy-login-title">
                <h2 id="legacy-login-title">受邀使用过页边？</h2>
                <p>用原账号登录，继续访问已有的资料和笔记。</p>
                <a className={styles.secondaryAction} href={chatGPTSignInPath(readerPath)} target="_top">
                  使用 ChatGPT 登录 <ArrowRight size={16} aria-hidden="true" />
                </a>
              </section>
              <p className={styles.privacy}>
                <LockKeyhole size={15} aria-hidden="true" /> 你的资料、笔记和讨论仅限你的账号访问。
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
