<script lang="ts">
	import { onDestroy } from 'svelte';
	import InfoIcon from 'phosphor-svelte/lib/Info';

	export let label: string;
	export let subtitle: string;
	export let score: number;
	export let scoreLabel: string;
	export let reason: string;
	export let color: string = '#f97316';
	export let borderTop: boolean = false;

	const tooltipId = `nourish-tooltip-${label.toLowerCase().replace(/\s+/g, '-')}`;
	let showTooltip = false;
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;

	function show() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		showTooltip = true;
	}

	function scheduleHide() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		hideTimeout = setTimeout(() => {
			showTooltip = false;
		}, 200);
	}

	onDestroy(() => {
		if (hideTimeout) clearTimeout(hideTimeout);
	});
</script>

<div class="score-card" class:border-top={borderTop}>
	<div class="score-header">
		<div class="score-title">
			<span class="label">{label}</span>
			<span class="subtitle">{subtitle}</span>
		</div>
		<div class="score-value-row">
			<span class="score-number" style="color: {color};">{score}</span>
			<span class="score-max">/ 10</span>
			<span class="score-label" style="color: {color};">{scoreLabel}</span>
		</div>
	</div>

	<!-- Score bar -->
	<div class="bar-track">
		<div class="bar-fill" style="width: {score * 10}%; background-color: {color};" />
	</div>

	<!-- Reason tooltip trigger -->
	{#if reason}
		<div class="reason-wrapper">
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<button
				class="reason-trigger"
				tabindex="0"
				aria-label="Why this score"
				aria-expanded={showTooltip}
				aria-describedby={showTooltip ? tooltipId : undefined}
				on:mouseenter={show}
				on:mouseleave={scheduleHide}
				on:focus={show}
				on:blur={scheduleHide}
				on:click|stopPropagation|preventDefault={() => (showTooltip = !showTooltip)}
				on:keydown={(e) => {
					if (e.key === 'Escape') showTooltip = false;
				}}
			>
				<InfoIcon size={13} />
				<span>Why?</span>
			</button>

			{#if showTooltip}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					id={tooltipId}
					role="tooltip"
					class="reason-tooltip"
					on:mouseenter={show}
					on:mouseleave={scheduleHide}
					on:click|stopPropagation
				>
					{reason}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "../../app.css";

	.score-card {
		@apply flex flex-col gap-2 py-3;
	}

	.border-top {
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	.score-header {
		@apply flex items-start justify-between gap-2;
	}

	.score-title {
		@apply flex flex-col;
	}

	.label {
		@apply text-sm font-semibold;
		color: var(--color-text-primary);
	}

	.subtitle {
		@apply text-xs;
		color: var(--color-text-secondary);
	}

	.score-value-row {
		@apply flex items-baseline gap-1 shrink-0;
	}

	.score-number {
		@apply text-xl font-bold leading-none;
	}

	.score-max {
		@apply text-xs;
		color: var(--color-text-secondary);
	}

	.score-label {
		@apply text-xs font-semibold ml-1;
	}

	.bar-track {
		@apply w-full h-1.5 rounded-full;
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	.bar-fill {
		@apply h-full rounded-full transition-all duration-500 ease-out;
	}

	.reason-wrapper {
		@apply relative;
	}

	.reason-trigger {
		@apply flex items-center gap-1 text-xs cursor-help;
		color: var(--color-text-secondary);
		background: none;
		border: none;
		padding: 0;
	}

	.reason-trigger:hover {
		color: var(--color-text-primary);
	}

	.reason-tooltip {
		@apply absolute left-0 top-full mt-1 z-50 text-xs leading-relaxed;
		width: min(280px, calc(100vw - 3rem));
		padding: 8px 10px;
		border-radius: 8px;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		color: var(--color-text-primary);
	}

	.reason-tooltip::before {
		content: '';
		position: absolute;
		top: -6px;
		left: 0;
		right: 0;
		height: 6px;
	}
</style>
