import { getLegacySiteAccount, registerSiteAccount } from "@/app/site-account";
import {
  authRequestOrigin, clearTransactionCookie, consumeLoginTransaction, createExternalSession,
  exchangeExternalCode, externalSessionOwner, linkExternalIdentity, oidcConfig, safeAuthReturnTo,
} from "@/server/oidc";
import { authError, authRedirect, bindings, singleParam } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = oidcConfig(bindings);
  const db = bindings.DB;
  if (!config || !db) return authError(503, "外部登录暂未开通。");
  if (authRequestOrigin(bindings, request) !== config.siteOrigin) {
    return authError(403, "登录回调地址无效。");
  }

  const query = new URL(request.url).searchParams;
  const state = singleParam(query, "state");
  let returnTo = "/";
  const status = (value: string, ...cookies: string[]) => {
    const search = new URLSearchParams({ auth: value });
    if (returnTo !== "/") search.set("return_to", returnTo);
    return authRedirect(config.siteOrigin + "/login?" + search, ...cookies);
  };
  if (!state) return status("failed");

  let consumed = false;
  try {
    const transaction = await consumeLoginTransaction(db, request, state);
    if (!transaction) return status("failed");
    consumed = true;
    returnTo = safeAuthReturnTo(transaction.return_to);
    const clear = clearTransactionCookie();
    if (query.has("iss") && singleParam(query, "iss") !== config.issuer) return status("failed", clear);
    if (query.has("error")) return status(singleParam(query, "error") === "access_denied" ? "cancelled" : "failed", clear);
    const code = singleParam(query, "code");
    if (!code || !/^[\x21-\x7e]{1,4096}$/.test(code)) return status("failed", clear);

    if (transaction.intent === "link") {
      const [legacy, currentOwner] = await Promise.all([
        getLegacySiteAccount(),
        externalSessionOwner(db, request),
      ]);
      if (!legacy || legacy.userId !== transaction.legacy_owner ||
          (currentOwner && currentOwner !== legacy.userId)) return status("link_denied", clear);
      const identity = await exchangeExternalCode(config, code, transaction);
      await registerSiteAccount(db, legacy);
      const linked = await linkExternalIdentity(db, request, identity, legacy.userId);
      return status(linked ? "linked" : "link_conflict", clear);
    }

    if (transaction.intent !== "login" || transaction.legacy_owner !== null) return status("failed", clear);
    const identity = await exchangeExternalCode(config, code, transaction);
    const session = await createExternalSession(db, request, identity);
    return authRedirect(config.siteOrigin + returnTo, session, clear);
  } catch {
    return status("failed", ...(consumed ? [clearTransactionCookie()] : []));
  }
}
