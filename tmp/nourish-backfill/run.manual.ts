/**
 * Phase 2 backfill — rescore all pantry-scored recipes at prompt v4
 * with macros + labels, rate-limited (~1/s). Resumable via rows.json.
 *
 * Usage:
 *   NOTIFICATION_PRIVATE_KEY=... pnpm exec vitest run \
 *     --config tmp/nourish-backfill/vitest.config.ts
 *
 * Loads OPENAI_API_KEY (+ optional NOTIFICATION_PRIVATE_KEY) from
 * env or .dev.vars. Without the publish key, scores + census still
 * write to results/ (dry-run); with it, events publish to pantry.
 *
 * Relay split: reads (scored corpus + recipes) come from the public
 * index relay; writes go to wss://pantry.zap.cooking, which requires
 * a NIP-42 AUTH handshake (kind-22242 signed by the service key) and
 * an active membership. Every publish AWAITS the relay's OK and only
 * accepted=true counts — "sent" is never reported as "published".
 * Checkpoint publish status from prior runs is untrusted (it counted
 * any-relay acceptance); every scored row re-publishes each run
 * (replaceable events; pantry dedupes by d-tag; harmless).
 *
 * Throwaway — lives under tmp/, not src/.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { makeAuthEvent } from 'nostr-tools/nip42';
import { runScoringPipeline } from '../../src/lib/nourish/scoringEngine.server';
import {
	buildNourishEventParts,
	type NourishPublishInput
} from '../../src/lib/nourish/nourishPublisher.server';
import { computeContentHash } from '../../src/lib/nourish/nourishRelay';
import { parseMarkdownForEditing } from '../../src/lib/parser';
import {
	NOURISH_SERVICE_PUBKEY,
	NOURISH_PROMPT_VERSION,
	type NourishLabel,
	type NourishMacros
} from '../../src/lib/nourish/types';

const OUT_DIR = resolve(process.cwd(), 'tmp/nourish-backfill/results');
const ROWS_PATH = resolve(OUT_DIR, 'rows.json');
/** Reads only — the scored 30078 corpus and 30023 recipes live here. */
const READ_RELAY = 'wss://nos.lol';
/** Writes only — NIP-42 AUTH + active membership required. */
const PANTRY_RELAY = 'wss://pantry.zap.cooking';
const RATE_LIMIT_MS = 800;
const PUBLISH_TIMEOUT_MS = 8000;

