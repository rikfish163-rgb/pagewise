import {index,integer,primaryKey,sqliteTable,text} from 'drizzle-orm/sqlite-core';

export const siteAccounts=sqliteTable('site_accounts',{
  owner:text('owner').primaryKey().notNull(),
  displayName:text('display_name').notNull(),
  email:text('email'),
  createdAt:integer('created_at').notNull(),
  lastSeen:integer('last_seen').notNull(),
},t=>[index('site_accounts_email').on(t.email)]);

export const siteSessions=sqliteTable('site_sessions',{
  tokenHash:text('token_hash').primaryKey().notNull(),
  owner:text('owner').notNull().references(()=>siteAccounts.owner,{onDelete:'cascade'}),
  expiresAt:integer('expires_at').notNull(),
},t=>[index('site_sessions_expiry').on(t.expiresAt)]);


export const siteExternalIdentities=sqliteTable('site_external_identities',{
  issuer:text('issuer').notNull(),
  subject:text('subject').notNull(),
  owner:text('owner').notNull().references(()=>siteAccounts.owner,{onDelete:'cascade'}),
},t=>[primaryKey({columns:[t.issuer,t.subject]}),index('site_external_identities_owner').on(t.owner)]);

export const siteLoginTransactions=sqliteTable('site_login_transactions',{
  stateHash:text('state_hash').primaryKey().notNull(),
  browserHash:text('browser_hash').notNull(),
  codeVerifier:text('code_verifier').notNull(),
  nonce:text('nonce').notNull(),
  intent:text('intent',{enum:['login','link']}).notNull(),
  legacyOwner:text('legacy_owner'),
  returnTo:text('return_to').notNull(),
  expiresAt:integer('expires_at').notNull(),
},t=>[index('site_login_transactions_expiry').on(t.expiresAt),
  index('site_login_transactions_browser').on(t.browserHash)]);

export const siteEmailChallenges=sqliteTable('site_email_challenges',{
  browserHash:text('browser_hash').primaryKey().notNull(),
  email:text('email').notNull(),
  codeHash:text('code_hash').notNull(),
  returnTo:text('return_to').notNull(),
  legacyOwner:text('legacy_owner'),
  sentAt:integer('sent_at').notNull(),
  attempts:integer('attempts').notNull().default(0),
  consumed:integer('consumed').notNull().default(0),
},t=>[
  index('site_email_challenges_sent').on(t.sentAt),
  index('site_email_challenges_email_sent').on(t.email,t.sentAt),
]);
