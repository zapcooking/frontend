# Building a Release APK

## Prerequisites

Before building a release APK, you need to set up a signing key:

### Step 1: Generate a Signing Key (First Time Only)

```bash
cd android/app
keytool -genkey -v -keystore zapcooking-release.keystore -alias zapcooking -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted for:
- Password (remember this!)
- Your name, organization, etc.
- Confirm the information

**Important:** 
- Store the keystore file securely (don't commit it to git!)
- Remember your password and alias name
- You'll need this for all future releases

### Step 2: Create Signing Configuration

Create `android/key.properties`:

```properties
storePassword=YOUR_KEYSTORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=zapcooking
storeFile=zapcooking-release.keystore
```

**Important:** Add `android/key.properties` and `*.keystore` to `.gitignore`!

### Step 3: Update build.gradle

The `android/app/build.gradle` file should already have signing config setup. If not, you'll need to add it.

## Building the Release APK

### Option 1: Using Android Studio (Easiest)

1. **Open Android Studio:**
   ```bash
   cd /Users/sethsager/Projects/ZapCooking
   npx cap open android
   ```

2. **Build → Generate Signed Bundle / APK**

3. **Select "APK"** (or "Android App Bundle" for Play Store)

4. **Select your keystore:**
   - Keystore: `android/app/zapcooking-release.keystore`
   - Key alias: `zapcooking`
   - Enter passwords

5. **Select "release" build variant**

6. **Finish** - APK will be generated at:
   ```
   android/app/release/app-release.apk
   ```

### Option 2: Using Command Line

```bash
cd /Users/sethsager/Projects/ZapCooking/android

# Build release APK
./gradlew assembleRelease

# APK will be at:
# app/build/outputs/apk/release/app-release.apk
```

## Building Android App Bundle (for Play Store)

If you're publishing to Google Play Store, use App Bundle instead:

### In Android Studio:
1. Build → Generate Signed Bundle / APK
2. Select "Android App Bundle"
3. Follow the same signing steps

### Command Line:
```bash
cd android
./gradlew bundleRelease

# Bundle will be at:
# app/build/outputs/bundle/release/app-release.aab
```

## Testing the Release APK

Before distributing:

1. **Install on device:**
   ```bash
   adb install android/app/build/outputs/apk/release/app-release.apk
   ```

2. **Test thoroughly:**
   - All features work
   - WebSocket connections
   - Authentication
   - Navigation

## Version Management

Before building a release, update version in:

1. **package.json:**
   ```json
   "version": "3.0.0"
   ```

2. **android/app/build.gradle:**
   ```gradle
   versionCode 1
   versionName "3.0.0"
   ```

3. **Rebuild:**
   ```bash
   npm run build:mobile
   npx cap sync
   ```

## Distribution

### Google Play Store:
- Use `.aab` (Android App Bundle) file
- Upload via Google Play Console

### Direct Distribution:
- Use `.apk` file
- Can be shared directly or hosted for download
- Users may need to enable "Install from unknown sources"

## Security Notes

- ⚠️ **Never commit** your keystore file or key.properties to git
- ⚠️ **Backup your keystore** - you can't update your app without it
- ⚠️ Store keystore securely (password manager, secure storage)

## Quick Checklist

- [ ] Keystore generated and stored securely
- [ ] key.properties created (not committed to git)
- [ ] Version numbers updated
- [ ] Code built with `npm run build:mobile`
- [ ] Synced with `npx cap sync`
- [ ] Release APK/Bundle built
- [ ] Tested on real device
- [ ] Ready to distribute!

