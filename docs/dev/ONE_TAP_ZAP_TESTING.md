# One-Tap Zap Testing Guide

## Overview

One-tap zap allows users to instantly zap posts with a single click when they have an in-app wallet (Spark or NWC) connected and one-tap zaps enabled. The feature includes optimistic updates that show the zap amount immediately, then corrects when the real payment completes.

## How It Works

1. **User clicks zap icon** → Optimistic update immediately shows zap amount in the count
2. **Payment processes in background** → Zap invoice is created and payment is sent
3. **Real zap receipt arrives** → Subscription detects the zap and corrects the count (prevents double-counting)

## Prerequisites for Testing

### 1. Enable One-Tap Zap

1. Go to **Settings** (click your profile/avatar)
2. Navigate to the **Wallet** or **Zap Settings** section
3. Enable **"One-Tap Zap"** toggle
4. Set your preferred **One-Tap Zap Amount** (default is usually 21 sats)

### 2. Connect an In-App Wallet

You need either:
- **Spark Wallet** (Breez Spark) - Wallet kind 4
- **NWC Wallet** (Nostr Wallet Connect) - Wallet kind 3

**Note:** External wallets (WebLN, Bitcoin Connect) do NOT support one-tap zap. They will open the modal instead.

#### To Connect Spark:
1. Go to **Settings** → **Wallet**
2. Click **"Connect Spark Wallet"** or **"Set up Spark"**
3. Follow the setup process (may require API key)

#### To Connect NWC:
1. Go to **Settings** → **Wallet**
2. Click **"Connect NWC Wallet"**
3. Enter your NWC connection string (from your wallet app)

### 3. Ensure You Have Balance

Make sure your connected wallet has sufficient balance to send zaps.

## Testing on Desktop

### Step 1: Verify One-Tap Zap is Available

1. Open the app in your browser (desktop)
2. Navigate to any feed (Home, Explore, etc.)
3. Look at a post's zap icon (⚡)
4. **Hover over the zap icon** - the tooltip should show:
   - ✅ **"Zap X sats"** (where X is your one-tap amount) = One-tap is enabled
   - ❌ **"Send a zap"** = One-tap is NOT available (will open modal)

### Step 2: Test Optimistic Update

1. **Before clicking:** Note the current zap count and total amount
2. **Click the zap icon** (⚡) on any post
3. **Immediately observe:**
   - ✅ Zap count should increase by 1 **instantly**
   - ✅ Total amount should increase by your one-tap amount **instantly**
   - ✅ Zap icon should show a pulse animation (if `isZapping` state is active)
   - ✅ Button should be disabled during zap process

### Step 3: Verify Payment Completion

1. **Wait 2-5 seconds** for payment to complete
2. **Observe:**
   - ✅ Zap count should remain correct (not double-counted)
   - ✅ Total amount should show the accurate amount from the real zap receipt
   - ✅ If there was any rounding difference, it should be corrected
   - ✅ Zap icon should return to normal state (no pulse)

### Step 4: Test Multiple Zaps

1. Click zap icon on the same post multiple times
2. Each click should:
   - Show immediate optimistic update
   - Process payment in background
   - Correct to real amount when receipt arrives
   - Not cause double-counting

### Step 5: Test Error Handling

1. **Test with insufficient balance:**
   - Try to zap when wallet has 0 balance
   - Should show error and revert optimistic update
   - Should fall back to opening modal

2. **Test with network issues:**
   - Disconnect internet temporarily
   - Click zap icon
   - Should handle error gracefully

## Visual Indicators

### During Zap Process:
- ⚡ Icon has `animate-pulse` class
- Button has `opacity-50` and `cursor-wait` classes
- Button is `disabled`

### After Successful Zap:
- Icon returns to normal state
- Count shows accurate amount
- Icon weight changes to "fill" if you zapped

## Debugging

### Check Browser Console

Open browser DevTools (F12) and look for:
- `[OneTapZap]` logs - shows zap process steps
- `[Engagement]` logs - shows engagement updates
- Any error messages

### Common Issues

1. **One-tap not working:**
   - Check if one-tap is enabled in settings
   - Verify you have an in-app wallet (Spark/NWC)
   - Check console for errors

2. **Double-counting:**
   - Check if optimistic zap tracking is working
   - Verify `processZap` is matching optimistic zaps correctly
   - Check console for matching logic

3. **Optimistic update not showing:**
   - Verify `optimisticZapUpdate` is being called
   - Check if `eventId` and `userPublickey` are valid
   - Check engagement store updates

## Testing Checklist

- [ ] One-tap zap is enabled in settings
- [ ] In-app wallet (Spark or NWC) is connected
- [ ] Wallet has sufficient balance
- [ ] Zap icon tooltip shows "Zap X sats"
- [ ] Clicking zap icon immediately updates count
- [ ] Count updates before payment completes
- [ ] Real zap receipt corrects the count accurately
- [ ] No double-counting occurs
- [ ] Multiple zaps work correctly
- [ ] Error handling works (insufficient balance, network issues)
- [ ] Falls back to modal when one-tap unavailable

## Code Flow

1. **User clicks zap icon** → `handleZapIconClick()` in `NoteTotalZaps.svelte`
2. **Check if one-tap available** → `canOneTapZap()` returns true
3. **Send one-tap zap** → `sendOneTapZap()` in `oneTapZap.ts`
4. **Optimistic update** → `optimisticZapUpdate()` called immediately
5. **Payment process** → Invoice created, payment sent
6. **Real zap receipt** → Subscription receives zap receipt event
7. **Process zap** → `processZap()` matches optimistic zap and corrects amount
8. **UI updates** → Engagement store updates, UI reflects accurate count

## Notes

- Optimistic updates are tracked for 5 minutes
- Matching logic allows 10% amount difference or 1 sat for rounding
- If zap fails, optimistic update is reverted via refresh
- External wallets always open modal (no one-tap support)
