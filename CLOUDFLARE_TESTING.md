# Testing Membership Notifications on Cloudflare

## Pre-Deployment Checklist

1. **Set Environment Variables in Cloudflare**:
   ```bash
   # Required
   NOTIFICATION_PRIVATE_KEY=nsec1... (or hex private key)
   RELAY_API_SECRET=your_relay_api_secret
   MEMBERSHIP_ENABLED=true
   
   # Optional but recommended
   CRON_SECRET=your_random_secret_string
   ```

2. **Verify Cron Trigger Configuration**:
   - The cron trigger is configured in `wrangler.toml`
   - It runs daily at 10:00 UTC
   - Route: `/api/cron/check-expiring-memberships`

## Manual Testing (Before Cron Runs)

You can manually trigger the endpoint to test it immediately:

### Option 1: Using curl (if CRON_SECRET is set)

```bash
curl -X GET https://your-domain.com/api/cron/check-expiring-memberships \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Option 2: Using curl (if CRON_SECRET is NOT set)

```bash
curl -X GET https://your-domain.com/api/cron/check-expiring-memberships
```

### Option 3: Using Cloudflare Dashboard

1. Go to Cloudflare Dashboard → Workers & Pages → Your Project
2. Navigate to Functions → View Logs
3. Trigger the cron manually from the Cron Triggers section (if available)

## Expected Response (Success)

```json
{
  "success": true,
  "timestamp": "2026-01-08T23:30:00.000Z",
  "daysAhead": 7,
  "notificationsSent": 2,
  "notificationsFailed": 0,
  "totalExpiring": 2
}
```

## Expected Response (Error)

```json
{
  "success": false,
  "error": "Error message here",
  "timestamp": "2026-01-08T23:30:00.000Z"
}
```

## Verification Steps

1. **Check Cloudflare Logs**:
   - Go to Workers & Pages → Your Project → Logs
   - Look for any error messages
   - Check for `[Membership Notification]` log entries

2. **Verify DMs Received**:
   - Check your Nostr client for DMs from the service account
   - Service account npub: `npub1lhfx8a5ln6269g993mp706q9xqgjznaxvqrajwex6t68zlf3j9asnezaf4`
   - Verify the message format matches the expected renewal message

3. **Check Members API**:
   - Verify members have `subscription_end` dates within 7 days
   - Verify members have `status: "active"`
   - Test with a member who has an expiring membership

## Testing with Test Data

To test before real memberships expire, you can:

1. **Temporarily adjust the daysAhead parameter** in the code to check memberships expiring further out
2. **Manually create a test membership** with a subscription_end date within 7 days
3. **Use the response to verify** which members would receive notifications

## Troubleshooting

### "Unauthorized" Error
- Check that `CRON_SECRET` matches between your curl command and Cloudflare env vars
- Or remove `CRON_SECRET` for testing (not recommended for production)

### "NOTIFICATION_PRIVATE_KEY not configured"
- Verify the secret is set in Cloudflare Workers/Pages environment variables
- Check it's not in `.env` file (that's only for local dev)

### "RELAY_API_SECRET not configured"
- Verify the secret is set in Cloudflare environment variables

### DMs Not Received
- Check Cloudflare logs for encryption/NDK errors
- Verify the service account private key is correct
- Check that recipient npubs are correct
- Verify relays are accessible (wss://relay.damus.io, wss://nos.lol, wss://purplepag.es)

### No Members Found
- Verify members have `status: "active"`
- Check that `subscription_end` dates are within 7 days
- Verify the members API is accessible from Cloudflare

## Production Deployment

Once testing is successful:

1. ✅ All environment variables set in Cloudflare
2. ✅ Manual endpoint test returns success
3. ✅ DMs are received correctly
4. ✅ Message format is correct
5. ✅ Cron trigger is configured (already done in wrangler.toml)

The cron will automatically run daily at 10:00 UTC once deployed.
