#!/usr/bin/env python3
"""Canonical emoji catalog generator for Zap Cooking (iOS / Android / web).

One source of truth: Unicode's RGI emoji set (emoji-test.txt, version pinned
below). The quick-reaction defaults and the emoji library must be identical
across the three clients (parity requirement) — regenerate all outputs with
this one script and land them in the same parity pass:

  iOS     zapcooking_ios            EmojiData.swift   (--swift / --quick-swift, splices in place)
  Android zap_cooking_android       EmojiData.kt      (--kotlin, whole file)
  Android zap_cooking_android       EmojiPicker.kt    (--quick-kotlin snippet)
  web     zapcooking/frontend       reactions.ts      (--quick-ts snippet)

The web full picker needs no catalog: it renders emoji-picker-element, which
already ships the complete Unicode set.

Filtering (identical on every platform):
  * RGI entries only (fully-qualified and minimally-qualified).
  * The Component group and every skin-tone / hair-tone variant are skipped —
    one base glyph per concept, matching what emoji-picker-element shows.
  * Per-category order is emoji-test.txt order (CLDR subgroup order).
"""

import argparse
import sys
import urllib.request
from pathlib import Path

EMOJI_VERSION = "15.1"
EMOJI_TEST_URL = f"https://www.unicode.org/Public/emoji/{EMOJI_VERSION}/emoji-test.txt"

# emoji-test.txt group name -> catalog category name (tab label).
CATEGORIES = [
    ("Smileys & Emotion", "Smileys"),
    ("People & Body", "People"),
    ("Animals & Nature", "Animals"),
    ("Food & Drink", "Food"),
    ("Activities", "Activities"),
    ("Travel & Places", "Travel"),
    ("Objects", "Objects"),
    ("Symbols", "Symbols"),
    ("Flags", "Flags"),
]

# Curated tab icons — stable regardless of catalog order. Deriving them from
# the group's first emoji drifts with Unicode releases (Activities opens with
# 🎃, so the library tab became a jack-o-lantern).
CATEGORY_ICONS = {
    "Smileys": "😀",
    "People": "👋",
    "Animals": "🐶",
    "Food": "🍔",
    "Activities": "⚽",
    "Travel": "✈️",
    "Objects": "💡",
    "Symbols": "♻️",
    "Flags": "🏴‍☠️",
}

# Canonical quick-reaction defaults — identical on iOS, Android, and web.
# 24 entries = 4 rows x 6 in the iOS picker (Android's popup flows uncapped).
# Rows 1-2: reactions. Rows 3-4: everything culinary, together in sequence —
# chef, then food (cooked, meats, fish, veg, dishes), no seasonal picks
# (🎃 🎄 … live in the catalog, not the defaults).
QUICK_REACTIONS = [
    "❤️", "🔥", "👍", "😂", "🙏", "🤙",
    "💯", "✨", "🎉", "🥂", "😋", "🤤",
    "🤌", "🧑‍🍳", "🍳", "🥩", "🍗", "🐟",
    "🥦", "🌶️", "🌮", "🍜", "🍝", "🍔",
]

SKIN_TONES = set(range(0x1F3FB, 0x1F3FF + 1))
HAIR_TONES = set(range(0x1F9B0, 0x1F9B3 + 1))


def load_catalog(path: Path) -> dict:
    """Parse emoji-test.txt into {group: [emoji, ...]} with the parity filters."""
    groups: dict[str, list[str]] = {}
    group = None
    seen = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# group:"):
            group = line[len("# group:"):].strip()
            groups.setdefault(group, [])
            continue
        if group is None or line.startswith(("#", "@")) or not line.strip():
            continue
        codes_field, status_and_comment = (part.strip() for part in line.split(";", 1))
        status = status_and_comment.split("#", 1)[0].strip()
        # Skip minimally-qualified duplicates (same emoji without FE0F) —
        # emoji-test.txt lists both forms; fully-qualified is canonical.
        if status != "fully-qualified":
            continue
        codepoints = [int(c, 16) for c in codes_field.split()]
        if any(cp in SKIN_TONES for cp in codepoints):
            continue
        # Hair-tone ZWJ combos (👱‍♀️‍🦰): skip the variants, keep the base glyph.
        if len(codepoints) > 1 and any(cp in HAIR_TONES for cp in codepoints):
            continue
        emoji = "".join(chr(cp) for cp in codepoints)
        if emoji in seen:
            continue
        seen.add(emoji)
        groups[group].append(emoji)
    missing = [g for g, _ in CATEGORIES if not groups.get(g)]
    if missing:
        sys.exit(f"emoji-test.txt is missing expected groups: {missing}")
    return groups


