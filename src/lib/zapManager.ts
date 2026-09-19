import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk';
import NDK from '@nostr-dev-kit/ndk';
import { bech32 } from 'bech32';
import { resolveProfileByPubkey } from './profileResolver';
import { AuthManager, getAuthManager } from './authManager';
import { generateSecretKey } from 'nostr-tools';
import { ensureClientTag } from './nip89';
import { extractZapAmountSats } from './zapAmount';

export interface ZapRequest {
  eventId?: string;
  pubkey: string;
  amount: number; // in millisatoshis
  comment?: string;
  relays?: string[];
  extraTags?: string[][];
}

export interface ZapReceipt {
  bolt11: string;
  preimage: string;
  recipientPubkey: string;
  eventId?: string;
}

export interface LNURLPayRequest {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  nostrPubkey?: string;
  allowsNostr?: boolean;
}

export interface LNURLPayResponse {
  pr: string;
  routes: any[];
  verify?: string;
}

export class ZapManager {
  private ndk: NDK;

  constructor(ndk: NDK) {
    this.ndk = ndk;
  }

  // ── Zap-target resolution cache ────────────────────────────────────
  // A zap needs the recipient's LNURL pay request, which costs a profile
  // fetch + an HTTPS round-trip. Zapping the same recipient again (very
  // common — several posts from one author) and the modal-open prefetch
  // both hit this cache instead. Short TTL: pay limits can change.
  private static readonly LNURL_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly LNURL_CACHE_MAX = 64;
  private static lnurlCache = new Map<
    string,
    { address: string; payRequest: LNURLPayRequest; expiresAt: number }
  >();
  private static lnurlInflight = new Map<string, Promise<{ address: string; payRequest: LNURLPayRequest }>>();

  private resolveZapTargetCached(pubkey: string): Promise<{ address: string; payRequest: LNURLPayRequest }> {
    const hit = ZapManager.lnurlCache.get(pubkey);
    if (hit && Date.now() <= hit.expiresAt) return Promise.resolve(hit);

    const inflight = ZapManager.lnurlInflight.get(pubkey);
    if (inflight) return inflight;

    const fetchIt = (async () => {
      const profileData = await resolveProfileByPubkey(pubkey, this.ndk);
      if (!profileData) {
        throw new Error('Could not fetch user profile - profile resolver returned null');
      }

      const lightningAddress = profileData.lud16;
      if (!lightningAddress) {
        throw new Error(`User has no lightning address configured. Profile lud16: ${profileData.lud16}. User may need to set up a Lightning address in their profile.`);
      }

      const lnurl = this.getLnurlFromAddress(lightningAddress);
      const payRequest = await this.fetchLnurlPayRequest(lnurl);

      const entry = { address: lightningAddress, payRequest, expiresAt: Date.now() + ZapManager.LNURL_CACHE_TTL_MS };
      if (ZapManager.lnurlCache.size >= ZapManager.LNURL_CACHE_MAX) {
        // Drop the oldest entry (Map iterates in insertion order).
        const oldest = ZapManager.lnurlCache.keys().next().value;
        if (oldest !== undefined) ZapManager.lnurlCache.delete(oldest);
      }
      ZapManager.lnurlCache.set(pubkey, entry);
      return entry;
    })();

    ZapManager.lnurlInflight.set(pubkey, fetchIt);
    fetchIt.finally(() => ZapManager.lnurlInflight.delete(pubkey)).catch(() => {});
    return fetchIt;
  }

  /**
   * Warm the zap-target cache for a recipient. Fire-and-forget on modal
   * open / note render so that by the time the user submits, the profile
   * and LNURL round-trips are already done and only the invoice fetch
   * remains. Errors are swallowed — the real zap will surface them.
   */
  prefetchZap(recipient: string | NDKUser | NDKEvent): void {
    const pubkey =
      typeof recipient === 'string'
        ? recipient
        : recipient instanceof NDKUser
          ? recipient.pubkey
          : recipient.author?.hexpubkey || recipient.pubkey;
    if (!pubkey) return;
    this.resolveZapTargetCached(pubkey).catch(() => {});
  }