function loadEnvVar(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	const p = resolve(process.cwd(), '.dev.vars');
	if (!existsSync(p)) return undefined;
	for (const line of readFileSync(p, 'utf8').split('\n')) {
		const m = line.match(new RegExp(`^${name}=(.+)$`));
		if (m) return m[1].trim().replace(/^["']|["']$/g, '');
	}
	return undefined;
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

function resolvePrivateKey(raw: string): Uint8Array {
	if (raw.startsWith('nsec1')) {
		return nip19.decode(raw).data as Uint8Array;
	}
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Uint8Array.from(raw.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
	}
	throw new Error('Invalid private key format — must be 64 hex chars or nsec');
}

function reqEvents(filter: Record<string, unknown>, timeoutMs = 10000): Promise<any[]> {
	return new Promise((resolveP, reject) => {
		const ws = new WebSocket(READ_RELAY);
		const events: any[] = [];
		const t = setTimeout(() => {
			try {
				ws.close();
			} catch {
				/* ignore */
			}
			resolveP(events);
		}, timeoutMs);
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify(['REQ', 'bf', filter]));
		});
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
			if (msg[0] === 'EVENT') events.push(msg[2]);
			if (msg[0] === 'EOSE') {
				clearTimeout(t);
				ws.close();
				resolveP(events);
			}
		});
		ws.addEventListener('error', (e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

type PantryResult = { accepted: boolean; reason: string };

/**
 * Publish one signed event to pantry over a raw WebSocket.
 *
 * NIP-42: pantry sends an AUTH challenge; we answer with a kind-22242
 * event signed by the service key, wait for the AUTH OK, then send the
 * EVENT and AWAIT its OK. Resolves with the relay's actual verdict —
 * accepted=true only when pantry says so.
 */
function publishToPantry(event: { id: string }, privKeyBytes: Uint8Array): Promise<PantryResult> {
	return new Promise((resolveP) => {
		let settled = false;
		let challenge: string | null = null;
		let authEventId: string | null = null;
		let authed = false;
		let ws: WebSocket | null = null;

		const finish = (accepted: boolean, reason: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			resolveP({ accepted, reason });
		};
		const timer = setTimeout(() => finish(false, 'timeout waiting for OK'), PUBLISH_TIMEOUT_MS);

		try {
			ws = new WebSocket(PANTRY_RELAY);
		} catch (err: any) {
			finish(false, `connect failed: ${err?.message || String(err)}`);
			return;
		}
		const sock = ws;

		const sendEvent = () => {
			if (settled) return;
			try {
				sock.send(JSON.stringify(['EVENT', event]));
			} catch (err: any) {
				finish(false, `send failed: ${err?.message || String(err)}`);
			}
		};

		const sendAuth = () => {
			if (settled || !challenge || authEventId) return;
			try {
				const authEvent = finalizeEvent(makeAuthEvent(PANTRY_RELAY, challenge), privKeyBytes);
				authEventId = authEvent.id;
				sock.send(JSON.stringify(['AUTH', authEvent]));
			} catch (err: any) {
				finish(false, `AUTH send failed: ${err?.message || String(err)}`);
			}
		};

		sock.addEventListener('open', () => {
			// Pantry sends its challenge on connect — give it a beat. If one
			// arrived, AUTH first (EVENT follows the AUTH OK); otherwise send
			// EVENT and rely on the auth-required retry below.
			setTimeout(() => {
				if (settled) return;
				if (challenge) sendAuth();
				else sendEvent();
			}, 500);
		});

		sock.addEventListener('message', (msg) => {
			let data: any;
			try {
				data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
			} catch {
				return;
			}
			if (!Array.isArray(data) || data.length < 2) return;

			if (data[0] === 'AUTH' && typeof data[1] === 'string') {
				challenge = data[1];
				sendAuth();
				return;
			}

			if (data[0] === 'OK') {
				const okId = data[1];
				const accepted = data[2] === true;
				const reason = typeof data[3] === 'string' ? data[3] : '';

				if (authEventId && okId === authEventId) {
					if (!accepted) {
						finish(false, `AUTH rejected: ${reason || 'no reason given'}`);
						return;
					}
					authed = true;
					sendEvent();
					return;
				}

				if (okId === event.id) {
					if (accepted) {
						finish(true, reason || 'accepted');
					} else if (/auth-required/i.test(reason) && !authed && challenge) {
						sendAuth(); // EVENT re-sent on AUTH OK
					} else {
						finish(false, reason || 'rejected without reason');
					}
				}
			}
		});

		sock.addEventListener('error', () => finish(false, 'websocket error'));
		sock.addEventListener('close', () => finish(false, 'connection closed before OK'));
	});
}

/** Build + sign a fresh 30078 (production event shape) and publish to pantry. */
async function signAndPublish(
	input: NourishPublishInput,
	privKeyBytes: Uint8Array
): Promise<PantryResult> {
	const { tags, content } = buildNourishEventParts(input);
	const event = finalizeEvent(
		{
			kind: 30078,
			created_at: Math.floor(Date.now() / 1000),
			tags,
			content: JSON.stringify(content)
		},
		privKeyBytes
	);
	return publishToPantry(event, privKeyBytes);
}

type Row = {
	dTag: string;
	recipePubkey: string;
	recipeDTag: string;
	prevPromptVersion: string;
	title: string;
	/** true = pantry ACCEPTED (OK true). false = rejected/no OK. null = not attempted (dry run). */
	published: boolean | null;
	publishReason?: string;
	macros?: NourishMacros;
	labels: NourishLabel[];
	omitReason?: string;
	error?: string;
};

const OPENAI_KEY = loadEnvVar('OPENAI_API_KEY');
const PUBLISH_KEY = loadEnvVar('NOTIFICATION_PRIVATE_KEY');
const RELAY_API_SECRET = loadEnvVar('RELAY_API_SECRET');

async function ensureServiceMembership(): Promise<string> {
	if (!RELAY_API_SECRET) return 'skipped (no RELAY_API_SECRET)';
	const pk = NOURISH_SERVICE_PUBKEY;
	const lookup = await fetch(`https://pantry.zap.cooking/api/members/${pk}`, {
		headers: { Authorization: `Bearer ${RELAY_API_SECRET}` }
	});
	const lookupBody = await lookup.json().catch(() => ({}));
	if (lookup.ok && (lookupBody.is_member === true || lookupBody.active === true || lookupBody.isActive)) {
		return 'already member';
	}
	const end = new Date();
	end.setFullYear(end.getFullYear() + 10);
	const res = await fetch('https://pantry.zap.cooking/api/members', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${RELAY_API_SECRET}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			pubkey: pk,
			subscription_months: 120,
			payment_id: `nourish_service_${Date.now()}`,
			tier: 'standard',
			subscription_end: end.toISOString(),
			payment_method: 'stripe'
		})
	});
	if (res.ok || res.status === 409) return `registered (${res.status})`;
	const text = await res.text();
	return `failed ${res.status}: ${text.slice(0, 120)}`;
}

