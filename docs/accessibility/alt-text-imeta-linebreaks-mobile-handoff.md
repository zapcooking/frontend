# Imeta Alt-Text Line Breaks — Mobile Parity Spec

Status: shipped on web (PR fixes line breaks being destroyed at publish).
This document is the implementation contract for the Android and iOS apps.

Companion reading: `docs/accessibility/alt-text-imeta-handoff.md` (the
overall NIP-92 alt-text feature; §1 wire format updated by this fix).

## 1. The bug this fixes

The alt editor is multiline, but the publish path flattened every line
break in the `alt` value to a space:

```
authored:  "A screenshot of a Nostr post.\n\nBelow it, a quoted post."
published: "alt A screenshot of a Nostr post. Below it, a quoted post."
```

Multi-paragraph descriptions — the kind screen-reader users write for
screenshots and multi-panel images — were silently destroyed for every
reader. Mobile must not repeat this.

## 2. Wire contract (normative)

Alt text lives in a NIP-92 `imeta` tag, one tag per image URL. Each tag
element is a single string: `"key value"`, where **the value is everything
after the first space**. Line breaks are allowed in the value and ride as
real `\n` characters inside the tag string — JSON escapes them on the wire,
relays store them verbatim, and event ids/signatures are unaffected.

Example (built with the web implementation and parsed back
byte-identical):

```json
[
  "imeta",
  "url https://i.nostr.build/eS5EHNjnkLY9cJ4iQ47pOO.png",
  "alt A screenshot of a Nostr post about web accessibility.\n\nBelow it, a quoted post from @BlindBitcoiner: \"Hello world this is a test post. I'm totally blind and trying Damus to see if blind users can use this Nostr client.\""
]
```

Rules:

1. **MUST preserve** single line breaks in `alt` when publishing. Never
   replace `\n` with a space.
2. **MUST cap** runs of line breaks: 3+ consecutive `\n` collapse to
   exactly `\n\n` (one blank line = one paragraph gap). Apply at publish
   AND at render, so alt text received from other clients can't balloon
   the layout.
3. **MUST normalize** CRLF/CR to LF before any other handling.
4. **MUST trim** each line's surrounding whitespace and the value's ends.
5. Everything else from the main handoff doc is unchanged: trim the value,
   omit the whole `alt` slot when empty, omit the whole `imeta` tag when
   there is no description.

## 3. Reference normalization (port this)

Web reference: `src/lib/feed/imeta.ts` → `normalizeAltBreaks`:

```ts
export function normalizeAltBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')        // CRLF/CR → LF
    .split('\n')
    .map((line) => line.trim())     // trim each line
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')     // cap blank-line runs at one
    .trim();
}
```

Kotlin sketch:

```kotlin
fun normalizeAltBreaks(text: String): String =
  text.replace("\r\n", "\n").replace('\r', '\n')
    .split('\n').joinToString("\n") { it.trim() }
    .replace(Regex("\n{3,}"), "\n\n")
    .trim()
```

Swift sketch:

```swift
func normalizeAltBreaks(_ text: String) -> String {
  var t = text.replacingOccurrences(of: "\r\n", with: "\n")
    .replacingOccurrences(of: "\r", with: "\n")
  t = t.components(separatedBy: "\n")
    .map { $0.trimmingCharacters(in: .whitespaces) }
    .joined(separator: "\n")
  while t.contains("\n\n\n") { t = t.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
  return t.trimmingCharacters(in: .whitespacesAndNewlines)
}
```

Apply it:
- on **publish** (build or rewrite an imeta `alt` slot), and
- on **read** (when extracting alt for display or handing it to an editor).

## 4. Parsing requirements

When parsing imeta slots, split each element on the **first space only** —
key = prefix, value = everything after, then trim the ends only. Interior
`\n` characters belong to the value and MUST survive. A parser that splits
on any whitespace will truncate multi-line alt at the first break — that
is the bug shape to avoid.

```
slot: "alt First paragraph\n\nSecond paragraph"
key:   "alt"
value: "First paragraph\n\nSecond paragraph"
```

## 5. Display requirements

- Render line breaks as visible breaks (Android `TextView` and iOS
  `UILabel`/`UITextView` show `\n` natively — do not collapse or strip
  them; don't use single-line modes that strip breaks).
- Apply the §2 cap at render time too, so third-party alt with 10
  consecutive breaks renders at most one blank line.
- Surfaces: `img alt` equivalent (accessibility announcement), the ALT
  badge → Description dialog, and the fullscreen viewer caption.
- Where the description area has a max height (captions), scroll rather
  than truncate mid-paragraph.

## 6. Authoring requirements

- The alt editor stays multiline. Do not block or warn on line breaks.
- Apply the §2 cap when saving/publishing (not necessarily on every
  keystroke).
- Round-trip rule: when carrying a received alt text back into an editor
  (edit/fork flows), preserve its line breaks; when re-emitting, cap per
  §2. Never re-flatten.

## 7. Test vectors (lock these in)

| input (`alt` value)          | expected published/displayed value |
|------------------------------|-------------------------------------|
| `two\nlines`                 | `two\nlines` (unchanged)            |
| `a\n\n\n\n\nb`               | `a\n\nb`                            |
| `a\r\nb`                     | `a\nb`                              |
| `First paragraph\n\nSecond paragraph` | identical after a full JSON serialize → relay → parse round trip |
| `"   "` (whitespace only)    | omit the whole `alt` slot           |

Also keep the existing interop vector (Amethyst note, alt
`"TV test pattern"`) passing unchanged — no newlines there.

## 8. Interop notes

- NIP-92 defines no newline or escaping convention. Raw `\n` in the tag
  string is the no-invention option: any JSON-based client receives it
  intact in the tag array.
- Clients that split slots on the first space (web Zap Cooking; the
  convention described in the main handoff doc) show the full
  multi-paragraph text.
- Clients that split on any whitespace show only the first line — a
  degraded but valid description, and the accepted trade-off vs. losing
  authoring structure for everyone.
- Do NOT invent an escape scheme (e.g. literal backslash-`n`): clients
  without the matching decoder would render the escape characters as
  visible text.
