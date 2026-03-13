<script lang="ts">
	import { onDestroy } from 'svelte';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
	import InfoIcon from 'phosphor-svelte/lib/Info';

	/** NIP-85 trust rank, 0-100 integer scale */
	export let rank: number | undefined = undefined;
	/** Whether this score is personalized to the user's Web of Trust */
	export let personalized: boolean = false;

	// Only show badge for scores above a meaningful threshold
	$: visible = rank !== undefined && rank >= 20;

	$: level = !rank ? 'none' : rank >= 70 ? 'high' : rank >= 40 ? 'medium' : 'low';

	$: label =
		level === 'high'
			? 'Highly trusted'
			: level === 'medium'
				? 'Trusted'
				: 'Known';

	let showTooltip = false;
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;
	const tooltipId = 'trust-badge-tooltip';

	function show() {
		if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
		showTooltip = true;
	}

	function scheduleHide() {
		if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
		hideTimeout = setTimeout(() => { showTooltip = false; }, 200);
	}

	onDestroy(() => {
		if (hideTimeout) clearTimeout(hideTimeout);
	});
</script>

{#if visible}
	<span
		class="trust-badge trust-{level}"
		tabindex="0"
		role="button"
		aria-label={`Trust score: ${label}${rank !== undefined ? ` (${rank}/100)` : ''}`}
		aria-expanded={showTooltip}
		aria-controls={tooltipId}
		on:mouseenter={show}
		on:mouseleave={scheduleHide}
		on:focus={show}
		on:blur={scheduleHide}
		on:click|stopPropagation|preventDefault={() => (showTooltip = !showTooltip)}
		on:keydown={(e) => {
			if (e.key === 'Escape') showTooltip = false;
		}}
	>
		<ShieldCheckIcon size={14} weight="fill" />
		<span class="trust-label">{label}</span>

		{#if showTooltip}
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div
				id={tooltipId}
				class="tooltip"
				on:mouseenter={show}
				on:mouseleave={scheduleHide}
				on:click|stopPropagation
			>
				<div class="tooltip-row">
					<span class="tooltip-score">{rank} <span class="score-max">/ 100</span></span>
					<span class="tooltip-level">{label}</span>
				</div>
				<div class="tooltip-source">
					{#if personalized}
						Personalized to your Web of Trust
					{:else}
						Based on global Web of Trust
					{/if}
				</div>
				<a href="/market/trust" class="learn-more" on:click|stopPropagation>
					<InfoIcon size={11} />
					Learn more
				</a>
			</div>
		{/if}
	</span>
{/if}

<style lang="postcss">
	@reference "../../app.css";

	.trust-badge {
		@apply inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap cursor-help;
		line-height: 1;
		position: relative;
	}

	.trust-badge:hover {
		filter: brightness(1.15);
	}

	.trust-high {
		color: #16a34a;
		background-color: rgba(22, 163, 74, 0.12);
	}

	.trust-medium {
		color: #d97706;
		background-color: rgba(217, 119, 6, 0.12);
	}

	.trust-low {
		color: #6b7280;
		background-color: rgba(107, 114, 128, 0.1);
	}

	.trust-label {
		font-size: 0.65rem;
		font-weight: 600;
	}

	/* --- Compact tooltip --- */

	.tooltip {
		position: absolute;
		top: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		width: 200px;
		padding: 10px 12px;
		border-radius: 10px;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		text-align: left;
		white-space: normal;
		cursor: default;
	}

	/* Bridge the gap between badge and tooltip so mouse doesn't fall through */
	.tooltip::before {
		content: '';
		position: absolute;
		top: -8px;
		left: 0;
		right: 0;
		height: 8px;
	}

	.tooltip-row {
		@apply flex items-baseline justify-between mb-1;
	}

	.tooltip-score {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1;
	}

	.score-max {
		font-size: 0.7rem;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.tooltip-level {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.tooltip-source {
		font-size: 0.65rem;
		color: var(--color-text-secondary);
		opacity: 0.8;
		margin-bottom: 6px;
	}

	.learn-more {
		@apply flex items-center gap-1 text-xs;
		color: var(--color-accent, #f97316);
		font-weight: 500;
		text-decoration: none;
	}

	.learn-more:hover {
		text-decoration: underline;
	}
</style>