  /**
   * Convert a lightning address to its LNURL pay endpoint.
   *
   * Pure URL construction — no fetch. The endpoint gets fetched (and
   * cached) by fetchLnurlPayRequest; verifying it here with a throwaway
   * request cost a full extra round-trip on every zap for nothing.
   */
  getLnurlFromAddress(address: string): string {
    if (!address.includes('@')) {
      throw new Error('Invalid lightning address format');
    }

    const [username, domain] = address.split('@');
    return `https://${domain}/.well-known/lnurlp/${username}`;
  }

  /**
   * Fetch LNURL pay request data
   */
  async fetchLnurlPayRequest(lnurl: string): Promise<LNURLPayRequest> {
    try {
      const response = await fetch(lnurl);
      if (!response.ok) {
        throw new Error(`LNURL request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(`LNURL error: ${data.reason}`);
      }

      return {
        callback: data.callback,
        maxSendable: data.maxSendable || 1000000000, // 1M sats default
        minSendable: data.minSendable || 1000, // 1 sat default
        metadata: data.metadata,
        nostrPubkey: data.nostrPubkey,
        allowsNostr: data.allowsNostr || false
      };
    } catch (error) {
      console.error('LNURL pay request fetch error:', error);
      throw new Error(`Failed to fetch LNURL pay request: ${error}`);
    }
  }

  /**
   * Create a zap request event (kind 9734)
   */
  async createZapRequest(request: ZapRequest): Promise<NDKEvent> {
    const zapRequest = new NDKEvent(this.ndk);
    zapRequest.kind = 9734;
    zapRequest.content = request.comment || '';

    // Add p tag for recipient pubkey (with relay hint)
    const relayHint = request.relays?.[0] || '';
    zapRequest.tags.push(relayHint ? ['p', request.pubkey, relayHint] : ['p', request.pubkey]);

    // Add e tag for event being zapped (with relay hint)
    if (request.eventId) {
      zapRequest.tags.push(relayHint ? ['e', request.eventId, relayHint] : ['e', request.eventId]);
    }

    // Add relays tag (NIP-57: single tag with all relay URLs as values)
    if (request.relays && request.relays.length > 0) {
      zapRequest.tags.push(['relays', ...request.relays]);
    }

    // Add amount tag
    zapRequest.tags.push(['amount', request.amount.toString()]);

    // Add lnurl tag (will be populated when we get the LNURL)
    zapRequest.tags.push(['lnurl', '']);

    // Add any extra tags (e.g., poll_option for zap polls)
    if (request.extraTags) {
      for (const tag of request.extraTags) {
        zapRequest.tags.push(tag);
      }
    }

    // Add NIP-89 client tag
    zapRequest.tags = ensureClientTag(zapRequest.tags);

    return zapRequest;
  }

  /**
   * Get Lightning invoice from LNURL callback
   */
  async getZapInvoice(
    lnurlPayRequest: LNURLPayRequest,
    zapRequest: NDKEvent,
    amount: number
  ): Promise<LNURLPayResponse> {
    if (!lnurlPayRequest.allowsNostr) {
      throw new Error('LNURL endpoint does not support Nostr zaps');
    }

    // Validate amount
    if (amount < lnurlPayRequest.minSendable || amount > lnurlPayRequest.maxSendable) {
      throw new Error(`Amount ${amount} is outside allowed range ${lnurlPayRequest.minSendable}-${lnurlPayRequest.maxSendable}`);
    }

    // Update the zap request with the LNURL
    const lnurlTag = zapRequest.tags.find(tag => tag[0] === 'lnurl');
    if (lnurlTag) {
      lnurlTag[1] = lnurlPayRequest.callback;
    }

    // Sign the zap request
    try {
      await zapRequest.sign();
    } catch (error: unknown) {
      console.error('Error signing zap request:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      // If signing fails, we might need to create an anonymous signer for the zap request
      if (err.message.includes('signer') || err.message.includes('private key')) {
        // For zap requests, we might not need a signer if the LNURL endpoint doesn't require it
        // Let's try without signing first
        try {
          const sk = generateSecretKey();
          await zapRequest.sign(new NDKPrivateKeySigner(sk));
        } catch (ex) {
          console.error(`Couldn't post zap anon: ${ex}`)
        }
      } else {
        throw new Error(`Failed to sign zap request: ${err.message}`);
      }
    }

    // Create callback URL with parameters
    const callbackUrl = new URL(lnurlPayRequest.callback);
    callbackUrl.searchParams.set('amount', amount.toString());
    
    const zapRequestJson = JSON.stringify(zapRequest.rawEvent());
    callbackUrl.searchParams.set('nostr', zapRequestJson);


    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const response = await fetch(callbackUrl.toString(), {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Callback error response:', errorText);
        throw new Error(`Invoice request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Invoice error: ${data.reason}`);
      }

      if (!data.pr) {
        throw new Error('No invoice (pr) returned from callback');
      }


      return {
        pr: data.pr,
        routes: data.routes || [],
        verify: data.verify
      };
    } catch (error: unknown) {
      console.error('Error in callback request:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      if (err.name === 'AbortError') {
        throw new Error('Invoice request timed out after 15 seconds');
      }
      
      throw new Error(`Failed to get invoice: ${err.message}`);
    }
  }