/**
 * Checkpoint row scored in a dry run — no current-version event exists
 * on the read relay to forward, so re-run the pipeline and publish fresh.
 */
async function rescoreAndPublish(
	row: Row,
	privKeyBytes: Uint8Array
): Promise<{ res: PantryResult; macros?: NourishMacros; labels?: NourishLabel[] }> {
	if (!row.recipePubkey || !row.recipeDTag) {
		return { res: { accepted: false, reason: 'row missing recipe coordinate' } };
	}
	const recipes = await reqEvents({
		kinds: [30023],
		authors: [row.recipePubkey],
		'#d': [row.recipeDTag],
		limit: 5
	});
	const recipeEv = recipes.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
	if (!recipeEv) return { res: { accepted: false, reason: 'recipe not found for re-score' } };

	const parsed = parseMarkdownForEditing(recipeEv.content || '');
	const ingredients = parsed.ingredients || [];
	if (ingredients.length === 0) {
		return { res: { accepted: false, reason: 'no ingredients for re-score' } };
	}
	const title = recipeEv.tags?.find((t: string[]) => t[0] === 'title')?.[1] || row.title;
	const tags = (recipeEv.tags || [])
		.filter((t: string[]) => t[0] === 't' && t[1])
		.map((t: string[]) => t[1]);
	const contentHash = await computeContentHash(recipeEv.content || '');
	const pipeline = await runScoringPipeline(OPENAI_KEY!, {
		title,
		ingredients,
		tags,
		servings: parsed.information?.servings || ''
	});
	if (!pipeline.ok) return { res: { accepted: false, reason: `pipeline failed: ${pipeline.error}` } };

	const res = await signAndPublish(
		{
			recipePubkey: row.recipePubkey,
			recipeDTag: row.recipeDTag,
			contentHash,
			scores: pipeline.scores,
			improvements: pipeline.improvements,
			ingredientSignals: pipeline.ingredientSignals,
			audienceScores: pipeline.audienceScores,
			macros: pipeline.macros,
			labels: pipeline.labels,
			updatedAt: Math.floor(Date.now() / 1000)
		},
		privKeyBytes
	);
	return { res, macros: pipeline.macros, labels: pipeline.labels };
}

