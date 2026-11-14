/**
 * Taking the tracking tail off a link pasted into a composer.
 *
 * A link copied out of a browser usually arrives with a tail describing the
 * person who copied it rather than the thing it points at: which campaign
 * reached them, which app they were in, and an id that ties that click back
 * to them. Posting it forwards all of that to everyone who reads the note,
 * which is not something anyone means to do by pasting a link.
 *
 * OFFERED, NEVER DONE FOR YOU. The composer publishes what a person wrote, and
 * quietly rewriting the words on the way in is the same kind of act as quietly
 * rewriting an event on the way out. So a paste that carries a tail says so,
 * once, and one button takes it off — the composers call findTrackedUrls for
 * the offer and apply the hits only when it is pressed.
 *
 * Adapted from sidecar's composer-core (PR dmnyc/sidecar#338); the behavioral
 * contract there is pinned test-for-test in trackingParams.test.ts.
 */

/** A URL worth cleaning, with what it becomes. The composer replaces every
 * occurrence of `raw` with `clean` when the offer is accepted. */
export interface TrackedUrlHit {
  raw: string;
  clean: string;
}

// Params that identify where a visitor came FROM, never which page they're on.
// Left in, every share link describes its sharer as much as its destination.
//
// Deliberately a denylist, never "strip the whole query". For plenty of sites
// the query IS the page (youtube.com/watch?v=…), and dropping a load-bearing
// param is strictly worse than a forwarded campaign tag: the cleaned link would
// point at a URL rendering different content, or nothing. Anything ambiguous
// stays — `ref` in particular is functional often enough to leave alone.
const TRACKING_PARAMS = [
  // ad-click IDs
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'twclid',
  'ttclid',
  'yclid',
  'igshid',
  'li_fat_id',
  'epik',
  'rdt_cid',
  'sccid',
  'srsltid',
  's_kwcid',
  // email + marketing platforms
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'vero_conv',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  '__s',
  // analytics and referrer echoes
  '_ga',
  '_openstat',
  'ref_src',
  'ref_url',
  'ncid',
  'spm',
  'at_medium',
  'at_campaign',
  // Yahoo consent-redirect residue
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  // Facebook share callbacks
  'fb_action_ids',
  'fb_action_types',
  'fb_ref',
  'fb_source',
  'action_object_map',
  'action_type_map',
  'action_ref_map'
];

// Namespaces that exist only for analytics, so the whole family goes without
// enumerating it. `utm_` alone has a dozen variants past the common five
// (utm_name, utm_source_platform, utm_marketing_tactic, …) and vendors keep
// adding more — matching the prefix is what actually answers "utm junk", where
// a fixed list silently rots.
const TRACKING_PREFIXES = ['utm_', 'pk_', 'piwik_', 'mtm_', 'hsa_'];

// Pure tracking on a specific host, but possibly load-bearing elsewhere, so
// only stripped where we know what it means. YouTube's `si` is the most common
// real-world splitter there is: every press of Share mints a fresh one, so one
// video would otherwise carry a separate thread per sharer.
//
// Amazon is deliberately absent. Its `tag` is an affiliate code, which is
// sometimes the entire reason somebody shared the link, and a button offering
// to remove "tracking" should not quietly be a button that removes earnings.
const HOST_TRACKING_PARAMS: { host: RegExp; params: string[] }[] = [
  { host: /(^|\.)(youtube\.com|youtu\.be)$/i, params: ['si', 'pp', 'feature', 'kw'] },
  // Same shape as YouTube's `si`, and the same consequence: `t` is minted fresh on
  // every press of Share, so one post would carry a separate thread per sharer.
  { host: /^(x\.com|twitter\.com)$/i, params: ['s', 't'] },
  { host: /(^|\.)spotify\.com$/i, params: ['si', 'nd', 'nd_lfid'] },
  { host: /(^|\.)tiktok\.com$/i, params: ['is_from_webapp', 'sender_device', '_r', '_t'] },
  {
    host: /(^|\.)reddit\.com$/i,
    params: ['share_id', 'rdt', 'correlation_id', 'ref_source', 'ref_campaign']
  },
  { host: /(^|\.)linkedin\.com$/i, params: ['trk', 'trackingid'] }
];

// Case-insensitive: the same vendor ships both `ScCid` and `sccid`, and a param
// that survives on a capital letter splits the thread just as effectively.
function isTrackingParam(name: string): boolean {
  const n = String(name).toLowerCase();
  return TRACKING_PARAMS.includes(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
}

function hostTrackingParams(hostname: string): string[] | null {
  const rule = HOST_TRACKING_PARAMS.find((r) => r.host.test(String(hostname || '')));
  return rule ? rule.params : null;
}

// Cuts whole k=v segments out of the query, textually. Rebuilding through URL
// or URLSearchParams would re-encode every parameter being KEPT: a %20 comes
// back a +, an unescaped bracket comes back escaped. That is a change to a
// link nobody asked us to change, on a path whose entire promise is that it
// changes nothing else.
//
// The query only, never the path. Several sites carry tracking in path segments
// too, and nothing tells those apart from an id without knowing the site.
// Confining this to whole parameters is what makes it safe against a URL for a
// site nobody here has heard of: the output is the input minus entire
// parameters, so a link that worked still works. Returns null when there is
// nothing to take off.
export function cleanTrackedUrl(raw: string): string | null {
  const s = String(raw || '');
  if (!/^https?:\/\//i.test(s)) return null;
  const q = s.indexOf('?');
  if (q === -1) return null;
  let hostname: string;
  try {
    hostname = new URL(s).hostname;
  } catch {
    return null;
  }
  const hashAt = s.indexOf('#', q);
  const head = s.slice(0, q);
  const tail = hashAt === -1 ? '' : s.slice(hashAt);
  const query = s.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  const hostParams = hostTrackingParams(hostname);
  const parts = query.split('&').filter((part) => part !== '');
  const kept = parts.filter((part) => {
    const eq = part.indexOf('=');
    const encoded = (eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' ');
    let name = encoded;
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* a stray % is still a name */
    }
    if (isTrackingParam(name)) return false;
    return !hostParams || !hostParams.includes(name.toLowerCase());
  });
  if (kept.length === parts.length) return null;
  return head + (kept.length ? '?' + kept.join('&') : '') + tail;
}

// Trailing punctuation belongs to the sentence, not to the link. A URL written
// at the end of a line takes the period with it otherwise, and the cleaned
// version would come back without one.
function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const before = out;
    out = out.replace(/[.,;:!?'"]+$/, '');
    for (const [close, open] of [
      [')', '('],
      [']', '['],
      ['}', '{']
    ] as const) {
      if (!out.endsWith(close)) continue;
      if (out.split(close).length > out.split(open).length) out = out.slice(0, -1);
    }
    if (out === before) return out;
  }
}

/**
 * Every link in a draft that arrives with a tail, deduplicated and ordered
 * LONGEST FIRST — so replacing one link cannot eat the front of another that
 * starts with it, which two shares of the same page with different campaign
 * ids produce exactly.
 */
export function findTrackedUrls(text: string): TrackedUrlHit[] {
  const out: TrackedUrlHit[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || '')))) {
    const raw = trimUrlTail(m[0]);
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const clean = cleanTrackedUrl(raw);
    if (clean && clean !== raw) out.push({ raw, clean });
  }
  out.sort((a, b) => b.raw.length - a.raw.length);
  return out;
}
