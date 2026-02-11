# Invoice Metadata KV Setup

The Lightning invoice metadata store maps Strike `receiveRequestId` to membership payment metadata so that webhooks and verification endpoints can match payments to users across serverless instances.

## Why KV?

Previously, invoice metadata was stored in-memory, which worked only for single-instance deployments. In serverless/multi-instance deployments (like Cloudflare Pages), requests and webhooks can hit different instances, causing `getInvoiceMetadata()` to return null even for valid invoices. This KV-based solution provides persistent, shared storage across all instances.

## KV Namespace Setup

1. In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → KV → Create a namespace (e.g., `zapcooking-invoice-metadata`).
2. Copy the namespace **id**.
3. In **wrangler.jsonc**, replace `PLACEHOLDER_ID` with your actual namespace ID:
   ```json
   "kv_namespaces": [
     {
       "binding": "SHORTLINKS",
       "id": "2ad4aaf7011543b7b70c8c46a14766e1"
     },
     {
       "binding": "INVOICE_METADATA",
       "id": "your-actual-namespace-id-here"
     }
   ]
   ```
4. For **Pages**, you can also bind KV in: Pages → Your Project → Settings → Functions → KV namespace bindings → Add binding **INVOICE_METADATA** to the namespace.

## Local Development

The store automatically falls back to in-memory storage when KV is not available (e.g., during local development without `wrangler`). You'll see a warning:
```
[InvoiceMetadataStore] KV not available, using in-memory fallback
```

To test with actual KV locally:

```bash
pnpm build && pnpm dev:cloudflare
```

Or specify the namespace when running `wrangler pages dev`:

```bash
wrangler pages dev .svelte-kit/cloudflare --kv=INVOICE_METADATA=<dev_namespace_id>
```

## Data Shape (KV)

### Invoice Entry
- **Key**: `invoice:{receiveRequestId}`
- **Value** (JSON): 
  ```json
  {
    "pubkey": "hex pubkey",
    "tier": "cook" | "pro",
    "period": "annual" | "2year",
    "receiveRequestId": "Strike receive request ID",
    "createdAt": 1234567890123
  }
  ```
- **TTL**: 2 hours (7200 seconds)

### Payment Hash Index
- **Key**: `hash:{paymentHash}`
- **Value**: `receiveRequestId` (plain text)
- **TTL**: 2 hours (7200 seconds)

Entries automatically expire after 2 hours (Lightning invoices typically expire in 1 hour).

## Usage

The invoice metadata store is used by:

1. **Create Invoice Endpoints**
   - `/api/membership/create-lightning-invoice`
   - `/api/genesis/create-lightning-invoice`
   
   Store metadata when creating a new Lightning invoice:
   ```typescript
   await storeInvoiceMetadata(
     receiveRequestId,
     { pubkey, tier, period },
     paymentHash,
     platform
   );
   ```

2. **Verify Payment Endpoints**
   - `/api/membership/verify-lightning-payment`
   - `/api/genesis/verify-lightning-payment`
   
   Look up metadata by receiveRequestId or paymentHash:
   ```typescript
   const metadata = await getInvoiceMetadata(receiveRequestId, platform);
   // or
   const metadata = await getInvoiceMetadataByPaymentHash(paymentHash, platform);
   ```

3. **Webhook Handler**
   - `/api/membership/strike-webhook`
   
   Match webhook notifications to user payments:
   ```typescript
   const metadata = await getInvoiceMetadata(receiveRequestId, platform);
   ```

## Deployment Considerations

- **Production**: Always use KV storage for production deployments
- **Development**: In-memory fallback is acceptable for local testing
- **Monitoring**: Check logs for `[InvoiceMetadataStore]` warnings
- **Cleanup**: Entries expire automatically via TTL; no manual cleanup needed
