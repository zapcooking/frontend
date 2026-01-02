// Client-side load function - this runs instead of server load in static builds
// This prevents SvelteKit from trying to fetch __data.json in Capacitor
export const ssr = false;
export const csr = true;

export async function load() {
  // Return default data - actual recipe data is loaded client-side in the component
  // This completely bypasses the need for server data
  return {
    ogMeta: null
  };
}

