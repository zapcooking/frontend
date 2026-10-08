import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from '$lib/nip98';

export type OwnMembershipState = 'active' | 'inactive' | 'unknown';

export interface OwnMembership {
  state: OwnMembershipState;
  /** Tier from the public shape (only meaningful when active). */
  tier?: string;
  /** Raw response body when the server answered 2xx (owner shape when signed). */
  data?: any;
}

/**
 * The viewer's own membership via POST /api/membership/check-status, as a
 * tri-state. `unknown` (503, network error, non-JSON) must never be shown as
 * "not a member": pages that gate on this should show a neutral "couldn't
 * check" state with a retry, not the membership pitch.
 */
export async function fetchOwnMembership(
  pubkey: string,
  opts: { ndk?: NDK | null; fetchFn?: typeof fetch } = {}
): Promise<OwnMembership> {
  const fetchFn = opts.fetchFn ?? fetch;
  const bodyString = JSON.stringify({ pubkey });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.ndk?.signer) {
    try {
      headers.Authorization = await signNip98AuthHeader(opts.ndk, {
        method: 'POST',
        url: new URL('/api/membership/check-status', window.location.origin).toString(),
        bodyString
      });
    } catch {
      // No usable signer — the public shape is enough for a tri-state.
    }
  }
  try {
    const res = await fetchFn('/api/membership/check-status', {
      method: 'POST',
      headers,
      body: bodyString
    });
    if (!res.ok) return { state: 'unknown' };
    const data = await res.json();
    if (typeof data?.isActive !== 'boolean') return { state: 'unknown', data };
    return { state: data.isActive ? 'active' : 'inactive', tier: data.member?.tier, data };
  } catch {
    return { state: 'unknown' };
  }
}
