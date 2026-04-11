<script lang="ts">
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { ndk, userPublickey } from '$lib/nostr';
	import Modal from '../Modal.svelte';
	import Button from '../Button.svelte';
	import LeafIcon from 'phosphor-svelte/lib/Leaf';
	import LockIcon from 'phosphor-svelte/lib/Lock';
	import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
	import { parseMarkdownForEditing } from '$lib/parser';
	import { getNourishCache, setNourishScores } from '$lib/nourish/cache';
	import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
	import { ingredientStore } from '$lib/nourish/ingredientStore';
	import { fetchNourishEvent, isNourishStale, computeContentHash } from '$lib/nourish/nourishRelay';
	import type { NourishScores } from '$lib/nourish/types';

	export let open = false;
	export let event: NDKEvent;
	export let hasMembership = false;

	let scores: NourishScores | null = null;
	let improvements: string[] = [];
	let loading = false;
	let checking = false;
	let stale = false;
	let analyzedAt = 0;
	let error = '';
	let expandedScore: string | null = null;

	// Open modal: anyone can VIEW existing scores, only members can GENERATE new ones
	$: if (open && !scores && !loading && !checking) { fetchScores(); }
	$: if (!open) { error = ''; expandedScore = null; stale = false; }

	function toggleExpand(key: string) {
		expandedScore = expandedScore === key ? null : key;
	}

	function getRecipeCoordinates() {
		const recipePubkey = event.author?.hexpubkey || event.pubkey;
		const recipeDTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
		return { recipePubkey, recipeDTag };
	}

	async function fetchScores() {
		// 1. Check localStorage cache (instant)
		const cached = getNourishCache(event.id);
		if (cached) {
			scores = cached.scores;
			improvements = [];
			buildImprovements(cached.scores, cached.improvements);
			// Check staleness against current content if we have a hash
			if (cached.contentHash) {
				computeContentHash(event.content || '').then((currentHash) => {
					if (currentHash !== cached.contentHash) {
						stale = true;
					}
				}).catch(() => {});
			}
			analyzedAt = cached.timestamp ? Math.floor(cached.timestamp / 1000) : 0;
			return;
		}

		// 2. Check pantry relay for existing analysis (fast, ~200ms)
		checking = true;
		error = '';
		try {
			const { recipePubkey, recipeDTag } = getRecipeCoordinates();
			if (recipePubkey && recipeDTag && $ndk) {
				const relayResult = await fetchNourishEvent($ndk, recipePubkey, recipeDTag);
				if (relayResult) {
					scores = relayResult.scores;
					buildImprovements(relayResult.scores, relayResult.improvements);
					analyzedAt = relayResult.createdAt;

					// Cache locally for next time
					setNourishScores(event.id, relayResult.scores, {
						contentHash: relayResult.contentHash,
						improvements: relayResult.improvements
					});

					// Populate ingredient store from relay data (build dataset over time)
					if (relayResult.ingredientSignals.length > 0) {
						ingredientStore.saveIngredients(relayResult.ingredientSignals, 'recipe', event.id).catch(() => {});
					}

					// Check staleness
					const isStale = await isNourishStale(relayResult, event.content || '');
					stale = isStale;

					checking = false;
					return;
				}
			}
		} catch {
			// Relay query failed — fall through to API
		}
		checking = false;

		// 3. No existing analysis — call API (requires membership)
		if (!hasMembership) {
			// No cached score and no membership — show lock state
			return;
		}
		await analyzeRecipe();
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
			analyzedAt = Math.floor(Date.now() / 1000);
			setNourishScores(event.id, data.scores, {
				contentHash,
				improvements: data.improvements,
				ingredientSignals: data.ingredient_signals
			});
			buildImprovements(data.scores, data.improvements);

			if (data.ingredient_signals?.length > 0) {
				ingredientStore.saveIngredients(data.ingredient_signals, 'recipe', event.id).catch(() => {});
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

	function reanalyze() { scores = null; stale = false; analyzeRecipe(); }

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
	{#if !hasMembership && !scores && !checking}
		<!-- Lock state — only shown if no existing scores exist -->
		<div class="lock-state">
			<div class="lock-icon-wrap">
				<LockIcon size={24} weight="fill" class="text-orange-500" />
			</div>
			<h3 class="lock-title">Unlock Nourish</h3>
			<p class="lock-desc">See how this recipe scores for gut health, protein, and real food quality.</p>
			<a href="/membership" class="w-full"><Button primary>View Membership</Button></a>
		</div>

	{:else if checking}
		<div class="loading-state">
			<SpinnerIcon size={28} class="animate-spin text-green-500" />
			<p class="loading-text">Checking for analysis...</p>
		</div>

	{:else if loading}
		<div class="loading-state">
			<SpinnerIcon size={28} class="animate-spin text-green-500" />
			<p class="loading-text">Analyzing recipe...</p>
		</div>

	{:else if error}
		<div class="error-state">
			<p class="error-text">{error}</p>
			<Button primary={false} on:click={retry}>Try Again</Button>
		</div>

	{:else if scores}
		<!-- ── Stale banner ── -->
		{#if stale}
			<div class="stale-banner">
				<p class="stale-text">Recipe updated since this analysis</p>
				{#if hasMembership}
					<button class="stale-refresh" on:click={reanalyze}>
						<ArrowClockwiseIcon size={14} />
						Re-analyze
					</button>
				{/if}
			</div>
		{/if}

		<!-- ── Hero: Overall Score ── -->
		<div class="hero-score">
			<div class="hero-icon">
				<LeafIcon size={20} weight="fill" class="text-green-500" />
			</div>
			<div class="hero-number" style="color: #a855f7;">
				{scores.overall?.score ?? '—'}<span class="hero-max">/10</span>
			</div>
			<div class="hero-label">{scores.overall?.label ?? ''}</div>
			{#if scores.summary}
				<p class="hero-summary">{scores.summary}</p>
			{/if}
		</div>

		<!-- ── Subscores ── -->
		<div class="subscores">
			{#each [
				{ key: 'realFood', label: 'Real Food', color: '#f97316', detail: scores.realFood },
				{ key: 'gut', label: 'Gut', color: '#22c55e', detail: scores.gut },
				{ key: 'protein', label: 'Protein', color: '#3b82f6', detail: scores.protein }
			] as item}
				<button
					class="subscore-row"
					on:click={() => toggleExpand(item.key)}
					aria-expanded={expandedScore === item.key}
				>
					<div class="subscore-info">
						<span class="subscore-label">{item.label}</span>
						<span class="subscore-value" style="color: {item.color};">
							{item.detail.score}<span class="subscore-max">/10</span>
						</span>
					</div>
					<div class="subscore-bar-track">
						<div class="subscore-bar-fill" style="width: {item.detail.score * 10}%; background: {item.color};" />
					</div>
					<div class="subscore-expand-hint">
						<span class="subscore-tag">{item.detail.label}</span>
						<span class="expand-caret" class:expanded={expandedScore === item.key}><CaretDownIcon size={12} /></span>
					</div>
				</button>
				{#if expandedScore === item.key && item.detail.reason}
					<p class="subscore-reason">{item.detail.reason}</p>
				{/if}
			{/each}
		</div>

		<!-- ── Improvements ── -->
		{#if improvements.length > 0}
			<div class="improvements">
				<p class="improvements-title">Simple upgrades</p>
				{#each improvements as s}
					<div class="improvement-item">{s}</div>
				{/each}
			</div>
		{/if}

		<!-- ── Footer ── -->
		<div class="modal-footer">
			<p class="footer-philosophy">Nourish helps you understand what a meal leans toward — so you can adjust, not judge.</p>
			<p class="footer-disclaimer">
				Estimates based on ingredients. Not medical advice.
				{#if analyzedAt}
					Analyzed {formatAnalyzedAt(analyzedAt)}.
				{/if}
				<a href="/nourish" class="footer-link">Learn more</a>
			</p>
		</div>
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
	.loading-state { @apply flex flex-col items-center gap-3 py-8; }
	.loading-text { @apply text-sm; color: var(--color-text-secondary); }
	.error-state { @apply flex flex-col items-center text-center gap-3 py-4; }
	.error-text { @apply text-sm; color: var(--color-text-secondary); }

	/* ── Hero score ── */
	.hero-score {
		@apply flex flex-col items-center text-center pb-4 mb-1;
		border-bottom: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
	}
	.hero-icon { @apply mb-2; }
	.hero-number {
		@apply text-4xl font-bold leading-none;
	}
	.hero-max {
		@apply text-base font-normal;
		color: var(--color-text-secondary);
	}
	.hero-label {
		@apply text-sm font-semibold mt-1;
		color: var(--color-text-secondary);
	}
	.hero-summary {
		@apply text-xs leading-relaxed mt-2 max-w-sm;
		color: var(--color-text-secondary);
		opacity: 0.8;
	}

	/* ── Subscores ── */
	.subscores {
		@apply flex flex-col py-2;
	}
	.subscore-row {
		@apply w-full text-left py-2.5 cursor-pointer transition-colors;
		border-bottom: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
	}
	.subscore-row:last-child { border-bottom: none; }
	.subscore-row:hover { opacity: 0.9; }
	.subscore-info {
		@apply flex items-center justify-between mb-1.5;
	}
	.subscore-label {
		@apply text-sm font-medium;
		color: var(--color-text-primary);
	}
	.subscore-value {
		@apply text-sm font-bold;
	}
	.subscore-max {
		@apply text-xs font-normal;
		color: var(--color-text-secondary);
	}
	.subscore-bar-track {
		@apply w-full h-1 rounded-full mb-1.5;
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
	}
	.subscore-bar-fill {
		@apply h-full rounded-full transition-all duration-500 ease-out;
	}
	.subscore-expand-hint {
		@apply flex items-center justify-between;
	}
	.subscore-tag {
		@apply text-xs;
		color: var(--color-text-secondary);
		opacity: 0.7;
	}
	.expand-caret {
		@apply inline-flex;
		color: var(--color-text-secondary);
		opacity: 0.4;
		transition: transform 0.2s ease;
	}
	.expand-caret.expanded {
		transform: rotate(180deg);
	}
	.subscore-reason {
		@apply text-xs leading-relaxed pb-2 pl-0;
		color: var(--color-text-secondary);
		opacity: 0.8;
		border-bottom: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
	}

	/* ── Improvements ── */
	.improvements {
		@apply pt-3 mt-1;
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
	}
	.improvements-title {
		@apply text-sm font-semibold mb-2;
		color: var(--color-text-primary);
	}
	.improvement-item {
		@apply text-xs py-1.5 pl-3;
		color: var(--color-text-secondary);
		border-left: 2px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
	}

	/* ── Footer ── */
	.modal-footer {
		@apply pt-3 mt-3 text-center;
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
	}
	.footer-philosophy {
		@apply text-xs mb-1;
		color: var(--color-text-secondary);
		opacity: 0.6;
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
