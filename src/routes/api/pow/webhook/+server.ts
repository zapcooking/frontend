/**
 * POST /api/pow/webhook — the zapcooking org webhook ("Pull requests").
 *
 *   503 { code: 'POW_UNCONFIGURED' }  POW_WEBHOOK_SECRET or POW binding missing
 *   401 (empty)   missing, malformed or wrong X-Hub-Signature-256
 *   200 (empty)   ping
 *   400 (empty)   signed but not JSON
 *   204 (empty)   anything we don't act on: other events and actions,
 *                 unmerged closes, repos outside REPOS (member-relay…)
 *   202 (empty)   accepted; the work runs in waitUntil (GitHub gives up
 *                 after 10 s): merged → fetchOne → upsert → recompute →
 *                 pow:head; edited/labeled on a merged PR → patched from
 *                 the payload, no GitHub call
 *
 * The signature is checked over the exact request bytes, before any parse.
 * Logs carry event, action, repo, PR number, delivery id and outcome —
 * never the body, headers or secret.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { createGithubClient } from '$lib/shipped/github.server';
import { recordRefusal } from '$lib/shipped/refresh.server';
import { applyDelivery, classifyDelivery, verifySignature } from '$lib/shipped/webhook.server';

/** Header/payload values are attacker-shaped until verified; keep log fields tame. */
function field(value: unknown, max = 64): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, max) || '-'
    : '-';
}

const empty = (status: number) =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export const POST: RequestHandler = async ({ request, platform }) => {
  const kv = platform?.env?.POW;
  const secret = platform?.env?.POW_WEBHOOK_SECRET;
  const token = platform?.env?.POW_GITHUB_TOKEN;
  const event = field(request.headers.get('x-github-event'));
  const delivery = field(request.headers.get('x-github-delivery'));
  const log = (parts: Record<string, unknown>, outcome: string) =>
    console.log(
      `[pow] webhook event=${event} action=${field(parts.action)} repo=${field(parts.repo, 100)} ` +
        `pr=${field(parts.number)} delivery=${delivery} outcome=${outcome}`
    );

  if (!kv || !secret) {
    log({}, 'unconfigured');
    return json(
      { code: 'POW_UNCONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (!(await verifySignature(body, request.headers.get('x-hub-signature-256'), secret))) {
    log({}, 'bad_signature');
    return empty(401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    log({}, 'bad_json');
    return empty(400);
  }

  const d = classifyDelivery(request.headers.get('x-github-event'), payload);
  if (d.kind === 'ping') {
    log({}, 'ping');
    return empty(200);
  }
  if (d.kind === 'ignore') {
    log(d, `ignored_${d.reason}`);
    return empty(204);
  }

  log(d, 'accepted');
  const work = applyDelivery(kv, d, token ? () => createGithubClient(token) : null)
    .then(async ({ outcome, refusal }) => {
      if (refusal) {
        const until = await recordRefusal(kv, refusal, new Date());
        console.error(
          refusal.kind === 'auth'
            ? `[pow] github_auth_failed status=${refusal.label}`
            : `[pow] github_rate_limited status=${refusal.label} retry_at=${until.toISOString()}`
        );
      }
      log(d, outcome);
    })
    .catch((e: unknown) => log(d, `failed_${field(e instanceof Error ? e.name : 'error')}`));

  if (platform?.ctx) platform.ctx.waitUntil(work);
  else await work;
  return empty(202);
};
