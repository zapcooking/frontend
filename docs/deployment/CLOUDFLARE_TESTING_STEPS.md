# Step-by-Step: Testing on Cloudflare Pages

## Overview
You'll test the notification endpoint using curl commands. The endpoint will be available at your Cloudflare Pages domain once deployed.

## Step 1: Verify Deployment Status

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on **Workers & Pages** in the left sidebar
3. Find your project **zapcooking-frontend** (or similar) and click on it
4. Check the **Deployments** tab at the top
5. Look for the latest deployment and verify it's **Active** (green checkmark)
6. Note the domain URL (e.g., `zapcooking.pages.dev` or your custom domain)

## Step 2: Check Environment Variables are Set

1. Still in your Cloudflare Pages project
2. Click on **Settings** tab at the top
3. Scroll down to **Environment Variables** section
4. Verify these are set (for Production environment):
   - `NOTIFICATION_PRIVATE_KEY` (should be a Secret, not a regular variable)
   - `RELAY_API_SECRET`
   - `MEMBERSHIP_ENABLED` (should be `true`)
   - `CRON_SECRET` (optional, but recommended for security)

If any are missing, click **Add variable** and add them. **Important**: After adding secrets, you need to redeploy.

## Step 3: Get Your CRON_SECRET (if set)

1. In **Settings** → **Environment Variables**
2. Look for `CRON_SECRET`
3. If it exists, you'll see it listed (but not the value - that's hidden for security)
4. You'll need to know the value to use it in the curl command

**Note**: If you don't see `CRON_SECRET`, that's okay - the endpoint will work without it for testing.

## Step 4: Test the Endpoint

You have two options depending on whether CRON_SECRET is set:

### Option A: If CRON_SECRET is set

Open your terminal (Mac Terminal, iTerm, etc.) and run:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET_HERE" \
  "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

**Replace `YOUR_CRON_SECRET_HERE`** with the actual value from Step 3.

### Option B: If CRON_SECRET is NOT set

Open your terminal and run:

```bash
curl "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

**Note**: Replace `zap.cooking` with your actual Cloudflare Pages domain if different.

## Step 5: Check the Response

You should see a JSON response. If successful, it will look like:

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

If you get an error, see the Troubleshooting section below.

## Step 6: View Logs (if there's an issue)

1. Go back to Cloudflare Dashboard → **Workers & Pages** → Your Project
2. Click on **Logs** tab at the top
3. Click **Start Log Stream** (if not already running)
4. Run your curl command again
5. Watch the logs appear in real-time to see any errors

The logs will show:
- Request details
- Any console.log or console.error messages
- Stack traces if there are errors

## Step 7: Verify DM Delivery

1. Open zap.cooking in your browser
2. Log in with the account matching npub: `npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq`
3. Navigate to your DMs/Messages section
4. Look for a DM from the notification service account
5. The message should say: "⚡ Your Zap Cooking membership is due for renewal in 7 days"

## Troubleshooting

### Error: "Unauthorized" (401)
- Make sure you're including the Authorization header correctly
- Verify the CRON_SECRET value matches exactly (no extra spaces)
- Try Option B (without CRON_SECRET) if you haven't set one

### Error: "NOTIFICATION_PRIVATE_KEY not configured"
1. Go to **Settings** → **Environment Variables**
2. Verify `NOTIFICATION_PRIVATE_KEY` exists and is set as a **Secret** (not regular variable)
3. After adding/updating, **trigger a new deployment**:
   - Go to **Deployments** tab
   - Click the three dots (⋯) on the latest deployment
   - Click **Retry deployment**
   - Or make a small change and push to trigger auto-deploy

### Error: "Failed to send notification"
1. Check the **Logs** tab for detailed error messages
2. Verify `NOTIFICATION_PRIVATE_KEY` is valid (64 hex characters or valid nsec)
3. Make sure NDK can connect to relays (check network/firewall)

### No DM Appearing
- Wait 10-30 seconds for the DM to propagate through relays
- Try refreshing your DM inbox
- Some Nostr clients need to reconnect to relays to see new messages
- Check multiple relays in your client settings

### Command Not Found: curl
If you're on Windows and don't have curl:
- Use Git Bash (comes with Git for Windows)
- Or use PowerShell: `Invoke-WebRequest -Uri "https://zap.cooking/api/cron/test-notification?npub=..." -Headers @{Authorization="Bearer YOUR_SECRET"}`
- Or use Postman or similar tool to make the GET request

## Quick Reference

**Your test npub:**
```
npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq
```

**With CRON_SECRET:**
```bash
curl -H "Authorization: Bearer YOUR_SECRET" \
  "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

**Without CRON_SECRET:**
```bash
curl "https://zap.cooking/api/cron/test-notification?npub=npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq"
```

## Next Steps After Successful Test

Once the test works:
1. The notification system is ready for production use
2. Set up the cron trigger in **Settings** → **Functions** → **Cron Triggers**
3. The cron will automatically run daily at 10:00 UTC
4. Members with expiring memberships (within 7 days) will receive DMs automatically
