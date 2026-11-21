import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export type OidcBindings = {
  AUTHING_ISSUER?: string;
  AUTHING_CLIENT_ID?: string;
  AUTHING_CLIENT_SECRET?: string;
  SITE_AUTH_ORIGIN?: string;
  AUTHING_GOOGLE_CONNECTION_ID?: string;
  AUTHING_WECHAT_CONNECTION_ID?: string;
};

export type AuthBindings = OidcBindings & { DB?: D1Database };
export type LoginMethod = "google" | "wechat" | "email" | "phone";
export type LoginIntent = "login" | "link";

type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  siteOrigin: string;
  redirectUri: string;
  googleConnectionId?: string;
  wechatConnectionId?: string;
};

type Discovery = {
  authorization: URL;
  token: URL;
  jwks: URL;
  tokenAuthentication: "client_secret_post" | "client_secret_basic";
};

type LoginTransaction = {
  code_verifier: string;
  nonce: string;
  intent: LoginIntent;
  legacy_owner: string | null;
  return_to: string;
  expires_at: number;
};

type ExternalIdentity = { issuer: string; subject: string; displayName: string; email: string | null };

export const sessionCookieName = "__Host-pagewise_session";
export const transactionCookieName = "__Host-pagewise_oidc";
const transactionSeconds = 5 * 60;
const sessionSeconds = 8 * 60 * 60;
const requestTimeoutMs = 5_000;
const clockSkewSeconds = 30;
const opaqueToken = /^[A-Za-z0-9_-]{43}$/;

