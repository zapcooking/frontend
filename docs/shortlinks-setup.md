# URL Shortener (Shortlinks) Setup

The zap.cooking URL shortener stores mappings in Cloudflare KV and exposes:

- **Create short link**: `POST /api/shorten` (body: `{ url, type?, customSlug?, createdBy? }`)
- **Redirect**: `GET /s/:code` → 302 to `/r/:naddr` or `/reads/:naddr`
- **Stats**: `GET /api/stats/:code`
- **Preview**: `GET /s/:code/info` (preview before redirect)

## KV namespace

1. In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → KV → Create a namespace (e.g. `zapcooking-shortlinks`).
2. Copy the namespace **id**.
3. In **wrangler.jsonc**, set the `id` in `kv_namespaces[0]` to that value:
   ```json
   "kv_namespaces": [
     {
       "binding": "SHORTLINKS",
       "id": "your-actual-namespace-id-here"
     }
   ]
   ```
4. For **Pages**, you can instead bind KV in: Pages → Your Project → Settings → Functions → KV namespace bindings → Add binding **SHORTLINKS** to the same namespace.

## Local development

With the namespace id in `wrangler.jsonc`, run:

```bash
pnpm build && pnpm dev:cloudflare
```

Or use a separate dev namespace and pass it when running `wrangler pages dev`:

```bash
wrangler pages dev .svelte-kit/cloudflare --kv=SHORTLINKS=<dev_namespace_id>
```

## Data shape (KV)

- **Key**: normalized short code (lowercase, 4–12 alphanumeric).
- **Value** (JSON): `{ shortCode, naddr, createdAt, createdBy?, clicks?, type: 'recipe' | 'article' }`.

## Rate limiting and auth

The API does not enforce rate limiting or authentication by default. To restrict creation to logged-in users, the client can send `createdBy: npub...` and you can add server-side checks (e.g. NIP-07 / NIP-98) in `src/routes/api/shorten/+server.ts`.
