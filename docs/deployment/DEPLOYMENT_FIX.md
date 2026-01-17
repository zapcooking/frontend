# Deployment Fix

## Issue
The deployment is failing with:
```
✘ [ERROR] Missing entry-point to Worker script or to assets directory
Executing user deploy command: npx wrangler versions upload
```

## Root Cause
The deployment platform is using `wrangler versions upload`, which is for **Cloudflare Workers**, but this project is configured for **Cloudflare Pages**.

**Important**: You do NOT need Cloudflare Workers. This is a Pages-only project. The cron job for membership notifications will work through Pages Functions, which are configured in the Cloudflare Dashboard.

## Solution
Update your deployment platform's deploy command to use one of the following:

### Option 1: Use the npm script (Recommended)
```bash
pnpm deploy
```

### Option 2: Use wrangler pages deploy directly
```bash
wrangler pages deploy .svelte-kit/cloudflare --project-name=zapcooking-frontend
```

## How to Fix

### If deploying via Cloudflare Pages Dashboard:
1. Go to your Cloudflare Pages project settings
2. Navigate to **Builds & deployments**
3. Update the **Deploy command** to: `pnpm deploy`
4. Save and redeploy

### If deploying via CI/CD (GitHub Actions, Netlify, etc.):
1. Find your deployment configuration file or platform settings
2. Update the deploy command from:
   ```bash
   npx wrangler versions upload  # ❌ Wrong - for Workers
   ```
   To:
   ```bash
   pnpm deploy  # ✅ Correct - for Pages
   ```
   Or:
   ```bash
   wrangler pages deploy .svelte-kit/cloudflare --project-name=zapcooking-frontend
   ```

## Verification
After updating the deploy command, the deployment should:
- ✅ Build successfully (already working)
- ✅ Deploy to Cloudflare Pages using the correct command
- ✅ No longer show the "Missing entry-point" error

## Notes
- The `deploy` script is already configured correctly in `package.json`
- The `wrangler.jsonc` is correctly configured with `pages_build_output_dir`
- The build output directory `.svelte-kit/cloudflare` is correct
- The only issue is the deployment command being used
