# Cloudflare Configuration: NIP-05 nostr.json Fix

## Problem
The `.well-known/nostr.json` endpoint at `https://zap.cooking/.well-known/nostr.json` was forwarding to `pantry.zap.cooking`, which breaks existing NIP-05 verification and prevents serving the file directly from `zap.cooking`.

## Solution
We've created a dynamic route handler at `src/routes/.well-known/nostr.json/+server.ts` that:
1. Fetches dynamic NIP-05 mappings from `pantry.zap.cooking/.well-known/nostr.json`
2. Merges them with static names (jack, seth, daniel, _)
3. Serves the combined result directly from `zap.cooking`

## Cloudflare Configuration Changes Required

### Remove the Forwarding Rule

You need to remove or disable the forwarding rule in Cloudflare Pages that forwards `/.well-known/nostr.json` to `pantry.zap.cooking`.

**Steps:**
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Pages** → Select your project (`zapcooking-frontend` or similar)
3. Go to **Settings** → **Functions** → **Redirects/Rewrites** (or **Custom domains** → **Rules**)
4. Look for a rule that forwards/redirects `/.well-known/nostr.json` to `pantry.zap.cooking`
5. **Delete or disable** this rule

**Alternative location:** The rule might also be in:
- **Pages** → Your Project → **Custom domains** → **Rules**
- **Rules** → **Page Rules** (legacy)
- **Transform Rules** → **URL Rewrite Rules**

### Verify the Endpoint

After removing the forwarding rule, verify the endpoint works:

```bash
# Test the endpoint
curl https://zap.cooking/.well-known/nostr.json

# Should return JSON with names object:
# {
#   "names": {
#     "username": "pubkey...",
#     ...
#   }
# }
```

### CORS Headers

The route handler already sets the required CORS headers:
- `Access-Control-Allow-Origin: *`
- `Content-Type: application/json`

### Cache Behavior

The endpoint sets a cache header of `Cache-Control: public, max-age=300` (5 minutes), which is appropriate for NIP-05 verification.

## Testing

1. **Local testing:**
   ```bash
   npm run dev
   # Visit http://localhost:5173/.well-known/nostr.json
   ```

2. **Production testing:**
   - After deploying, visit: `https://zap.cooking/.well-known/nostr.json`
   - Should return JSON (not a redirect)
   - Should include both static names and dynamic NIP-05 mappings

## Fallback Behavior

If the fetch from `pantry.zap.cooking` fails, the endpoint will:
- Log an error
- Return only the static names (jack, seth, daniel, _)
- This ensures the endpoint always returns valid JSON

## Notes

- The static file at `static/.well-known/nostr.json` will not interfere with the dynamic route handler (route handlers take precedence in SvelteKit)
- The static file can be kept as a backup/fallback or removed if desired
- Make sure `pantry.zap.cooking/.well-known/nostr.json` is accessible from your Cloudflare Pages function (it should be)