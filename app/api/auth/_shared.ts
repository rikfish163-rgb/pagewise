import { env } from "cloudflare:workers";
import { authHeaders, type AuthBindings } from "@/server/oidc";

export const bindings = env as AuthBindings;

export function authError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: authHeaders() });
}

export function authRedirect(location: string, ...cookies: string[]): Response {
  const headers = authHeaders();
  headers.set("Location", location);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export function singleParam(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

export async function linkForm(request: Request): Promise<URLSearchParams | undefined> {
  if (!request.body) return new URLSearchParams();
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) return;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let input = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new URLSearchParams(input + decoder.decode());
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      return;
    }
    input += decoder.decode(value, { stream: true });
  }
}
