import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { TrialDatabase } from '../lib/cheffyTrial.server';

/** Real SQLite executes the same conditional SQL used by D1. Node 22 is pinned. */
export function createTrialDatabase(): TrialDatabase {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/scheduler/0003_create_cheffy_trial_turns.sql', 'utf8'));
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              return (sqlite.prepare(sql).get(...values) ?? null) as T | null;
            },
            async run() {
              const result = sqlite.prepare(sql).run(...values);
              return { meta: { changes: Number(result.changes) } };
            }
          };
        }
      };
    }
  };
}
