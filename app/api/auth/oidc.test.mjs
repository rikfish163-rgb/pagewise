import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { applyMigrations } from "../../../tests/sqlite-migrations.mjs";
import {
  consumeLoginTransaction, createExternalSession, exchangeExternalCode, externalLoginReady,
  externalSessionOwner, hashSession, linkExternalIdentity, oidcConfig, randomToken,
  revokeExternalSession, safeAuthReturnTo, sameOriginAuthWrite, sessionCookieName,
  startExternalLogin, transactionCookieName,
} from "../../../server/oidc.ts";

const bindings = {
  AUTHING_ISSUER: "https://fixture.authing.cn/oidc",
  AUTHING_CLIENT_ID: "fixture-client",
  AUTHING_CLIENT_SECRET: "fixture-secret",
  SITE_AUTH_ORIGIN: "https://pagewise.example",
  AUTHING_GOOGLE_CONNECTION_ID: "fixture-google",
  AUTHING_WECHAT_CONNECTION_ID: "fixture-wechat",
};
const config = oidcConfig(bindings);
const issuer = bindings.AUTHING_ISSUER;
const authorize = issuer + "/auth";
const tokenUrl = issuer + "/token";
const jwksUrl = issuer + "/.well-known/jwks.json";
const discoveryUrl = issuer + "/.well-known/openid-configuration";
const metadata = {
  issuer, authorization_endpoint: authorize, token_endpoint: tokenUrl, jwks_uri: jwksUrl,
  code_challenge_methods_supported: ["S256"], id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
};
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

test("requires explicit HTTPS Authing bindings and restricts logout and link origins", () => {
  assert.equal(externalLoginReady(), false);
  for (const invalid of [
    { AUTHING_ISSUER: "http://fixture.authing.cn/oidc" },
    { AUTHING_ISSUER: "https://fixture.authing.cn.evil.example/oidc" },
    { AUTHING_ISSUER: "https://other@fixture.authing.cn/oidc" },
    { AUTHING_ISSUER: "https://fixture.authing.cn/oidc?x" },
    { AUTHING_CLIENT_SECRET: "" },
    { SITE_AUTH_ORIGIN: "https://pagewise.example/path" },
  ]) assert.equal(externalLoginReady({ ...bindings, ...invalid }), false);
  assert.equal(externalLoginReady(bindings), true);
  assert.equal(config.redirectUri, "https://pagewise.example/api/auth/callback");
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

test("starts all hosted methods using S256 and consumes each live transaction only in its browser", async (t) => {
  const { db, sql } = database(t);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, discoveryUrl);
    assert.equal(init.redirect, "manual");
    return Response.json(metadata);
  });

  for (const method of ["google", "wechat", "email", "phone"]) {
    const { location, cookie } = await startExternalLogin(db, config, request(), {
      intent: "login", method, returnTo: "/?document=abc&page=3#reader",
    });
    const url = new URL(location);
    assert.equal(url.origin + url.pathname, authorize);
    assert.equal(url.searchParams.get("ext_idp_conn_id"),
      ["google", "wechat"].includes(method) ? "fixture-" + method : null);
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
  }

  const pending = await startExternalLogin(db, config, request(), {
    intent: "login", method: "phone", returnTo: "/",
  });
  sql.exec("UPDATE site_login_transactions SET expires_at = 0");
  assert.equal(await consumeLoginTransaction(db, request(cookiePair(pending.cookie)),
    new URL(pending.location).searchParams.get("state")), null);
});

test("rejects a mismatched discovery issuer or off-origin endpoint before credentials are sent", async (t) => {
  const { db } = database(t);
  let response;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, discoveryUrl);
    assert.equal(init.redirect, "manual");
    return response;
  });
  for (const mismatch of [
    { issuer: "https://elsewhere.example/oidc" },
    { authorization_endpoint: "https://elsewhere.example/oidc/auth" },
    { token_endpoint: "http://fixture.authing.cn/oidc/token" },
    { jwks_uri: "https://sibling.authing.cn/oidc/.well-known/jwks.json" },
    { code_challenge_methods_supported: ["plain"] },
  ]) {
    response = Response.json({ ...metadata, ...mismatch });
    await assert.rejects(startExternalLogin(db, config, request(), { intent: "login", returnTo: "/" }));
  }
  response = Response.redirect("https://elsewhere.example/oidc", 302);
  await assert.rejects(startExternalLogin(db, config, request(), { intent: "login", returnTo: "/" }));
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
    if (String(url) === discoveryUrl) return Response.json(metadata);
    if (String(url) === jwksUrl) return jwks();
    assert.equal(String(url), tokenUrl);
    assert.equal(init.method, "POST");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("client_secret"), bindings.AUTHING_CLIENT_SECRET);
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
  await assert.rejects(exchange(await sign(), link));
  await assert.rejects(exchange(await sign({ auth_time: now - 60 }), link));
  assert.equal((await exchange(await sign({ auth_time: now }), link)).subject, "subject");

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
  assert.match(owner, /^authing:/);
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