def kotlin_escape(emoji: str) -> str:
    out = []
    for ch in emoji:
        cp = ord(ch)
        if cp < 0x10000:
            out.append("\\u%04X" % cp)
        else:
            cp -= 0x10000
            out.append("\\u%04X\\u%04X" % (0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)))
    return "".join(out)


def wrap(items: list, indent: str, per_line: int = 5) -> str:
    return "\n".join(
        indent + ", ".join(items[i:i + per_line]) + ","
        for i in range(0, len(items), per_line)
    )


def emit_swift(catalog: dict) -> str:
    parts = []
    for group, name in CATEGORIES:
        emojis = catalog[group]
        icon = CATEGORY_ICONS[name]
        body = wrap([f'"{e}"' for e in emojis], " " * 16)
        parts.append(
            "        EmojiCategory(\n"
            f'            name: "{name}",\n'
            f'            icon: "{icon}",\n'
            "            emojis: [\n"
            f"{body}\n"
            "            ]\n"
            "        )"
        )
    return ",\n".join(parts)


def emit_kotlin(catalog: dict) -> str:
    parts = []
    for group, name in CATEGORIES:
        emojis = [kotlin_escape(e) for e in catalog[group]]
        icon = kotlin_escape(CATEGORY_ICONS[name])
        body = wrap([f'"{e}"' for e in emojis], " " * 16)
        parts.append(
            "        EmojiCategory(\n"
            f'            name = "{name}",\n'
            f'            icon = "{icon}",\n'
            "            emojis = listOf(\n"
            f"{body}\n"
            "            )\n"
            "        )"
        )
    return ",\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=None,
                        help="Path to emoji-test.txt (downloaded when omitted)")
    parser.add_argument("--swift", action="store_true",
                        help="Print the generated categories block for EmojiData.swift")
    parser.add_argument("--quick-swift", action="store_true",
                        help="Print the generated defaultQuickReactions block")
    parser.add_argument("--kotlin", action="store_true",
                        help="Print the whole generated EmojiData.kt")
    parser.add_argument("--quick-kotlin", action="store_true",
                        help="Print the DEFAULT_UNICODE_EMOJIS list for EmojiPicker.kt")
    parser.add_argument("--quick-ts", action="store_true",
                        help="Print the QUICK_EMOJIS line for reactions.ts")
    args = parser.parse_args()

    outputs = [args.swift, args.quick_swift, args.kotlin, args.quick_kotlin, args.quick_ts]
    if not any(outputs):
        parser.error("pick an output: --swift / --quick-swift / --kotlin / --quick-kotlin / --quick-ts")

    src = args.input
    if src is None:
        cache = Path(__file__).parent / f".emoji-test-{EMOJI_VERSION}.txt"
        if not cache.exists():
            print(f"downloading {EMOJI_TEST_URL}", file=sys.stderr)
            urllib.request.urlretrieve(EMOJI_TEST_URL, cache)
        src = cache

    catalog = load_catalog(src)
    total = sum(len(catalog[g]) for g, _ in CATEGORIES)
    print(f"# {total} emoji across {len(CATEGORIES)} categories "
          f"from emoji-test.txt {EMOJI_VERSION}", file=sys.stderr)

    if args.swift:
        print("    static let categories: [EmojiCategory] = [")
        print(emit_swift(catalog))
        print("    ]")
    elif args.quick_swift:
        body = wrap([f'"{e}"' for e in QUICK_REACTIONS], " " * 8, per_line=6)
        print("    static let defaultQuickReactions: [String] = [\n%s\n    ]" % body)
    elif args.kotlin:
        header = (
            "// GENERATED by tools/gen-emoji-data.py (zapcooking_ios) from Unicode\n"
            f"// emoji-test.txt {EMOJI_VERSION} — do not hand-edit. The emoji library\n"
            "// must stay identical on iOS (EmojiData.swift); the web full picker\n"
            "// already renders this complete set via emoji-picker-element.\n"
            "// Parity: regenerate together with iOS when bumping EMOJI_VERSION.\n"
            "package cooking.zap.app.ui.component\n"
            "\n"
            "data class EmojiCategory(val name: String, val icon: String, val emojis: List<String>)\n"
            "\n"
            "object EmojiData {\n"
            "    val categories: List<EmojiCategory> = listOf(\n"
        )
        print(header + emit_kotlin(catalog) + "\n    )\n}")
    elif args.quick_kotlin:
        body = wrap(['"%s"' % kotlin_escape(e) for e in QUICK_REACTIONS], " " * 4, per_line=4)
        print("listOf(\n%s\n)" % body)
    elif args.quick_ts:
        items = ", ".join("'%s'" % e for e in QUICK_REACTIONS)
        print(f"export const QUICK_EMOJIS = [{items}] as const;")


if __name__ == "__main__":
    main()
