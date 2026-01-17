# Testing Membership Expiration Notifications

## Step 1: Add nsec to Local .env File

Add this to your `.env` file (for local testing):

```bash
NOTIFICATION_PRIVATE_KEY=nsec1your_nsec_here
```

**Important:** Never commit your `.env` file to git (it should already be in `.gitignore`).

## Step 2: Test Locally

You can test the endpoint locally by running:

```bash
# Start your dev server
pnpm dev

# In another terminal, test the endpoint
curl http://localhost:5174/api/cron/check-expiring-memberships
```

Or if you set a CRON_SECRET:

```bash
curl -H "Authorization: Bearer your_cron_secret" \
  http://localhost:5174/api/cron/check-expiring-memberships
```

## Step 3: Add Secret to Cloudflare Workers

### Option A: Using Cloudflare Dashboard (Recommended)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → Your Project
3. Click on **Settings** tab
4. Scroll down to **Variables and Secrets** section
5. Click **Add variable**
6. Select **Secret** (not Environment Variable)
7. Enter:
   - **Variable name:** `NOTIFICATION_PRIVATE_KEY`
   - **Value:** Your nsec (e.g., `nsec1...`)
8. Click **Save**

### Option B: Using Wrangler CLI

```bash
# Make sure you're logged in
npx wrangler login

# Add the secret (it will prompt you to enter the value securely)
npx wrangler secret put NOTIFICATION_PRIVATE_KEY

# When prompted, paste your nsec
```

### Option C: Using Cloudflare Pages Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → Your Project
3. Go to **Settings** → **Environment Variables**
4. Click **Add variable**
5. Enter:
   - **Variable name:** `NOTIFICATION_PRIVATE_KEY`
   - **Value:** Your nsec
   - **Type:** Secret (make sure to select "Secret" not plain text)
6. Select environment (Production, Preview, or both)
7. Click **Save**

## Step 4: Deploy and Test

After adding the secret and deploying:

```bash
# Test the production endpoint
curl https://your-domain.com/api/cron/check-expiring-memberships

# Or with cron secret (if set)
curl -H "Authorization: Bearer your_cron_secret" \
  https://your-domain.com/api/cron/check-expiring-memberships
```

## Step 5: Check Logs

View logs in Cloudflare Dashboard:
1. Go to **Workers & Pages** → Your Project
2. Click **Logs** tab
3. You should see execution logs and any errors

## Testing Tips

1. **Test with a Known Expiring Membership**: 
   - Create a test membership with expiration date 7 days from now
   - Run the cron endpoint
   - Check if DM was sent

2. **Verify DM Delivery**:
   - Log in to zap.cooking with the test account
   - Check if DM was received in the DMs section

3. **Check Response**:
   - The endpoint returns JSON with stats:
     ```json
     {
       "success": true,
       "timestamp": "2025-01-08T...",
       "daysAhead": 7,
       "notificationsSent": 1,
       "notificationsFailed": 0,
       "totalExpiring": 1
     }
     ```

## Troubleshooting

### "NOTIFICATION_PRIVATE_KEY not configured"
- Make sure the secret is added in Cloudflare
- Check the variable name is exactly `NOTIFICATION_PRIVATE_KEY`
- Redeploy after adding the secret

### "Invalid nsec format"
- Verify your nsec starts with `nsec1`
- Make sure there are no extra spaces or quotes
- Try decoding it to verify: `node -e "const {nip19} = require('nostr-tools'); console.log(nip19.decode('your_nsec'))"`

### DMs Not Sending
- Check Cloudflare logs for errors
- Verify the service account keypair has access to relays
- Ensure recipient pubkeys are valid
- Check that NDK can connect to relays

### Testing Locally with Cloudflare Dev

```bash
# Start local Cloudflare dev environment
pnpm dev:cloudflare

# Test the endpoint
curl http://localhost:8788/api/cron/check-expiring-memberships
```

Note: When testing locally with `pnpm dev`, the environment variables from `.env` will be loaded automatically.
