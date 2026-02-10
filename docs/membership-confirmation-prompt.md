# Membership Confirmation Page — Implementation Prompt

## Overview

Build a membership confirmation page that displays after successful payment for any of our three membership tiers. The page celebrates the purchase, shows membership details, and guides the user to claim a custom NIP-05 username (`username@zap.cooking`). This page must work for all three tiers: **Genesis Founder**, **Cook+**, and **Pro Kitchen**.

## Design System

### Brand Colors (constant across all tiers)

```
Orange (primary brand):     #E8652B
Orange light:               #F28C5A
Orange dark:                #C4501E
Orange glow:                rgba(232, 101, 43, 0.3)
Orange gradient:            linear-gradient(135deg, #F28C5A 0%, #E8652B 50%, #C4501E 100%)

Success green:              #22C55E
Success green glow:         rgba(34, 197, 94, 0.3)
Success gradient:           linear-gradient(135deg, #34D399 0%, #22C55E 50%, #16A34A 100%)

Background:                 #0F1219
Card background:            rgba(255,255,255,0.03)
Card border:                rgba(255,255,255,0.06)
```

### Color Usage Rules

- **Orange** is the brand color. It owns: the welcome heading, background glow, input focus states, CTA buttons, membership expiration date, and the "Start Cooking" button on the success state.
- **Green** is semantic for success/verified only. It appears on: the NIP-05 verified checkmark, the "membership active" status dot, and the entire confirmed/success state card after username claim.
- **Tier accent colors** are used sparingly — only for the tier badge icon border/glow and the perk list checkmarks. They should NOT override the orange brand.

### Tier Configuration

```js
genesis: {
  name: "Genesis Founder",
  tagline: "You're part of the beginning.",
  accent: "#F59E0B",        // amber/gold
  accentGlow: "rgba(245, 158, 11, 0.25)",
  badgeIcon: "⚡",
  perks: ["Private relay access", "NIP-05 verified identity", "Founder badge on profile", "Priority support"]
}

cook_plus: {
  name: "Cook+",
  tagline: "Your kitchen just leveled up.",
  accent: "#10B981",        // green
  accentGlow: "rgba(16, 185, 129, 0.25)",
  badgeIcon: "🍳",
  perks: ["Private relay access", "NIP-05 verified identity", "Sous Chef AI assistant", "Ad-free experience"]
}

pro_kitchen: {
  name: "Pro Kitchen",
  tagline: "Welcome to the professional tier.",
  accent: "#8B5CF6",        // purple
  accentGlow: "rgba(139, 92, 246, 0.25)",
  badgeIcon: "👨‍🍳",
  perks: ["Private relay access", "NIP-05 verified identity", "Full AI suite access", "Priority recipe promotion"]
}
```

## Page Layout (top to bottom)

1. **Background**: Subtle confetti animation (mostly warm orange tones with a few accent colors). Radial orange glow behind the content area, blurred.

2. **Tier badge**: The tier's emoji icon inside a rounded square with a subtle tier-accent-colored border and glow. Centered.

3. **Welcome heading**: "Welcome to {tier name}!" in a serif font with the orange brand gradient applied as text fill. Large, celebratory.

4. **Tagline**: Tier-specific subtitle in muted white. Centered below heading.

5. **Membership status bar**: Card with a green status dot + "Membership active" on the left, and "until {expiration date}" in orange on the right.

6. **Perks list**: Card with "WHAT'S INCLUDED" label. Each perk has a small checkmark square using the tier's accent color. Perks animate in with a staggered slide-in on page load.

7. **Username claim section** (the main interaction — see below)

## Username Claim UX (critical section)

This is the most important part of the page. The goal is to motivate users to choose a custom username rather than defaulting to their pubkey prefix.

### Layout

- **Live preview pill** at top: Shows a rounded pill with a checkmark circle + `{username}@zap.cooking` that updates in real time as the user types. When no username is entered, it shows the pubkey prefix in muted text with a gray checkmark. When a username is entered, the text brightens to white, the checkmark turns green with a glow, and the pill subtly scales up.

- **Heading**: "Claim your identity"

- **Subtext**: "Choose a username for your verified Nostr address. This is how other clients will verify you."

- **Input field**: Monospace font. Shows the typed username on the left, `@zap.cooking` suffix in muted text on the right (not editable). Input validation: lowercase alphanumeric, hyphens, underscores only. On focus, the input border turns orange with a glow.

- **Primary CTA button**:
  - **Empty state**: Muted/disabled appearance, reads "Type a username above"
  - **With username**: Lights up with orange brand gradient + glow, reads "Claim {username}@zap.cooking"

- **Skip button**: Visually de-emphasized below the CTA. Reads "Skip — use {pubkeyPrefix}@zap.cooking instead". Should feel like a last resort, not an equal option.

### The card border should glow orange when a username has been entered, reinforcing that they're about to do something.

## Success State (after claiming)

When the user confirms their username (or skips), replace the username claim section with a success card:

- Green-tinted card background and border
- Green checkmark circle with glow
- "You're all set!" heading
- The claimed `username@zap.cooking` in green monospace
- "Your verified identity has been added to your profile. Other Nostr clients can now verify you."
- "Start Cooking →" button in orange brand gradient

## Animations

- Page content fades in and slides up on load (0.8s ease)
- Perks list items stagger in from left with 100ms delays
- Confetti canvas runs continuously in background
- All color/border/shadow transitions should be ~0.3-0.4s ease

## Fonts

- Heading (Welcome to...): Serif — Playfair Display 700
- Section headings (Claim your identity, You're all set): Outfit 600
- Body text: DM Sans 400/500/600
- Monospace (username, NIP-05): JetBrains Mono 400/500

## Dynamic Data

The component needs to receive or determine:
- `tier` — which tier was purchased ("genesis" | "cook_plus" | "pro_kitchen")
- `expirationDate` — membership expiration date string
- `pubkeyPrefix` — first 8 chars of user's pubkey hex (fallback NIP-05 username)

## Integration Notes

- On username claim confirmation, call the NIP-05 registration endpoint to register `username@zap.cooking` for this user's pubkey
- On skip, register `{pubkeyPrefix}@zap.cooking` as the default
- The "Start Cooking →" button should navigate to the main app/feed
- Ensure the page works as a post-payment redirect — it should be reachable after Lightning payment confirmation
- Mobile responsive: max-width 480px content area, uses clamp() for heading font sizes, cards should have comfortable padding on small screens

## Reference Implementation

See the attached `membership-confirmation.jsx` React component for a complete working reference of the design, interactions, and color system. Adapt it to fit the existing project structure, routing, and API integration patterns.
