import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { applyMigrations } from "../../../tests/sqlite-migrations.mjs";
import {
  consumeLoginTransaction, createExternalSession, exchangeExternalCode,
  externalSessionOwner, hashSession, linkExternalIdentity, oidcConfig, randomToken,
  revokeExternalSession, safeAuthReturnTo, sameOriginAuthWrite, sessionCookieName,
  startExternalLogin, transactionCookieName,
} from "../../../server/oidc.ts";

const bindings = {
  GOOGLE_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-secret",
  SITE_AUTH_ORIGIN: "https://pagewise.htsjustin.com",
};
const config = oidcConfig(bindings);
const issuer = "https://accounts.google.com";
const authorize = issuer + "/o/oauth2/v2/auth";
const tokenUrl = "https://oauth2.googleapis.com/token";
const jwksUrl = "https://www.googleapis.com/oauth2/v3/certs";
const request = (cookie) => new Request(config.redirectUri, { headers: cookie ? { Cookie: cookie } : {} });
const cookiePair = (setCookie) => setCookie.split(";", 1)[0];

function database(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  applyMigrations(sql);
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        all() { return { results: sql.prepare(query).all(...values) }; },
        async first() { return sql.prepare(query).get(...values) ?? null; },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.all());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sql };
}

test("requires explicit HTTPS Google bindings and restricts logout and link origins", () => {
  assert.equal(Boolean(oidcConfig()), false);
  for (const invalid of [
    { GOOGLE_CLIENT_ID: "fixture-client" },
    { GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com.example" },
    { GOOGLE_CLIENT_SECRET: "" },
    { SITE_AUTH_ORIGIN: "https://pagewise.example/path" },
  ]) assert.equal(Boolean(oidcConfig({ ...bindings, ...invalid })), false);
  assert.equal(Boolean(oidcConfig(bindings)), true);
  assert.equal(config.redirectUri, "https://pagewise.htsjustin.com/api/auth/callback");
  for (const origin of ["null", "https://sub.pagewise.example", undefined]) {
    const headers = origin ? { Origin: origin } : {};
    assert.equal(sameOriginAuthWrite(bindings, new Request(config.redirectUri, { headers })), false);
  }
  const headers = { Origin: config.siteOrigin, "Sec-Fetch-Site": "same-origin" };
  assert.equal(sameOriginAuthWrite(bindings, new Request(config.redirectUri, { method: "POST", headers })), true);
  headers["Sec-Fetch-Site"] = "same-site";
  assert.equal(sameOriginAuthWrite(bindings, new Request(config.redirectUri, { method: "POST", headers })), false);

  for (const value of ["//elsewhere.example", "/\\elsewhere.example", "/api/auth/login", "/?redirect=https://elsewhere.example"]) {
    assert.equal(safeAuthReturnTo(value), "/");
  }
  assert.equal(safeAuthReturnTo("/?document=abc-123&page=3#reader"), "/?document=abc-123&page=3#reader");
});

test("starts Google authorization with S256 and consumes each transaction only in its browser", async (t) => {
  const { db, sql } = database(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("Authorization uses the fixed Google endpoint"));
  const { location, cookie } = await startExternalLogin(db, config, request(), {
    intent: "login", returnTo: "/?document=abc&page=3#reader",
  });
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, authorize);
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), "openid profile email");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.match(cookie, /^__Host-pagewise_oidc=[\w-]{43}; Path=\/; Max-Age=300; HttpOnly; Secure; SameSite=Lax$/);

  const state = url.searchParams.get("state");
  const callback = request(cookiePair(cookie));
  const row = sql.prepare("SELECT state_hash, browser_hash FROM site_login_transactions").get();
  assert.equal(row.state_hash, await hashSession(state));
  assert.equal(row.browser_hash, await hashSession(cookiePair(cookie).slice(transactionCookieName.length + 1)));
  assert.equal(await consumeLoginTransaction(db, callback, randomToken()), null);
  assert.equal(await consumeLoginTransaction(db, request(transactionCookieName + "=" + randomToken()), state), null);
  const attempts = await Promise.all([
    consumeLoginTransaction(db, callback, state),
    consumeLoginTransaction(db, callback, state),
  ]);
  const transaction = attempts.find(Boolean);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(transaction.return_to, "/?document=abc&page=3#reader");
  assert.equal(transaction.nonce, url.searchParams.get("nonce"));
  assert.equal(url.searchParams.get("code_challenge"),
    createHash("sha256").update(transaction.code_verifier).digest("base64url"));

  const pending = await startExternalLogin(db, config, request(), {
    intent: "login", returnTo: "/",
  });
  sql.exec("UPDATE site_login_transactions SET expires_at = 0");
  assert.equal(await consumeLoginTransaction(db, request(cookiePair(pending.cookie)),
    new URL(pending.location).searchParams.get("state")), null);
});