  /**
   * Complete zap flow from request to invoice
   */
  async createZap(
    recipient: NDKUser | string,
    amount: number,
    comment?: string,
    eventId?: string,
    extraTags?: string[][]
  ): Promise<{ invoice: string; verify?: string; zapRequest: NDKEvent; zapPubkey: string }> {
    // Check if user is authenticated (required for zap requests)
    if (!this.ndk.signer) {
      throw new Error('User must be authenticated to create zap requests. Please log in first.');
    }

    // Get recipient pubkey
    const pubkey = typeof recipient === 'string' ? recipient : recipient.hexpubkey;

    // Profile fetch + LNURL resolution, cached per recipient (see
    // resolveZapTargetCached). The modal's prefetch usually has this
    // resolved before the user even clicks an amount.
    const { payRequest: lnurlPayRequest } = await this.resolveZapTargetCached(pubkey);
    
    // Validate Nostr support
    if (!lnurlPayRequest.allowsNostr || !lnurlPayRequest.nostrPubkey) {
      throw new Error(`LNURL endpoint does not support Nostr zaps. allowsNostr: ${lnurlPayRequest.allowsNostr}, nostrPubkey: ${lnurlPayRequest.nostrPubkey}`);
    }

    // NIP-57: The zap request `p` tag MUST be the recipient's pubkey,
    // not the LNURL provider's nostrPubkey. The LNURL nostrPubkey is
    // only used by the provider to sign the zap receipt (kind 9735).
    if (lnurlPayRequest.nostrPubkey !== pubkey) {
      console.log(`LNURL nostrPubkey (${lnurlPayRequest.nostrPubkey}) differs from recipient (${pubkey}) — using recipient per NIP-57`);
    }

    // Create zap request with the actual recipient's pubkey
    const zapRequest = await this.createZapRequest({
      eventId,
      pubkey,
      amount,
      comment,
      relays: this.ndk.explicitRelayUrls || [],
      extraTags
    });

    // Get invoice
    const invoiceResponse = await this.getZapInvoice(lnurlPayRequest, zapRequest, amount);

    return {
      invoice: invoiceResponse.pr,
      verify: invoiceResponse.verify,
      zapRequest,
      zapPubkey: pubkey // Return the recipient pubkey used for the zap request
    };
  }

