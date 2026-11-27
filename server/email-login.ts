import { authCookie, hashSession, randomToken, readCookie, safeAuthReturnTo, type OidcBindings } from "./oidc.ts";

const emailCookie = "__Host-pagewise_email";
const lifetime = 10 * 60;
const hour = 3_600_000;
const day = 24 * hour;
const emailFormat = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;

export function normalizeLoginEmail(input: string | null): string | undefined {
  const email = input?.trim().toLowerCase();
  if (email && email.length <= 254 && emailFormat.test(email)) return email;
}

export function emailLoginConfig(bindings: OidcBindings) {
  const key = bindings.RESEND_API_KEY;
  const from = normalizeLoginEmail(bindings.AUTH_EMAIL_FROM ?? null);
  if (key && /^[A-Za-z0-9_-]{1,512}$/.test(key) && from) return { key, from };
}

type EmailConfig = NonNullable<ReturnType<typeof emailLoginConfig>>;

async function hashCode(config: EmailConfig, browser: string, code: string): Promise<string> {
  const encode = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encode.encode(config.key), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encode.encode("pagewise email code:" + browser + ":" + code));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function verificationCode(): string {
  const draw = new Uint32Array(1);
  do {
    crypto.getRandomValues(draw);
  } while (draw[0] >= 4_294_000_000);
  return String(draw[0] % 1_000_000).padStart(6, "0");
}

export async function sendLoginEmail(
  db: D1Database, config: EmailConfig, email: string, returnTo: string, legacyOwner: string | null,
): Promise<string | null> {
  const now = Date.now();
  const browser = randomToken();
  const code = verificationCode();
  const [browserHash, codeHash] = await Promise.all([hashSession(browser), hashCode(config, browser, code)]);
  const [, inserted] = await db.batch([
    db.prepare("DELETE FROM site_email_challenges WHERE sent_at <= ?").bind(now - day),
    db.prepare(`INSERT INTO site_email_challenges (browser_hash, email, code_hash, return_to, legacy_owner, sent_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM site_email_challenges WHERE sent_at > ?) < 90
      AND (SELECT COUNT(*) FROM site_email_challenges WHERE email = ? AND sent_at > ?) < 3
      AND NOT EXISTS (SELECT 1 FROM site_email_challenges WHERE email = ? AND sent_at > ?)
      RETURNING browser_hash`).bind(browserHash, email, codeHash, safeAuthReturnTo(returnTo), legacyOwner, now,
      now - day, email, now - hour, email, now - 60_000),
  ]);
  if (!inserted.results.length) return null;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + config.key, "Content-Type": "application/json", "Idempotency-Key": browserHash },
    body: JSON.stringify({
      from: config.from, to: [email], subject: "页边登录验证码 / Pagewise sign-in code",
      text: `页边验证码 / Pagewise code: ${code}\n10 分钟内有效 / Expires in 10 minutes.`,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Email delivery failed");
  return authCookie(emailCookie, browser, lifetime);
}

type VerifiedEmail = { email: string; return_to: string; legacy_owner: string | null; consumed: number };

export async function verifyLoginEmail(
  db: D1Database, config: EmailConfig, request: Request, code: string, legacyOwner: string | null,
): Promise<VerifiedEmail | null> {
  const browser = readCookie(request, emailCookie);
  if (!browser || !/^\d{6}$/.test(code)) return null;
  const [browserHash, codeHash] = await Promise.all([hashSession(browser), hashCode(config, browser, code)]);
  const row = await db.prepare(`UPDATE site_email_challenges
    SET attempts = attempts + 1, consumed = (code_hash = ?)
    WHERE browser_hash = ? AND sent_at > ? AND attempts < 5 AND consumed = 0
      AND legacy_owner IS ?
    RETURNING email, return_to, legacy_owner, consumed`)
    .bind(codeHash, browserHash, Date.now() - lifetime * 1000, legacyOwner).first<VerifiedEmail>();
  return row?.consumed === 1 ? row : null;
}

export const clearEmailCookie = () => authCookie(emailCookie, "", 0);
