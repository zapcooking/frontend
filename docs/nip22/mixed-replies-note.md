# Nostr note — mixed replies justification (paste-ready)

Why zap.cooking now speaks both reply dialects

Nostr has two ways to answer a note. Kind 1 replies (NIP-10) put the thread root and the replied-to note in lowercase e tags — every descendant carries the root, so one #e filter fetches the whole thread. Kind 1111 comments (NIP-22) split the job: the root lives in an uppercase E, the immediate parent in a lowercase e.

That split has a quiet failure mode. Ask #e = root — the query that works perfectly for kind-1 threads — and you only ever see the top-level comments. Every comment-to-comment branch below the first reply is invisible, because those events carry their parent's id in e, not the root's. A thread looks fine until a Ditto or Sidecar user replies, and then half the conversation silently disappears.

The fix is to fetch with two sibling filters in one REQ (relays OR them): #e for the NIP-10 tree, #E for the comment tree. Never merged — inside a single filter the tags AND, and you're back to matching nothing new.

On the write side we made a deliberate policy call: reply in the format the thread already speaks. Answer a comment → kind 1111, copying its E/K/P root scope verbatim so every client can still thread it. Answer anything else → kind 1 with NIP-10 tags, because that's still what every client renders everywhere. And when a comment target carries no root scope at all, we fall back to kind 1 rather than publish an event nobody — including us — could place in a tree.

One tree, mixed kinds, each event grouped under its immediate parent. Comments count as replies toward the parent they actually answered (never the root), and notifications say "replied to your comment" instead of guessing.

Diagram below. Ported from our iOS client (PRs #161 + #145); conventions confirmed against Ditto's own client code; #E indexing verified on relay.azzamo.net, nostr.wine, nos.lol and relay.ditto.pub.

---

Character count: ~1,950 — fits comfortably in a kind 1 note. The first line works as the title clients show in collapsed previews; keep it as its own line.
