# Mobile App Build Instructions

## Overview

This project uses **Capacitor** to build native mobile apps (Android/iOS) from the web application. The web app and mobile app share the same codebase but use different build adapters.

## Key Configuration

### Build Adapters
- **Web (Cloudflare)**: Uses `adapter-cloudflare` (default)
- **Mobile (Capacitor)**: Uses `adapter-static` with `ADAPTER=static` environment variable

### Build Output
- **Web**: `.svelte-kit/cloudflare/` (for Cloudflare Pages)
- **Mobile**: `build/` directory (for Capacitor `webDir`)

### Configuration Files
- `svelte.config.js`: Chooses adapter based on `ADAPTER` env var
- `capacitor.config.ts`: Points to `webDir: 'build'`
- `package.json`: Has `build:mobile` script

## Build Process

### Step 1: Build for Mobile
```bash
npm run build:mobile
# or
pnpm build:mobile
```

This command:
- Sets `ADAPTER=static` environment variable
- Sets `SKIP_ENV_VALIDATION=1` (mobile doesn't need server-side env vars)
- Runs `vite build` which outputs to `build/` directory
- Uses `adapter-static` to generate static HTML files

### Step 2: Sync with Capacitor
```bash
npx cap sync
```

This command:
- Copies files from `build/` to native app directories (`android/app/src/main/assets/public/` or `ios/App/App/public/`)
- Updates native project configuration if needed
- Ensures Capacitor plugins are properly linked

### Step 3: Open Native IDE (Optional)
```bash
# For Android
npx cap open android

# For iOS
npx cap open ios
```

## Important Notes

### ⚠️ Always Run Build:mobile Before Sync
**You MUST run `npm run build:mobile` BEFORE `npx cap sync`** whenever you make code changes. The sync command only copies files - it doesn't rebuild your web app!

### Build Directory
- The `build/` directory is gitignored (should not be committed)
- It's regenerated on each `build:mobile` run
- Capacitor reads from this directory during sync

### Environment Variables
- Mobile builds use `SKIP_ENV_VALIDATION=1` because they don't need server-side environment variables
- All runtime configuration should be client-side compatible
- No `.env` files needed for mobile builds

## Complete Workflow

```bash
# 1. Make code changes
# 2. Build for mobile
npm run build:mobile

# 3. Sync with Capacitor
npx cap sync

# 4. Test in native app
npx cap open android  # or ios
```

## Troubleshooting

### Mobile app shows old code
- **Problem**: You changed code but mobile app shows old version
- **Solution**: Run `npm run build:mobile` again, then `npx cap sync`

### Build directory exists but is outdated
- **Problem**: `build/` exists but was created before your latest changes
- **Solution**: Delete `build/` directory and run `npm run build:mobile` again

### Sync says "nothing to sync"
- **Problem**: You ran `npx cap sync` but no files changed
- **Solution**: Make sure you ran `npm run build:mobile` first. Check that `build/` has recent timestamps.

### Mobile app crashes or doesn't load
- **Problem**: App builds but crashes on launch
- **Solution**: 
  1. Check browser console errors (enable remote debugging)
  2. Verify `build/index.html` exists and is valid
  3. Check Capacitor logs: `npx cap run android --logs` (or iOS equivalent)

## Quick Reference

| Command | Purpose | When to Run |
|---------|---------|-------------|
| `npm run build:mobile` | Build web app for mobile | After code changes |
| `npx cap sync` | Copy build to native projects | After `build:mobile` |
| `npx cap open android` | Open Android Studio | When ready to test/debug |
| `npx cap open ios` | Open Xcode | When ready to test/debug |
| `npx cap run android` | Build and run on device/emulator | To test on Android |
| `npx cap run ios` | Build and run on device/simulator | To test on iOS |

## Differences from Web Build

| Aspect | Web Build | Mobile Build |
|--------|-----------|--------------|
| Command | `npm run build` | `npm run build:mobile` |
| Adapter | `adapter-cloudflare` | `adapter-static` |
| Output | `.svelte-kit/cloudflare/` | `build/` |
| Environment | Needs env vars | `SKIP_ENV_VALIDATION=1` |
| Deployment | Cloudflare Pages | Native app stores |

## Current Status Check

To verify your setup:
1. Check if `build/` directory exists: `ls -la build/`
2. Check build timestamp: `stat build/index.html`
3. Verify Capacitor config: `cat capacitor.config.ts`
4. Check adapter in use: Look at `svelte.config.js`