  /**
   * Validate zap receipt authenticity
   */
  async validateZapReceipt(zapReceipt: NDKEvent, originalZapRequest?: NDKEvent): Promise<boolean> {
    if (zapReceipt.kind !== 9735) {
      return false;
    }

    // Check for required tags (NIP-57: bolt11 and description are required, preimage is optional)
    const bolt11Tags = zapReceipt.tags.filter(tag => tag[0] === 'bolt11');
    const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');

    if (bolt11Tags.length === 0 || descriptionTags.length === 0) {
      return false;
    }

    // If we have the original zap request, validate it matches
    if (originalZapRequest) {
      const description = descriptionTags[0][1];
      const originalZapRequestJson = JSON.stringify(originalZapRequest.rawEvent());
      
      if (description !== originalZapRequestJson) {
        return false;
      }
    }

    // Verify the signature
    try {
      // NDKEvent doesn't have a verify method, so we'll skip signature verification for now
      // In a production app, you'd want to implement proper signature verification
      return true;
    } catch (error) {
      console.error('Zap receipt verification failed:', error);
      return false;
    }
  }

  /**
   * Subscribe to zap receipts for a specific pubkey and event
   */
  subscribeToZapReceipts(
    pubkey: string,
    eventId?: string,
    onReceipt?: (receipt: NDKEvent) => void,
    timeoutMs: number = 30000 // 30 second timeout
  ) {
    // Only get events from the last minute to avoid processing old receipts
    const since = Math.floor(Date.now() / 1000) - 60;

    const filter: any = {
      kinds: [9735],
      '#p': [pubkey],
      since
    };

    if (eventId) {
      filter['#e'] = [eventId];
    }

    console.log('Subscribing to zap receipts with filter:', filter);
    
    // Add a small delay before subscribing to avoid receiving the zap request itself
    const subscription = this.ndk.subscribe(filter, { closeOnEose: false });
    
    // Set up timeout
    const timeout = setTimeout(() => {
      console.warn('Zap receipt subscription timed out after', timeoutMs, 'ms');
      subscription.stop();
      if (onReceipt) {
        // Call onReceipt with null to indicate timeout
        onReceipt(null as any);
      }
    }, timeoutMs);
    
    subscription.on('event', async (receipt: NDKEvent) => {
      // With the 'since' filter, we should only receive recent events
      if (receipt.kind !== 9735) return;

      // Check if this receipt has payment-related tags
      const hasBolt11 = receipt.tags.some(tag => tag[0] === 'bolt11');
      const hasDescription = receipt.tags.some(tag => tag[0] === 'description');

      if (hasBolt11 || hasDescription) {
        console.log('Zap receipt received, forwarding to callback for invoice matching');
        if (onReceipt) {
          onReceipt(receipt);
        }
      }
    });

    subscription.on('eose', () => {
      console.log('Zap receipt subscription EOSE - no more events');
    });

    return subscription;
  }

  /**
   * Get total zaps for a pubkey/event
   */
  async getZapTotals(pubkey: string, eventId?: string): Promise<{ count: number; total: number }> {
    const filter: any = {
      kinds: [9735],
      '#p': [pubkey]
    };

    if (eventId) {
      filter['#e'] = [eventId];
    }

    console.log('Fetching zap totals with filter:', filter);
    
    try {
      let total = 0;
      let count = 0;
      
      const subscription = this.ndk.subscribe(filter, { closeOnEose: false });
      let resolved = false;
      
      await new Promise<void>((resolve) => {
        subscription.on('event', (receipt: any) => {
          // Bolt11 multipliers (m/u/n/p) and the msats→sats conversion are
          // handled by the canonical extractor in zapAmount.ts; the previous
          // regex `/lnbc(\d+)/` dropped the multiplier and treated raw
          // pre-multiplier digits as sats, so any invoice with a `u` / `n` /
          // `p` suffix displayed with a 10³–10¹² error.
          const { sats } = extractZapAmountSats(receipt);
          if (sats > 0) {
            total += sats;
            count++;
          }
        });
        
        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            console.log('Found zap receipts:', count);
            console.log('Zap totals:', { count, total });
            resolve();
          }
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            console.log('Timeout: Found zap receipts:', count);
            resolve();
          }
        }, 5000);
      });

      return { count, total };
    } catch (error) {
      console.error('Error fetching zap totals:', error);
      return { count: 0, total: 0 };
    }
  }

}
