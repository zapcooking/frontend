# Notification Permission Troubleshooting

## 🔴 CRITICAL FIX APPLIED

The issue was that `isNativePlatform()` was failing to import Capacitor, causing it to fall back to web Notification API (which doesn't exist in iOS WebView).

**Fix applied:**
- Now checks `window.Capacitor` first (available globally in Capacitor apps)
- Falls back to dynamic import if needed
- Better error handling and logging

## Quick Fix for Testing

If you've tested before and localStorage is blocking the request, clear it:

```javascript
// In browser console:
localStorage.removeItem('zc_notification_permission_requested')
// Then restart the app
```

Or use the debug function:
```javascript
window.testNotificationPermissions(true) // true = clear storage first
```

---

If notification permissions aren't showing up, check the following:

## 1. Check Console Logs

After rebuilding and running the app, check the browser/device console for logs starting with `[Notifications]`. You should see:
- `[Notifications] requestPermissionsOnAppLaunch called` - on app launch
- `[Notifications] isNativePlatform: platform = ios/android` - platform detection
- `[Notifications] Current permission status: prompt/granted/denied` - current status
- `[Notifications] Requesting permissions via LocalNotifications plugin...` - when requesting

## 2. Verify Plugin Installation

Make sure the plugin is installed:
```bash
npm list @capacitor/local-notifications
# or
pnpm list @capacitor/local-notifications
```

Should show version `^8.0.0`.

## 3. Sync Capacitor Plugins

After installing/updating plugins, you need to sync:
```bash
npx cap sync
```

This copies the plugin to native projects.

## 4. Rebuild Native Projects

After syncing, rebuild:
```bash
# iOS
npx cap open ios
# Then rebuild in Xcode

# Android
npx cap open android
# Then rebuild in Android Studio
```

## 5. Check iOS Info.plist (iOS only)

The plugin should auto-add permissions, but verify in Xcode:
- Open `ios/App/App/Info.plist`
- Should have entries for notifications (auto-added by Capacitor)

## 6. Check Android Manifest (Android only)

Verify in `android/app/src/main/AndroidManifest.xml`:
- Should have notification permissions (auto-added by Capacitor)

## 7. Clear App Data

If you've tested before, the permission might be cached:
- iOS: Delete app and reinstall
- Android: Clear app data or uninstall/reinstall

## 8. Test on Real Device

Capacitor plugins often don't work in simulators/emulators. Test on a real device.

## 9. Check Permission Status

In the console, you should see the permission status. If it shows `'denied'` immediately, the permission was already denied previously. You'll need to:
- iOS: Settings → Zap Cooking → Notifications → Enable
- Android: Settings → Apps → Zap Cooking → Notifications → Enable

## 10. Verify Code is Running

Check that the layout onMount is actually running:
- Look for `[Layout] Error requesting notification permissions:` in console
- If you see errors, the import or function call might be failing

## Common Issues

### Issue: "Not in browser" logs
- **Cause**: Code running in SSR (server-side)
- **Fix**: Already handled with `if (!browser)` checks

### Issue: "isNativePlatform: platform = web"
- **Cause**: Running in web browser, not native app
- **Fix**: Build and run on device, not in browser

### Issue: "Error importing Capacitor"
- **Cause**: Capacitor not installed or not synced
- **Fix**: Run `npm install` and `npx cap sync`

### Issue: Permission shows as 'denied' immediately
- **Cause**: Permission was denied previously
- **Fix**: Reset in device Settings or clear app data

### Issue: No logs at all
- **Cause**: Code not running or error before logging
- **Fix**: Check for JavaScript errors in console
