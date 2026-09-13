/**
 * CSP violation collector.
 *
 * Required by the report-only policy: SvelteKit (and the CSP spec) will not
 * accept `content-security-policy-report-only` without a `report-uri` or
 * `report-to` target. Its purpose is the soak — enumerate what the policy
 * WOULD have blocked before anyone considers enforcing it.
 *
 * This endpoint is necessarily unauthenticated: violation reports are sent
 * by the browser, not by our client code, so they carry no credentials.
 * It is therefore deliberately inert — it never stores anything, never
 * echoes input back, caps how much of the body it reads, and caps how much
 * it will log per isolate so it can't be used to flood worker logs.
 */
import type { RequestHandler } from './$types';

/** Reports are small; anything larger is not a real report. */
const MAX_REPORT_BYTES = 8 * 1024;

/**
 * Per-isolate log budget. A browser can be made to emit reports in a loop,
 * and an isolate is shared across requests, so cap the noise rather than
 * trusting the sender. Not a security boundary, just log hygiene.
 */
const MAX_LOGS_PER_ISOLATE = 50;
let logged = 0;

/** Keep only the fields worth reading, and bound their length. */
function summarize(report: Record<string, unknown>): Record<string, string> {
  const pick = (key: string): string => {
    const value = report[key];
    return typeof value === 'string' ? value.slice(0, 300) : '';
  };
  return {
    directive: pick('effective-directive') || pick('violated-directive'),
    blocked: pick('blocked-uri'),
    document: pick('document-uri'),
    // Present for inline/eval violations; identifies WHICH inline script.
    sample: pick('script-sample')
  };
}

export const POST: RequestHandler = async ({ request }) => {
  // Always 204, whatever happens — a collector that errors would turn a
  // reporting problem into a visible browser-side failure.
  try {
    if (logged >= MAX_LOGS_PER_ISOLATE) return new Response(null, { status: 204 });

    const body = await request.text();
    if (body.length > MAX_REPORT_BYTES) return new Response(null, { status: 204 });

    const parsed = JSON.parse(body);
    // Browsers post `{ "csp-report": { … } }` for report-uri.
    const report = parsed?.['csp-report'] ?? parsed;
    if (!report || typeof report !== 'object') return new Response(null, { status: 204 });

    logged++;
    console.warn('[csp-report]', JSON.stringify(summarize(report)));
  } catch {
    // Malformed body — nothing to report, nothing to do.
  }

  return new Response(null, { status: 204 });
};
