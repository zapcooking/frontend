// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
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
        // Add other Cloudflare env vars here
      };
    }
  }

  const __VERSION__: string;
  const __BUILD_HASH__: string;
}

export {};
