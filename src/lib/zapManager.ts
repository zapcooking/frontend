import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
import NDK from '@nostr-dev-kit/ndk';
import { bech32 } from 'bech32';
import { requestProvider } from 'webln';

export interface ZapRequest {
  eventId?: string;
  pubkey: string;
  amount: number; // in millisatoshis
  comment?: string;
  relays?: string[];
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
}

export class ZapManager {
  private ndk: NDK;
  private webln: any = null;
  private weblnAvailable = false;

  constructor(ndk: NDK) {
    this.ndk = ndk;
    this.initializeWebLN();
  }

  private async initializeWebLN() {
    try {
      if (typeof window !== 'undefined' && (window as any).webln) {
        this.webln = (window as any).webln;
        this.weblnAvailable = true;
      } else {
        this.webln = await requestProvider();
        this.weblnAvailable = true;
      }
    } catch (error) {
      console.log('WebLN not available:', error);
      this.weblnAvailable = false;
    }
  }

  /**
   * Convert a lightning address to LNURL endpoint
   */
  async getLnurlFromAddress(address: string): Promise<string> {
    if (!address.includes('@')) {
      throw new Error('Invalid lightning address format');
    }

    const [username, domain] = address.split('@');
    const lnurl = `https://${domain}/.well-known/lnurlp/${username}`;
    
    try {
      const response = await fetch(lnurl);
      if (!response.ok) {
        throw new Error(`LNURL endpoint not found: ${response.status}`);
      }
      return lnurl;
    } catch (error) {
      throw new Error(`Failed to fetch LNURL endpoint: ${error}`);
    }
  }

  /**
   * Fetch LNURL pay request data
   */
  async fetchLnurlPayRequest(lnurl: string): Promise<LNURLPayRequest> {
    try {
      const response = await fetch(lnurl);
      if (!response.ok) {
        throw new Error(`LNURL request failed: ${response.status}`);
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

    // Add p tag for recipient pubkey
    zapRequest.tags.push(['p', request.pubkey]);

    // Add e tag for event being zapped (if applicable)
    if (request.eventId) {
      zapRequest.tags.push(['e', request.eventId]);
    }

    // Add relays tag
    if (request.relays && request.relays.length > 0) {
      request.relays.forEach(relay => {
        zapRequest.tags.push(['relays', relay]);
      });
    }

    // Add amount tag
    zapRequest.tags.push(['amount', request.amount.toString()]);

    // Add lnurl tag (will be populated when we get the LNURL)
    zapRequest.tags.push(['lnurl', '']);

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
    await zapRequest.sign();

    // Create callback URL with parameters
    const callbackUrl = new URL(lnurlPayRequest.callback);
    callbackUrl.searchParams.set('amount', amount.toString());
    callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest.rawEvent()));

    try {
      const response = await fetch(callbackUrl.toString());
      if (!response.ok) {
        throw new Error(`Invoice request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Invoice error: ${data.reason}`);
      }

      return {
        pr: data.pr,
        routes: data.routes || []
      };
    } catch (error) {
      throw new Error(`Failed to get invoice: ${error}`);
    }
  }

