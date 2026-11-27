import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export type OidcBindings = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  SITE_AUTH_ORIGIN?: string;
};

export type AuthBindings = OidcBindings & { DB?: D1Database };
export type LoginIntent = "login" | "link";

export type OAuthProvider = "google" | "github";

type OidcConfig = {
  provider: OAuthProvider;
  issuer: string;
  clientId: string;
  clientSecret: string;
  siteOrigin: string;
  redirectUri: string;
};

const githubIssuer = "https://github.com";
const githubAuthorization = githubIssuer + "/login/oauth/authorize";
const githubToken = githubIssuer + "/login/oauth/access_token";
const githubUser = "https://api.github.com/user";

const googleIssuer = "https://accounts.google.com";
const googleAuthorization = googleIssuer + "/o/oauth2/v2/auth";
const googleToken = "https://oauth2.googleapis.com/token";
const googleJwks = new URL("https://www.googleapis.com/oauth2/v3/certs");

type LoginTransaction = {
  code_verifier: string;
  nonce: string;
  intent: LoginIntent;
  legacy_owner: string | null;
  return_to: string;
  expires_at: number;
};

export type ExternalIdentity = { issuer: string; subject: string; displayName: string; email: string | null };

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

export function oidcConfig(bindings: OidcBindings = {}, provider: OAuthProvider = "google"): OidcConfig | undefined {
  const origin = siteOrigin(bindings.SITE_AUTH_ORIGIN);
  const google = provider === "google";
  const clientId = google ? bindings.GOOGLE_CLIENT_ID : bindings.GITHUB_CLIENT_ID;
  const clientSecret = google ? bindings.GOOGLE_CLIENT_SECRET : bindings.GITHUB_CLIENT_SECRET;
  const clientPattern = google ? /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/ : /^[A-Za-z0-9_]{1,128}$/;
  if (!origin || !clientId || !clientSecret || !clientPattern.test(clientId) ||
      !/^[\x21-\x7e]{1,512}$/u.test(clientSecret)) return;

  return {
    provider,
    issuer: google ? googleIssuer : githubIssuer,
    clientId,
    clientSecret,
    siteOrigin: origin,
    redirectUri: origin + (google ? "/api/auth/callback" : "/api/auth/callback/github"),
  };
}

export function transactionMatchesProvider(config: OidcConfig, transaction: LoginTransaction): boolean {
  return config.provider === "github" ? transaction.nonce === "github" : opaqueToken.test(transaction.nonce);
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

export function readCookie(request: Request, name: string): string | undefined {
  const matches = request.headers.get("Cookie")?.split(";").map(cookie => cookie.trim())
    .filter(cookie => cookie.startsWith(name + "=")) ?? [];
  if (matches.length !== 1) return;
  const token = matches[0].slice(name.length + 1);
  if (opaqueToken.test(token)) return token;
}

export function authCookie(name: string, token: string, maxAge: number): string {
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

async function requestJson(url: string | URL, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error("OAuth request failed");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OAuth response");
  return value as Record<string, unknown>;
}

export async function startExternalLogin(
  db: D1Database,
  config: OidcConfig,
  request: Request,
  options: { intent: LoginIntent; legacyOwner?: string; returnTo: string },
): Promise<{ location: string; cookie: string }> {
  const google = config.provider === "google";
  const authorization = new URL(google ? googleAuthorization : githubAuthorization);
  const { intent, legacyOwner, returnTo } = options;
  const state = randomToken();
  const browser = randomToken();
  // GitHub has no ID token nonce. Store the provider marker in that transaction field.
  const nonce = google ? randomToken() : "github";
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
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  if (google) {
    authorization.searchParams.set("scope", "openid profile email");
    authorization.searchParams.set("nonce", nonce);
  } else {
    authorization.searchParams.set("scope", "");
  }
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
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: transaction.code_verifier,
  });
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" });
  if (!transactionMatchesProvider(config, transaction)) throw new Error("OAuth provider mismatch");

  const github = config.provider === "github";
  const tokens = await requestJson(github ? githubToken : googleToken, {
    method: "POST", headers, body: form.toString(),
  });
  if (github) {
    if (typeof tokens.access_token !== "string" || !/^[A-Za-z0-9_]{1,512}$/.test(tokens.access_token)) {
      throw new Error("Invalid GitHub access token");
    }
    const user = await requestJson(githubUser, { headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + tokens.access_token,
      "User-Agent": "Pagewise",
    } });
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
      throw new Error("Invalid GitHub user ID");
    }
    return {
      issuer: config.issuer, subject: String(user.id),
      displayName: profileName(user.name) || profileName(user.login) || "页边账号", email: null,
    };
  }
  if (typeof tokens.id_token !== "string" || tokens.id_token.length > 16_384) {
    throw new Error("Google did not return a valid ID token");
  }

  const keys = createRemoteJWKSet(googleJwks, {
    timeoutDuration: requestTimeoutMs,
    [customFetch]: (url, init) => fetch(url, { ...init, redirect: "manual", cache: "no-store" }),
  });
  const { payload } = await jwtVerify(tokens.id_token, keys, {
    algorithms: ["RS256"],
    issuer: [config.issuer, "accounts.google.com"],
    audience: config.clientId,
    requiredClaims: ["exp", "iat", "sub", "nonce"],
    maxTokenAge: transactionSeconds,
    clockTolerance: clockSkewSeconds,
  });

  if (payload.nonce !== transaction.nonce ||
      (Array.isArray(payload.aud) && payload.aud.length !== 1) ||
      (payload.azp !== undefined && payload.azp !== config.clientId) ||
      !payload.sub || !/^[\x21-\x7e]{1,255}$/u.test(payload.sub)) {
    throw new Error("Google ID token claims do not match the login transaction");
  }

  const displayName = profileName(payload.name);
  const email = payload.email_verified === true && typeof payload.email === "string" &&
    payload.email.length <= 254 && /^[^@\s]+@[^@\s]+$/u.test(payload.email) &&
    !/[\p{Cc}\p{Cf}]/u.test(payload.email) ? payload.email : null;
  return { issuer: config.issuer, subject: payload.sub, displayName: displayName || "页边账号", email };
}

function profileName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 100) : "";
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
  const newOwner = "account:" + crypto.randomUUID();

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
