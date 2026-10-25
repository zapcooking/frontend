/**
 * A small, independent enhancement for the shared SSR magazine. It deliberately
 * imports neither auth nor the application runtime. Browser identity is used
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
 * @returns {Promise<Audience>}
 */
export async function landingAudience(storage, fetcher) {
  const identity = readLandingIdentity(storage);
  if (identity.kind !== 'signed-in') return identity.kind === 'guest' ? 'guest' : 'unknown';
  try {
    const response = await fetcher('/api/membership/check-status', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: identity.pubkey }),
      signal: AbortSignal.timeout(5000)
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

if (typeof document !== 'undefined') {
  let generation = 0;
  const root = {
    /** @param {string} selector */
    querySelectorAll: (selector) =>
      /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(selector))
  };
  const refresh = async () => {
    const current = ++generation;
    // Hide invitations while a changed identity is being resolved.
    applyLandingAudience(root, 'unknown');
    /** @type {Audience} */
    let audience = 'unknown';
    try {
      audience = await landingAudience(window.localStorage, window.fetch.bind(window));
    } catch {
      /* storage unavailable */
    }
    if (current === generation) applyLandingAudience(root, audience);
  };
  void refresh();
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void refresh();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === IDENTITY_KEY || event.key === null) void refresh();
  });
}
