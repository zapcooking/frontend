# Fixing Emulator Graphics Errors (MESA)

## Problem
The MESA graphics errors you're seeing are **emulator-only issues**, not your app:
- `Failed to open rendernode: No such file or directory`
- `Access denied finding property "vendor.mesa.*"`

These are graphics driver issues with the Android emulator, not your app code.

## Solutions

### Option 1: Change Emulator Graphics Settings (Recommended)

1. **In Android Studio AVD Manager:**
   - Open AVD Manager
   - Click the pencil icon to edit your emulator
   - Click "Show Advanced Settings"
   - Under "Graphics", change from "Automatic" to:
     - **"Hardware - GLES 2.0"** (best performance)
     - OR **"Software - GLES 2.0"** (most compatible)

2. **Cold Boot the Emulator:**
   - Close the emulator completely
   - In AVD Manager, click the dropdown arrow next to your emulator
   - Select "Cold Boot Now"
   - This resets the graphics state

### Option 2: Use a Different System Image

Some system images have better graphics support:
- Try a **Google Play** system image instead of a standard one
- Or try a different API level (e.g., API 33 instead of 34)

### Option 3: Test on Real Device

The MESA errors won't appear on real devices - they're emulator-specific. Testing on a physical device will give you:
- No graphics errors
- Better performance
- More realistic testing environment

### Option 4: Ignore the Errors (Current Status)

Since:
- ✅ Your app is working correctly
- ✅ All functionality works
- ✅ These are just log noise
- ❌ They don't affect functionality

You can safely ignore them. They're just annoying log messages.

## What the Errors Mean

**MESA** is the graphics library used by the Android emulator on some systems. The errors indicate:
- The emulator's graphics layer can't access certain rendering nodes
- This is an emulator limitation, not your app
- Real Android devices use their own graphics drivers (not MESA)

## Verification

To confirm these are harmless:
- ✅ App loads correctly
- ✅ WebSocket connections work
- ✅ Recipes display
- ✅ Navigation works
- ✅ No actual crashes

If all of the above are true, the MESA errors are just noise and can be ignored.

## Recommendation

**Best approach:** Use a real Android device for testing, or ignore the emulator errors since they don't affect functionality.



