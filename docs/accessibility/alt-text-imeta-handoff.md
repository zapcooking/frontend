# Image Alt Text via NIP-92 `imeta` — Implementation Spec & Mobile Handoff

Status: shipped on web (this PR). Android/iOS parity is the goal of this document.

## 1. Wire format (the contract)

Alt text rides in a **NIP-92 `imeta` tag** on the event itself — kind-agnostic, so
the identical format applies to kind 1 notes, kind 1111 comments, kind 30023
recipes/articles, NIP-99 products, and anything else that carries images.

```json
{
  "tags": [
    ["imeta",
      "url https://host/ae8469….jpg",
      "m image/jpeg",
      "alt TV test pattern"
    ]
  ],
  "content": "test image with alt text\nhttps://host/ae8469….jpg"
}
```

Rules (all match how Amethyst/Quartz and Gossip already behave):

- One `imeta` tag **per image URL**; the tag's `url` slot must equal the image
  URL exactly as it appears in `content` (or the `image` tag on 30023) —
  clients match by exact string, no normalization.
- `alt <text>` is a single slot: the value may contain spaces but never
  newlines. Trim the value; omit the whole `alt` slot when empty; omit the
  entire `imeta` tag when there is no description (no empty metadata).
- Other imeta slots (`m`, `dim`, `blurhash`, `x`, `size`, `fallback`, …) are
  orthogonal — preserve them when re-writing tags, always keep `url` first.
- Key lookup: `url → alt` per event. Examples: Amethyst builds
  `tags.imetasByUrl()`; a minimal implementation is "for each `imeta` tag,
  split each subsequent slot on the first space".

### Real test vector

Published from Amethyst, live on relays (id `3957043a41de5c28…`), and locked
into `src/lib/feed/imeta.test.ts` as an interop regression test:

```json
{
  "content": "test image with alt text\nhttps://npub1sjvt6lzmhj66gc3tjc5l4g3uhxz5lhaf4tqe2c0n5m92a0amffxq7veejj.blossom.band/ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f.jpg",
  "tags": [
    ["imeta",
      "url https://npub1sjvt6lzmhj66gc3tjc5l4g3uhxz5lhaf4tqe2c0n5m92a0amffxq7veejj.blossom.band/ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f.jpg",
      "x ae8469…",
      "size 78925",
      "m image/jpeg",
      "dim 1080x2340",
      "blurhash [57nB:…",
      "ox ae8469…",
      "alt TV test pattern"
    ],
    ["client", "Amethyst"]
  ]
}
```

Expected: `alt == "TV test pattern"` for that URL.

## 2. Read path (display)

1. When rendering an event, build `altByUrl: Map<url, string>` from its imeta tags.
2. Attach it to the `<img>` as `alt` (screen readers announce it).
3. Show an **"ALT" badge** (small dark chip, bottom-left of the image) on every
   image that has alt text. Tapping it opens a dialog titled **"Description"**
   showing the text — alt must be inspectable by sighted users too, not only
   announced to assistive tech.
4. In the fullscreen image viewer, render the alt text as a caption bar pinned
   to the bottom of the pane.
5. Images without alt keep today's behavior (`alt=""`, generic "View image"
   label, no badge).
6. A11y detail: the badge is a sibling of the image tap target, never a nested
   button — two clean focus stops ("TV test pattern, image" / "View image
   description").

Web reference implementation: `src/lib/feed/imeta.ts` (`imetaAltByUrl`),
`MediaCarousel.svelte` (badge + dialog), `MediaLightbox.svelte` (caption).

## 3. Compose path (authoring)

- After upload/paste of an image, show a **"+ ALT"** chip on its thumbnail
  (top-left). Tap → editor modal: image preview, one-line explainer
  ("A short description makes your photo accessible to screen reader users —
  and gives everyone context if the image doesn't load."), a multiline field
  (2000-char cap, remaining count shown), Save.
- Saved alt flips the chip to **"✓ ALT"** (accent color); tapping again lets
  the user edit or clear it (clearing removes the imeta on publish).
- On publish, emit one `imeta` tag per described image (see §1). Do not block
  posting on alt text; do not emit tags for undescribed images.
- Persist alt in drafts alongside the image URLs (keyed by URL).

Surfaces covered on web: post composer (notes/polls), reply composer,
recipe create/fork/gated editors, longform cover image, marketplace product
form. Images added "by URL" get the same affordance as uploads.

## 4. AI generation (Cook+ premium)

- The alt editor has a **"Generate with AI"** action, badged **Cook+**.
- Endpoint: `POST /api/zappy/ask-photo` (existing Cheffy vision endpoint),
  NIP-98 auth with body-hash binding, membership-gated (fails closed) and
  rate-limited 8/hour + 30/day per pubkey.
- Body: `{ "image": "<base64, no data: prefix>", "purpose": "alt" }`.
  `purpose: "alt"` selects a neutral describer system instruction with **no
  food-only gate** (alt must describe any image — screenshots, people,
  places) and `temperature 0.4`; the member's question field is ignored in
  this mode.
- Response: `{ "ok": true, "output": "TV test pattern" }` — write it into the
  field as an editable draft, never publish it sight-unseen.
- Error codes to handle: `NOT_MEMBER` (403 → "Cook+ feature" upsell),
  `RATE_LIMITED` (429 → try-later copy), `IMAGE_UNREADABLE` (422),
  `SIGN_FAILED` (user rejected signing). Client fetch of the image URL needs
  CORS; hosts that block it fall back to manual entry.
- Mobile note: the base64 cap is ~14 MB on the wire (≈10 MB file); reuse the
  Cheffy photo pipeline's signing and error mapping.

Web reference: `src/routes/api/zappy/ask-photo/+server.ts` (`purpose`),
`src/lib/cheffyPrompt.server.ts` (`CHEFFY_ALT_TEXT_INSTRUCTION`),
`src/lib/photoAsk.ts` (`purpose` opt), `AltTextEditorModal.svelte`.

## 5. Mobile rollout checklist

- [ ] Parse imeta → url/alt map (kind-agnostic) + unit tests with the vector in §1
- [ ] Render alt on images; ALT badge + Description dialog; lightbox caption
- [ ] Composer: "+ ALT / ✓ ALT" chip flow, drafts persist alt, publish emits imeta
- [ ] Emit imeta on: notes, replies/comments, recipes, article covers, products
- [ ] AI "Generate with AI (Cook+)" in the editor against ask-photo `purpose: "alt"`
- [ ] Never merge imeta with content-URL fallbacks: if an event has any imeta
      tags, treat them as the authoritative media list (Damus/Amethyst/Jumble
      behavior — prevents double-render)
