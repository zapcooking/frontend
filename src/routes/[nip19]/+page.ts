// Hotfix: disable SSR for client-data-only nip19 route to bypass
// intermittent server-side NDK construction failures in the Pages runtime.
export const ssr = false;
