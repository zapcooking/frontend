# Cloudflare Production Testing Guide

## Test Notification Endpoint

The test endpoint is now available on Cloudflare and can send notifications to specific npubs for testing.

## Your Test npub

```
npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq
```

## Testing on Cloudflare

### Option 1: Using curl with CRON_SECRET

If you have a `CRON_SECRET` set in Cloudflare Pages environment variables:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

### Option 2: Using curl without CRON_SECRET (if not set)

If `CRON_SECRET` is not configured, the endpoint will work without authentication:

```bash
curl "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

### Option 3: Using the npm script

Add your CRON_SECRET to your environment and use:

```bash
export CRON_SECRET=your_secret_here
pnpm test:notification:cloudflare
```

## Expected Response

On success, you should see:

```json
{
  "success": true,
  "message": "Test notification sent successfully",
  "recipient": {
    "npub": "npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq",
    "pubkey": "abc123..."
  },
  "testExpirationDate": "2025-01-15T10:00:00.000Z",
  "timestamp": "2025-01-08T10:00:00.000Z"
}
```

## Verify DM Delivery

1. Log in to zap.cooking with the account matching the test npub
2. Navigate to your DMs/messages section
3. You should see a DM from the notification service account with:
   - "⚡ Your Zap Cooking membership is due for renewal in 7 days"
   - A renewal link to https://zap.cooking/membership

## Troubleshooting

### "Unauthorized" Error
- Make sure you're including the Authorization header if CRON_SECRET is set
- Verify the CRON_SECRET matches exactly (no extra spaces)

### "NOTIFICATION_PRIVATE_KEY not configured"
- Verify the secret is set in Cloudflare Pages → Settings → Environment Variables
- Make sure it's set as a **Secret** (not a regular environment variable)
- Redeploy after adding the secret

### "Failed to send notification"
- Check Cloudflare Pages logs for detailed error messages
- Verify NDK can connect to relays
- Check that the notification private key is valid

### DM Not Appearing
- Wait a few seconds for the DM to propagate through relays
- Check multiple relays in your client
- Some clients may need to refresh or reconnect to see new DMs
- Verify you're logged in with the correct account (matching the npub)

## Security Note

The test endpoint uses the same security as the main cron endpoint:
- Requires `CRON_SECRET` authentication if set
- Only sends to the npub specified in the query parameter
- Uses the same notification service account configured in `NOTIFICATION_PRIVATE_KEY`

For production use, it's recommended to set a `CRON_SECRET` to protect both endpoints.
