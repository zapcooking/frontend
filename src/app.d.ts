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
          /** KV namespace for Lightning invoice metadata (Cloudflare Pages: bind in dashboard as INVOICE_METADATA) */
          INVOICE_METADATA?: {
            get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
            put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
            delete(key: string): Promise<void>;
          };
          // Add other Cloudflare env vars here
        };
      }
  }

  const __VERSION__: string;
  const __BUILD_HASH__: string;
}

export {};
