/**
 * Audience helpers for the shared SSR magazine. They do not read identity
 * until the hydrated component mounts. Browser identity is used
 * only to suppress invitations; it never grants access to a paid feature.
 */
export const IDENTITY_KEY = 'nostrcooking_loggedInPublicKey';

/** @typedef {'guest' | 'member' | 'nonmember' | 'unknown'} Audience */
/** @param {{getItem: (key: string) => string | null}} storage */
export function readLandingIdentity(storage) {
  try {
    const value = storage.getItem(IDENTITY_KEY);
    if (!value) return { kind: 'guest' };
    if (/^[0-9a-f]{64}$/i.test(value)) return { kind: 'signed-in', pubkey: value.toLowerCase() };
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * @param {{getItem: (key: string) => string | null}} storage
 * @param {typeof fetch} fetcher
 * @param {AbortSignal} [signal]
 * @returns {Promise<Audience>}
 */
export async function landingAudience(storage, fetcher, signal) {
  const identity = readLandingIdentity(storage);
  if (identity.kind !== 'signed-in') return identity.kind === 'guest' ? 'guest' : 'unknown';
  try {
    const response = await fetcher('/api/membership/check-status', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: identity.pubkey }),
      signal: signal || AbortSignal.timeout(5000)
    });
    if (!response.ok) return 'unknown';
    const data = await response.json();
    return data.isActive === true ? 'member' : data.isActive === false ? 'nonmember' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {{querySelectorAll: (selector: string) => Iterable<{hidden: boolean}>}} root
 * @param {Audience} audience
 */
export function applyLandingAudience(root, audience) {
  for (const element of root.querySelectorAll('[data-landing-guest]')) {
    element.hidden = audience !== 'guest';
  }
  for (const element of root.querySelectorAll('[data-landing-upgrade]')) {
    element.hidden = audience !== 'guest' && audience !== 'nonmember';
  }
  for (const element of root.querySelectorAll('[data-landing-account]')) {
    element.hidden = audience === 'guest';
  }
}

/**
 * Component-owned listeners and requests. A fresh controller is created when
 * Explore is mounted again after client navigation.
 * @param {HTMLElement} element
 * @param {Pick<Window, 'localStorage' | 'fetch' | 'addEventListener' | 'removeEventListener'>} [environment]
 */
export function createLandingAudienceController(element, environment = window) {
  let generation = 0;
  let disposed = false;
  /** @type {AbortController | null} */
  let request = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let requestTimeout = null;
  const root = {
    /** @param {string} selector */
    querySelectorAll: (selector) =>
      /** @type {NodeListOf<HTMLElement>} */ (element.querySelectorAll(selector))
  };
  const cancelRequest = () => {
    request?.abort();
    request = null;
    if (requestTimeout !== null) clearTimeout(requestTimeout);
    requestTimeout = null;
  };
  /** @param {string} [pubkey] Same-tab identity; omitted for storage/pageshow refreshes. */
  const refresh = async (pubkey) => {
    if (disposed) return;
    const current = ++generation;
    cancelRequest();
    // Hide invitations while a changed identity is being resolved.
    applyLandingAudience(root, 'unknown');
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    requestTimeout = timeout;
    /** @type {Audience} */
    let audience = 'unknown';
    try {
      // Auth notifications precede their storage write/removal. An explicit
      // subscriber value (including an empty logout value) is authoritative.
      const storage =
        pubkey === undefined ? environment.localStorage : { getItem: () => pubkey || null };
      audience = await landingAudience(
        storage,
        environment.fetch.bind(environment),
        controller.signal
      );
    } catch {
      /* storage unavailable */
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        request = null;
        requestTimeout = null;
      }
    }
    if (!disposed && current === generation) applyLandingAudience(root, audience);
  };
  /** @param {PageTransitionEvent} event */
  const pageShown = (event) => {
    if (event.persisted) void refresh();
  };
  /** @param {StorageEvent} event */
  const storageChanged = (event) => {
    if (event.key === IDENTITY_KEY || event.key === null) void refresh();
  };
  environment.addEventListener('pageshow', pageShown);
  environment.addEventListener('storage', storageChanged);
  return {
    refresh,
    destroy() {
      disposed = true;
      generation++;
      cancelRequest();
      environment.removeEventListener('pageshow', pageShown);
      environment.removeEventListener('storage', storageChanged);
    }
  };
}
