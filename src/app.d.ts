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
        // Add other Cloudflare env vars here
      };
    }
  }

  const __VERSION__: string;
  const __BUILD_HASH__: string;
}

export {};
