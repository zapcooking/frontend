# nspam Spam Filter

## Overview

nspam is a reply-spam classifier ([barrydeen/nspam](https://huggingface.co/barrydeen/nspam),
MIT): 500 LightGBM trees plus an isotonic calibration table that score a bundle of 1–10
replies **from one author** as human or reply-spam bot, from the replies' words and shape —
links, mentions, tags, emoji, capitals, and how alike the replies are to each other. It reads
no profile and no follow graph: the follow list knows your circle and nothing about a
stranger; nspam knows nothing about your circle and something about the stranger.

This is Sidecar's (local repo) method, applied as **hiding**: an author whose newest scorable
replies the model scores `>= 0.9` is a known spammer, and their replies and notifications are
hidden until the verdict changes. Sidecar marks and re-sorts instead of hiding; zap.cooking
has no out-of-network group to sort into, so the verdict hides directly. The calibration is
nearly a step function, so almost every score is 0 or 1.

## Fail-open guarantees

Nothing is hidden unless every gate opens:

- **No model, no hiding.** The model (`static/models/nspam.bin`, fetched lazily from
  `/models/nspam.bin`) loads in the background after the first notification subscription. A
  failed fetch costs the feature, never a reply.
- **Only what the model was trained on is judged.** `scorable()` (ported from Sidecar) only
  scores kind-1 replies that carry an `e` tag and are at least half Latin script (links and
  nostr: references don't count as Latin; a reply that is nothing but a picture link is read
  whole). Reactions, zaps, mentions without an `e` tag, and non-Latin text leave their author
  unscored — the model was trained on (mostly English) kind-1 replies and is weak on anything
  else.
- **Your circle is never hidden.** Anyone in your kind-3 follow list is exempt from hiding,
  whatever they score. Until the follow list has been read, no one is a stranger yet.
- **Your own replies are never judged** (`userPublickey` is excluded), so the model can't
  hide you from your own threads.
- **Hiding is reactive, not destructive.** Raw notifications stay in `notifications` and raw
  replies stay in the subscription's event store; a re-verdict (or an unfollow) brings rows
  back without a refetch.

## Where verdicts are applied

| Surface | File | Mechanism |
|---|---|---|
| Notifications (bell, panel, page) | `src/lib/notificationStore.ts` | `visibleNotifications` filters `nspamHiddenAuthors`; `unreadCount` inherits it |
| Native push notifications | `src/lib/notificationStore.ts` | `sendLocalNotificationForNostrEvent` checks the verdict before buzzing |
| Thread replies | `src/routes/[nip19]/+page.svelte` | `visibleReplies` drops judged spammers |
| Comment subscriptions (feed cards, recipe comments) | `src/lib/comments/subscription.ts` | `events` derived store drops judged spammers (always on; mutes stay opt-in per surface) |

Judging happens where raw events already arrive: the notification subscription's
`handleEvent`, the comment subscription's batch flush, and the thread page's `replies`
array — all funnel into `judgeReplies()`, which keeps per-author bundles (newest 10
scorable replies, the model's training shape) and re-scores on each change.

## Module layout

- `src/lib/nspam/nspam.ts` — the scorer: a port of Sidecar's `nspam.js` (itself bit-exact
  against the training pipeline's Go port in nspam-strfry). MurmurHash3 feature hashing,
  Python-compatible casefolding and whitespace classes, tree walk, isotonic calibration.
- `src/lib/nspam/spamFilter.ts` — the judge: model warm-up, per-author bundles, the
  `nspamSpammers` / `nspamHiddenAuthors` stores (SPAM_THRESHOLD = 0.9, sidecar's
  NSPAM_LABEL).
- `src/test/fixtures/nspam/` — the model's own reference cases: 10 hashing fixtures and 50
  real reply bundles with the scores the trained pipeline gave them.
- `static/models/nspam.bin` — the model, repacked from the published `model.txt` +
  `calibration.npz` by Sidecar's `scripts/build-nspam-model.py`.

## Data provenance and integrity

| File | Source | License | SHA-256 |
|---|---|---|---|
| `static/models/nspam.bin` | `barrydeen/nspam` v2.4, `model.txt` + `calibration.npz` (repacked) | MIT | `67e3f69c5bcde9e5ec14d68382665aa3f5d72b6deed8d9235dd2d110e7b642c8` |

`nspam.test.ts` checks the bundled file byte-for-byte against the SHA above and runs the
reference cases through the scorer — a port that drifts anywhere, in a regex's idea of a
space or a tree's comparison, moves a score there and fails the suite.

## Testing

- `src/lib/nspam/nspam.test.ts` — model parity (hashing fixtures, 50 bundle scores to 1e-9,
  scorable gating, bundle cap, model-file validation, SHA pin).
- `src/lib/nspam/spamFilter.test.ts` — judge behavior: fail-open without a model, bot/person
  verdicts against reference fixtures, follow-list gate, own-reply exemption, newest-10
  window, comment-subscription hiding.
- `src/lib/notificationStore.nspam.test.ts` — end-to-end: a judged spammer's notifications
  are kept in the store but never shown; unread count drops with them.
