# Local Testing Setup for Membership Notifications

## Prerequisites

1. Make sure you have a `.env` file in the project root (it should be gitignored)
2. Add the following environment variables to `.env`:

```bash
# Required: Private key for sending notifications (can be nsec or hex)
NOTIFICATION_PRIVATE_KEY=nsec1your_nsec_here

# Required: Relay API secret for checking memberships
RELAY_API_SECRET=your_relay_api_secret_here

# Optional: Enable membership notifications
MEMBERSHIP_ENABLED=true

# Optional: Cron secret for protecting the endpoint (can be omitted for local testing)
# CRON_SECRET=your_secret_here
```

## Step 1: Set Up Environment Variables

Create or update your `.env` file with the required variables. If you don't have a notification private key yet, you can generate one:

```bash
# Generate a new keypair (you can use any Nostr key generator)
# The private key should be 64 hex characters or nsec1 format
```

## Step 2: Test with Specific npub

To test sending a notification to a specific npub, use the test endpoint:

```bash
# Start the dev server
pnpm dev

# In another terminal, test with the npub
curl "http://localhost:5174/api/cron/test-notification?npub=npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx"
```

This will:
- Decode the npub to get the hex pubkey
- Send a test expiration notification (with expiration date 7 days from now)
- Return success/failure status

## Step 3: Test the Full Cron Endpoint

To test the full cron endpoint (which checks for expiring memberships from the API):

```bash
# Start the dev server
pnpm dev

# Test the cron endpoint
curl http://localhost:5174/api/cron/check-expiring-memberships
```

Or if you set a CRON_SECRET:

```bash
curl -H "Authorization: Bearer your_cron_secret" \
  http://localhost:5174/api/cron/check-expiring-memberships
```

## Step 4: Verify DM Delivery

1. Log in to zap.cooking with the account that matches the test npub
2. Navigate to your DMs/messages section
3. You should see a DM from the notification service account with the expiration reminder

## Expected Response Format

### Test Endpoint Response (Success):
```json
{
  "success": true,
  "message": "Test notification sent successfully",
  "recipient": {
    "npub": "npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx",
    "pubkey": "abc123..."
  },
  "testExpirationDate": "2025-01-15T10:00:00.000Z",
  "timestamp": "2025-01-08T10:00:00.000Z"
}
```

### Cron Endpoint Response (Success):
```json
{
  "success": true,
  "timestamp": "2025-01-08T10:00:00.000Z",
  "daysAhead": 7,
  "notificationsSent": 1,
  "notificationsFailed": 0,
  "totalExpiring": 1
}
```

## Troubleshooting

### "NOTIFICATION_PRIVATE_KEY not configured"
- Make sure your `.env` file exists in the project root
- Verify the variable name is exactly `NOTIFICATION_PRIVATE_KEY`
- Check that the value doesn't have extra quotes or spaces
- Restart the dev server after updating `.env`

### "Failed to decode npub"
- Verify the npub starts with `npub1`
- Make sure the npub is complete (not truncated)
- Check for any URL encoding issues

### "Failed to send notification"
- Check the console output for detailed error messages
- Verify the notification private key is correct
- Make sure NDK can connect to relays (check network connectivity)
- Verify the recipient pubkey is valid

### DM Not Appearing
- Wait a few seconds for the DM to propagate through relays
- Check multiple relays in your client
- Verify you're logged in with the correct account (matching the npub)
- Some clients may need to refresh or reconnect to see new DMs

## Testing with Production API

If you want to test with actual membership data from the production API:

1. Make sure `RELAY_API_SECRET` in your `.env` matches the production secret
2. The cron endpoint will check for memberships expiring within 7 days
3. Only active memberships with expiration dates in the window will receive notifications

## Next Steps After Local Testing

Once local testing is successful:

1. Add `NOTIFICATION_PRIVATE_KEY` as a secret in Cloudflare Pages dashboard
2. Deploy the code
3. Configure the cron trigger in Cloudflare Pages dashboard (Settings → Functions → Cron Triggers)
4. Test the production endpoint
