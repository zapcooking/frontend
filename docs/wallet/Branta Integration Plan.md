# Branta Guardrail Integration Plan

## Overview
Integrate Branta Guardrail to verify Bitcoin and Lightning payment addresses/invoices displayed to users. When zapcooking generates a QR code for receiving payments, it will register that address/invoice with Branta, and display a "Verified by Branta" badge.

## Architecture

**Flow:**
1. User requests to receive payment → zapcooking generates invoice/address
2. Server registers the payment string with Branta API (POST /payments)
3. QR code displays with verification badge
4. Anyone scanning can verify the address is legitimate via Branta

**Why server-side:** API key must be kept secret, following existing `strikeService.server.ts` pattern.

## Files to Create

### 1. `src/lib/brantaService.server.ts`
Server-side service for Branta API calls.

```typescript
import { env } from '$env/dynamic/private';

interface BrantaConfig {
  apiKey: string;
  baseUrl: string;
}

function getBrantaConfig(platform?: any): BrantaConfig | null {
  const apiKey = platform?.env?.BRANTA_API_KEY || env.BRANTA_API_KEY;
  if (!apiKey) return null;
  const baseUrl = platform?.env?.BRANTA_API_BASE_URL || env.BRANTA_API_BASE_URL || 'https://guardrail.branta.pro/v1';
  return { apiKey, baseUrl };
}

export function isBrantaConfigured(platform?: any): boolean

export async function registerPayment(
  paymentString: string,
  options?: { ttl?: number; description?: string },
  platform?: any
): Promise<{ success: boolean; error?: string }>

export async function verifyPayment(
  paymentString: string,
  platform?: any
): Promise<{ verified: boolean; registeredAt?: string }>
```

### 2. `src/routes/api/branta/register/+server.ts`
POST endpoint to register payments.

```typescript
export const POST: RequestHandler = async ({ request, platform }) => {
  const { paymentString, ttl, description } = await request.json();
  const result = await registerPayment(paymentString, { ttl, description }, platform);
  return json(result);
};
```

### 3. `src/routes/api/branta/verify/+server.ts`
GET endpoint to check verification status.

```typescript
export const GET: RequestHandler = async ({ url, platform }) => {
  const paymentString = url.searchParams.get('payment');
  const result = await verifyPayment(paymentString, platform);
  return json(result);
};
```

### 4. `src/components/BrantaBadge.svelte`
Reusable verification badge component.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  
  export let paymentString: string = '';
  export let autoVerify: boolean = true;
  export let verified: boolean | null = null;
  
  let loading = false;
  
  async function verify() {
    if (!paymentString || verified !== null) return;
    loading = true;
    try {
      const res = await fetch(`/api/branta/verify?payment=${encodeURIComponent(paymentString)}`);
      const data = await res.json();
      verified = data.verified;
    } catch {
      verified = false;
    }
    loading = false;
  }
  
  onMount(() => { if (autoVerify) verify(); });
</script>

{#if verified}
  <div class="flex items-center gap-1 text-xs text-green-500" title="Verified by Branta Guardrail">
    <CheckCircleIcon size={14} />
    <span>Verified</span>
  </div>
{/if}
```

## Files to Modify

### 5. `src/routes/wallet/+page.svelte`

**A. Add import:**
```typescript
import BrantaBadge from '../../components/BrantaBadge.svelte';
```

**B. Add registration helper:**
```typescript
async function registerWithBranta(paymentString: string, description?: string) {
  try {
    await fetch('/api/branta/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentString, description, ttl: 86400 })
    });
  } catch (e) {
    console.warn('Branta registration failed:', e);
  }
}
```

**C. Integration points (4 locations):**

| Location | Line ~  | Register When | Badge Placement |
|----------|---------|---------------|-----------------|
| Lightning Invoice | 5414 | After `createInvoice()` succeeds | Below QR, above "Copy Invoice" |
| Bitcoin Address | 5078 | After `receiveOnchain()` returns | Below QR, above address display |
| NWC Lightning Address | 5290 | When modal opens with `nwcLud16` | Below QR |
| Spark Lightning Address | 5369 | When modal opens with address | Below QR |

**Example integration (Lightning Invoice):**
```svelte
<!-- After QR code, before copy button -->
{#if generatedInvoice}
  <div class="flex justify-center my-2">
    <BrantaBadge paymentString={generatedInvoice} />
  </div>
{/if}
```

### 6. `src/components/Footer.svelte`

Add badge below support QR code (~line 140):
```svelte
<BrantaBadge paymentString="ZapCooking@getalby.com" />
```

### 7. `.env.example`

Add configuration:
```env
# Branta Guardrail - Payment verification
BRANTA_API_KEY=
BRANTA_API_BASE_URL=https://guardrail.branta.pro/v1
```

## Implementation Order

1. Create `brantaService.server.ts`
2. Create API routes (`/api/branta/register`, `/api/branta/verify`)
3. Create `BrantaBadge.svelte` component
4. Update `.env.example` and add API key to local env
5. Integrate into wallet page (4 QR locations)
6. Integrate into Footer support modal
7. Test end-to-end

## Verification / Testing

1. **Service test:** Call `/api/branta/verify?payment=test` - should return `{ verified: false }`
2. **Registration test:** Generate a Lightning invoice, check Branta API received it
3. **Badge test:** Verify badge appears green after successful registration
4. **Error handling:** Remove API key, confirm graceful degradation (no badge, no errors)
5. **Visual test:** Ensure badge placement looks good on mobile and desktop

## Error Handling

- **API key missing:** Skip all Branta operations silently
- **Registration fails:** Log warning, don't block invoice generation
- **Verification fails:** Hide badge (no error shown to user)
- **Network timeout:** 5 second timeout, fail gracefully
