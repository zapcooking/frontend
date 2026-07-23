// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace svelteHTML {
    interface HTMLAttributes<T> {
      'on:click_outside'?: (event: CustomEvent<void>) => void;
    }
  }

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
      interface Platform {
        env?: {
          RELAY_API_SECRET: string;
          RELAY_ICON?: string;
          NOTIFICATION_PRIVATE_KEY?: string;
          CRON_SECRET?: string;
          MEMBERSHIP_ENABLED?: string;
          /** Temporary rollout flag for /api/extract-recipe legacy body-pubkey auth. */
          EXTRACT_LEGACY_AUTH?: string;
          /** OpenAI API key — used by /api/extract-recipe and /api/nourish. */
          OPENAI_API_KEY?: string;
          MEMBERSHIP_LIGHTNING_ADDRESS?: string;
          STRIKE_API_KEY?: string;
          STRIKE_API_BASE_URL?: string;
          STRIKE_WEBHOOK_SECRET?: string;
          STRIPE_SECRET_KEY?: string;
          STRIPE_WEBHOOK_SECRET?: string;
          /** KV namespace for URL shortlinks (Cloudflare Pages: bind in dashboard as SHORTLINKS) */
          SHORTLINKS?: {
            get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
            put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
          };
          /** KV namespace for NIP-108 lightning-gated recipe storage */
          GATED_CONTENT?: {
            get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
            put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
            delete(key: string): Promise<void>;
            list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
          };
          /** KV namespace for anon Nourish-score flag submissions, rate-limit buckets, and daily IP-hash salts. */
          NOURISH_FLAGS?: {
            get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
            put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
            delete(key: string): Promise<void>;
            list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
          };
          /**
           * KV namespace for passkey vault-sync blobs, keyed by
           * sha256(credentialId) hex ONLY — never indexed by pubkey (R2).
           * Also holds the vault-sync routes' rate-limit buckets and
           * challenge tombstones.
           */
          VAULT_SYNC?: {
            get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
            put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
            delete(key: string): Promise<void>;
          };
          /** HMAC key for vault-sync challenges. Distinct values in Production and Preview. */
          VAULT_SYNC_CHALLENGE_SECRET?: string;
          /**
           * 64-hex-char AES-256-GCM key for scheduled-post encryption at
           * rest. Secret (Pages project + cron worker) — never committed.
           */
          SCHEDULE_ENC_KEY?: string;
          /** D1 database for scheduled posts (zapcooking-scheduler). */
          SCHEDULER_DB?: {
            prepare(query: string): {
              bind(...values: unknown[]): {
                first<T = unknown>(): Promise<T | null>;
                all<T = unknown>(): Promise<{ results: T[] }>;
                run(): Promise<{ meta: { changes: number } }>;
              };
            };
          };
        };
      }
  }

  const __VERSION__: string;
  const __BUILD_HASH__: string;
}

export {};