function writeCensus(rows: Row[], corpusSize: number) {
	const labelCounts: Record<string, number> = {};
	let rough = 0;
	let estimate = 0;
	let omitted = 0;
	let publishedOk = 0;
	let errors = 0;
	for (const r of rows) {
		if (r.error) errors++;
		if (r.published === true) publishedOk++;
		if (r.error) {
			/* skip confidence */
		} else if (!r.macros) omitted++;
		else if (r.macros.confidence === 'rough') rough++;
		else estimate++;
		for (const l of r.labels) {
			labelCounts[l] = (labelCounts[l] || 0) + 1;
		}
	}

	const rejected = rows.filter((r) => !r.error && r.published === false);

	const census = {
		ranAt: new Date().toISOString(),
		corpus: corpusSize,
		scored: rows.filter((r) => !r.error).length,
		errors,
		// Counts pantry ACCEPTANCES (OK accepted=true), not sends.
		published: PUBLISH_KEY ? publishedOk : null,
		dryRun: !PUBLISH_KEY,
		confidence: { estimate, rough, omitted },
		labels: labelCounts,
		pantryRejections: rejected.map((r) => ({
			coordinate: `30023:${r.recipePubkey}:${r.recipeDTag}`,
			reason: r.publishReason || 'no reason recorded'
		}))
	};

	writeFileSync(ROWS_PATH, JSON.stringify(rows, null, 2));
	writeFileSync(resolve(OUT_DIR, 'census.json'), JSON.stringify(census, null, 2));

	const md = [
		'# Phase 2 backfill census',
		'',
		`Ran: ${census.ranAt}`,
		`Corpus: ${census.corpus} · scored: ${census.scored} · errors: ${census.errors}`,
		PUBLISH_KEY
			? `Pantry accepted: ${publishedOk}/${census.scored} (OK accepted=true, not sends)`
			: 'Dry-run (no NOTIFICATION_PRIVATE_KEY) — labels below are what would publish.',
		...(rejected.length
			? [
					'',
					'## Pantry rejections',
					'',
					...rejected.map(
						(r) =>
							`- \`30023:${r.recipePubkey}:${r.recipeDTag}\` — ${r.publishReason || 'no reason recorded'}`
					)
				]
			: []),
		'',
		'## Confidence',
		'',
		`| class | count |`,
		`|-------|------:|`,
		`| estimate | ${estimate} |`,
		`| rough | ${rough} |`,
		`| macros omitted | ${omitted} |`,
		'',
		'## Labels',
		'',
		`| label | recipes |`,
		`|-------|--------:|`,
		...Object.entries(labelCounts)
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([l, n]) => `| \`${l}\` | ${n} |`)
	].join('\n');
	writeFileSync(resolve(OUT_DIR, 'census.md'), md);
	return { census, md };
}

