import { readFileSync } from 'node:fs';

const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url))).entries;

export const migration = tag => readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8');

export function applyMigrations(sql, {from=0, to=journal.length}={}) {
  for (const {tag} of journal.slice(from,to)) sql.exec(migration(tag));
}
