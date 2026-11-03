import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from './nip98';
import { CHEFFY_TRIAL_LIMIT } from './cheffyTrial';

export async function loadCheffyTrial(ndk: NDK): Promise<number> {
  const bodyString = '{}';
  const Authorization = await signNip98AuthHeader(ndk, {
    method: 'POST',
    url: new URL('/api/zappy/trial-status', window.location.origin).toString(),
    bodyString
  });
  const response = await fetch('/api/zappy/trial-status', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization },
    body: bodyString
  });
  const data = await response.json();
  if (
    !response.ok ||
    !Number.isInteger(data.remaining) ||
    data.remaining < 0 ||
    data.remaining > CHEFFY_TRIAL_LIMIT
  ) {
    throw new Error('Your free messages could not be checked. Please try again.');
  }
  return data.remaining;
}
