import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { sourceUrl } from './anonImport';

/** Exact-source check for new imports. Historical recipes without r tags cannot be matched. */
export function findSourceDuplicate(
  ndk: NDK,
  pubkey: string,
  raw: string,
  timeoutMs = 2500
): Promise<string | null> {
  const url = sourceUrl(raw);
  if (!url || !pubkey) return Promise.resolve(null);
  return new Promise((resolve) => {
    let subscription: ReturnType<NDK['subscribe']> | undefined;
    let done = false;
    const finish = (href: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription?.stop();
      resolve(href);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      subscription = ndk.subscribe(
        { kinds: [30023], authors: [pubkey], '#r': [url], limit: 10 },
        { closeOnEose: true }
      );
      subscription.on('event', (event: NDKEvent) => {
        const identifier = event.tags.find((t) => t[0] === 'd')?.[1];
        if (
          event.pubkey !== pubkey ||
          event.kind !== 30023 ||
          !identifier ||
          !event.tags.some((t) => t[0] === 'r' && sourceUrl(t[1] || '') === url)
        )
          return;
        try {
          finish(`/recipe/${nip19.naddrEncode({ kind: 30023, pubkey, identifier })}`);
        } catch {
          /* Ignore malformed relay records. */
        }
      });
      subscription.on('eose', () => finish(null));
    } catch {
      finish(null);
    }
  });
}
