<script lang="ts">
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { userPublickey } from '$lib/nostr';
	import Modal from '../Modal.svelte';
	import Button from '../Button.svelte';
	import NourishScoreCard from './NourishScoreCard.svelte';
	import LeafIcon from 'phosphor-svelte/lib/Leaf';
	import LockIcon from 'phosphor-svelte/lib/Lock';
	import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
	import { parseMarkdownForEditing } from '$lib/parser';
	import { getNourishScores, setNourishScores } from '$lib/nourish/cache';
	import { generateSuggestions, mergeImprovements } from '$lib/nourish/suggestions';
	import { ingredientStore } from '$lib/nourish/ingredientStore';
	import type { NourishScores } from '$lib/nourish/types';

	export let open = false;
	export let event: NDKEvent;
	export let hasMembership = false;

	let scores: NourishScores | null = null;
	let improvements: string[] = [];
	let loading = false;
	let error = '';

	// Score display colors
	const SCORE_COLORS = {
		gut: '#22c55e',
		protein: '#3b82f6',
		realFood: '#f97316'
	};

	// Fetch or load scores when modal opens
	$: if (open && hasMembership && !scores && !loading) {
		fetchScores();
	}

	// Reset state when modal closes
	$: if (!open) {
		error = '';
	}

	async function fetchScores() {
		// Check cache first
		const cached = getNourishScores(event.id);
		if (cached) {
			scores = cached;
			return;
		}

		loading = true;
		error = '';

		try {
			// Extract recipe data from event
			const title =
				event.tags.find((t) => t[0] === 'title')?.[1] ||
				event.tags.find((t) => t[0] === 'd')?.[1] ||
				'';

			const tags = event.tags
				.filter((t) => t[0] === 't' && t[1])
				.map((t) => t[1]);

			const info = parseMarkdownForEditing(event.content);
			const servings = info.information?.servings || '';

			if (info.ingredients.length === 0) {
				error = 'No ingredients found in this recipe.';
				loading = false;
				return;
			}

			const res = await fetch('/api/nourish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pubkey: $userPublickey || '',
					eventId: event.id,
					title,
					ingredients: info.ingredients,
					tags,
					servings
				})
			});

			const data = await res.json();

			if (!data.success) {
				error = data.error || 'Failed to analyze recipe.';
				return;
			}

			scores = data.scores;
			setNourishScores(event.id, data.scores);

			// Build upgrade suggestions (rule-based + LLM)
			if (data.scores) {
				improvements = mergeImprovements(
					generateSuggestions(data.scores),
					data.improvements || []
				);
			}

			// Fire-and-forget: save ingredient signals
			if (data.ingredient_signals?.length > 0) {
				ingredientStore.saveIngredients(data.ingredient_signals, 'recipe', event.id).catch(() => {});
			}
		} catch (err) {
			console.error('[Nourish] Fetch error:', err);
			error = 'Could not analyze this recipe. Please try again.';
		} finally {
			loading = false;
		}
	}

	function retry() {
		scores = null;
		fetchScores();
	}
</script>

<Modal bind:open compact>
	<svelte:fragment slot="title">
		<span class="flex items-center gap-2">
			<LeafIcon size={20} weight="fill" class="text-green-500" />
			Nourish Scores
		</span>
	</svelte:fragment>

	{#if !hasMembership}
		<!-- Premium lock state -->
		<div class="flex flex-col items-center text-center gap-4 py-4">
			<div
				class="w-14 h-14 rounded-full flex items-center justify-center"
				style="background-color: rgba(249, 115, 22, 0.1);"
			>
				<LockIcon size={28} weight="fill" class="text-orange-500" />
			</div>
			<div class="flex flex-col gap-1">
				<h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
					Unlock Nourish Scores
				</h3>
				<p class="text-sm" style="color: var(--color-text-secondary);">
					See how every recipe stacks up for gut health, protein, and real food quality.
					Available exclusively for members.
				</p>
			</div>
			<a href="/membership" class="w-full">
				<Button primary>View Membership Options</Button>
			</a>
		</div>
	{:else if loading}
		<!-- Loading state -->
		<div class="flex flex-col items-center gap-3 py-8">
			<SpinnerIcon size={32} class="animate-spin text-green-500" />
			<p class="text-sm" style="color: var(--color-text-secondary);">Analyzing recipe...</p>
		</div>
	{:else if error}
		<!-- Error state -->
		<div class="flex flex-col items-center text-center gap-3 py-4">
			<p class="text-sm" style="color: var(--color-text-secondary);">{error}</p>
			<Button primary={false} on:click={retry}>Try Again</Button>
		</div>
	{:else if scores}
		<!-- Scores display -->
		<div class="flex flex-col">
			<NourishScoreCard
				label="Gut Score"
				subtitle="Digestive health potential"
				score={scores.gut.score}
				scoreLabel={scores.gut.label}
				reason={scores.gut.reason}
				color={SCORE_COLORS.gut}
			/>
			<NourishScoreCard
				borderTop
				label="Protein Score"
				subtitle="Protein source quality"
				score={scores.protein.score}
				scoreLabel={scores.protein.label}
				reason={scores.protein.reason}
				color={SCORE_COLORS.protein}
			/>
			<NourishScoreCard
				borderTop
				label="Real Food Score"
				subtitle="Whole food ingredients"
				score={scores.realFood.score}
				scoreLabel={scores.realFood.label}
				reason={scores.realFood.reason}
				color={SCORE_COLORS.realFood}
			/>

			{#if scores.summary}
				<p
					class="text-sm leading-relaxed mt-2 pt-3"
					style="color: var(--color-text-secondary); border-top: 1px solid var(--color-bg-tertiary, rgba(255,255,255,0.08));"
				>
					{scores.summary}
				</p>
			{/if}

			{#if improvements.length > 0}
				<div class="mt-2 pt-3" style="border-top: 1px solid var(--color-bg-tertiary, rgba(255,255,255,0.08));">
					<p class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">Upgrade It</p>
					<ul class="text-sm pl-4 list-disc" style="color: var(--color-text-secondary);">
						{#each improvements as suggestion}
							<li class="py-0.5">{suggestion}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<p class="text-xs mt-3" style="color: var(--color-text-secondary); opacity: 0.7;">
			Estimates based on ingredient analysis. Not medical advice.
			<a href="/nourish" class="underline hover:no-underline" style="color: var(--color-accent, #f97316);">Learn more</a>
		</p>
	{/if}
</Modal>
