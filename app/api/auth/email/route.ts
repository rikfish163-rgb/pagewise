import { getLegacySiteAccount, registerSiteAccount } from "@/app/site-account";
import {
  clearEmailCookie, emailLoginConfig, normalizeLoginEmail, sendLoginEmail, verifyLoginEmail,
} from "@/server/email-login";
import {
  createExternalSession, externalSessionOwner, linkExternalIdentity, safeAuthReturnTo, sameOriginAuthWrite,
} from "@/server/oidc";
import { authError, authRedirect, bindings, linkForm, singleParam } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const { DB: db, SITE_AUTH_ORIGIN } = bindings;
  const config = emailLoginConfig(bindings);
  if (!config || !db || !SITE_AUTH_ORIGIN) return authError(503, "邮箱登录暂未开通。");
  if (!sameOriginAuthWrite(bindings, request)) return authError(403, "跨站请求已拒绝。");

  try {
    const data = await linkForm(request);
    if (!data) return authError(400, "登录请求无效。");
    const returnTo = safeAuthReturnTo(singleParam(data, "return_to"));
    const link = singleParam(data, "intent") === "link";
    const search = new URLSearchParams();
    if (returnTo !== "/") search.set("return_to", returnTo);
    if (link) search.set("email_link", "1");
    const status = (value: string, ...cookies: string[]) => {
      search.set("auth", value);
      return authRedirect("/login?" + search, ...cookies);
    };

    const legacy = link ? await getLegacySiteAccount() : null;
    if (link) {
      const owner = await externalSessionOwner(db, request);
      if (!legacy || (owner && owner !== legacy.userId)) return status("link_denied");
    }
    const legacyOwner = legacy?.userId ?? null;

    if (singleParam(data, "action") === "send") {
      const email = normalizeLoginEmail(singleParam(data, "email"));
      if (!email) return status("email_invalid");
      const cookie = await sendLoginEmail(db, config, email, returnTo, legacyOwner);
      return cookie ? status("email_sent", cookie) : status("email_limited");
    }

    if (singleParam(data, "action") !== "verify") return authError(400, "登录请求无效。");
    const challenge = await verifyLoginEmail(db, config, request, singleParam(data, "code") ?? "", legacyOwner);
    if (!challenge) return status("email_failed");
    const identity = {
      issuer: "urn:pagewise:email", subject: challenge.email, displayName: challenge.email, email: challenge.email,
    };
    if (legacy) {
      await registerSiteAccount(db, legacy);
      const linked = await linkExternalIdentity(db, request, identity, legacy.userId);
      return status(linked ? "linked" : "link_conflict", clearEmailCookie());
    }
    const session = await createExternalSession(db, request, identity);
    return authRedirect(safeAuthReturnTo(challenge.return_to), session, clearEmailCookie());
  } catch {
    return authRedirect("/login?auth=unavailable");
  }
}
