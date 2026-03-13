<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';

	const dispatch = createEventDispatcher<{ accept: void }>();

	let agreed = false;

	function handleAccept() {
		if (!agreed) return;
		dispatch('accept');
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-overlay" on:click|self={() => {}}>
	<div class="modal-content">
		<div class="modal-header">
			<WarningCircleIcon size={32} weight="duotone" class="text-orange-500" />
			<h2 class="text-xl font-bold" style="color: var(--color-text-primary)">Before You List on The Market</h2>
		</div>

		<div class="modal-body">
			<p class="mb-4" style="color: var(--color-text-secondary)">
				The Market connects buyers and sellers directly. By creating a listing, you agree to the following:
			</p>

			<div class="space-y-4">
				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">You are responsible for your listings and your products.</p>
					<p class="text-sm" style="color: var(--color-text-secondary)">
						Zap Cooking does not inspect, verify, certify, or guarantee any goods listed on The Market. You are solely responsible for the accuracy of your listings, the quality and safety of your products, and compliance with all applicable laws.
					</p>
				</div>

				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">Food sellers must comply with applicable food safety laws.</p>
					<p class="text-sm" style="color: var(--color-text-secondary)">
						This includes cottage food laws, labeling requirements, allergen disclosure, licensing, and any restrictions on interstate sales in your jurisdiction. Zap Cooking does not verify your compliance.
					</p>
				</div>

				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">Only food and cooking-related goods are allowed.</p>
					<p class="text-sm" style="color: var(--color-text-secondary)">
						The Market is limited to food products, cooking equipment, kitchenware, cookbooks, ingredients, and related items. Prohibited items include alcohol, tobacco, cannabis, CBD products, weapons, pharmaceuticals, and supplements with unapproved health claims. See our <a href="/terms" class="text-primary hover:underline">Terms of Service</a> for the full list.
					</p>
				</div>

				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">Payments happen directly between you and the buyer.</p>
					<p class="text-sm" style="color: var(--color-text-secondary)">
						Zap Cooking does not process, hold, or guarantee any payment. Lightning and Bitcoin transactions are generally irreversible.
					</p>
				</div>

				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">You must be at least 18 years old.</p>
				</div>

				<div>
					<p class="font-semibold" style="color: var(--color-text-primary)">You are responsible for your own taxes and legal obligations.</p>
				</div>
			</div>

			<label class="checkbox-row">
				<input type="checkbox" bind:checked={agreed} class="checkbox" />
				<span class="text-sm" style="color: var(--color-text-primary)">
					I have read and agree to the zap.cooking <a href="/terms" class="text-primary hover:underline">Terms of Service</a>, including the Marketplace terms in Section 7. I understand that I am solely responsible for the legality, safety, accuracy, and compliance of my listings and products, and that Zap Cooking does not process payments or guarantee transactions.
				</span>
			</label>
		</div>

		<div class="modal-footer">
			<button
				type="button"
				class="accept-btn"
				disabled={!agreed}
				on:click={handleAccept}
			>
				Agree & Create Listing
			</button>
		</div>
	</div>
</div>

<style lang="postcss">
	@reference "../../app.css";

	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background-color: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
	}

	.modal-content {
		@apply w-full max-w-lg rounded-2xl overflow-hidden;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		@apply flex items-center gap-3 px-6 pt-6 pb-4;
	}

	.modal-body {
		@apply px-6 pb-4 overflow-y-auto;
		flex: 1;
	}

	.checkbox-row {
		@apply flex items-start gap-3 mt-6 p-4 rounded-xl cursor-pointer;
		background-color: var(--color-bg-secondary);
	}

	.checkbox {
		@apply mt-0.5 flex-shrink-0 w-5 h-5 rounded;
		accent-color: var(--color-accent, #f97316);
	}

	.modal-footer {
		@apply px-6 pb-6 pt-2;
	}

	.accept-btn {
		@apply w-full py-3 px-4 rounded-xl font-semibold text-white transition-all;
		background: linear-gradient(135deg, #f97316, #ea580c);
	}

	.accept-btn:hover:not(:disabled) {
		transform: scale(1.02);
	}

	.accept-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
