<script lang="ts">
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { ndk, userPublickey } from '$lib/nostr';
	import Modal from '../Modal.svelte';
	import Button from '../Button.svelte';
	import LeafIcon from 'phosphor-svelte/lib/Leaf';
	import LockIcon from 'phosphor-svelte/lib/Lock';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
	import { parseMarkdownForEditing } from '$lib/parser';
	import {
		setNourishScores,
		clearNourishCache,
		type NourishCacheKey
	} from '$lib/nourish/cache';
	import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
	import { ingredientStore } from '$lib/nourish/ingredientStore';
	import { computeContentHash, queryNourishEvent } from '$lib/nourish/nourishRelay';
	import { resolveScore, purgeMemory, type ResolveResult } from '$lib/nourish/scoreResolver';
	import type { NourishScores } from '$lib/nourish/types';
	import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
	import type { FlagTarget } from '$lib/nourish/flagSubmit';
	import { onMount, onDestroy } from 'svelte';
	import NourishResult from './NourishResult.svelte';
	import NourishLoadingState from './NourishLoadingState.svelte';

	export let open = false;
	export let event: NDKEvent;
	export let hasMembership = false;

	// Flag target for the per-dimension flag affordance inside NourishResult.
	// Derived from the recipe's NIP-01 addressable form. The Nourish event's
	// own id isn't tracked on this component today, so the `a`-tag is the
	// sole identifier in the flag; admin aggregation uses the a-tag to group.
	$: flagTarget = scores
		? ({
				kind: 'recipe',
				aTag: `${event.kind}:${event.author?.hexpubkey || event.pubkey}:${
					event.tags.find((t) => t[0] === 'd')?.[1] || ''
				}`
			} satisfies FlagTarget)
		: null;

	let scores: NourishScores | null = null;
	let improvements: string[] = [];
	let loading = false;
	let checking = false;
	let stale = false;
	let analyzedAt = 0;
	let error = '';
	// Pantry-timeout state — set when resolveScore returns
	// { status: 'timeout' } (drift #1 fix: no more silent compute on
	// pantry failure). Retry UI consumes attemptCount to decide when
	// to surface the "Score now" escape hatch.
	let pantryTimeout = false;
	let attemptCount = 0;
	let isOffline = false;

	// Latch to prevent the reactive open-guard from re-firing fetchScores
	// when the `checking` flag flips false → false on a miss. Without
	// this, miss/timeout states would loop because the guard's deps
	// re-evaluate on every `checking` transition. Cleared on modal close
	// and on explicit handleRetry so retries still fire.
	let fetched = false;

	// Online/offline listeners — low-cost navigator.onLine check per
	// the Phase 2 refinement. Accepts occasional false "offline"
	// states; retry button dismisses it anyway.
	function handleOnline() { isOffline = false; }
	function handleOffline() { isOffline = true; }
	onMount(() => {
		if (typeof navigator === 'undefined') return;
		isOffline = !navigator.onLine;
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
	});
	onDestroy(() => {
		if (typeof window === 'undefined') return;
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	});

	// Open modal: anyone can VIEW existing scores, only members can GENERATE new ones
	$: if (open && !scores && !loading && !checking && !pantryTimeout && !fetched) {
		fetched = true;
		fetchScores();
	}
	$: if (!open) {
		error = '';
		stale = false;
		pantryTimeout = false;
		attemptCount = 0;
		fetched = false;
	}

	function getRecipeCoordinates() {
		const recipePubkey = event.author?.hexpubkey || event.pubkey;
		const recipeDTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
		return { recipePubkey, recipeDTag };
	}

	// The resolver (scoreResolver.ts) owns the hex-64 + non-empty-d-tag
	// guard on read paths. analyzeRecipe's post-API write still needs a
	// local guard so a malformed recipe event doesn't write a colliding
	// localStorage key.
	const HEX_64_RE = /^[a-fA-F0-9]{64}$/;
	function toCacheKey(recipePubkey: string, recipeDTag: string) {
		if (!recipeDTag || !HEX_64_RE.test(recipePubkey)) return null;
		return { recipePubkey, recipeDTag, promptVersion: NOURISH_PROMPT_VERSION };
	}

	async function fetchScores() {
		const { recipePubkey, recipeDTag } = getRecipeCoordinates();
		const key: NourishCacheKey = {
			recipePubkey,
			recipeDTag,
			promptVersion: NOURISH_PROMPT_VERSION
		};

		checking = true;
		error = '';
		pantryTimeout = false;
		let result: ResolveResult = { status: 'miss' };
		try {
			result = await resolveScore($ndk, key);
		} finally {
			checking = false;
		}

		if (result.status === 'hit') {
			scores = result.entry.scores;
			improvements = [];
			buildImprovements(result.entry.scores, result.entry.improvements);
			analyzedAt = result.entry.createdAt;

			// Preserve the original ingredient-store semantics: save only on
			// a pantry hit (first-time surfacing of this event in a session).
			// L2/memory and L3/localStorage hits were written from a prior
			// pantry hit that already saved the signals.
			if (result.source === 'pantry' && result.entry.ingredientSignals?.length) {
				ingredientStore
					.saveIngredients(
						result.entry.ingredientSignals,
						'recipe',
						event.id,
						result.entry.promptVersion
					)
					.catch(() => {});
			}

			// Preserve the original blocking-vs-nonblocking staleness pattern:
			// pantry hit awaits the content-hash comparison (so stale renders
			// before the modal settles); L2/L3 hits fire-and-forget (so the
			// score displays immediately and the stale badge lights up after).
			if (result.entry.contentHash) {
				const pending = computeContentHash(event.content || '').then((currentHash) => {
					if (currentHash !== result.entry.contentHash) stale = true;
				}).catch(() => {});
				if (result.source === 'pantry') await pending;
			}
			return;
		}

		if (result.status === 'timeout') {
			// Drift #1 fix: pantry is unreachable and we have no local
			// score. Surface a retry UI instead of silently computing a
			// fresh score via /api/nourish — compute now requires an
			// explicit user click.
			pantryTimeout = true;
			attemptCount = result.attemptCount;
			return;
		}

		// Miss — pantry confirmed no event. Members see an [Analyze]
		// button via NourishLoadingState; non-members see the lock-state
		// membership upsell. Compute fires only on explicit click — no
		// more silent fall-through.
	}

	async function analyzeRecipe() {
		loading = true;
		error = '';
		stale = false;
		try {
			const title = event.tags.find((t) => t[0] === 'title')?.[1] || event.tags.find((t) => t[0] === 'd')?.[1] || '';
			const tags = event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]);
			const info = parseMarkdownForEditing(event.content);
			const servings = info.information?.servings || '';

			if (info.ingredients.length === 0) { error = 'No ingredients found in this recipe.'; loading = false; return; }

			// Compute content hash for staleness tracking
			const contentHash = await computeContentHash(event.content || '');
			const { recipePubkey, recipeDTag } = getRecipeCoordinates();

			const res = await fetch('/api/nourish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pubkey: $userPublickey || '',
					eventId: event.id,
					title,
					ingredients: info.ingredients,
					tags,
					servings,
					recipePubkey,
					recipeDTag,
					contentHash
				})
			});
			const data = await res.json();
			if (!data.success) { error = data.error || 'Failed to analyze recipe.'; return; }

			scores = data.scores;
			analyzedAt = data.createdAt ?? Math.floor(Date.now() / 1000);
			const writeKey = toCacheKey(recipePubkey, recipeDTag);
			if (writeKey) {
				setNourishScores(
					{ ...writeKey, promptVersion: data.promptVersion ?? NOURISH_PROMPT_VERSION },
					data.scores,
					{
						contentHash,
						createdAt: data.createdAt,
						improvements: data.improvements,
						ingredientSignals: data.ingredient_signals
					}
				);
			}
			buildImprovements(data.scores, data.improvements);

			if (data.ingredient_signals?.length > 0) {
				ingredientStore
					.saveIngredients(data.ingredient_signals, 'recipe', event.id, data.promptVersion)
					.catch(() => {});
			}
		} catch (err) {
			console.error('[Nourish] Fetch error:', err);
			error = 'Could not analyze this recipe. Please try again.';
		} finally { loading = false; }
	}

	function buildImprovements(s: NourishScores, llm?: string[]) {
		improvements = mergeImprovements(generateSuggestions(s), llm || []);
	}

	function retry() { scores = null; analyzeRecipe(); }

	// Refresh the stale banner's score without unconditionally burning
	// an LLM call. Flow:
	//   1. Purge local cache under the current key (L2 + L3)
	//   2. Query pantry directly — skipping resolveScore avoids a
	//      speculative write-through of whatever pantry returns, since
	//      we only want to cache a score whose contentHash matches the
	//      recipe as it exists NOW.
	//   3. If pantry has a fresh-hash version (e.g. another client
	//      already rescored), use it + write through.
	//   4. Otherwise fall through to analyzeRecipe — this path was
	//      always the old behavior; it's the expensive fallback.
	// Closes drift source #5 (refresh button unconditionally computes).
	async function reanalyze() {
		scores = null;
		stale = false;

		const { recipePubkey, recipeDTag } = getRecipeCoordinates();
		const key: NourishCacheKey = {
			recipePubkey,
			recipeDTag,
			promptVersion: NOURISH_PROMPT_VERSION
		};

		purgeMemory(key);
		clearNourishCache(key);

		checking = true;
		try {
			const currentHash = await computeContentHash(event.content || '');
			const pantry = await queryNourishEvent($ndk, recipePubkey, recipeDTag);
			if (pantry.status === 'hit' && pantry.result.contentHash === currentHash) {
				// Pantry already has the fresh-hash version — use it, no
				// LLM call. Write-through so subsequent mounts skip the
				// pantry query.
				scores = pantry.result.scores;
				analyzedAt = pantry.result.createdAt;
				buildImprovements(pantry.result.scores, pantry.result.improvements);
				setNourishScores(
					{ ...key, promptVersion: pantry.result.promptVersion },
					pantry.result.scores,
					{
						contentHash: pantry.result.contentHash,
						createdAt: pantry.result.createdAt,
						improvements: pantry.result.improvements,
						ingredientSignals: pantry.result.ingredientSignals
					}
				);
				return;
			}
		} finally {
			checking = false;
		}

		// Pantry miss, timeout, or pantry's version still carries the
		// old (stale) content hash → compute fresh.
		await analyzeRecipe();
	}

	// Retry-UI handlers. handleRetry re-runs the resolver (next pantry
	// query); handleAnalyze commits to an explicit compute. The "Score
	// now" escape hatch also routes through handleAnalyze — member
	// gating is enforced both by NourishLoadingState hiding the button
	// for non-members AND by the existing paywall path below.
	function handleRetry() {
		// Clear the flags and let the reactive guard re-fire fetchScores.
		// Calling fetchScores directly here would double-fire because
		// the guard re-evaluates when pantryTimeout flips to false.
		pantryTimeout = false;
		fetched = false;
	}
	function handleAnalyze() {
		pantryTimeout = false;
		if (!hasMembership) return;
		analyzeRecipe();
	}

	// Derived state for the shared NourishLoadingState component. Order
	// of precedence: offline > pending (network in flight) > timeout >
	// miss (no data, show [Analyze] for members). Explicit type so the
	// ternary chain doesn't widen to `string` for the child prop.
	let loadingState: 'pending' | 'timeout' | 'miss' | 'offline' = 'pending';
	$: loadingState = isOffline
		? 'offline'
		: checking || loading
			? 'pending'
			: pantryTimeout
				? 'timeout'
				: 'miss';

	function formatAnalyzedAt(ts: number): string {
		if (!ts) return '';
		const diff = Math.floor(Date.now() / 1000) - ts;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
		return new Date(ts * 1000).toLocaleDateString();
	}
