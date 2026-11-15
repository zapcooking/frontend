import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { LiveDb } from '../lib/live/sessions.server';

/** The Go live migrations, in order. */
export const LIVE_MIGRATIONS = [
  '0004_create_live_sessions.sql',
  '0005_add_live_pass_rejoins.sql',
  '0006_add_live_note_id.sql',
  '0007_live_rollout_and_safety.sql',
  '0008_add_live_watching_counts.sql'
] as const;

/**
 * Put hosts on the approved-hosts list. Hosting defaults to 'approved'
 * mode (no KV in tests reads as 'approved'), so a route test that creates
 * sessions approves its hosts first.
 */
export function approveHosts(db: { raw: any }, ...pubkeys: string[]): void {
  for (const pk of pubkeys) {
    db.raw
      .prepare(
        "INSERT OR IGNORE INTO live_approved_hosts (pubkey, created_at, added_by) VALUES (?, 1, 'test')"
      )
      .run(pk);
  }
}

/**
 * Real SQLite running the Go live migrations (0004–0008), so the tests exercise the same SQL
 * (including the partial unique index) that D1 runs. Node 22 is pinned.
 * `raw` gives tests direct access for arranging and inspecting rows.
 */
export function createLiveDatabase(): LiveDb & { raw: any } {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  for (const file of LIVE_MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/scheduler/${file}`, 'utf8'));
  }
  return {
    raw: sqlite,
    /** Like D1's batch: one transaction, all or none. */
    async batch(statements: any[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          // D1 binds numbered parameters (?1, ?2, and a number may repeat);
          // node:sqlite binds plain `?` in order. Rewrite to the plain form.
          const order: number[] = [];
          const plain = sql.replace(/\?(\d+)/g, (_m, n: string) => {
            order.push(Number(n) - 1);
            return '?';
          });
          const source = order.length > 0 ? order.map((i) => values[i]) : values;
          const args = source.map((v) => (v === undefined ? null : v)) as any[];
          return {
            async first<T>() {
              return (sqlite.prepare(plain).get(...args) ?? null) as T | null;
            },
            async all<T>() {
              return { results: sqlite.prepare(plain).all(...args) as T[] };
            },
            async run() {
              const result = sqlite.prepare(plain).run(...args);
              return { meta: { changes: Number(result.changes) } };
            }
          };
        }
      };
    }
  };
}
