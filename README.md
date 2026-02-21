# Zap Cooking

Food is culture. Food is community.

Zap Cooking is a Nostr-native cooking and food culture platform built around discovery, creativity, and value-for-value. It is not just a recipe app. It is a place where people share food, ideas, and inspiration without algorithms, ads, or extraction.

Built on open protocols. Powered by Nostr. Fueled by people who love to cook.

Check it out at [zap.cooking](https://zap.cooking)

---

## What Zap Cooking Is

Zap Cooking is a decentralized recipe and food culture app where:

- Recipes are shared as Nostr events
- Identity is your Nostr key, not an account
- Value flows peer-to-peer through Lightning zaps
- Discovery comes from people, not algorithms
- Creativity compounds through community feedback

If you believe food connects people and culture matters more than clicks, you're in the right place.

---

## Core Principles

- **Nostr-native** — Built directly on the Nostr protocol. No walled gardens.
- **Value for Value** — Support creators with Lightning zaps. No ads. No paywalls.
- **Human Discovery** — Explore recipes, cooks, and ideas organically.
- **Open and Experimental** — This project evolves in public and improves through iteration.

---

## Features

### Recipes & Content

- **Recipe Publishing** — Create and share recipes with markdown, images, tags, servings, prep/cook times.
- **Gated Recipes** — Publish premium recipes available only to members.
- **Recipe Extraction** — Import recipes from URLs or paste raw content.
- **Longform Articles** — Write and read food articles and stories (NIP-23 kind 30023) with a full editor and draft system.
- **Food Culture Feed** — Post updates, thoughts, and food stories to a social feed with global, following, and community tabs.

### Discovery

- **Explore Page** — Curated collections, popular cooks, trending tags, recent recipes, and longform food articles.
- **Mesh Visualization** — Interactive D3 force-directed network graph showing recipes, connections, and engagement relationships.
- **Tag Browsing** — Browse recipes by category with trending tag discovery.
- **Creator Profiles** — Follow cooks, explore their recipes and articles, and view profile badges.

### Community & Messaging

- **Direct Messages** — Encrypted private messaging (NIP-17) between users.
- **Group Chat** — NIP-29 relay-based group conversations hosted on the Pantry relay (`wss://pantry.zap.cooking`). Create groups, manage members, share images.
- **Comments & Reactions** — Comment on recipes and react with emoji reactions.
- **Notifications** — Activity notifications with pull-to-refresh.

### Organization

- **Cookbooks** — Personal recipe collections you can create, edit, and share.
- **Recipe Lists** — Curated lists of recipes (kind 30001).
- **Bookmarks** — Save recipes and articles for later.
- **Shopping Lists** — Manage grocery lists for meal planning.
- **Drafts** — Save and manage unpublished article drafts with word count and reading time.

### Payments & Wallet

- **Lightning Zaps** — Support creators directly using Bitcoin Lightning with one-tap zap support.
- **Integrated Wallet** — Built-in wallet supporting NWC (Nostr Wallet Connect), Spark (Breez SDK), Bitcoin Connect, and WebLN.
- **On-Chain Bitcoin** — Receive Bitcoin directly to on-chain addresses with deposit claiming.
- **Branta Guardrail** — Payment address verification so users can confirm they're paying the right recipient.

### Membership

- **Tiered Membership** — Cook, Cook+, Pro Kitchen, and Genesis Founders tiers.
- **Member Benefits** — Access to gated recipes, group chat, marketplace, AI assistant, and community features.
- **Invite Tree** — Visual referral and membership tree.

### Marketplace

- **P2P Marketplace** — Browse and list ingredients, kitchen tools, knowledge, and merch.
- **Seller Dashboard** — Manage your marketplace products.

### Kitchen Tools

- **Zappy AI** — AI assistant for recipe ideas and cooking help (membership feature).
- **Cooking Timer** — Integrated timer widget accessible from the header.
- **Unit Converter** — Convert between cooking measurement units.

### Settings & Personalization

- **Theming** — Light, dark, and system-preference modes.
- **Relay Management** — Configure and monitor Nostr relay connections.
- **Currency Display** — Choose your preferred currency.
- **One-Tap Zap** — Customize default zap amounts.

---

## Tech Stack

- **Frontend:** SvelteKit (Svelte 4)
- **Protocol:** Nostr (NDK, nostr-tools)
- **Hosting:** Cloudflare Pages
- **Auth:** NIP-07 (browser extensions), NIP-46 (Nostr Connect), nsec, key generation
- **Payments:** Bitcoin Lightning (zaps), On-chain Bitcoin
- **Wallet:** NWC, Spark (Breez SDK), Bitcoin Connect, WebLN
- **Verification:** Branta Guardrail
- **Visualization:** D3.js (Mesh network graph)

---

## App Structure

```
src/
  routes/                    # SvelteKit page routes
    (auth)/login/            # Authentication (NIP-07, NIP-46, nsec)
    (auth)/onboarding/       # New user setup wizard
    explore/                 # Discovery hub
    recent/                  # Latest recipes
    recipe/[slug]/           # Individual recipe view
    r/[naddr]/               # Recipe view (NIP-19 address)
    tag/[slug]/              # Tag-based browsing
    create/                  # Recipe editor
    create/gated/            # Gated recipe editor
    extract/                 # Recipe import tool
    reads/                   # Longform articles feed
    reads/[naddr]/           # Individual article
    drafts/                  # Article draft management
    feed-post/               # Food culture post composer
    community/               # Community feed
    kitchen/                 # Kitchen relay feed
    mesh/                    # Network visualization
    cookbook/                 # Recipe collections
    bookmarks/               # Saved content
    grocery/                 # Shopping lists
    messages/                # Direct messages (NIP-17)
    groups/                  # Group chat (NIP-29)
    user/[slug]/             # Creator profiles
    wallet/                  # Wallet management
    membership/              # Membership tiers & checkout
    marketplace/             # P2P marketplace
    my-store/                # Seller dashboard
    garden/                  # Invite tree
    pantry/                  # Community features
    zappy/                   # AI assistant
    settings/                # App settings
    notifications/           # Activity feed
    [nip19]/                 # Universal NIP-19 handler
    s/[code]/                # Shortlinks

  lib/                       # Shared utilities and modules
    stores/                  # Svelte writable stores (messages, groups, etc.)
    components/              # Shared components
      messages/              # DM UI (ConversationList, MessageThread, etc.)
      groups/                # Group chat UI (GroupList, GroupThread, etc.)
    wallet/                  # Wallet integrations (NWC, Bitcoin Connect, WebLN)
    spark/                   # Breez SDK / Spark wallet
    mesh/                    # D3 network graph utilities
    marketplace/             # Marketplace types and operations
    relays/                  # Relay configuration and sets
    perf/                    # Performance monitoring
    types/                   # TypeScript interfaces
    nostr.ts                 # NDK initialization, relay management
    nip17.ts                 # Direct messaging protocol
    nip29.ts                 # Group chat protocol
    authManager.ts           # Authentication management
    encryptionService.ts     # Message encryption
    themeStore.ts            # Light/dark/system theming
    profileResolver.ts       # Profile resolution with caching
    profileSearchService.ts  # User search (Primal API + NDK)
    followListCache.ts       # Contacts list caching
    mentionComposer.ts       # @mention autocomplete controller
    parser.ts                # Markdown template parsing
    consts.ts                # Recipe tags and constants

  components/                # Page-level components
    Recipe/                  # Recipe display components
    mesh/                    # Mesh visualization (canvas, nodes, controls)
    marketplace/             # Product cards and filters
    reads/                   # Article cards and feeds
    grocery/                 # Shopping list components
    Reactions/               # Emoji reactions
    icons/                   # Branded icons
```

---

## Nostr Event Kinds Used

| Kind | Description |
|------|-------------|
| 0 | User metadata (profiles) |
| 1 | Short text notes (food feed posts) |
| 3 | Contact lists (follows) |
| 7 | Reactions |
| 9735 | Zap receipts |
| 9802 | Recipe highlights |
| 10009 | Group list |
| 30001 | Recipe lists |
| 30023 | Longform articles |
| 30023 | Recipes (with structured tags) |
| 39000-39003 | NIP-29 group metadata |
| 9000-9022 | NIP-29 group moderation |
| NIP-17 | Direct messages (encrypted) |

---

## Contributing

Everyone is welcome to contribute.

Note: The tag list is [here](https://github.com/github-tijlxyz/nostr.cooking/blob/main/src/lib/consts.ts#L22), please add useful tags to this list so they work with autocompletion.

---

## License

This project is open source. See the repository for license details.
