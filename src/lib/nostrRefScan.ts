import { nip19 } from 'nostr-tools';
import LinkifyIt from 'linkify-it';
import tlds from 'tlds';

/**
 * Scan note content for links and nostr references.
 *
 * Extracted from NoteContent.svelte so the tricky part — a regex run over
 * arbitrary user text — is unit-testable. The interleaving with hashtags
 * and the rendering itself stay in the component.
 *
 * References may or may not carry the `nostr:` prefix. NIP-27 says they
 * should, but several clients emit prefix-less ones and most clients render
 * them anyway, so refusing to would read as zap.cooking being broken rather
 * than the authoring client (issue #637).
 */

export interface ScannedRef {
  index: number;
  content: string;
  type: 'url' | 'nostr';
  url?: string;
  /**
   * True for scheme-less fuzzy matches ("see zap.cooking/pow"). The renderer
   * keeps these inline — never a preview card or embed — because a fuzzy
   * match is an inference, and a false positive like "oven.to" should at
   * worst be a stray underline, not a loaded card.
   */
  bare?: boolean;
  prefix?: string;
  data?: string;
}

/**
 * Ordering is load-bearing: the URL branch comes FIRST so
 * `https://njump.me/nevent1…` matches as a link instead of being carved up.
 */
const REF_RE =
  /(https?:\/\/[^\s]+)|nostr:(nevent1|note1|npub1|nprofile1|naddr1|noffer1)([023456789acdefghjklmnpqrstuvwxyz]+)|\b(nevent1|note1|npub1|nprofile1|naddr1|noffer1)([023456789acdefghjklmnpqrstuvwxyz]{6,})/g;

/**
 * Does a bech32 token actually decode?
 *
 * Only applied to PREFIX-LESS matches. A `nostr:` prefix is an explicit
 * declaration of intent and is trusted as before; a bare run of bech32
 * characters is a guess, and this is what makes the guess safe — it rejects
 * prose false positives and truncated pastes, and is stricter than the
 * regex's `{6,}` length bound.
 *
 * `noffer1` is exempt: NofferButton owns its own parsing and nip19 has no
 * such type.
 */
function isDecodableNostrRef(token: string): boolean {
  if (token.startsWith('noffer1')) return true;
  try {
    nip19.decode(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scheme-less domain detection: "see zap.cooking/pow" is a link the author
 * meant, the way Twitter/X treats bare domains. Uses linkify-it with the
 * same full IANA TLD list `$lib/parser` feeds markdown-it, so both surfaces
 * agree on what counts as a domain.
 *
 * Only fuzzy (`schema === ''`) matches are taken — explicit http(s) URLs are
 * REF_RE's job and must not match twice. Fuzzy email is off: turning
 * `chef@zap.cooking` into a mailto in note bodies is a separate decision.
 */
const bareDomainLinkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false });
bareDomainLinkify.tlds(tlds, true);

export function scanNostrRefs(text: string): ScannedRef[] {
  const out: ScannedRef[] = [];
  let match: RegExpExecArray | null;

  REF_RE.lastIndex = 0;
  while ((match = REF_RE.exec(text)) !== null) {
    const [fullMatch, url, nostrPrefix, nostrData, barePrefix, bareData] = match;

    if (url) {
      out.push({ index: match.index, content: fullMatch, type: 'url', url });
      continue;
    }

    if (nostrPrefix && nostrData) {
      out.push({
        index: match.index,
        content: fullMatch,
        type: 'nostr',
        prefix: nostrPrefix,
        data: nostrData
      });
      continue;
    }

    if (barePrefix && bareData) {
      // Scheme-less host: `npub1abc….blossom.band/img.png` is a URL the
      // https? branch never sees, and carving the npub out of it would
      // mangle the link. If a domain-ish character follows, leave it as text
      // — the bare-domain pass below claims the whole span as one link.
      const after = text[match.index + fullMatch.length];
      if (after === '.' || after === '/') continue;

      if (!isDecodableNostrRef(`${barePrefix}${bareData}`)) continue;

      out.push({
        index: match.index,
        content: fullMatch,
        type: 'nostr',
        prefix: barePrefix,
        data: bareData
      });
    }
  }

  // Bare domains, merged in. Spans overlapping an already-found reference
  // are dropped so a domain inside an explicit URL or a nostr reference is
  // never carved out (same ordering guarantee REF_RE gives njump links).
  // Fuzzy matches carry `schema === ''`; fuzzy email is off, so every match
  // at this point is a scheme-less link.
  for (const m of bareDomainLinkify.match(text) || []) {
    if (m.schema !== '') continue;
    const bare: ScannedRef = {
      index: m.index,
      content: m.text,
      type: 'url',
      url: m.url,
      bare: true
    };
    const overlaps = out.some(
      (r) => bare.index < r.index + r.content.length && r.index < bare.index + bare.content.length
    );
    if (!overlaps) out.push(bare);
  }

  return out.sort((a, b) => a.index - b.index);
}
