import { getLegacySiteAccount } from "@/app/site-account";
import {
  authRequestOrigin, externalSessionOwner, oidcConfig, safeAuthReturnTo,
  sameOriginAuthWrite, startExternalLogin, type LoginIntent,
} from "@/server/oidc";
import { authError, authRedirect, bindings, linkForm, singleParam } from "../_shared";

export const dynamic = "force-dynamic";

async function start(request: Request, intent: LoginIntent): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const method = query.has("method") ? singleParam(query, "method") : "google";
  if (method !== "google" && method !== "github") return authError(400, "请选择有效的登录方式。");
  const config = oidcConfig(bindings, method);
  const db = bindings.DB;
  if (!config || !db) return authError(503, "外部登录暂未开通。");
  if (authRequestOrigin(bindings, request) !== config.siteOrigin ||
      (intent === "link" && !sameOriginAuthWrite(bindings, request))) {
    return authError(403, "跨站请求已拒绝。");
  }

  const requestedIntent = singleParam(query, "intent");
  if ((intent === "login" && query.has("intent") && requestedIntent !== "login") ||
      (intent === "link" && requestedIntent !== "link")) {
    return authError(400, "登录请求无效。");
  }

  try {
    const form = intent === "link" ? await linkForm(request) : new URLSearchParams();
    if (!form) return authError(400, "登录请求无效。");
    if (form.has("method")) return authError(400, "请选择有效的登录方式。");

    let legacyOwner: string | undefined;
    if (intent === "link") {
      const [legacy, currentOwner] = await Promise.all([
        getLegacySiteAccount(),
        externalSessionOwner(db, request),
      ]);
      if (!legacy || (currentOwner && currentOwner !== legacy.userId)) {
        return authRedirect(config.siteOrigin + "/login?auth=link_denied");
      }
      legacyOwner = legacy.userId;
    }

    const returnTo = safeAuthReturnTo(singleParam(query, "return_to") ?? singleParam(form, "return_to"));
    const { location, cookie } = await startExternalLogin(db, config, request, {
      intent, legacyOwner, returnTo,
    });
    return authRedirect(location, cookie);
  } catch {
    return authRedirect(config.siteOrigin + "/login?auth=unavailable");
  }
}

export function GET(request: Request): Promise<Response> {
  return start(request, "login");
}

export function POST(request: Request): Promise<Response> {
  return start(request, "link");
}
