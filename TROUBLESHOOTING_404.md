# Troubleshooting 404 Error for Test Endpoint

## The Issue
You're getting a 404 error when accessing `/api/cron/test-notification`. This means the route isn't being found.

## Possible Causes

### 1. Route Not Deployed Yet (Most Likely)
The new test endpoint route was added in commit `6d46306`, but your current deployment might be from an earlier commit.

**Solution:**
1. Go to Cloudflare Dashboard → **Workers & Pages** → Your Project
2. Check the **Deployments** tab
3. Look at the latest deployment and verify it includes commit `6d46306` or later
4. If it doesn't, either:
   - Wait for automatic deployment (if you have auto-deploy enabled)
   - Or trigger a new deployment manually:
     - Go to **Settings** → **Builds & deployments**
     - Click **Retry deployment** on the latest deployment
     - Or push a new commit to trigger deployment

### 2. Route Not Built Correctly
The route file exists but might not have been included in the build.

**Solution:**
1. Check that the file exists at: `src/routes/api/cron/test-notification/+server.ts`
2. Verify the file has `export const GET` handler
3. Rebuild and redeploy

### 3. Cloudflare Pages Routing Issue
Sometimes Cloudflare Pages needs a moment to recognize new routes.

**Solution:**
- Wait a few minutes after deployment
- Clear Cloudflare cache if you have caching enabled
- Try again

## How to Verify the Route is Deployed

1. **Check the deployment commit hash:**
   - Cloudflare Dashboard → Your Project → **Deployments**
   - Look at the latest deployment details
   - Verify it shows commit `6d46306` or later

2. **Check if other API routes work:**
   ```bash
   curl https://zap.cooking/api/cron/check-expiring-memberships
   ```
   If this also gives 404, there might be a broader routing issue.

3. **Check the build logs:**
   - Cloudflare Dashboard → Your Project → **Deployments**
   - Click on a deployment to see build logs
   - Look for any errors during the build process

## Quick Test

Try accessing the main cron endpoint first to verify API routes work:

```bash
curl https://zap.cooking/api/cron/check-expiring-memberships
```

If this works but `/test-notification` doesn't, it confirms the new route isn't deployed yet.

## Next Steps

1. **Verify latest commit is deployed** - Check Cloudflare Deployments tab
2. **If not deployed, trigger a new deployment** - Retry or push new commit
3. **Wait 2-3 minutes after deployment completes** - Routes need time to propagate
4. **Test again** - Try the curl command again

## Alternative: Use Main Cron Endpoint for Testing

If you need to test immediately and the test endpoint isn't deployed yet, you can temporarily modify your membership in the members API to have an expiration date 7 days from now, then call the main cron endpoint:

```bash
curl https://zap.cooking/api/cron/check-expiring-memberships
```

This will send notifications to all members expiring in 7 days (including your test npub if it's in the members database with the right expiration date).
