# Roadmap — native Blossom media

## Reading BUD-10 `blossom:` references — shipped

Notes can reference media content-addressed via BUD-10 — a
`blossom:<sha256>[.<ext>]?xs=<hint>&as=<author>&sz=<n>` URI that names no
http URL at all. All three clients now render these by resolving the URI
against its own `xs` server hints (then the reader's configured Blossom
servers) and fetching the blob from the first server that answers — the same
resolution amethyst uses:

- **Android** — zapcooking_android (Coil interceptor + resolver)
- **iOS** — zapcooking_ios (ContentParser + InlineMediaLoader resolution)
- **Web** — this repo (nostrRefScan + NoteContent/MediaCarousel resolution)

## Posting native `blossom:` references — deliberately not yet

We keep publishing media as plain https URLs. Switching uploads to publish
`blossom:` URIs is on the roadmap, gated on one condition: **enough other
clients must render them on read first.** A note whose image most clients
can't see is a broken note for most of the audience, so the bar is broad
ecosystem read support, not just ours.

Revisit when clients like amethyst, Damus, Primal, Snort, and Iris render
`blossom:` URIs on read. At that point publishing native URIs makes media
server-independent: any Blossom host holding the blob serves it, and no
single CDN URL becomes a permanent dependency baked into old notes.
