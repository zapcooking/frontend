# Sidebar Wallet — screenshot baselines

Visual baselines for the sidebar-wallet PR: the wallet balance card in the
sidebar (replacing the header pill, the panel/menu wallet links, and the
right-panel wallet entry), the collapsible My Kitchen group, the reduced
frosted user panel with its connection row, and the longform-aware profile
empty state. Captured against `pnpm dev` on 2026-10-05, **signed in with a
throwaway private-key session** (`nostrcooking_privateKey` +
`nostrcooking_loggedInPublicKey` + `nostrcooking_authMethod` in
localStorage) and **no wallets connected**, so the sidebar shows the
"Set up a Wallet" state.

| File | State captured | Viewport |
| --- | --- | --- |
| `feed-sidebar-collapsed.png` | `/feed` signed in: unlabeled Home group, My Kitchen collapsed, Wallet card in "Set up a Wallet" state, dotted separator starting at the Feed row | 1440×900 |
| `feed-sidebar-expanded.png` | Same, with the My Kitchen group expanded (My Kitchen, Nourish, Membership, Sponsors, The Pantry Relay, Gadgets) | 1440×900 |
| `wallet-setup-modal.png` | Wallet onboarding opened from the sidebar card — viewport-centered, with Breez Spark / NWC / Bitcoin Connect options | 1440×900 |
| `user-panel.png` | Right user panel after the dedupe: Profile only, frosted content-sized surface, theme toggle, Settings, connection row (green dot, "4 relays", hover names the signer), Log out | 1440×900 (cropped) |
| `profile-longform-empty-state.png` | Profile whose posts are all kind-30023 longform (Freedom.Tech): Posts tab empty state says so and offers "View their Reads" instead of "hasn't posted anything yet" | 1440×900 |
| `settings-lazarus-spec.png` | Settings → Data Recovery: "Uses the Lazarus spec 0.6.2-draft" disclosure right-aligned on the scan row | 1440×900 (cropped) |
| `mobile-drawer-expanded.png` | Mobile nav drawer: My Kitchen group expanded incl. The Pantry Relay, Wallet card beneath | 390×844 |

Not captured:

- A **connected** wallet (balance card with a live amount) — the throwaway
  session has no funded wallet; the wallet modal's onboarding view stands in.
  To capture it, connect any NWC wallet for the test session before opening
  the panel.
- The **Messages/Groups pane top alignment** — visible on those routes only;
  same 25px offset as the separator start.

## Regenerating

1. `pnpm dev` (or `npm run dev`)
2. In localStorage set `nostrcooking_privateKey` (any throwaway hex key),
   `nostrcooking_loggedInPublicKey` (its pubkey), `nostrcooking_authMethod`
   = `privateKey`, `nostrcooking_theme` = `dark`, and ensure
   `zapcooking_wallets` is absent for the "Set up a Wallet" state.
3. States in the table above; the connection row count reflects the relays
   NDK is connected to at the moment the panel opens.