test("accepts only a matching, signed RS256 token and rejects token and JWKS redirects", async (t) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const forgedKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...await exportJWK(publicKey), kid: "fixture", use: "sig", alg: "RS256" };
  const now = Math.floor(Date.now() / 1000);
  const transaction = {
    nonce: randomToken(), code_verifier: randomToken(), intent: "login", legacy_owner: null,
    expires_at: Date.now() + 300_000, return_to: "/",
  };

  let tokens, jwks;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.redirect, "manual");
    if (String(url) === jwksUrl) return jwks();
    assert.equal(String(url), tokenUrl);
    assert.equal(init.method, "POST");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("client_secret"), bindings.GOOGLE_CLIENT_SECRET);
    assert.equal(form.get("client_id"), bindings.GOOGLE_CLIENT_ID);
    assert.equal(form.get("redirect_uri"), config.redirectUri);
    assert.equal(form.get("code_verifier"), transaction.code_verifier);
    return tokens();
  });

  jwks = () => Response.json({ keys: [jwk] });
  const sign = (claims = {}, key = privateKey, alg = "RS256") => new SignJWT({
    iss: issuer, aud: config.clientId, sub: "subject", iat: now, exp: now + 300,
    nonce: transaction.nonce, email: "reader@example.com", email_verified: true, ...claims,
  }).setProtectedHeader({ alg, kid: "fixture" }).sign(key);
  const exchange = async (jwt, txn = transaction) => {
    tokens = () => Response.json({ id_token: jwt, access_token: "never returned" });
    return exchangeExternalCode(config, "fixture-code", txn);
  };

  assert.deepEqual(await exchange(await sign()), {
    issuer, subject: "subject", displayName: "页边账号", email: "reader@example.com",
  });
  assert.equal((await exchange(await sign({ email_verified: false }))).email, null);

  for (const claims of [
    { iss: issuer + "/" }, { aud: "another-client" }, { aud: [config.clientId, "other-audience"] },
    { azp: "another-client" }, { nonce: randomToken() }, { exp: now - 120 }, { iat: now - 600 },
  ]) await assert.rejects(exchange(await sign(claims)));
  await assert.rejects(exchange(await sign({}, forgedKey)));
  await assert.rejects(exchange(await sign({}, crypto.getRandomValues(new Uint8Array(32)), "HS256")));

  const link = { ...transaction, intent: "link", legacy_owner: "legacy" };
  assert.equal((await exchange(await sign(), link)).subject, "subject");
  assert.equal((await exchange(await sign({ iss: "accounts.google.com" }))).issuer, issuer);

  tokens = () => Response.redirect("https://elsewhere.example/token", 307);
  await assert.rejects(exchangeExternalCode(config, "fixture-code", transaction));
  jwks = () => Response.redirect("https://elsewhere.example/jwks", 302);
  await assert.rejects(exchange(await sign()));
});

test("session rotation and revocation preserve provider ownership and never link by email", async (t) => {
  const { db, sql } = database(t);
  sql.exec("INSERT INTO site_accounts VALUES ('legacy', 'Legacy', 'same@example.com', 1, 1), ('other', 'Other', NULL, 1, 1)");
  const external = { issuer, subject: "new-external", displayName: "Reader", email: "same@example.com" };
  const original = await createExternalSession(db, request(), external);
  assert.match(original, /^__Host-pagewise_session=[\w-]{43}; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax$/);
  const originalRequest = request(cookiePair(original));
  const owner = await externalSessionOwner(db, originalRequest);
  assert.match(owner, /^account:/);
  assert.equal(sql.prepare("SELECT email FROM site_accounts WHERE owner = ?").get(owner).email, external.email);
  assert.equal(await linkExternalIdentity(db, request(), external, "legacy"), false);

  const linked = { ...external, subject: "new-link" };
  assert.equal(await linkExternalIdentity(db, originalRequest, linked, "legacy"), false);
  assert.equal(await linkExternalIdentity(db, request(), linked, "legacy"), true);
  assert.equal(await linkExternalIdentity(db, request(), linked, "legacy"), true);
  assert.equal(await linkExternalIdentity(db, request(), linked, "other"), false);

  const rotated = await createExternalSession(db, originalRequest, linked);
  const rotatedRequest = request(cookiePair(rotated));
  assert.equal(await externalSessionOwner(db, originalRequest), undefined);
  assert.equal(await externalSessionOwner(db, rotatedRequest), "legacy");
  const snapshot = sql.prepare("SELECT token_hash FROM site_sessions").get();
  assert.equal(snapshot.token_hash, await hashSession(cookiePair(rotated).slice(sessionCookieName.length + 1)));
  await revokeExternalSession({ DB: db }, rotatedRequest);
  assert.equal(await externalSessionOwner(db, rotatedRequest), undefined);
});