describe('Phase 2 backfill (0.8)', () => {
	it(
		'rescores corpus, publishes to pantry when keyed, writes label census',
		async () => {
			expect(OPENAI_KEY, 'OPENAI_API_KEY required').toBeTruthy();
			mkdirSync(OUT_DIR, { recursive: true });

			const PRIV_BYTES = PUBLISH_KEY ? resolvePrivateKey(PUBLISH_KEY) : null;
			if (PRIV_BYTES) {
				expect(
					getPublicKey(PRIV_BYTES),
					'NOTIFICATION_PRIVATE_KEY must derive the Nourish service pubkey — pantry membership is granted to that key'
				).toBe(NOURISH_SERVICE_PUBKEY);
			}

			const membership = await ensureServiceMembership();
			console.log(`[backfill] pantry service membership: ${membership}`);

			const raw = await reqEvents({
				kinds: [30078],
				authors: [NOURISH_SERVICE_PUBKEY],
				limit: 200
			});
			const byD = new Map<string, any>();
			for (const ev of raw) {
				const d = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1];
				if (!d) continue;
				const prev = byD.get(d);
				if (!prev || (ev.created_at ?? 0) > (prev.created_at ?? 0)) byD.set(d, ev);
			}

			const done = new Map<string, Row>();
			if (existsSync(ROWS_PATH)) {
				try {
					const prev = JSON.parse(readFileSync(ROWS_PATH, 'utf8')) as Row[];
					for (const r of prev) {
						if (r.dTag && !r.error) {
							// Checkpoint publish status is untrusted — the old run
							// counted any-relay acceptance, and pantry got 0 while
							// it reported 53/53. Reset; this run re-verifies.
							done.set(r.dTag, { ...r, published: null, publishReason: undefined });
						}
					}
					console.log(`[backfill] resumed ${done.size} prior rows (publish status reset)`);
				} catch {
					/* ignore corrupt checkpoint */
				}
			}

			const entries = [...byD.entries()].sort((a, b) => a[0].localeCompare(b[0]));
			console.log(
				`[backfill] unique=${entries.length} remaining=${entries.length - done.size} publish=${Boolean(PUBLISH_KEY)}`
			);

			const publishedThisRun = new Set<string>();

			let i = 0;
			for (const [dTag, nourishEv] of entries) {
				i++;
				if (done.has(dTag)) continue;

				const a = nourishEv.tags?.find((t: string[]) => t[0] === 'a')?.[1] as string | undefined;
				const prevPromptVersion =
					nourishEv.tags?.find((t: string[]) => t[0] === 'prompt_version')?.[1] || 'untagged';

				const fail = (error: string, extra: Partial<Row> = {}) => {
					const row: Row = {
						dTag,
						recipePubkey: extra.recipePubkey ?? '',
						recipeDTag: extra.recipeDTag ?? '',
						prevPromptVersion,
						title: extra.title ?? '',
						published: null,
						labels: [],
						error,
						...extra
					};
					done.set(dTag, row);
					writeFileSync(ROWS_PATH, JSON.stringify([...done.values()], null, 2));
				};

				if (!a || !a.startsWith('30023:')) {
					fail('missing a-tag');
					continue;
				}
				const [, recipePubkey, ...rest] = a.split(':');
				const recipeDTag = rest.join(':');

				try {
					const recipes = await reqEvents({
						kinds: [30023],
						authors: [recipePubkey],
						'#d': [recipeDTag],
						limit: 5
					});
					const recipeEv =
						recipes.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
					if (!recipeEv) {
						fail('recipe not found', { recipePubkey, recipeDTag });
						continue;
					}

					const title =
						recipeEv.tags?.find((t: string[]) => t[0] === 'title')?.[1] ||
						recipeEv.tags?.find((t: string[]) => t[0] === 'd')?.[1] ||
						'';
					const tags = (recipeEv.tags || [])
						.filter((t: string[]) => t[0] === 't' && t[1])
						.map((t: string[]) => t[1]);
					const parsed = parseMarkdownForEditing(recipeEv.content || '');
					const servings = parsed.information?.servings || '';
					const ingredients = parsed.ingredients || [];
					if (ingredients.length === 0) {
						fail('no ingredients', { recipePubkey, recipeDTag, title });
						continue;
					}

					const contentHash = await computeContentHash(recipeEv.content || '');
					const pipeline = await runScoringPipeline(OPENAI_KEY!, {
						title,
						ingredients,
						tags,
						servings
					});
					if (!pipeline.ok) {
						fail(pipeline.error, { recipePubkey, recipeDTag, title });
						continue;
					}

					let published: boolean | null = null;
					let publishReason: string | undefined;
					if (PRIV_BYTES) {
						const res = await signAndPublish(
							{
								recipePubkey,
								recipeDTag,
								contentHash,
								scores: pipeline.scores,
								improvements: pipeline.improvements,
								ingredientSignals: pipeline.ingredientSignals,
								audienceScores: pipeline.audienceScores,
								macros: pipeline.macros,
								labels: pipeline.labels,
								updatedAt: Math.floor(Date.now() / 1000)
							},
							PRIV_BYTES
						);
						published = res.accepted;
						publishReason = res.reason;
						publishedThisRun.add(dTag);
					}

					done.set(dTag, {
						dTag,
						recipePubkey,
						recipeDTag,
						prevPromptVersion,
						title,
						published,
						publishReason,
						macros: pipeline.macros,
						labels: pipeline.labels,
						omitReason: pipeline.macros ? undefined : 'macros omitted'
					});
					writeFileSync(ROWS_PATH, JSON.stringify([...done.values()], null, 2));

					console.log(
						`[backfill] ${done.size}/${entries.length} ${title.slice(0, 40)} conf=${pipeline.macros?.confidence ?? 'omit'} labels=${pipeline.labels.length} pantry=${published}${published === false ? ` — ${publishReason}` : ''}`
					);
				} catch (err: any) {
					fail(err?.message || String(err), { recipePubkey, recipeDTag });
				}

				await sleep(RATE_LIMIT_MS);
			}

			// Pantry sync — re-publish EVERY scored row this run, regardless of
			// checkpoint publish status. When the read relay already holds the
			// current-prompt-version signed event, forward it verbatim (byte-
			// identical to the public copy, no re-scoring); otherwise fall back
			// to a fresh pipeline run.
			if (PRIV_BYTES) {
				const pending = [...done.entries()].filter(
					([dTag, row]) => !row.error && !publishedThisRun.has(dTag)
				);
				console.log(`[backfill] pantry sync: re-publishing ${pending.length} scored rows`);
				let n = 0;
				for (const [dTag, row] of pending) {
					n++;
					const corpusEv = byD.get(dTag);
					const corpusVersion = corpusEv?.tags?.find(
						(t: string[]) => t[0] === 'prompt_version'
					)?.[1];

					let outcome: PantryResult;
					if (corpusEv && corpusVersion === NOURISH_PROMPT_VERSION) {
						outcome = await publishToPantry(corpusEv, PRIV_BYTES);
						done.set(dTag, { ...row, published: outcome.accepted, publishReason: outcome.reason });
					} else {
						try {
							const { res, macros, labels } = await rescoreAndPublish(row, PRIV_BYTES);
							outcome = res;
							done.set(dTag, {
								...row,
								published: res.accepted,
								publishReason: res.reason,
								...(macros ? { macros } : {}),
								...(labels ? { labels } : {})
							});
						} catch (err: any) {
							outcome = { accepted: false, reason: err?.message || String(err) };
							done.set(dTag, { ...row, published: false, publishReason: outcome.reason });
						}
					}

					console.log(
						`[backfill] pantry ${n}/${pending.length} ${(row.title || dTag).slice(0, 40)} accepted=${outcome.accepted}${outcome.accepted ? '' : ` — ${outcome.reason}`}`
					);
					writeFileSync(ROWS_PATH, JSON.stringify([...done.values()], null, 2));
					await sleep(RATE_LIMIT_MS);
				}
			}

			const { md, census } = writeCensus([...done.values()], entries.length);
			console.log(md);
			expect(census.scored).toBeGreaterThan(0);

			if (PRIV_BYTES) {
				const notAccepted = [...done.values()].filter((r) => !r.error && r.published !== true);
				for (const r of notAccepted) {
					console.error(
						`[backfill] NOT ACCEPTED 30023:${r.recipePubkey}:${r.recipeDTag} — ${r.publishReason || 'no OK received'}`
					);
				}
				console.log(
					`[backfill] pantry acceptances: ${census.published}/${census.scored} (rejections/no-OK: ${notAccepted.length})`
				);
				expect(
					notAccepted.length,
					'every scored row must be ACCEPTED by pantry (OK accepted=true) — sends do not count'
				).toBe(0);
			}
		},
		40 * 60 * 1000
	);
});