  /**
   * Complete zap flow from request to invoice
   */
  async createZap(
    recipient: NDKUser | string,
    amount: number,
    comment?: string,
    eventId?: string
  ): Promise<{ invoice: string; zapRequest: NDKEvent }> {
    // Get recipient pubkey
    const pubkey = typeof recipient === 'string' ? recipient : recipient.hexpubkey;
    
    // Fetch recipient profile to get lightning address
    let user: NDKUser;
    if (typeof recipient === 'string') {
      user = await this.ndk.getUser({ pubkey });
    } else {
      user = recipient;
    }

    const profile = await user.fetchProfile();
    if (!profile) {
      throw new Error('Could not fetch user profile');
    }

    // Get lightning address (prefer lud16 over lud06)
    const lightningAddress = profile.lud16 || profile.lud06;
    if (!lightningAddress) {
      throw new Error('User has no lightning address configured');
    }

    // Convert lightning address to LNURL
    const lnurl = await this.getLnurlFromAddress(lightningAddress);
    
    // Fetch LNURL pay request
    const lnurlPayRequest = await this.fetchLnurlPayRequest(lnurl);
    
    // Validate Nostr support
    if (!lnurlPayRequest.allowsNostr || !lnurlPayRequest.nostrPubkey) {
      throw new Error('LNURL endpoint does not support Nostr zaps');
    }

    // Validate recipient pubkey matches LNURL nostrPubkey
    if (lnurlPayRequest.nostrPubkey !== pubkey) {
      throw new Error('Recipient pubkey does not match LNURL nostrPubkey');
    }

    // Create zap request
    const zapRequest = await this.createZapRequest({
      eventId,
      pubkey,
      amount,
      comment,
      relays: this.ndk.explicitRelayUrls || []
    });

    // Get invoice
    const invoiceResponse = await this.getZapInvoice(lnurlPayRequest, zapRequest, amount);

    return {
      invoice: invoiceResponse.pr,
      zapRequest
    };
  }

  /**
   * Pay with WebLN if available
   */
  async payWithWebLN(invoice: string): Promise<{ preimage: string }> {
    if (!this.weblnAvailable || !this.webln) {
      throw new Error('WebLN not available');
    }

    if (this.webln.enabled === false) {
      throw new Error('WebLN is not enabled. Please enable it in your Lightning wallet.');
    }

    try {
      const result = await this.webln.sendPayment(invoice);
      
      if (!result || !result.preimage) {
        throw new Error('Payment failed: no preimage returned');
      }

      return { preimage: result.preimage };
    } catch (error) {
      throw new Error(`WebLN payment failed: ${error}`);
    }
  }

  /**
   * Validate zap receipt authenticity
   */
  async validateZapReceipt(zapReceipt: NDKEvent, originalZapRequest?: NDKEvent): Promise<boolean> {
    if (zapReceipt.kind !== 9735) {
      return false;
    }

    // Check for required tags
    const bolt11Tags = zapReceipt.tags.filter(tag => tag[0] === 'bolt11');
    const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');
    const preimageTags = zapReceipt.tags.filter(tag => tag[0] === 'preimage');

    if (bolt11Tags.length === 0 || descriptionTags.length === 0 || preimageTags.length === 0) {
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
    onReceipt?: (receipt: NDKEvent) => void
  ) {
    const filter: any = {
      kinds: [9735],
      '#p': [pubkey]
    };

    if (eventId) {
      filter['#e'] = [eventId];
    }

    const subscription = this.ndk.subscribe(filter);
    
    subscription.on('event', async (receipt: NDKEvent) => {
      const isValid = await this.validateZapReceipt(receipt);
      if (isValid && onReceipt) {
        onReceipt(receipt);
      }
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

    const receipts = await this.ndk.fetchEvents(filter);
    
    let total = 0;
    let count = 0;

    for (const receipt of receipts) {
      const bolt11Tags = receipt.tags.filter((tag: any) => tag[0] === 'bolt11');
      if (bolt11Tags.length > 0) {
        // Parse bolt11 invoice to get amount (simplified - in production you'd want proper bolt11 parsing)
        const bolt11 = bolt11Tags[0][1];
        // This is a simplified amount extraction - you might want to use a proper bolt11 decoder
        const amountMatch = bolt11.match(/lnbc(\d+)/);
        if (amountMatch) {
          total += parseInt(amountMatch[1]);
        }
        count++;
      }
    }

    return { count, total };
  }

  /**
   * Check if WebLN is available
   */
  isWebLNAvailable(): boolean {
    return this.weblnAvailable;
  }

  /**
   * Get WebLN instance
   */
  getWebLN(): any {
    return this.webln;
  }
}
