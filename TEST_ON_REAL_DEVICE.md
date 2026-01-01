# Testing on Real Android Device

## Step 1: Enable USB Debugging on Your Device

1. **Enable Developer Options:**
   - Go to Settings → About Phone
   - Find "Build Number" (might be under Software Information)
   - Tap "Build Number" **7 times** until you see "You are now a developer!"

2. **Enable USB Debugging:**
   - Go back to Settings
   - Find "Developer Options" (usually under System or Advanced)
   - Toggle on "Developer Options"
   - Enable "USB Debugging"
   - You may see a warning - tap "OK" or "Allow"

3. **Connect Your Device:**
   - Connect your Android device to your Mac via USB cable
   - On your device, you'll see a popup: "Allow USB debugging?"
   - Check "Always allow from this computer" (optional but helpful)
   - Tap "Allow"

## Step 2: Verify Connection

### Option A: Using Android Studio
1. Open Android Studio
2. Look at the bottom toolbar - you should see your device listed in the device dropdown
3. If you see it, you're ready!

### Option B: Using Command Line
```bash
# Check if device is detected
adb devices
```

You should see something like:
```
List of devices attached
ABC123XYZ    device
```

If you see "unauthorized", check your device screen for the USB debugging permission popup.

## Step 3: Run the App on Your Device

### From Android Studio:
1. Make sure your device is selected in the device dropdown (top toolbar)
2. Click the green "Run" button (or press Shift+F10)
3. The app will build and install on your device automatically

### From Command Line (Alternative):
```bash
cd /Users/sethsager/Projects/ZapCooking

# Build and install
npx cap run android
```

## Step 4: Troubleshooting

### Device Not Showing Up?

1. **Check USB Cable:**
   - Try a different USB cable
   - Some cables are charge-only (need data-capable cable)

2. **Check USB Mode on Device:**
   - When connected, check your device notification area
   - You might see "USB for file transfer" - tap it
   - Select "File Transfer" or "MTP" mode

3. **Install USB Drivers (if needed):**
   - Most devices work automatically on Mac
   - Some manufacturers (Samsung, etc.) may need drivers
   - Usually not needed for modern devices on Mac

4. **Restart ADB:**
   ```bash
   adb kill-server
   adb start-server
   adb devices
   ```

5. **Check Device Screen:**
   - Make sure the "Allow USB debugging" popup is accepted
   - Try unplugging and replugging the cable

### Still Not Working?

Try enabling these additional options in Developer Options:
- "Stay awake" (keeps screen on while charging - helpful for testing)
- "Verify apps over USB" (can disable if causing issues)

## Benefits of Testing on Real Device

✅ No emulator graphics errors  
✅ Better performance  
✅ Real network conditions  
✅ Actual touch interactions  
✅ Better battery/performance profiling  
✅ More realistic user experience  

## Notes

- First time connecting: You'll need to approve the USB debugging permission on your device
- "Always allow from this computer": Saves you from approving every time
- The app will be installed on your device like any other app
- To uninstall: Long-press app icon → Uninstall (or Settings → Apps)

