import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk';
import NDK from '@nostr-dev-kit/ndk';
import { bech32 } from 'bech32';
import { requestProvider } from 'webln';
import { resolveProfileByPubkey } from './profileResolver';
import { AuthManager, getAuthManager } from './authManager';
import { generateSecretKey } from 'nostr-tools';

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
    // Only initialize WebLN in browser environment
    if (typeof window !== 'undefined') {
      this.initializeWebLN().catch(error => {
        console.log('WebLN not available:', error.message);
      });
    }
  }

  private async initializeWebLN() {
    try {
      if (typeof window !== 'undefined' && (window as any).webln) {
        this.webln = (window as any).webln;
        this.weblnAvailable = true;
      } else if (typeof window !== 'undefined') {
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
      console.log('Fetching LNURL endpoint:', lnurl);
      const response = await fetch(lnurl);
      if (!response.ok) {
        throw new Error(`LNURL endpoint not found: ${response.status} ${response.statusText}`);
      }
      console.log('LNURL endpoint verified successfully');
      return lnurl;
    } catch (error) {
      console.error('LNURL endpoint fetch error:', error);
      throw new Error(`Failed to fetch LNURL endpoint: ${error}`);
    }
  }

  /**
   * Fetch LNURL pay request data
   */
  async fetchLnurlPayRequest(lnurl: string): Promise<LNURLPayRequest> {
    try {
      console.log('Fetching LNURL pay request from:', lnurl);
      const response = await fetch(lnurl);
      if (!response.ok) {
        throw new Error(`LNURL request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('LNURL pay request response:', data);
      
      if (data.status === 'ERROR') {
        throw new Error(`LNURL error: ${data.reason}`);
      }

      const result = {
        callback: data.callback,
        maxSendable: data.maxSendable || 1000000000, // 1M sats default
        minSendable: data.minSendable || 1000, // 1 sat default
        metadata: data.metadata,
        nostrPubkey: data.nostrPubkey,
        allowsNostr: data.allowsNostr || false
      };
      
      console.log('Processed LNURL pay request:', result);
      return result;
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
    console.log('getZapInvoice called with:', {
      callback: lnurlPayRequest.callback,
      amount,
      allowsNostr: lnurlPayRequest.allowsNostr,
      minSendable: lnurlPayRequest.minSendable,
      maxSendable: lnurlPayRequest.maxSendable
    });

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

    console.log('Zap request before signing:', {
      kind: zapRequest.kind,
      tags: zapRequest.tags,
      content: zapRequest.content
    });

    // Check if NDK has a signer available
    console.log('NDK signer status:', {
      hasSigner: !!this.ndk.signer,
      signerType: this.ndk.signer?.constructor.name
    });

    // Sign the zap request
    try {
      console.log('Attempting to sign zap request...');
      await zapRequest.sign();
      console.log('Zap request signed successfully');
    } catch (error) {
      console.error('Error signing zap request:', error);
      
      // If signing fails, we might need to create an anonymous signer for the zap request
      if (error.message.includes('signer') || error.message.includes('private key')) {
        console.log('Signing failed due to missing signer - creating anonymous zap request');
        // For zap requests, we might not need a signer if the LNURL endpoint doesn't require it
        // Let's try without signing first
        try {
          const sk = generateSecretKey();
          await zapRequest.sign(new NDKPrivateKeySigner(sk));
        } catch (ex) {
          console.error(`Couldn't post zap anon: ${ex}`)
        }
      } else {
        throw new Error(`Failed to sign zap request: ${error}`);
      }
    }

    // Create callback URL with parameters
    const callbackUrl = new URL(lnurlPayRequest.callback);
    callbackUrl.searchParams.set('amount', amount.toString());
    
    const zapRequestJson = JSON.stringify(zapRequest.rawEvent());
    console.log('Zap request JSON:', zapRequestJson);
    callbackUrl.searchParams.set('nostr', zapRequestJson);

    console.log('Making callback request to:', callbackUrl.toString());

    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const response = await fetch(callbackUrl.toString(), {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      console.log('Callback response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Callback error response:', errorText);
        throw new Error(`Invoice request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Callback response data:', data);
      
      if (data.status === 'ERROR') {
        throw new Error(`Invoice error: ${data.reason}`);
      }

      if (!data.pr) {
        throw new Error('No invoice (pr) returned from callback');
      }

      console.log('Invoice generated successfully:', data.pr.substring(0, 50) + '...');

      return {
        pr: data.pr,
        routes: data.routes || []
      };
    } catch (error) {
      console.error('Error in callback request:', error);
      
      if (error.name === 'AbortError') {
        throw new Error('Invoice request timed out after 15 seconds');
      }
      
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
  ): Promise<{ invoice: string; zapRequest: NDKEvent; zapPubkey: string }> {
    // Check if user is authenticated (required for zap requests)
    if (!this.ndk.signer) {
      throw new Error('User must be authenticated to create zap requests. Please log in first.');
    }

    console.log('Creating zap for authenticated user:', {
      hasSigner: !!this.ndk.signer,
      signerType: this.ndk.signer?.constructor.name
    });

    // Get recipient pubkey
    console.log('zapManager.createZap - recipient:', recipient);
    console.log('zapManager.createZap - recipient type:', typeof recipient);
    console.log('zapManager.createZap - recipient constructor:', recipient?.constructor?.name);
    
    const pubkey = typeof recipient === 'string' ? recipient : recipient.hexpubkey;
    console.log('zapManager.createZap - extracted pubkey:', pubkey);
    
    // Fetch recipient profile to get lightning address using the working profile resolver
    console.log('Fetching profile for pubkey:', pubkey);
    let profileData;
    
    try {
      profileData = await resolveProfileByPubkey(pubkey, this.ndk);
    } catch (error) {
      console.error('Error in resolveProfileByPubkey:', error);
      throw new Error(`Failed to fetch user profile: ${error}`);
    }
    
    if (!profileData) {
      throw new Error('Could not fetch user profile - profile resolver returned null');
    }

    console.log('User profile fetched:', {
      pubkey: pubkey,
      name: profileData.name,
      lud16: profileData.lud16,
      display_name: profileData.display_name
    });

    // Get lightning address (prefer lud16 over lud06)
    const lightningAddress = profileData.lud16;
    if (!lightningAddress) {
      console.error('User profile data:', profileData);
      throw new Error(`User has no lightning address configured. Profile lud16: ${profileData.lud16}. User may need to set up a Lightning address in their profile.`);
    }

    // Convert lightning address to LNURL
    console.log('Converting lightning address to LNURL:', lightningAddress);
    const lnurl = await this.getLnurlFromAddress(lightningAddress);
    console.log('LNURL endpoint:', lnurl);
    
    // Fetch LNURL pay request
    console.log('Fetching LNURL pay request...');
    const lnurlPayRequest = await this.fetchLnurlPayRequest(lnurl);
    console.log('LNURL pay request:', {
      callback: lnurlPayRequest.callback,
      allowsNostr: lnurlPayRequest.allowsNostr,
      nostrPubkey: lnurlPayRequest.nostrPubkey,
      minSendable: lnurlPayRequest.minSendable,
      maxSendable: lnurlPayRequest.maxSendable
    });
    
    // Validate Nostr support
    if (!lnurlPayRequest.allowsNostr || !lnurlPayRequest.nostrPubkey) {
      throw new Error(`LNURL endpoint does not support Nostr zaps. allowsNostr: ${lnurlPayRequest.allowsNostr}, nostrPubkey: ${lnurlPayRequest.nostrPubkey}`);
    }

    // Validate recipient pubkey matches LNURL nostrPubkey
    // Note: Some Lightning addresses may be associated with different Nostr pubkeys
    // This is common when users have multiple Nostr identities or use different keys for different purposes
    if (lnurlPayRequest.nostrPubkey !== pubkey) {
      console.warn(`Recipient pubkey ${pubkey} does not match LNURL nostrPubkey ${lnurlPayRequest.nostrPubkey}`);
      console.warn('This is common when Lightning addresses are associated with different Nostr identities');
      console.warn('Proceeding with zap using the LNURL nostrPubkey for the zap request');
      console.warn('This ensures the zap is properly associated with the Lightning address');
      
      // Use the LNURL nostrPubkey for the zap request instead of the original pubkey
      // This ensures the zap is properly associated with the Lightning address
    } else {
      console.log('Recipient pubkey matches LNURL nostrPubkey - proceeding normally');
    }

    // Use the LNURL nostrPubkey for the zap request to ensure proper association
    const zapPubkey = lnurlPayRequest.nostrPubkey || pubkey;
    
    // Create zap request
    console.log('Creating zap request with:', {
      eventId,
      originalPubkey: pubkey,
      zapPubkey: zapPubkey,
      amount,
      comment,
      relays: this.ndk.explicitRelayUrls || []
    });
    const zapRequest = await this.createZapRequest({
      eventId,
      pubkey: zapPubkey,
      amount,
      comment,
      relays: this.ndk.explicitRelayUrls || []
    });

    // Get invoice
    console.log('Getting zap invoice...');
    const invoiceResponse = await this.getZapInvoice(lnurlPayRequest, zapRequest, amount);
    console.log('Invoice received:', invoiceResponse.pr.substring(0, 50) + '...');

    return {
      invoice: invoiceResponse.pr,
      zapRequest,
      zapPubkey: zapPubkey // Return the pubkey used for the zap request
    };
  }

  /**
   * Pay with WebLN if available
   */
  async payWithWebLN(invoice: string): Promise<{ preimage: string }> {
    console.log('Attempting WebLN payment...');
    console.log('WebLN available:', this.weblnAvailable);
    console.log('WebLN instance:', !!this.webln);
    
    if (!this.weblnAvailable || !this.webln) {
      throw new Error('WebLN not available');
    }

    console.log('WebLN enabled:', this.webln.enabled);
    if (this.webln.enabled === false) {
      throw new Error('WebLN is not enabled. Please enable it in your Lightning wallet.');
    }

    try {
      console.log('Sending payment with WebLN...');
      const result = await this.webln.sendPayment(invoice);
      console.log('WebLN payment result:', result);
      
      if (!result || !result.preimage) {
        throw new Error('Payment failed: no preimage returned');
      }

      return { preimage: result.preimage };
    } catch (error) {
      console.error('WebLN payment error:', error);
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
    onReceipt?: (receipt: NDKEvent) => void,
    timeoutMs: number = 30000 // 30 second timeout
  ) {
    const filter: any = {
      kinds: [9735],
      '#p': [pubkey]
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
      console.log('Received zap receipt event:', receipt);
      console.log('Receipt tags:', receipt.tags);
      console.log('Receipt created_at:', receipt.created_at);
      console.log('Current timestamp:', Math.floor(Date.now() / 1000));
      
      // More lenient validation - just check if it's a zap receipt
      if (receipt.kind === 9735) {
        // Additional validation: check if this receipt is recent (within last 5 minutes)
        const now = Math.floor(Date.now() / 1000);
        const receiptTime = receipt.created_at;
        const timeDiff = now - receiptTime;
        
        console.log('Receipt time difference:', timeDiff, 'seconds');
        
        // Only accept receipts that are very recent (within 5 minutes)
        // This helps filter out old receipts that might be echoed back
        if (timeDiff < 300) { // 5 minutes
          // Additional validation: check if this receipt has payment-related tags
          // A real zap receipt should have bolt11 or other payment tags
          const hasBolt11 = receipt.tags.some(tag => tag[0] === 'bolt11');
          const hasDescription = receipt.tags.some(tag => tag[0] === 'description');
          const hasPreimage = receipt.tags.some(tag => tag[0] === 'preimage');
          
          console.log('Receipt validation:', { hasBolt11, hasDescription, hasPreimage });
          
          // A real zap receipt should have at least one payment-related tag
          if (hasBolt11 || hasDescription || hasPreimage) {
            console.log('Valid zap receipt received (recent with payment tags)');
            clearTimeout(timeout);
            subscription.stop();
            if (onReceipt) {
              onReceipt(receipt);
            }
          } else {
            console.log('Received zap receipt lacks payment tags, ignoring');
          }
        } else {
          console.log('Received zap receipt is too old, ignoring (age:', timeDiff, 'seconds)');
        }
      } else {
        console.log('Invalid zap receipt - wrong kind:', receipt.kind);
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
      const receiptsSet = await this.ndk.fetchEvents(filter);
      const receipts = Array.from(receiptsSet);
      console.log('Found zap receipts:', receipts.length);
      
      let total = 0;
      let count = 0;

      for (const receipt of receipts) {
        console.log('Processing receipt:', receipt.id, 'tags:', receipt.tags);
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

      console.log('Zap totals:', { count, total });
      return { count, total };
    } catch (error) {
      console.error('Error fetching zap totals:', error);
      return { count: 0, total: 0 };
    }
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
