// Hotfix: disable SSR for client-data-only user profile route to bypass
// intermittent server-side NDK construction failures in the Pages runtime.
export const ssr = false;
