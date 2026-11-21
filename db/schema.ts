import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex, check } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), owner: text('owner').notNull(),
  name: text('name').notNull(), kind: text('kind').notNull(), course: text('course').notNull(),
  objectKey: text('object_key').notNull(), created: integer('created').notNull(),
}, t => [index('documents_owner').on(t.owner)]);

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(), owner: text('owner').notNull(),
  docId: text('doc_id').notNull().references(() => documents.id, { onDelete:'cascade' }),
  // image is an R2 object key, never inline image data.
  page: integer('page').notNull(), selectionText: text('selection_text'), image: text('image'), rect: text('rect'),
  messages: text('messages').notNull().default('[]'), refs: text('refs').notNull().default('[]'),
  created: integer('created').notNull(),
}, t => [index('threads_owner_doc').on(t.owner,t.docId)]);

export const memoryEvidence = sqliteTable('memory_evidence', {
  owner: text('owner').notNull(),
  threadId: text('thread_id').notNull().references(() => threads.id, {onDelete:'cascade'}),
  turn: integer('turn').notNull(),
  topicKey: text('topic_key'),
  topic: text('topic'),
  detail: text('detail'),
  kind: text('kind'),
  askedAt: integer('asked_at').notNull(),
}, t => [
  primaryKey({columns:[t.owner,t.threadId,t.turn]}),
  index('memory_evidence_thread').on(t.threadId),
]);

export const memoryMastery = sqliteTable('memory_mastery', {
  owner: text('owner').notNull(), course: text('course').notNull(), topicKey: text('topic_key').notNull(),
}, t => [primaryKey({columns:[t.owner,t.course,t.topicKey]})]);

export const memoryJobs = sqliteTable('memory_jobs', {
  owner: text('owner').notNull(), course: text('course').notNull(),
  token: text('token').notNull(), expiresAt: integer('expires_at').notNull(), samples: text('samples').notNull(),
}, t => [primaryKey({columns:[t.owner,t.course]})]);

export const learningCredits = sqliteTable('learning_credits', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(),
  credits: integer('credits').notNull(), studyDate: text('study_date').notNull(),
  createdAt: integer('created_at').notNull(), sourceId: text('source_id').notNull(),
}, t => [uniqueIndex('learning_credits_daily').on(t.owner,t.studyDate,t.kind),
  check('learning_credits_positive',sql`${t.credits} > 0`),index('learning_credits_owner_date').on(t.owner,t.createdAt,t.id)]);

export const creditIncome = sqliteTable('credit_income', {
  id:text('id').primaryKey(),owner:text('owner').notNull().unique(),
  credits:integer('credits').notNull().default(10),createdAt:integer('created_at').notNull(),
},t=>[check('credit_income_ten',sql`${t.credits}=10`)]);
export const creditRequests = sqliteTable('credit_requests', {
  owner:text('owner').notNull(),requestId:text('request_id').notNull(),fingerprint:text('fingerprint').notNull(),
  reserved:integer('reserved').notNull().default(0),token:text('token').notNull(),expiresAt:integer('expires_at').notNull(),response:text('response'),
  reservedMilli:integer('reserved_milli').default(0),
},t=>[primaryKey({columns:[t.owner,t.requestId]}),check('credit_requests_reserved',sql`${t.reserved} IN (0,1)`)]);
export const creditExpenses = sqliteTable('credit_expenses', {
  id:text('id').primaryKey(),owner:text('owner').notNull(),requestId:text('request_id').notNull(),
  credits:integer('credits').notNull(),createdAt:integer('created_at').notNull(),studyDate:text('study_date').notNull(),
  sourceId:text('source_id').notNull(),detail:text('detail').notNull(),
},t=>[uniqueIndex('credit_expenses_request').on(t.owner,t.requestId),index('credit_expenses_owner_date').on(t.owner,t.createdAt,t.id),check('credit_expenses_one',sql`${t.credits}=-1`)]);

// Metered expenses are signed milli-points. The historical ledger above uses whole points.
export const modelCreditExpenses = sqliteTable('model_credit_expenses', {
  id:text('id').primaryKey(),owner:text('owner').notNull(),requestId:text('request_id').notNull(),
  creditsMilli:integer('credits_milli').notNull(),createdAt:integer('created_at').notNull(),studyDate:text('study_date').notNull(),
  sourceId:text('source_id').notNull(),detail:text('detail').notNull(),
  kind:text('kind', {enum:['site_answer','site_memory']}).notNull().default('site_answer'),
},t=>[uniqueIndex('model_credit_expenses_request').on(t.owner,t.requestId),index('model_credit_expenses_owner_date').on(t.owner,t.createdAt,t.id),
  check('model_credit_expenses_debit',sql`typeof(${t.creditsMilli}) = 'integer' AND ${t.creditsMilli} <= 0`),
  check('model_credit_expenses_kind',sql`${t.kind} IN ('site_answer','site_memory')`)]);

// A failed insert aborts a D1 batch before a caller-supplied memory write can run.
// This table is always empty.
export const creditSettlementGuard = sqliteTable('credit_settlement_guard', {
  rejected:integer('rejected').notNull(),
}, () => [check('credit_settlement_requires_live_hold', sql`0`)]);

export const siteModelUsage = sqliteTable('site_model_usage', {
  id:text('id').primaryKey(), owner:text('owner').notNull(),
  operationId:text('operation_id').notNull(), createdAt:integer('created_at').notNull(),
  outcome:text('outcome', {enum:['completed','failed']}).notNull(), detail:text('detail').notNull(),
}, t => [index('site_model_usage_owner_operation').on(t.owner,t.operationId),
  check('site_model_usage_outcome',sql`${t.outcome} IN ('completed','failed')`)]);

export const adminCreditAdjustments = sqliteTable('admin_credit_adjustments', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  adminOwner: text('admin_owner').notNull(),
  requestId: text('request_id').notNull(),
  deltaMilli: integer('delta_milli').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  uniqueIndex('admin_credit_adjustments_request').on(t.adminOwner,t.requestId),
  index('admin_credit_adjustments_owner_date').on(t.owner,t.createdAt,t.id),
  index('admin_credit_adjustments_date').on(t.createdAt,t.id),
  check('admin_credit_adjustments_signed',sql`typeof(${t.deltaMilli}) = 'integer' AND ${t.deltaMilli} != 0 AND ${t.deltaMilli} BETWEEN -9007199254740991 AND 9007199254740991`),
  check('admin_credit_adjustments_reason',sql`length(trim(${t.reason})) BETWEEN 1 AND 500`),
]);

export * from './site-accounts';

export const studyProjects = sqliteTable('study_projects', {
  owner: text('owner').notNull(),
  name: text('name').notNull(),
}, t => [primaryKey({columns:[t.owner,t.name]})]);
