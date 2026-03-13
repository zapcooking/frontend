<script lang="ts">
	import { onMount } from 'svelte';
	import { ndk, userPublickey } from '$lib/nostr';
	import {
		fetchUserTrustProvider,
		publishTrustProvider,
		clearTrustProvider,
		type TrustProvider
	} from '$lib/marketplace/kitchens';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
	import GraphIcon from 'phosphor-svelte/lib/Graph';
	import GlobeIcon from 'phosphor-svelte/lib/Globe';
	import GearIcon from 'phosphor-svelte/lib/Gear';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import SpinnerIcon from 'phosphor-svelte/lib/Spinner';

	// --- Trust provider settings state ---
	let currentProvider: TrustProvider | null = null;
	let loadingProvider = false;
	let saving = false;
	let saveMessage: { type: 'success' | 'error'; text: string } | null = null;

	// Form state
	let selectedMode: 'global' | 'custom' = 'global';
	let customPubkey = '';
	let customRelay = '';

	// Known providers users can pick from
	const KNOWN_PROVIDERS = [
		{
			name: 'nostr.band',
			description: 'The most widely used trust scoring service on Nostr',
			pubkey: '6b37f2775a36575c1afe3e1399eb6b4a44793acca040685ac423e84be3aa0e16',
			relay: 'wss://nip85.nostr.band'
		}
	];

	$: isSignedIn = !!$userPublickey;
	$: hasChanges = checkForChanges(selectedMode, customPubkey, customRelay, currentProvider);

	function checkForChanges(mode: string, pubkey: string, relay: string, current: TrustProvider | null): boolean {
		if (mode === 'global') return current !== null;
		if (!pubkey.trim()) return false;
		if (!current) return true;
		return current.servicePubkey !== pubkey.trim() || (current.relayHint || '') !== relay.trim();
	}

	onMount(async () => {
		if ($userPublickey) {
			await loadCurrentProvider();
		}
	});

	async function loadCurrentProvider() {
		loadingProvider = true;
		try {
			currentProvider = await fetchUserTrustProvider($ndk, $userPublickey);
			if (currentProvider) {
				selectedMode = 'custom';
				customPubkey = currentProvider.servicePubkey;
				customRelay = currentProvider.relayHint || '';
			} else {
				selectedMode = 'global';
				customPubkey = '';
				customRelay = '';
			}
		} catch (e) {
			console.error('Failed to load trust provider:', e);
		} finally {
			loadingProvider = false;
		}
	}

	function selectKnownProvider(provider: typeof KNOWN_PROVIDERS[0]) {
		selectedMode = 'custom';
		customPubkey = provider.pubkey;
		customRelay = provider.relay;
	}

	async function saveProvider() {
		saving = true;
		saveMessage = null;

		try {
			if (selectedMode === 'global') {
				const result = await clearTrustProvider($ndk);
				if (result.success) {
					currentProvider = null;
					saveMessage = { type: 'success', text: 'Switched to global Web of Trust scoring' };
				} else {
					saveMessage = { type: 'error', text: result.error || 'Failed to save' };
				}
			} else {
				const pubkey = customPubkey.trim();
				if (!pubkey) {
					saveMessage = { type: 'error', text: 'Provider pubkey is required' };
					saving = false;
					return;
				}
				if (!/^[0-9a-f]{64}$/.test(pubkey)) {
					saveMessage = { type: 'error', text: 'Invalid pubkey format — must be 64 hex characters' };
					saving = false;
					return;
				}

				const provider: TrustProvider = {
					servicePubkey: pubkey,
					relayHint: customRelay.trim() || undefined
				};
				const result = await publishTrustProvider($ndk, provider);
				if (result.success) {
					currentProvider = provider;
					saveMessage = { type: 'success', text: 'Trust provider saved — scores will personalize on next load' };
				} else {
					saveMessage = { type: 'error', text: result.error || 'Failed to save' };
				}
			}
		} catch (e) {
			saveMessage = { type: 'error', text: 'Something went wrong' };
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Web of Trust | The Market | zap.cooking</title>
	<meta name="description" content="Learn how Web of Trust scoring works on zap.cooking and choose your trust provider." />
</svelte:head>

<div class="trust-page max-w-3xl mx-auto px-4 py-6">
	<a
		href="/market"
		class="inline-flex items-center gap-2 mb-6 text-sm hover:underline"
		style="color: var(--color-text-secondary)"
	>
		<ArrowLeftIcon size={16} />
		Back to The Market
	</a>

	<!-- Hero -->
	<div class="hero mb-8">
		<div class="flex items-center gap-3 mb-3">
			<ShieldCheckIcon size={36} weight="fill" class="text-green-500" />
			<h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">
				Web of Trust
			</h1>
		</div>
		<p class="text-base" style="color: var(--color-text-secondary)">
			Trust scores help you evaluate sellers in The Market. Scores come from
			independent trust providers that analyze the Nostr social graph — zap.cooking
			displays them, but doesn't control how they're calculated.
		</p>
	</div>

	<!-- Score Levels -->
	<div class="levels-grid mb-8">
		<div class="level-card">
			<div class="level-badge trust-high">
				<ShieldCheckIcon size={14} weight="fill" />
				<span>Highly trusted</span>
			</div>
			<span class="level-range">70 – 100</span>
		</div>
		<div class="level-card">
			<div class="level-badge trust-medium">
				<ShieldCheckIcon size={14} weight="fill" />
				<span>Trusted</span>
			</div>
			<span class="level-range">40 – 69</span>
		</div>
		<div class="level-card">
			<div class="level-badge trust-low">
				<ShieldCheckIcon size={14} weight="fill" />
				<span>Known</span>
			</div>
			<span class="level-range">20 – 39</span>
		</div>
		<div class="level-card">
			<span class="level-hidden">Not shown</span>
			<span class="level-range">0 – 19</span>
		</div>
	</div>

	<!-- Info Sections -->
	<div class="sections mb-8">
		<section class="info-section">
			<div class="section-icon">
				<ShieldCheckIcon size={20} weight="duotone" />
			</div>
			<div>
				<h2>Where do trust scores come from?</h2>
				<p>
					zap.cooking doesn't calculate trust scores itself. Instead, we read scores
					published by <strong>independent trust providers</strong> — services that
					crawl the Nostr network, run reputation algorithms, and publish the results
					as signed Nostr events.
				</p>
				<p>
					By default, zap.cooking uses <strong>nostr.band</strong> as the trust
					provider. Their service analyzes the entire Nostr social graph and publishes
					a score (0–100) for every user. Because these scores are standard Nostr
					events (<strong>NIP-85 Trusted Assertions</strong>), anyone can verify
					them — they can't be faked or manipulated by the seller.
				</p>
			</div>
		</section>

		<section class="info-section">
			<div class="section-icon">
				<GraphIcon size={20} weight="duotone" />
			</div>
			<div>
				<h2>What goes into a score?</h2>
				<p>
					Each trust provider runs its own algorithm. zap.cooking doesn't control
					the formula — we just display the result. The NIP-85 standard defines the
					types of data a provider <em>can</em> use to compute a score:
				</p>
				<ul>
					<li><strong>Followers</strong> — how many people follow the seller, and how
						reputable those followers are</li>
					<li><strong>Activity</strong> — how long they've been on Nostr, how many
						posts and replies they've made</li>
					<li><strong>Engagement</strong> — reactions, reposts, and replies their
						content receives</li>
					<li><strong>Zaps</strong> — Lightning sats sent and received, showing real
						economic participation</li>
					<li><strong>Reports</strong> — whether they've been reported by other users</li>
				</ul>
				<p>
					How each provider weighs these signals is up to them. That's why you can
					<strong>choose your provider</strong> — if you prefer an algorithm that
					weighs zap history heavily, or one that prioritizes social connections,
					you pick the provider whose judgment you trust.
				</p>
			</div>
		</section>

		<section class="info-section">
			<div class="section-icon">
				<GlobeIcon size={20} weight="duotone" />
			</div>
			<div>
				<h2>Global vs. personalized scores</h2>
				<p>
					<strong>Global scores</strong> are the same for everyone. The provider
					looks at the entire network and gives each user one number. This is the
					default when you haven't chosen a provider.
				</p>
				<p>
					<strong>Personalized scores</strong> are calculated from your perspective.
					Some providers run separate algorithms per user, weighing connections
					relative to <em>your</em> social graph. Sellers who are followed by people
					you follow, or who are active in communities you participate in, will score
					higher for you than for someone with different connections.
				</p>
				<p>
					Global scores answer <em>"does the network trust this seller?"</em>
					Personalized scores answer <em>"does my network trust this seller?"</em>
				</p>
			</div>
		</section>
	</div>

	<!-- Trust Provider Settings -->
	<div class="provider-section mb-8">
		<div class="flex items-center gap-3 mb-4">
			<GearIcon size={24} weight="duotone" class="text-orange-500" />
			<h2 class="text-lg font-bold" style="color: var(--color-text-primary)">
				Choose Your Trust Provider
			</h2>
		</div>
		<p class="text-sm mb-4" style="color: var(--color-text-secondary)">
			Different providers use different algorithms. Pick the one whose judgment you
			trust, or stick with the global default.
		</p>

		{#if !isSignedIn}
			<div class="provider-card">
				<p class="text-sm" style="color: var(--color-text-secondary)">
					Sign in with your Nostr identity to choose a trust provider and get
					personalized scores.
				</p>
				<a
					href="/login"
					class="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg font-medium text-sm transition-all hover:scale-105"
					style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
				>
					Sign in
				</a>
			</div>
		{:else if loadingProvider}
			<div class="provider-card flex items-center gap-3">
				<SpinnerIcon size={20} class="animate-spin" />
				<span class="text-sm" style="color: var(--color-text-secondary)">Loading your settings...</span>
			</div>
		{:else}
			<!-- Current status -->
			<div class="provider-card mb-4">
				<div class="flex items-center gap-2 mb-1">
					{#if currentProvider}
						<CheckCircleIcon size={16} weight="fill" class="text-green-500" />
						<span class="text-sm font-semibold" style="color: var(--color-text-primary)">
							Personalized scoring active
						</span>
					{:else}
						<GlobeIcon size={16} class="text-blue-400" />
						<span class="text-sm font-semibold" style="color: var(--color-text-primary)">
							Using global scores
						</span>
					{/if}
				</div>
				{#if currentProvider}
					<p class="text-xs" style="color: var(--color-text-secondary)">
						Provider: <code>{currentProvider.servicePubkey.slice(0, 12)}...{currentProvider.servicePubkey.slice(-8)}</code>
						{#if currentProvider.relayHint}
							<br />Relay: <code>{currentProvider.relayHint}</code>
						{/if}
					</p>
				{:else}
					<p class="text-xs" style="color: var(--color-text-secondary)">
						Scores are the same for everyone. Choose a provider below to personalize.
					</p>
				{/if}
			</div>

			<!-- Mode selection -->
			<div class="flex flex-col gap-3 mb-4">
				<label class="mode-option" class:selected={selectedMode === 'global'}>
					<input type="radio" bind:group={selectedMode} value="global" />
					<div>
						<span class="mode-label">Global Web of Trust</span>
						<span class="mode-desc">Default scoring — same for everyone</span>
					</div>
				</label>

				<label class="mode-option" class:selected={selectedMode === 'custom'}>
					<input type="radio" bind:group={selectedMode} value="custom" />
					<div>
						<span class="mode-label">Personalized</span>
						<span class="mode-desc">Choose a provider for scores based on your social graph</span>
					</div>
				</label>
			</div>

			<!-- Known providers -->
			{#if selectedMode === 'custom'}
				<div class="mb-4">
					<h3 class="text-xs font-semibold mb-2" style="color: var(--color-text-secondary)">
						Available providers
					</h3>
					{#each KNOWN_PROVIDERS as provider}
						<button
							type="button"
							class="known-provider"
							class:active={customPubkey === provider.pubkey}
							on:click={() => selectKnownProvider(provider)}
						>
							<div class="flex items-center gap-2">
								<ShieldCheckIcon size={16} weight="fill" class="text-green-500" />
								<span class="font-semibold text-sm" style="color: var(--color-text-primary)">
									{provider.name}
								</span>
							</div>
							<p class="text-xs mt-1" style="color: var(--color-text-secondary)">
								{provider.description}
							</p>
						</button>
					{/each}
				</div>

				<!-- Custom provider fields -->
				<div class="custom-fields">
					<h3 class="text-xs font-semibold mb-2" style="color: var(--color-text-secondary)">
						Or enter a custom provider
					</h3>
					<div class="flex flex-col gap-2">
						<input
							type="text"
							bind:value={customPubkey}
							placeholder="Provider pubkey (64 hex characters)"
							class="field-input"
						/>
						<input
							type="text"
							bind:value={customRelay}
							placeholder="Relay URL (optional, e.g. wss://...)"
							class="field-input"
						/>
					</div>
				</div>
			{/if}

			<!-- Save button -->
			{#if hasChanges}
				<button
					type="button"
					class="save-button mt-4"
					on:click={saveProvider}
					disabled={saving}
				>
					{#if saving}
						<SpinnerIcon size={16} class="animate-spin" />
						Saving...
					{:else}
						Save preference
					{/if}
				</button>
			{/if}

			<!-- Feedback message -->
			{#if saveMessage}
				<div class="save-message mt-3" class:success={saveMessage.type === 'success'} class:error={saveMessage.type === 'error'}>
					{#if saveMessage.type === 'success'}
						<CheckCircleIcon size={14} weight="fill" />
					{:else}
						<WarningIcon size={14} weight="fill" />
					{/if}
					<span>{saveMessage.text}</span>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style lang="postcss">
	@reference "../../../app.css";

	.hero {
		@apply pb-6;
		border-bottom: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	/* --- Score levels grid --- */

	.levels-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.levels-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.level-card {
		@apply flex flex-col items-center gap-2 py-4 px-3 rounded-xl;
		background-color: var(--color-bg-secondary);
	}

	.level-badge {
		@apply inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold;
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

	.level-range {
		@apply text-xs;
		color: var(--color-text-secondary);
	}

	.level-hidden {
		@apply text-xs font-semibold px-2 py-1;
		color: var(--color-text-secondary);
		opacity: 0.5;
	}

	/* --- Info sections --- */

	.sections {
		@apply flex flex-col gap-6;
	}

	.info-section {
		@apply flex gap-4 p-5 rounded-xl;
		background-color: var(--color-bg-secondary);
	}

	.section-icon {
		@apply flex-shrink-0 mt-0.5;
		color: var(--color-accent, #f97316);
	}

	.info-section h2 {
		@apply text-sm font-semibold mb-2;
		color: var(--color-text-primary);
	}

	.info-section p {
		@apply text-sm leading-relaxed mb-2;
		color: var(--color-text-secondary);
	}

	.info-section p:last-child {
		@apply mb-0;
	}

	.info-section p strong {
		color: var(--color-text-primary);
	}

	.info-section ul {
		@apply list-disc pl-5 mb-2 text-sm leading-relaxed;
		color: var(--color-text-secondary);
	}

	.info-section li {
		@apply mb-1;
	}

	/* --- Provider settings --- */

	.provider-section {
		@apply p-6 rounded-2xl;
		background-color: var(--color-bg-secondary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.08));
	}

	.provider-card {
		@apply p-4 rounded-xl;
		background-color: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
	}

	.provider-card code {
		@apply px-1 py-0.5 rounded;
		background-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
		color: var(--color-accent, #f97316);
		font-size: 0.7rem;
	}

	/* Mode radio options */

	.mode-option {
		@apply flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all;
		background-color: var(--color-bg-primary);
		border: 1px solid transparent;
	}

	.mode-option:hover {
		border-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
	}

	.mode-option.selected {
		border-color: var(--color-accent, #f97316);
		background-color: rgba(249, 115, 22, 0.05);
	}

	.mode-option input[type='radio'] {
		@apply mt-1 flex-shrink-0;
		accent-color: var(--color-accent, #f97316);
	}

	.mode-label {
		@apply block text-sm font-semibold;
		color: var(--color-text-primary);
	}

	.mode-desc {
		@apply block text-xs mt-0.5;
		color: var(--color-text-secondary);
	}

	/* Known providers */

	.known-provider {
		@apply w-full text-left p-3 rounded-xl transition-all cursor-pointer;
		background-color: var(--color-bg-primary);
		border: 1px solid transparent;
	}

	.known-provider:hover {
		border-color: var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
	}

	.known-provider.active {
		border-color: var(--color-accent, #f97316);
		background-color: rgba(249, 115, 22, 0.05);
	}

	/* Custom fields */

	.custom-fields {
		@apply mt-3 pt-3;
		border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
	}

	.field-input {
		@apply w-full px-3 py-2 rounded-lg text-sm;
		background-color: var(--color-bg-primary);
		color: var(--color-text-primary);
		border: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.1));
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--color-accent, #f97316);
	}

	.field-input::placeholder {
		color: var(--color-text-secondary);
		opacity: 0.5;
		font-family: inherit;
	}

	/* Save button */

	.save-button {
		@apply flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all;
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
	}

	.save-button:hover:not(:disabled) {
		filter: brightness(1.1);
		transform: translateY(-1px);
	}

	.save-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Save feedback message */

	.save-message {
		@apply flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium;
	}

	.save-message.success {
		color: #16a34a;
		background-color: rgba(22, 163, 74, 0.1);
	}

	.save-message.error {
		color: #ef4444;
		background-color: rgba(239, 68, 68, 0.1);
	}
</style>
