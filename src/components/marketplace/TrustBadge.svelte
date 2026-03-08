<script lang="ts">
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
	import InfoIcon from 'phosphor-svelte/lib/Info';

	/** NIP-85 trust rank, 0-100 integer scale */
	export let rank: number | undefined = undefined;

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
</script>

{#if visible}
	<span
		class="trust-badge trust-{level}"
		tabindex="0"
		role="button"
		aria-label={`Trust score: ${label}${rank !== undefined ? ` (${rank}/100)` : ''}`}
		aria-expanded={showTooltip}
		on:mouseenter={() => (showTooltip = true)}
		on:mouseleave={() => (showTooltip = false)}
		on:focus={() => (showTooltip = true)}
		on:blur={() => (showTooltip = false)}
		on:click={() => (showTooltip = !showTooltip)}
		on:keydown={(e) => {
			if (e.key === 'Escape') showTooltip = false;
		}}
	>
		<ShieldCheckIcon size={14} weight="fill" />
		<span class="trust-label">{label}</span>

		{#if showTooltip}
			<div class="tooltip">
				<div class="tooltip-header">
					<ShieldCheckIcon size={16} weight="fill" />
					<span>NIP-85 Trust Score</span>
				</div>
				<div class="tooltip-score">
					<span class="score-value">{rank}</span>
					<span class="score-max">/ 100</span>
				</div>
				<div class="tooltip-body">
					<p>
						This score is computed by a
						<strong>NIP-85 Trusted Assertions</strong>
						service provider using Web of Trust algorithms.
					</p>
					<p>
						It reflects this user's global reputation on Nostr
						based on social graph analysis, activity, and
						interactions across the network.
					</p>
				</div>
				<div class="tooltip-footer">
					<InfoIcon size={12} />
					<span>Score is network-wide, not personalized to you</span>
				</div>
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

	.tooltip {
		position: absolute;
		top: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		width: 260px;
		padding: 12px;
		border-radius: 12px;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		text-align: left;
		white-space: normal;
		cursor: default;
	}

	.tooltip-header {
		@apply flex items-center gap-1.5 font-semibold text-xs mb-2;
		color: var(--color-text-primary);
	}

	.tooltip-score {
		@apply flex items-baseline gap-1 mb-3 pb-3;
		border-bottom: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	.score-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1;
	}

	.score-max {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.tooltip-body {
		@apply flex flex-col gap-2 text-xs;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.tooltip-body strong {
		color: var(--color-text-primary);
	}

	.tooltip-footer {
		@apply flex items-center gap-1 mt-3 pt-2 text-xs;
		color: var(--color-text-secondary);
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
		opacity: 0.7;
		font-style: italic;
	}
</style>
