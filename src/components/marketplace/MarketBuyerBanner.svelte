<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import InfoIcon from 'phosphor-svelte/lib/Info';

	const SEEN_KEY = 'zc_market_disclosure_seen';

	let showPopover = false;
	let firstVisit = true;
	let mounted = false;
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		firstVisit = localStorage.getItem(SEEN_KEY) !== '1';
		mounted = true;
	});

	onDestroy(() => {
		if (hideTimeout) clearTimeout(hideTimeout);
	});

	function toggle() {
		showPopover = !showPopover;
		if (showPopover) markSeen();
	}

	function show() {
		if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
		showPopover = true;
		markSeen();
	}

	function scheduleHide() {
		if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
		hideTimeout = setTimeout(() => { showPopover = false; }, 200);
	}

	function markSeen() {
		if (firstVisit) {
			firstVisit = false;
			try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') showPopover = false;
	}
</script>

{#if mounted}
	<!-- First visit: compact inline disclosure (dismisses itself after read) -->
	{#if firstVisit && !showPopover}
		<button
			type="button"
			class="first-visit-row"
			on:click={toggle}
		>
			<InfoIcon size={14} class="flex-shrink-0" />
			<span class="text-xs">Peer-to-peer market — tap to learn more</span>
		</button>
	{:else}
		<!-- Returning visitor: subtle trigger + popover -->
		<div class="disclosure-row">
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<button
				type="button"
				class="disclosure-trigger"
				aria-label="Market disclosure"
				aria-expanded={showPopover}
				aria-describedby={showPopover ? 'market-disclosure-popover' : undefined}
				on:mouseenter={show}
				on:mouseleave={scheduleHide}
				on:focus={show}
				on:blur={scheduleHide}
				on:click|stopPropagation|preventDefault={toggle}
				on:keydown={handleKeydown}
			>
				<span class="label">Peer-to-peer market</span>
				<InfoIcon size={13} />
			</button>

			{#if showPopover}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					id="market-disclosure-popover"
					role="tooltip"
					class="disclosure-popover"
					on:mouseenter={show}
					on:mouseleave={scheduleHide}
					on:click|stopPropagation
				>
					<p>
						The Market connects buyers and sellers directly. Zap Cooking does not
						process payments, verify sellers, inspect products, or guarantee
						transactions. Please use your judgment when making purchases.
					</p>
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style lang="postcss">
	@reference "../../app.css";

	.first-visit-row {
		@apply flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-left cursor-pointer transition-colors;
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
	}

	.first-visit-row:hover {
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	.disclosure-row {
		@apply relative inline-flex mb-4;
	}

	.disclosure-trigger {
		@apply flex items-center gap-1.5 text-xs cursor-help;
		color: var(--color-text-secondary);
		opacity: 0.6;
		background: none;
		border: none;
		padding: 0;
	}

	.disclosure-trigger:hover,
	.disclosure-trigger:focus-visible {
		opacity: 1;
	}

	.label {
		font-weight: 500;
	}

	.disclosure-popover {
		@apply absolute left-0 top-full mt-1.5 z-50 text-xs leading-relaxed;
		width: min(320px, calc(100vw - 2rem));
		padding: 10px 12px;
		border-radius: 10px;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
		color: var(--color-text-secondary);
	}

	/* Bridge the gap so mouse doesn't fall through */
	.disclosure-popover::before {
		content: '';
		position: absolute;
		top: -8px;
		left: 0;
		right: 0;
		height: 8px;
	}
</style>
