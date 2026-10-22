# Project Notes

## Important Rules
- **Never push to upstream/main (production) without explicit user permission**
- Always allow user to perform commits manually; do not commit or push without permission
- Always write in US English (all output, comments, commit messages, PR text)

- **All PRs must be reviewed by the user before opening** - this applies even in "full access"/autonomous modes; present the changes (diff/summary) for review and get explicit approval before creating any pull request

## Deployment
- Upstream repo (zapcooking/frontend) uses Cloudflare
- Our fork (dmnyc/zapcooking) uses Vercel

## Branch Workflow
- **`main`** branch: uses `adapter-cloudflare` - for upstream PR compatibility
- **`vercel`** branch: uses `adapter-auto` - deployed to Vercel production

When syncing with upstream:
1. Pull/merge upstream changes into `main`
2. Merge `main` into `vercel` to keep both in sync

## Branta Guardrail Integration
Payment address verification service for Bitcoin/Lightning.

**API Base URL:** `https://guardrail.branta.pro/v2`

**Endpoints:**
- `POST /payments` - Register a payment address/invoice
- `GET /payments/:address` - Verify if address is registered (JSON response)
- Web verification: `https://guardrail.branta.pro/v/:address`

**Request format for registration:**
```json
{
  "destinations": [{"value": "bc1q...", "zk": true}],
  "ttl": 86400,
  "description": "optional description"
}
```

**ZK flag:**
- `zk: true` - Zero-knowledge encryption (recommended for on-chain Bitcoin addresses)
- `zk: false` - Plaintext (recommended for Lightning invoices/addresses)

**Environment variables:**
- `BRANTA_API_KEY` - API key for authentication
- `BRANTA_API_BASE_URL` - Optional, defaults to `https://guardrail.branta.pro/v2`

**See also:** `docs/wallet/Branta Integration Plan.md`
