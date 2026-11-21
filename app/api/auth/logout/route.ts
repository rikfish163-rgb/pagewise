import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import {
  authRequestOrigin, clearSessionCookie, clearTransactionCookie,
  revokeExternalSession, sameOriginAuthWrite,
} from "@/server/oidc";
import { authError, authRedirect, bindings, singleParam } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const origin = authRequestOrigin(bindings, request);
  if (!origin || !sameOriginAuthWrite(bindings, request)) return authError(403, "跨站请求已拒绝。");
  const query = new URL(request.url).searchParams;
  const redirectTo = singleParam(query, "intent") === "legacy"
    ? chatGPTSignOutPath("/login") : "/login";
  try {
    await revokeExternalSession(bindings, request);
    return authRedirect(origin + redirectTo, clearSessionCookie(), clearTransactionCookie());
  } catch {
    return authError(503, "暂时无法退出，请重试。");
  }
}