</script>

<Modal bind:open compact noHeader>
	<h2 id="title" class="sr-only">Nourish analysis</h2>
	{#if scores}
		<!-- ── Stale banner ── -->
		{#if stale}
			<div class="stale-banner">
				<p class="stale-text">This recipe has been updated since this profile was created.</p>
				{#if hasMembership}
					<button class="stale-refresh" on:click={reanalyze}>
						<ArrowClockwiseIcon size={14} />
						Refresh
					</button>
				{/if}
			</div>
		{/if}

		<NourishResult
			{scores}
			{improvements}
			{flagTarget}
			nourishVer={NOURISH_PROMPT_VERSION}
			compact
		/>

		<div class="modal-footer">
			<p class="footer-disclaimer">
				{#if analyzedAt}
					Analyzed {formatAnalyzedAt(analyzedAt)}.
				{/if}
				<a href="/nourish" class="footer-link">Explore Nourish</a>
			</p>
		</div>

	{:else if !hasMembership}
		<!-- Lock state — non-members see the membership upsell regardless
		     of pantry reachability. They can't compute, so the retry UI
		     and "not yet scored" miss state wouldn't be actionable. -->
		<div class="lock-state">
			<div class="lock-icon-wrap">
				<LockIcon size={24} weight="fill" class="text-orange-500" />
			</div>
			<h3 class="lock-title">Unlock Nourish</h3>
			<p class="lock-desc">See how this recipe scores for gut health, protein, and real food quality.</p>
			<a href="/membership" class="w-full"><Button primary>View Membership</Button></a>
		</div>

	{:else if error}
		<div class="error-state">
			<p class="error-text">{error}</p>
			<Button primary={false} on:click={retry}>Try Again</Button>
		</div>

	{:else}
		<!-- Shared loading/retry/miss/offline UI. loadingState is derived
		     above; the component dispatches retry/score-now/analyze. -->
		<NourishLoadingState
			state={loadingState}
			{attemptCount}
			{hasMembership}
			on:retry={handleRetry}
			on:score-now={handleAnalyze}
			on:analyze={handleAnalyze}
		/>
	{/if}
</Modal>

<style lang="postcss">
	@reference "../../app.css";

	/* ── Lock ── */
	.lock-state { @apply flex flex-col items-center text-center gap-3 py-4; }
	.lock-icon-wrap {
		@apply w-12 h-12 rounded-full flex items-center justify-center;
		background-color: rgba(249, 115, 22, 0.08);
	}
	.lock-title { @apply text-lg font-semibold; color: var(--color-text-primary); }
	.lock-desc { @apply text-sm; color: var(--color-text-secondary); }

	/* ── Stale banner ── */
	.stale-banner {
		@apply flex items-center justify-between gap-2 px-3 py-2 rounded-lg mb-3 text-xs;
		background-color: rgba(234, 179, 8, 0.1);
		border: 1px solid rgba(234, 179, 8, 0.2);
	}
	.stale-text { color: var(--color-text-secondary); }
	.stale-refresh {
		@apply inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer whitespace-nowrap;
		color: #eab308;
		background: rgba(234, 179, 8, 0.1);
		border: none;
	}
	.stale-refresh:hover { background: rgba(234, 179, 8, 0.2); }

	/* ── Loading / Error ── */
	.error-state { @apply flex flex-col items-center text-center gap-3 py-4; }
	.error-text { @apply text-sm; color: var(--color-text-secondary); }

	/* ── Footer ── */
	.modal-footer {
		@apply pt-3 mt-3 text-center;
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
	}
	.footer-disclaimer {
		@apply text-xs;
		color: var(--color-text-secondary);
		opacity: 0.4;
	}
	.footer-link {
		color: var(--color-accent, #f97316);
	}
	.footer-link:hover { text-decoration: underline; }
</style>