function httpsUrl(value: string | undefined): URL | undefined {
  if (!value?.startsWith("https://") || /[\s\\?#]/u.test(value)) return;
  try {
    const url = new URL(value);
    if (!url.username && !url.password && !url.port && url.href === (
      value === url.origin ? value + "/" : value
    )) return url;
  } catch {
    return;
  }
}

function siteOrigin(value: string | undefined): string | undefined {
  const url = httpsUrl(value);
  if (url?.pathname === "/") return url.origin;
}

export function oidcConfig(bindings: OidcBindings = {}): OidcConfig | undefined {
  const issuer = httpsUrl(bindings.AUTHING_ISSUER);
  const origin = siteOrigin(bindings.SITE_AUTH_ORIGIN);
  const { AUTHING_CLIENT_ID: clientId, AUTHING_CLIENT_SECRET: clientSecret } = bindings;
  const { AUTHING_GOOGLE_CONNECTION_ID: googleConnectionId,
    AUTHING_WECHAT_CONNECTION_ID: wechatConnectionId } = bindings;
  const connectionId = /^[A-Za-z0-9_-]{1,128}$/;

  if (!issuer || issuer.pathname !== "/oidc" ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.authing\.(?:cn|co)$/u.test(issuer.hostname) ||
      !origin || !clientId || !clientSecret ||
      !/^[\x21-\x7e]{1,512}$/u.test(clientId) ||
      !/^[\x21-\x7e]{1,512}$/u.test(clientSecret) ||
      (googleConnectionId && !connectionId.test(googleConnectionId)) ||
      (wechatConnectionId && !connectionId.test(wechatConnectionId))) return;

  return {
    issuer: issuer.href,
    clientId,
    clientSecret,
    siteOrigin: origin,
    redirectUri: origin + "/api/auth/callback",
    googleConnectionId,
    wechatConnectionId,
  };
}

export function externalLoginReady(bindings?: OidcBindings): boolean {
  return Boolean(oidcConfig(bindings));
}

export function authRequestOrigin(bindings: OidcBindings, request: Request): string | undefined {
  const origin = new URL(request.url).origin;
  const expected = siteOrigin(bindings.SITE_AUTH_ORIGIN ?? origin);
  return origin === expected ? origin : undefined;
}

export function sameOriginAuthWrite(bindings: OidcBindings, request: Request): boolean {
  const origin = authRequestOrigin(bindings, request);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return Boolean(request.method === "POST" && origin && request.headers.get("Origin") === origin &&
    (fetchSite === null || fetchSite === "same-origin"));
}

export function safeAuthReturnTo(value: string | null): string {
  if (!value || value.length > 512 || /[\\\s\u0000-\u001f\u007f]/u.test(value)) return "/";
  if (value !== "/" && !value.startsWith("/?") && value !== "/#reader") return "/";
  const url = new URL(value, "https://workspace.invalid");
  if (url.hash && url.hash !== "#reader") return "/";
  const query = new URLSearchParams();
  for (const [key, item] of url.searchParams) {
    if (!["document", "discussion", "page"].includes(key) || query.has(key) ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(item)) return "/";
    if (key === "page" && !/^[1-9]\d{0,8}$/.test(item)) return "/";
    query.set(key, item);
  }
  return "/" + (query.size ? "?" + query : "") + url.hash;
}

export function loginMethod(value: string | null): LoginMethod | undefined {
  switch (value) {
    case "google":
    case "wechat":
    case "email":
    case "phone":
      return value;
  }
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function hashSession(value: string): Promise<string> {
  return Array.from(await sha256(value), byte => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | undefined {
  const matches = request.headers.get("Cookie")?.split(";").map(cookie => cookie.trim())
    .filter(cookie => cookie.startsWith(name + "=")) ?? [];
  if (matches.length !== 1) return;
  const token = matches[0].slice(name.length + 1);
  if (opaqueToken.test(token)) return token;
}

function authCookie(name: string, token: string, maxAge: number): string {
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearSessionCookie = () => authCookie(sessionCookieName, "", 0);
export const clearTransactionCookie = () => authCookie(transactionCookieName, "", 0);

export function authHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
}

function endpoint(value: unknown, issuer: string): URL {
  const url = typeof value === "string" ? httpsUrl(value) : undefined;
  if (!url || url.origin !== new URL(issuer).origin || !url.pathname.startsWith("/oidc/")) {
    throw new Error("Invalid Authing endpoint");
  }
  return url;
}

async function requestJson(url: string | URL, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error("Authing request failed");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Authing response");
  return value as Record<string, unknown>;
}

async function discover(config: OidcConfig): Promise<Discovery> {
  const metadata = await requestJson(config.issuer + "/.well-known/openid-configuration", {
    headers: { Accept: "application/json" },
  });
  if (metadata.issuer !== config.issuer ||
      !Array.isArray(metadata.code_challenge_methods_supported) ||
      !metadata.code_challenge_methods_supported.includes("S256") ||
      !Array.isArray(metadata.id_token_signing_alg_values_supported) ||
      !metadata.id_token_signing_alg_values_supported.includes("RS256")) {
    throw new Error("Authing does not advertise the required OIDC configuration");
  }

  const authMethods = metadata.token_endpoint_auth_methods_supported;
  const tokenAuthentication = Array.isArray(authMethods) && authMethods.includes("client_secret_post")
    ? "client_secret_post"
    : "client_secret_basic";
  if (authMethods !== undefined &&
      (!Array.isArray(authMethods) || !authMethods.includes(tokenAuthentication))) {
    throw new Error("Authing token endpoint requires unsupported client authentication");
  }

  return {
    authorization: endpoint(metadata.authorization_endpoint, config.issuer),
    token: endpoint(metadata.token_endpoint, config.issuer),
    jwks: endpoint(metadata.jwks_uri, config.issuer),
    tokenAuthentication,
  };
}

export async function startExternalLogin(
  db: D1Database,
  config: OidcConfig,
  request: Request,
  options: { intent: LoginIntent; method?: LoginMethod; legacyOwner?: string; returnTo: string },
): Promise<{ location: string; cookie: string }> {
  const { authorization } = await discover(config);
  const { intent, method, legacyOwner, returnTo } = options;
  const state = randomToken();
  const browser = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  const previousBrowser = readCookie(request, transactionCookieName);
  const [stateHash, browserHash, challenge, previousBrowserHash] = await Promise.all([
    hashSession(state),
    hashSession(browser),
    sha256(codeVerifier).then(base64url),
    previousBrowser ? hashSession(previousBrowser) : null,
  ]);
  const now = Date.now();

  await db.batch([
    db.prepare("DELETE FROM site_login_transactions WHERE expires_at <= ? OR browser_hash = ?")
      .bind(now, previousBrowserHash),
    db.prepare(`INSERT INTO site_login_transactions
        (state_hash, browser_hash, code_verifier, nonce, intent, legacy_owner, return_to, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(stateHash, browserHash, codeVerifier, nonce, intent, legacyOwner ?? null,
        safeAuthReturnTo(returnTo), now + transactionSeconds * 1000),
  ]);

  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
  }).toString();
  if (intent === "link") authorization.searchParams.set("max_age", "0");
  const connectionId = method === "google" ? config.googleConnectionId
    : method === "wechat" ? config.wechatConnectionId : undefined;
  if (connectionId) authorization.searchParams.set("ext_idp_conn_id", connectionId);

  return { location: authorization.href, cookie: authCookie(transactionCookieName, browser, transactionSeconds) };
}

export async function consumeLoginTransaction(
  db: D1Database,
  request: Request,
  state: string,
): Promise<LoginTransaction | null> {
  const browser = readCookie(request, transactionCookieName);
  if (!browser || !opaqueToken.test(state)) return null;
  const [stateHash, browserHash] = await Promise.all([hashSession(state), hashSession(browser)]);
  return db.prepare(`DELETE FROM site_login_transactions
      WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?
      RETURNING code_verifier, nonce, intent, legacy_owner, return_to, expires_at`)
    .bind(stateHash, browserHash, Date.now()).first<LoginTransaction>();
}

export async function exchangeExternalCode(
  config: OidcConfig,
  code: string,
  transaction: LoginTransaction,
): Promise<ExternalIdentity> {
  const { token, jwks, tokenAuthentication } = await discover(config);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: transaction.code_verifier,
  });
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" });
  if (tokenAuthentication === "client_secret_post") {
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
  } else {
    const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    headers.set("Authorization", "Basic " + btoa(formEncode(config.clientId) + ":" + formEncode(config.clientSecret)));
  }
  const tokens = await requestJson(token, { method: "POST", headers, body: form.toString() });
  if (typeof tokens.id_token !== "string" || tokens.id_token.length > 16_384) {
    throw new Error("Authing did not return a valid ID token");
  }

  const keys = createRemoteJWKSet(jwks, {
    timeoutDuration: requestTimeoutMs,
    [customFetch]: (url, init) => fetch(url, { ...init, redirect: "manual", cache: "no-store" }),
  });
  const { payload } = await jwtVerify(tokens.id_token, keys, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience: config.clientId,
    requiredClaims: ["exp", "iat", "sub", "nonce"],
    maxTokenAge: transactionSeconds,
    clockTolerance: clockSkewSeconds,
  });

  if (payload.nonce !== transaction.nonce ||
      (Array.isArray(payload.aud) && payload.aud.length !== 1) ||
      (payload.azp !== undefined && payload.azp !== config.clientId) ||
      !payload.sub || !/^[\x21-\x7e]{1,255}$/u.test(payload.sub)) {
    throw new Error("Authing ID token claims do not match the login transaction");
  }

  if (transaction.intent === "link") {
    const earliest = transaction.expires_at / 1000 - transactionSeconds - clockSkewSeconds;
    const latest = Date.now() / 1000 + clockSkewSeconds;
    if (typeof payload.auth_time !== "number" || !Number.isInteger(payload.auth_time) ||
        payload.auth_time < earliest || payload.auth_time > latest) {
      throw new Error("Authing did not freshly authenticate the account being linked");
    }
  }

  const displayName = typeof payload.name === "string"
    ? payload.name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 100) : "";
  const email = payload.email_verified === true && typeof payload.email === "string" &&
    payload.email.length <= 254 && /^[^@\s]+@[^@\s]+$/u.test(payload.email) &&
    !/[\p{Cc}\p{Cf}]/u.test(payload.email) ? payload.email : null;
  return { issuer: config.issuer, subject: payload.sub, displayName: displayName || "页边账号", email };
}

export async function externalSessionOwner(db: D1Database, request: Request): Promise<string | undefined> {
  const currentToken = readCookie(request, sessionCookieName);
  if (!currentToken) return;
  return (await db.prepare("SELECT owner FROM site_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await hashSession(currentToken), Date.now()).first<{ owner: string }>())?.owner;
}

export async function linkExternalIdentity(
  db: D1Database,
  request: Request,
  identity: ExternalIdentity,
  legacyOwner: string,
): Promise<boolean> {
  const currentToken = readCookie(request, sessionCookieName);
  const currentHash = currentToken ? await hashSession(currentToken) : null;
  const linked = await db.prepare(`INSERT INTO site_external_identities (issuer, subject, owner)
    SELECT ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM site_sessions WHERE token_hash = ? AND expires_at > ? AND owner <> ?
    )
    ON CONFLICT (issuer, subject) DO UPDATE SET owner = excluded.owner
    WHERE site_external_identities.owner = excluded.owner
    RETURNING owner`)
    .bind(identity.issuer, identity.subject, legacyOwner, currentHash, Date.now(), legacyOwner)
    .first<{ owner: string }>();
  return linked?.owner === legacyOwner;
}

export async function createExternalSession(
  db: D1Database,
  request: Request,
  identity: ExternalIdentity,
): Promise<string> {
  const previousToken = readCookie(request, sessionCookieName);
  const token = randomToken();
  const { issuer, subject, displayName, email } = identity;
  const [tokenHash, previousHash] = await Promise.all([
    hashSession(token),
    previousToken ? hashSession(previousToken) : null,
  ]);
  const now = Date.now();
  const newOwner = "authing:" + crypto.randomUUID();

  // D1 executes the batch atomically. An existing subject keeps its original owner.
  const [, , session] = await db.batch<{ owner: string }>([
    db.prepare(`INSERT INTO site_accounts (owner, display_name, email, created_at, last_seen)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM site_external_identities WHERE issuer = ? AND subject = ?
      )`).bind(newOwner, displayName, email, now, now, issuer, subject),
    db.prepare(`INSERT INTO site_external_identities (issuer, subject, owner)
      SELECT ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM site_external_identities WHERE issuer = ? AND subject = ?
      )`).bind(issuer, subject, newOwner, issuer, subject),
    db.prepare(`INSERT INTO site_sessions (token_hash, owner, expires_at)
      SELECT ?, owner, ? FROM site_external_identities WHERE issuer = ? AND subject = ?
      RETURNING owner`).bind(tokenHash, now + sessionSeconds * 1000, issuer, subject),
    db.prepare(`UPDATE site_accounts SET last_seen = MAX(last_seen, ?)
      WHERE owner = (SELECT owner FROM site_sessions WHERE token_hash = ?)`).bind(now, tokenHash),
    db.prepare("DELETE FROM site_sessions WHERE expires_at <= ? OR token_hash = ?")
      .bind(now, previousHash),
  ]);
  if (!session.results[0]) throw new Error("Failed to create external session");
  return authCookie(sessionCookieName, token, sessionSeconds);
}

export async function revokeExternalSession(bindings: AuthBindings, request: Request): Promise<void> {
  const token = readCookie(request, sessionCookieName);
  const browser = readCookie(request, transactionCookieName);
  if (!token && !browser) return;
  const db = bindings.DB;
  if (!db) throw new Error("Auth database is unavailable");

  const statements = [];
  if (token) {
    statements.push(db.prepare("DELETE FROM site_sessions WHERE token_hash = ?")
      .bind(await hashSession(token)));
  }
  if (browser) {
    statements.push(db.prepare("DELETE FROM site_login_transactions WHERE browser_hash = ?")
      .bind(await hashSession(browser)));
  }
  await db.batch(statements);
}
