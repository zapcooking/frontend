/**
 * Keep the `Link` response header small.
 *
 * SvelteKit emits one `Link: <chunk>; rel="modulepreload"` entry per JS chunk
 * the page loads. On heavy routes (e.g. a note, which pulls in the composer,
 * wallet and zap modal) that is ~190 entries / ~15 KB, which pushes total
 * response headers past 16 KB — Node's default limit. Node-based clients
 * (Signal Desktop's link-preview fetcher, among others) then fail the request
 * outright (`HPE_HEADER_OVERFLOW`) and never see the page or its OG tags.
 *
 * Preloads are only a performance hint, so cap the header: entries are kept
 * in order (the entry chunks come first) until the byte budget is reached.
 */

/** Budget for the Link header; leaves ample room under 16 KB for the rest. */
export const MAX_LINK_HEADER_BYTES = 6144;

/** Split on the commas that separate `<url>; …` entries, not ones inside them. */
export function splitLinkHeader(value: string): string[] {
  return value.split(/,\s*(?=<)/).filter(Boolean);
}

export function trimLinkHeader(value: string, maxBytes: number = MAX_LINK_HEADER_BYTES): string {
  if (value.length <= maxBytes) return value;
  const kept: string[] = [];
  let size = 0;
  for (const entry of splitLinkHeader(value)) {
    const next = size + entry.length + (kept.length ? 2 : 0); // ", "
    if (next > maxBytes) break;
    kept.push(entry);
    size = next;
  }
  return kept.join(', ');
}
