/**
 * Create Lightning Invoice for NIP-108 Gated Recipe
 * 
 * Creates a real Lightning invoice using the recipe author's LNURL/Lightning address.
 * The payment goes directly to the author.
 * 
 * POST /api/nip108/create-invoice
 * 
 * Body:
 * {
 *   amountMsats: number,
 *   description: string,
 *   metadata: { gatedNoteId: string, userPubkey: string }
 * }
 * 
 * Returns:
 * {
 *   invoice: string, // bolt11 invoice from author's Lightning address
 *   paymentHash: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getGatedContent, type GatedKV } from '$lib/nip108/server-store';

function getKV(platform: App.Platform | undefined): GatedKV {
  return (platform?.env?.GATED_CONTENT as GatedKV) || null;
}

/**
 * Resolve a Lightning address (lud16) to LNURL pay parameters
 */
async function resolveLightningAddress(
  address: string
): Promise<{ callback: string; minSendable: number; maxSendable: number; commentAllowed?: number }> {
  const [username, domain] = address.trim().toLowerCase().split('@');
  if (!username || !domain) {
    throw new Error('Invalid Lightning address format');
  }
  
  const response = await fetch(`https://${domain}/.well-known/lnurlp/${username}`);
  if (!response.ok) {
    throw new Error(`Failed to resolve Lightning address: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Lightning address resolution failed');
  }
  
  return {
    callback: data.callback,
    minSendable: data.minSendable || 1000,
    maxSendable: data.maxSendable || 100000000000,
    commentAllowed: data.commentAllowed
  };
}

/**
 * Fetch an invoice from LNURL callback
 */
async function fetchLnurlInvoice(
  callback: string, 
  amountMsats: number, 
  comment?: string
): Promise<{ invoice: string; paymentHash?: string }> {
  // Handle callbacks that may already contain query parameters
  const separator = callback.includes('?') ? '&' : '?';
  let url = `${callback}${separator}amount=${amountMsats}`;
  if (comment) {
    url += `&comment=${encodeURIComponent(comment)}`;
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch LNURL invoice: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Failed to get invoice from Lightning address');
  }
  if (!data.pr) {
    throw new Error('No invoice returned from Lightning address');
  }
  
  return {
    invoice: data.pr,
    paymentHash: data.paymentHash
  };
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const kv = getKV(platform);

  try {
    const body = await request.json();
    const { amountMsats, description, metadata } = body;

    if (!amountMsats || !description) {
      return json(
        { error: 'amountMsats and description are required' },
        { status: 400 }
      );
    }

    const gatedNoteId = metadata?.gatedNoteId;
    if (!gatedNoteId) {
      return json(
        { error: 'gatedNoteId is required in metadata' },
        { status: 400 }
      );
    }

    // Get the gated content to find the author's Lightning address
    const gatedContent = await getGatedContent(kv, gatedNoteId);
    if (!gatedContent) {
      return json(
        { error: 'Gated content not found' },
        { status: 404 }
      );
    }
    
    const authorLightningAddress = gatedContent.authorLightningAddress;
    
    if (!authorLightningAddress) {
      if (!dev) {
        return json(
          { error: 'Author has no Lightning address configured' },
          { status: 400 }
        );
      }
      // Dev-only: mock invoice when author has no Lightning address
      const paymentHash = `mock_${Date.now()}`;
      return json({
        invoice: `lnbc${Math.floor(amountMsats / 1000)}u1p...mock`,
        paymentHash,
        isMock: true
      });
    }
    
    // Resolve the Lightning address and create a real invoice
    
    try {
      const lnurlInfo = await resolveLightningAddress(authorLightningAddress);
      
      // Validate amount
      if (amountMsats < lnurlInfo.minSendable) {
        return json(
          { error: `Amount too small. Minimum: ${Math.ceil(lnurlInfo.minSendable / 1000)} sats` },
          { status: 400 }
        );
      }
      if (amountMsats > lnurlInfo.maxSendable) {
        return json(
          { error: `Amount too large. Maximum: ${Math.floor(lnurlInfo.maxSendable / 1000)} sats` },
          { status: 400 }
        );
      }
      
      // Truncate comment if needed
      let comment = description;
      if (lnurlInfo.commentAllowed && comment.length > lnurlInfo.commentAllowed) {
        comment = comment.substring(0, lnurlInfo.commentAllowed);
      } else if (!lnurlInfo.commentAllowed) {
        comment = undefined;
      }
      
      // Fetch the invoice
      const invoiceResult = await fetchLnurlInvoice(lnurlInfo.callback, amountMsats, comment);
      
      return json({
        invoice: invoiceResult.invoice,
        paymentHash: invoiceResult.paymentHash || '',
        isMock: false
      });
      
    } catch (lnurlError) {
      console.error('[NIP-108] LNURL error:', lnurlError);
      return json(
        { error: `Failed to create invoice: ${lnurlError instanceof Error ? lnurlError.message : 'Unknown error'}` },
        { status: 500 }
      );
    }
    
  } catch (error) {
    console.error('[NIP-108 Create Invoice] Error:', error);
    return json(
      { error: 'Failed to create invoice' },
      { status: 500 }
    );
  }
};
