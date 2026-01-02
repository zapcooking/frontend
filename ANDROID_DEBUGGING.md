# Android Debugging Guide

## Viewing Logs in Android Studio

Since `adb` isn't in your PATH, use Android Studio's built-in logcat:

1. **Open Android Studio** (should already be open if you ran `npx cap open android`)
2. **Open Logcat**:
   - Click the "Logcat" tab at the bottom
   - Or go to View → Tool Windows → Logcat
3. **Filter for errors**:
   - Use the search/filter box and type: `chromium` or `WebView` or `ERROR`
   - Or filter by log level: Select "Error" from the dropdown
4. **Look for JavaScript errors**:
   - Filter for: `console` or `JS` or `JavaScript`
   - Look for red error messages

## Common Android WebView Issues

### 1. WebSocket Connection Issues
Nostr relays use WebSockets (`wss://`). Check for:
- `ERR_CONNECTION_REFUSED`
- `ERR_CLEARTEXT_NOT_PERMITTED`
- Network security config issues

**Solution**: The `capacitor.config.ts` has `allowMixedContent: false` which is correct, but ensure your Android manifest allows cleartext traffic if needed (though WSS shouldn't need it).

### 2. IndexedDB/Dexie Issues
The app uses Dexie (IndexedDB wrapper) for caching. WebView sometimes has issues with IndexedDB.

**Check logs for**:
- `IndexedDB` errors
- `Dexie` errors
- `QuotaExceededError`

### 3. CSP (Content Security Policy) Issues
Check browser console for CSP violations.

### 4. Memory Issues
The app might be using too much memory.

**Check logs for**:
- `OutOfMemoryError`
- `Low memory`

## Quick Debugging Steps

### Step 1: Check Android Studio Logcat
1. Open Android Studio
2. Run the app (green play button)
3. When the error occurs, check Logcat
4. Look for red error messages
5. Copy the full error stack trace

### Step 2: Enable Remote Debugging
1. In your app code, you can use Chrome DevTools to debug:
   - Open Chrome browser on your computer
   - Go to `chrome://inspect`
   - Enable "Discover USB devices"
   - Connect your emulator/device
   - Click "inspect" next to your app

### Step 3: Check Android Manifest Permissions
The manifest should have INTERNET permission (auto-added by Capacitor), but verify:
- `android/app/src/main/AndroidManifest.xml`
- Should have: `<uses-permission android:name="android.permission.INTERNET" />`

### Step 4: Test in Chrome Remote Debugging
This gives you full browser DevTools:
1. Enable remote debugging (Step 2)
2. Check Console tab for JavaScript errors
3. Check Network tab for failed requests
4. Check Application tab for storage issues

## Common Fixes

### Fix 1: Clear App Data
Sometimes cached data causes issues:
```bash
# In Android Studio terminal or adb shell
adb shell pm clear cooking.zap.app
```

### Fix 2: Rebuild Clean
```bash
cd /Users/sethsager/Projects/ZapCooking
rm -rf build android/app/build
npm run build:mobile
npx cap sync
```

### Fix 3: Check for JavaScript Errors
Most crashes are caused by uncaught JavaScript exceptions. Check:
- Browser console (via remote debugging)
- Look for errors related to:
  - NDK/NDKEvent
  - WebSocket connections
  - IndexedDB operations
  - Missing modules

## What to Look For

When the error occurs, check Logcat for:

1. **JavaScript Errors**:
   ```
   chromium: [ERROR:...]
   JS: Error: ...
   console.error: ...
   ```

2. **WebView Crashes**:
   ```
   FATAL EXCEPTION: chromium
   ```

3. **Network Errors**:
   ```
   ERR_CONNECTION_REFUSED
   ERR_NAME_NOT_RESOLVED
   ERR_CLEARTEXT_NOT_PERMITTED
   ```

4. **Storage Errors**:
   ```
   QuotaExceededError
   IndexedDB
   ```

## Next Steps

1. **Run the app again** in Android Studio
2. **Watch Logcat** as it loads
3. **When it crashes**, check for the error message
4. **Copy the full error** and share it

The "Pixel Launcher isn't responding" is usually just Android's way of saying the app crashed - the real error will be in Logcat.

