import {env} from 'cloudflare:workers';
import {cookies} from 'next/headers';
import {getChatGPTUser} from './chatgpt-auth';
import {oidcConfig,hashSession,sessionCookieName} from '../server/oidc';
import {emailLoginConfig} from '../server/email-login';

export type SiteAccount = {
  userId: string;
  displayName: string;
  email: string;
  admin: boolean;
  source: 'chatgpt'|'oidc';
};

function containsEmail(list:string|undefined,email:string){
  return list?.split(',').some(item=>item.trim().toLowerCase()===email.trim().toLowerCase())??false;
}

export async function getLegacySiteAccount():Promise<SiteAccount|null>{
  const user=await getChatGPTUser();
  if(!user||!containsEmail(env.PAGEWISE_LEGACY_EMAILS,user.email))return null;
  return {...user,source:'chatgpt',admin:containsEmail(env.PAGEWISE_ADMIN_EMAILS,user.email)};
}

export async function registerSiteAccount(db:D1Database,account:Pick<SiteAccount,'userId'|'displayName'|'email'>,now=Date.now()){
  await db.prepare(`INSERT INTO site_accounts(owner,display_name,email,created_at,last_seen) VALUES(?,?,?,?,?)
    ON CONFLICT(owner) DO UPDATE SET display_name=excluded.display_name,
      email=COALESCE(excluded.email,site_accounts.email),last_seen=excluded.last_seen
    WHERE site_accounts.last_seen<excluded.last_seen-300000
       OR site_accounts.display_name<>excluded.display_name
       OR (excluded.email IS NOT NULL AND site_accounts.email IS NOT excluded.email)`)
    .bind(account.userId,account.displayName,account.email||null,now,now).run();
}

export async function getSiteAccount():Promise<SiteAccount|null>{
  const db=env.DB;
  const token=(await cookies()).get(sessionCookieName)?.value;
  if(db&&token&&/^[A-Za-z0-9_-]{43}$/.test(token)){
    const identity=await db.prepare(`SELECT a.owner,a.display_name,a.email FROM site_sessions s
      JOIN site_accounts a ON a.owner=s.owner WHERE s.token_hash=? AND s.expires_at>?`)
      .bind(await hashSession(token),Date.now()).first<{owner:string;display_name:string;email:string|null}>();
    if(identity)return {userId:identity.owner,displayName:identity.display_name,email:identity.email??'',admin:false,source:'oidc'};
  }
  const legacy=await getLegacySiteAccount();
  if(db&&legacy)await registerSiteAccount(db,legacy);
  return legacy;
}

export function loginMethodsReady(){
  return {
    google: Boolean(env.DB && oidcConfig(env, 'google')),
    github: Boolean(env.DB && oidcConfig(env, 'github')),
    email: Boolean(env.DB && env.SITE_AUTH_ORIGIN && emailLoginConfig(env)),
  };
}
