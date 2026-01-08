# Membership Expiration Notifications

This system sends Nostr direct messages (DMs) to users when their membership is about to expire.

## Setup

### 1. Environment Variables

Add these to your `.env` file and Cloudflare Workers environment:

```bash
# Required: Private key for the service account that sends DMs
# Can be provided as:
# - Hex private key (64 characters): "abc123..."
# - nsec (bech32 encoded): "nsec1..."
# 
# Service account npub: npub1lhfx8a5ln6269g993mp706q9xqgjznaxvqrajwex6t68zlf3j9asnezaf4
NOTIFICATION_PRIVATE_KEY=your_private_key_here_or_nsec

# Optional: Secret to protect the cron endpoint from unauthorized access
CRON_SECRET=your_random_secret_here

# Required: Already configured
RELAY_API_SECRET=your_relay_api_secret
MEMBERSHIP_ENABLED=true
```

### 2. Generate Service Account Keypair

You need to create a dedicated Nostr keypair for sending membership notifications:

```bash
# Generate a new keypair (you can use nostr-tools CLI or online tools)
# The private key should be 64 hexadecimal characters
# Example: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5f6a7b8c9d0e1f2a3
```

**Important:** 
- This keypair should be dedicated to membership notifications
- Do NOT use a user's private key
- Keep the private key secure (use Cloudflare Workers secrets)

### 3. Cloudflare Pages Cron Configuration

For Cloudflare Pages, cron triggers are configured in the Cloudflare dashboard:

1. Go to Cloudflare Dashboard → Pages → Your Project
2. Navigate to Settings → Functions → Cron Triggers
3. Add a new cron trigger:
   - **Route:** `/api/cron/check-expiring-memberships`
   - **Cron Expression:** `0 10 * * *` (runs daily at 10:00 UTC)
   - **Timezone:** UTC

Alternatively, you can configure via `wrangler.toml` (for Workers) or use an external cron service.

### 4. Manual Testing

Test the endpoint manually:

```bash
# Without auth (if CRON_SECRET not set)
curl https://your-domain.com/api/cron/check-expiring-memberships

# With auth (if CRON_SECRET set)
curl -H "Authorization: Bearer your_cron_secret" \
  https://your-domain.com/api/cron/check-expiring-memberships
```

## How It Works

1. **Daily Check**: The cron job runs daily at 10:00 UTC
2. **Find Expiring Members**: Checks members API for memberships expiring within 7 days
3. **Send DMs**: For each expiring membership, sends a Nostr DM (kind 4) with:
   - Encrypted message using NIP-44
   - Reminder about expiration date
   - Renewal link to zap.cooking/membership
   - List of membership benefits

## DM Message Format

The DM includes:
- Days until expiration
- Expiration date
- Membership tier (Cook+ or Pro Kitchen)
- List of benefits
- Renewal link: https://zap.cooking/membership

## Monitoring

Check the cron job logs in Cloudflare Workers dashboard to see:
- Number of expiring memberships found
- Number of DMs sent successfully
- Any errors encountered

## Security Considerations

1. **Private Key Security**: Store `NOTIFICATION_PRIVATE_KEY` as a secret in Cloudflare Workers
2. **Endpoint Protection**: Use `CRON_SECRET` to prevent unauthorized access
3. **Rate Limiting**: The service adds 500ms delay between messages to avoid rate limiting
4. **Error Handling**: Failed DMs are logged but don't stop the process

## Troubleshooting

### DMs Not Sending

1. Verify `NOTIFICATION_PRIVATE_KEY` is correct (64 hex characters)
2. Check that the service account keypair has access to relays
3. Verify recipient pubkeys are valid
4. Check Cloudflare Workers logs for errors

### Cron Not Running

1. Verify cron trigger is configured in Cloudflare dashboard
2. Check cron expression syntax
3. Test endpoint manually to ensure it works
4. Check Cloudflare Workers logs for execution attempts

### Encryption Errors

1. Ensure `nostr-tools` version supports NIP-44 v2
2. Verify private key format (must be 64 hex characters)
3. Check that recipient pubkeys are valid hex format

## Future Enhancements

- Add multiple notification windows (30 days, 7 days, 1 day)
- Track sent notifications to avoid duplicates
- Add preference for users to opt-out of notifications
- Support different message templates
- Add analytics on renewal rates

