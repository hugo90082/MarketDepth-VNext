import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const snapshots = sqliteTable('md_snapshots', {
  key: text('key').primaryKey(), body: text('body').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const gate = sqliteTable('md_gate', {
  key: text('key').primaryKey(), owner: text('owner').notNull().default(''),
  leaseUntil: integer('lease_until').notNull().default(0), nextAt: integer('next_at').notNull().default(0),
});
export const chunks = sqliteTable('md_chunks', {
  id: text('id').notNull(), sha: text('sha').notNull(), startTs: integer('start_ts').notNull(), body: text('body').notNull(),
}, t => [primaryKey({ columns: [t.id, t.sha] }), index('idx_md_chunks_start_ts').on(t.startTs)]);
export const marketBlocks=sqliteTable('md_market_blocks',{
 base:integer('base').primaryKey(),version:integer('version').notNull(),sha:text('sha').notNull(),body:text('body').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('idx_md_market_version').on(t.version)]);
export const marketCollectors=sqliteTable('md_market_collectors',{
 id:text('id').primaryKey(),client:text('client').notNull(),session:text('session').notNull(),expiresAt:integer('expires_at').notNull(),qualifiedAt:integer('qualified_at'),proof:text('proof'),lastBatchId:text('last_batch_id'),lastBatchHash:text('last_batch_hash'),lastReceipt:text('last_receipt'),
});
