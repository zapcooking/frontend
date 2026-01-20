# NIP-108 Lightning Gated Recipes Implementation

## Overview

This document describes the implementation of NIP-108 (Lightning Gated Notes) as a Pro Kitchen feature for ZapCooking. This allows Pro Kitchen members to create recipes that require a Lightning payment to view.

## Architecture

### Components

1. **Encryption Utilities** (`src/lib/nip108/encryption.ts`)
   - AES-256-CBC encryption/decryption using `@noble/ciphers`
   - Secret key generation
   - Hex encoding/decoding utilities

2. **Client Utilities** (`src/lib/nip108/client.ts`)
   - `createGatedRecipe()` - Creates gated recipe (kind 55) and announcement (kind 54)
   - `checkIfGated()` - Detects if a recipe is gated
   - `checkAccess()` - Checks if user has access (kind 56 key note)
   - `requestPayment()` - Requests payment invoice from endpoint
   - `fetchSecret()` - Fetches secret after payment
   - `createKeyNote()` - Creates key note (kind 56) for permanent access

3. **Server Endpoints**
   - `/api/nip108/payment` - Payment request and secret distribution
   - `/api/nip108/create-invoice` - Creates Lightning invoice
   - `/api/nip108/store-secret` - Stores secret when creating gated recipe

4. **UI Components**
   - `/create/gated` - Separate page for creating premium/gated recipes (Pro Kitchen only)
   - `GateRecipeToggle.svelte` - Toggle for gating recipes during creation
   - `GatedRecipePayment.svelte` - Payment UI for purchasing gated recipes
   - Updated `Recipe.svelte` - Detects and handles gated recipes

## Flow

### Creating a Gated Recipe

1. User (Pro Kitchen member) navigates to `/create/gated` (separate page from regular recipe creation)
2. User creates recipe with all standard fields
3. User sets cost (in mSats) and optional preview text (gating is always enabled on this page)
4. On publish:
   - Recipe is encrypted with random secret key
   - Kind 55 (Gated Note) is created with encrypted content
   - Kind 54 (Announcement Note) is created with preview
   - Secret is stored on server for payment distribution
   - Recipe is linked to gated note via 'g' tag

### Viewing a Gated Recipe

1. User views recipe page
2. System checks if recipe is gated
3. If gated:
   - Check if user has access (kind 56 key note exists)
   - If no access, show payment UI
   - User pays Lightning invoice
   - Secret is fetched from server
   - Kind 56 key note is created for permanent access
   - Recipe is decrypted and displayed

## NIP-108 Event Kinds

### Kind 55: Gated Note
- Contains encrypted recipe content
- Tags: `cost`, `endpoint`, `t`, `g`
- Content: JSON with `iv` and `content` (both hex-encoded)

### Kind 54: Announcement Note
- Preview/announcement of gated content
- Tags: `g` (references kind 55), `cost`, `endpoint`, recipe metadata
- Content: Preview text

### Kind 56: Key Note
- NIP-04 encrypted secret for specific user
- Tags: `g` (references kind 55)
- Content: NIP-04 encrypted secret (hex-encoded)

## Security Considerations

1. **Secret Storage**: Currently in-memory (Map). In production:
   - Store encrypted in database
   - Use secure key management
   - Consider time-limited access

2. **Payment Verification**: Currently accepts preimage. In production:
   - Verify payment with Lightning node
   - Check invoice status
   - Prevent double-spending

3. **Access Control**: Key notes (kind 56) are user-specific and encrypted with NIP-04

## Pro Kitchen Membership

- Only Pro Kitchen members can create gated recipes
- Checked via `membershipStore.getActiveTier()` === 'pro'
- Non-Pro users see upgrade prompt

## Future Improvements

1. **Real Lightning Integration**
   - Replace mock invoices with real Lightning provider (LNbits, BTCPay, etc.)
   - Implement payment webhooks
   - Add payment verification

2. **Database Storage**
   - Store secrets securely in database
   - Track payment history
   - Analytics for gated recipes

3. **Enhanced Features**
   - Time-limited access
   - Subscription-based access
   - Free previews
   - Discount codes

4. **UI/UX**
   - Better payment flow
   - Payment status indicators
   - Access history
   - Revenue dashboard for creators

## Testing

To test the implementation:

1. **Create Gated Recipe**:
   - Log in as Pro Kitchen member
   - Navigate to `/create/gated`
   - Create recipe with all fields
   - Set cost (e.g., 1000 mSats)
   - Set optional preview text
   - Publish

2. **View Gated Recipe**:
   - Log in as different user (or logout)
   - View the gated recipe
   - Should see payment UI
   - Pay invoice
   - Recipe should unlock

3. **Verify Access**:
   - Refresh page
   - Recipe should remain unlocked (key note exists)

## References

- [NIP-108 Specification](https://github.com/fanfares/NIP-108)
- [NIP-04: Encrypted Direct Messages](https://github.com/nostr-protocol/nips/blob/master/04.md)
