import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';
import { loginMethodsReady, getSiteAccount } from '@/app/site-account';
import LoginScreen from '@/components/LoginScreen';
import { localeCookieName, resolveLocale, translate } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale((await cookies()).get(localeCookieName)?.value);
  return { title: translate(locale, '登录 · 页边') };
}

const authMessages = new Map([
  ["email_sent", "验证码已发送，请查看邮箱。"],
  ["email_invalid", "请输入有效的邮箱地址。"],
  ["email_limited", "发送次数已达上限，请稍后再试。"],
  ["email_failed", "验证码无效或已过期。请重试或重新发送。"],
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
  searchParams: Promise<{ auth?: string | string[]; email_link?: string | string[]; return_to?: string | string[] }>;
}) {
  const [account, query] = await Promise.all([getSiteAccount(), searchParams]);
  const ready = loginMethodsReady();
  const returnTo = getReturnTo(query.return_to);
  const readerPath = returnTo ?? "/";
  const returnQuery = returnTo ? `return_to=${encodeURIComponent(returnTo)}` : "";
  const status = typeof query.auth === "string" ? query.auth : "";
  const linked = status === "linked";
  const message = linked && account?.source !== "chatgpt" ? undefined : authMessages.get(status);

  return <LoginScreen
    account={account ? { displayName: account.displayName, email: account.email, source: account.source } : null}
    ready={ready}
    emailChallenge={status === "email_sent" || status === "email_failed"}
    emailLink={query.email_link === "1"}
    returnTo={returnTo}
    readerPath={readerPath}
    returnQuery={returnQuery}
    message={message}
    linked={linked}
    chatgptSignInUrl={chatGPTSignInPath(readerPath)}
  />;
}