test("GitHub uses its own callback, PKCE, and a stable user ID without forwarding tokens elsewhere", async (t) => {
  const { db } = database(t);
  const github = oidcConfig({
    ...bindings, GITHUB_CLIENT_ID: "github_client", GITHUB_CLIENT_SECRET: "github-secret",
  }, "github");
  const { location, cookie } = await startExternalLogin(db, github, request(), { intent: "login", returnTo: "/" });
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pagewise.htsjustin.com/api/auth/callback/github");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), null);
  const transaction = await consumeLoginTransaction(db, request(cookiePair(cookie)), url.searchParams.get("state"));
  assert(transaction);

  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (endpoint, init) => {
    fetches++;
    assert.equal(init.redirect, "manual");
    if (endpoint === "https://github.com/login/oauth/access_token") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("code_verifier"), transaction.code_verifier);
      assert.equal(form.get("redirect_uri"), github.redirectUri);
      return Response.json({ access_token: "gho_fixture" });
    }
    assert.equal(endpoint, "https://api.github.com/user");
    assert.equal(init.headers.Authorization, "Bearer gho_fixture");
    return Response.json({ id: 4382, login: "reader", email: "unverified@example.com" });
  });
  await assert.rejects(exchangeExternalCode(config, "code", transaction), /provider mismatch/);
  assert.equal(fetches, 0);
  assert.deepEqual(await exchangeExternalCode(github, "code", transaction), {
    issuer: "https://github.com", subject: "4382", displayName: "reader", email: null,
  });
  assert.equal(fetches, 2);
});

test("email codes are kept out of D1, bound to the browser and owner, and consumed once", async (t) => {
  const { db, sql } = database(t);
  const env = { RESEND_API_KEY: "re_fixture", AUTH_EMAIL_FROM: "login@mail.example.com" };
  const { emailLoginConfig, normalizeLoginEmail, sendLoginEmail, verifyLoginEmail } =
    await import("../../../server/email-login.ts");
  const emailConfig = emailLoginConfig(env);
  const email = normalizeLoginEmail(" Reader+Notes@Example.COM ");
  assert.equal(email, "reader+notes@example.com");
  let code;
  t.mock.method(globalThis, "fetch", async (endpoint, init) => {
    assert.equal(endpoint, "https://api.resend.com/emails");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.to, [email]);
    code = body.text.match(/\b\d{6}\b/)[0];
    return new Response(null, { status: 200 });
  });

  const cookie = await sendLoginEmail(db, emailConfig, email, "/?document=abc", "legacy");
  assert.match(cookie, /^__Host-pagewise_email=[\w-]{43}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  const row = sql.prepare("SELECT code_hash, attempts FROM site_email_challenges").get();
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.attempts, 0);
  assert.equal(await sendLoginEmail(db, emailConfig, email, "/", null), null);
  const browser = request(cookiePair(cookie));
  assert.equal(await verifyLoginEmail(db, emailConfig, request(), code, "legacy"), null);
  assert.equal(await verifyLoginEmail(db, emailConfig, browser, code, null), null);
  const wrong = code === "000000" ? "000001" : "000000";
  assert.equal(await verifyLoginEmail(db, emailConfig, browser, wrong, "legacy"), null);
  assert.equal(sql.prepare("SELECT attempts FROM site_email_challenges").get().attempts, 1);
  const [first, second] = await Promise.all([
    verifyLoginEmail(db, emailConfig, browser, code, "legacy"),
    verifyLoginEmail(db, emailConfig, browser, code, "legacy"),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal((first ?? second).return_to, "/?document=abc");

  sql.prepare("UPDATE site_email_challenges SET consumed = 0, attempts = 0, sent_at = ?")
    .run(Date.now() - 11 * 60_000);
  assert.equal(await verifyLoginEmail(db, emailConfig, browser, code, "legacy"), null);
  sql.prepare("UPDATE site_email_challenges SET attempts = 4, sent_at = ?").run(Date.now());
  assert.equal(await verifyLoginEmail(db, emailConfig, browser, wrong, "legacy"), null);
  assert.equal(await verifyLoginEmail(db, emailConfig, browser, code, "legacy"), null);
  assert.equal(sql.prepare("SELECT attempts FROM site_email_challenges").get().attempts, 5);
});
