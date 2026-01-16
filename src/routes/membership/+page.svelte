<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { profileCacheManager } from '$lib/profileCache';
  import { userPublickey } from '$lib/nostr';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  
  export let data;
  
  interface Founder {
    number: number;
    pubkey: string;
    tier: string;
    joined: string;
    user?: NDKUser | null;
  }
  
  let founders: Founder[] = (data.founders || []).map((f: any) => ({
    number: f.number,
    pubkey: f.pubkey,
    tier: f.tier,
    joined: f.joined,
    user: null
  }));
  let loading = true;
  let showFoundersList = false;
  let isCheckingOut = false;
  
  // Genesis founders constants
  const TOTAL_GENESIS_SPOTS = 21;
  const GENESIS_PRICE_USD = 210;
  const GENESIS_PRICE_SATS = 210000;
  
  // Track actual founders count from server (before profile filtering)
  const actualFoundersCount = data.founders?.length || 0;
  
  $: foundersCount = founders.length;
  $: spotsTaken = actualFoundersCount; // Use actual count, not filtered count
  $: spotsRemaining = TOTAL_GENESIS_SPOTS - spotsTaken;
  $: isSoldOut = spotsRemaining === 0;
  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;

  // Blacklist of pubkeys to exclude (add specific pubkeys here if needed)
  const EXCLUDED_PUBKEYS = new Set<string>([
    // Add pubkeys to exclude here, e.g.:
    // 'abc123...'
  ]);

  // Check if a user has a valid profile (not just a generated name)
  function hasValidProfile(user: NDKUser | null, pubkey: string): boolean {
    // Exclude blacklisted pubkeys
    if (EXCLUDED_PUBKEYS.has(pubkey)) return false;
    
    if (!user || !user.profile) return false;
    // Check if profile has a real name (not generated)
    const name = user.profile.displayName || user.profile.name;
    if (!name) return false;
    // Filter out generated names like "Sharp Culinary", "Cool Chef", etc.
    const generatedPatterns = ['Chef', 'Cook', 'Baker', 'Foodie', 'Gourmet', 'Epicure', 'Culinary', 'Kitchen'];
    const isGenerated = generatedPatterns.some(pattern => name.includes(pattern));
    return !isGenerated;
  }

  // Fetch Nostr profiles for all founders using existing profile cache
  async function loadProfiles() {
    loading = true;
    
    // Load profiles in parallel for better performance
    const profilePromises = founders.map(async (founder) => {
      try {
        const user = await profileCacheManager.getProfile(founder.pubkey);
        founder.user = user;
      } catch (err) {
        console.error(`Failed to load profile for ${founder.pubkey}:`, err);
        founder.user = null;
      }
    });
    
    await Promise.all(profilePromises);
    
    // Keep all founders but mark which ones have valid profiles
    // Don't filter or re-number - keep original founder numbers from payment_id
    founders = [...founders]; // Trigger reactivity
    loading = false;
  }
  
  // Helper to check if founder should be displayed with profile or placeholder
  function getFounderDisplayName(founder: Founder): string {
    if (founder.user?.profile?.displayName) return founder.user.profile.displayName;
    if (founder.user?.profile?.name) return founder.user.profile.name;
    // Show truncated pubkey as fallback
    return `${founder.pubkey.substring(0, 8)}...`;
  }

  onMount(() => {
    loadProfiles();
  });

  async function handleClaimSpot() {
    if (!browser) return;
    
    // Check if user is logged in
    if (!isLoggedIn) {
      // Redirect to login page
      goto('/login?redirect=/membership');
      return;
    }
    
    // Check if sold out
    if (isSoldOut) {
      alert('All Genesis Founder spots have been claimed!');
      return;
    }
    
    // Navigate to checkout
    isCheckingOut = true;
    goto('/membership/genesis-checkout');
  }

  function handleCardClick() {
    if (isSoldOut) return;
    showFoundersList = !showFoundersList;
  }

  function goToCookPlusCheckout() {
    goto('/membership/cook-plus-checkout');
  }

  function goToProKitchenCheckout() {
    goto('/membership/pro-kitchen-checkout');
  }
</script>

<svelte:head>
  <title>Membership - zap.cooking</title>
</svelte:head>

<div class="membership-page">
  <section class="hero">
    <h1>Become a Founder</h1>
    <p>Join the community building the future of food on Nostr</p>
  </section>

  <!-- Genesis Founders Hero Section -->
  <section class="genesis-founders-hero">
    <div 
      class="genesis-hero-card {isSoldOut ? 'sold-out' : ''}" 
      on:click={handleCardClick}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      role="button" 
      tabindex="0"
      aria-expanded={showFoundersList}
      aria-label="Toggle Genesis Founders list"
    >
      <div class="genesis-hero-content">
        <div class="genesis-hero-icon">🔥</div>
        <div class="genesis-hero-text">
          <h2>Genesis Founders</h2>
          <p class="genesis-hero-countdown">
            {spotsTaken}/{TOTAL_GENESIS_SPOTS} taken
          </p>
        </div>
        <div class="genesis-hero-arrow">
          <svg 
            class="arrow-icon {showFoundersList ? 'rotated' : ''}" 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </div>
      </div>
      {#if !loading && spotsRemaining > 0}
        <div class="genesis-hero-progress">
          <div class="progress-bar">
            <div 
              class="progress-fill" 
              style="width: {(spotsTaken / TOTAL_GENESIS_SPOTS) * 100}%"
            ></div>
          </div>
          <p class="progress-text">{spotsRemaining} spots remaining</p>
        </div>
      {/if}
    </div>
  </section>

  <!-- Genesis Founders Checkout Section (shown when expanded) -->
  {#if showFoundersList && !isSoldOut}
    <section class="genesis-checkout-section">
      <div class="genesis-checkout-card">
        <div class="genesis-checkout-header">
          <h3>Become a Genesis Founder</h3>
          <p class="genesis-checkout-price">$210 <span>lifetime</span></p>
        </div>
        
        <div class="genesis-checkout-benefits">
          <h4>What you get:</h4>
          <ul>
            <li>✓ Lifetime Pro Kitchen membership (never expires)</li>
            <li>✓ Genesis Founder badge (#{spotsTaken + 1}-21)</li>
            <li>✓ Access to both pantry.zap.cooking and pro.zap.cooking relays</li>
            <li>✓ Name permanently displayed as a Genesis Founder</li>
            <li>✓ All future Pro Kitchen features included</li>
          </ul>
        </div>
        
        <div class="genesis-checkout-urgency">
          <p>Only <strong>{spotsRemaining} of {TOTAL_GENESIS_SPOTS} spots remaining</strong></p>
        </div>
        
        <button 
          class="genesis-claim-button"
          on:click={handleClaimSpot}
          disabled={isCheckingOut || isSoldOut || !isLoggedIn}
        >
          {#if !isLoggedIn}
            Login to Claim Your Spot
          {:else if isCheckingOut}
            Processing...
          {:else if isSoldOut}
            Sold Out
          {:else}
            Claim Your Spot
          {/if}
        </button>
      </div>
    </section>
  {/if}

  <!-- Genesis Founders List (Collapsible) -->
  {#if showFoundersList}
    <section class="genesis-founders">
      <h2>🔥 Genesis Founders</h2>
      <p class="subtitle">The first believers who made this possible</p>
    
    {#if loading}
      <div class="loading-state">
        <p>Loading founders...</p>
      </div>
    {:else if founders.length === 0}
      <div class="empty-state">
        <p>No founders found yet. Be the first!</p>
  </div>
    {:else}
      <div class="founders-grid">
        {#each founders as founder}
          <div class="founder-card">
            <div class="founder-number">#{founder.number}</div>
            
            <div class="founder-avatar-wrapper">
              <CustomAvatar pubkey={founder.pubkey} size={80} className="founder-avatar-img" />
  </div>

            <div class="founder-info">
              <div class="founder-name">
                <CustomName pubkey={founder.pubkey} className="founder-name-text" />
              </div>
  </div>

            <div class="founder-badge">
              Genesis Founder
            </div>
          </div>
        {/each}
  </div>
    {/if}
    </section>
  {/if}

  <!-- Membership Tiers Section -->
  <section class="tiers">
    <h2>Membership Tiers</h2>
    
    <div class="tiers-grid">
      <div class="tier-card cook-plus">
        <h3>Cook+</h3>
        <div class="price">$49<span>/year</span></div>
        <ul>
          <li>Custom Lightning address (you@zap.cooking)</li>
          <li>Access to pantry.zap.cooking relay</li>
          <li>Recipe collections</li>
          <li>Member badge</li>
          <li>Vote on features</li>
        </ul>
        <button class="tier-button" on:click={goToCookPlusCheckout}>Join Cook+</button>
      </div>

      <div class="tier-card pro-kitchen">
        <div class="popular-badge">Most Popular</div>
        <h3>Pro Kitchen</h3>
        <div class="price">$89<span>/year</span></div>
        <ul>
          <li>Everything in Cook+</li>
          <li>Creator analytics</li>
          <li>Access to pro.zap.cooking relay</li>
          <li>Gated recipes (coming soon)</li>
          <li>AI recipe tools</li>
          <li>Priority support</li>
        </ul>
        <button class="tier-button primary" on:click={goToProKitchenCheckout}>Join Pro Kitchen</button>
      </div>
    </div>
  </section>
</div>

<style>
  .membership-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .hero {
    text-align: center;
    padding: 4rem 0 5rem 0;
  }

  .hero h1 {
    font-size: 3rem;
    font-weight: 900;
    margin-bottom: 1rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  @media (min-width: 640px) {
    .hero h1 {
      font-size: 4rem;
    }
  }

  @media (min-width: 1024px) {
    .hero h1 {
      font-size: 5rem;
    }
  }

  .hero p {
    color: #9ca3af;
    font-size: 1.2rem;
    font-weight: 400;
    margin-top: 0.5rem;
  }

  /* Dark mode adjustments for hero */
  html.dark .hero h1 {
    background: linear-gradient(135deg, #ff5722 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  html.dark .hero p {
    color: #6b7280;
  }

  /* Genesis Founders Hero Section */
  .genesis-founders-hero {
    margin: 5rem 0 3rem 0;
  }

  .genesis-hero-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid;
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 50%, #ff4500 100%) 1;
    border-radius: 16px;
    padding: 2.5rem;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 
      0 8px 32px rgba(236, 71, 0, 0.15),
      0 0 0 1px rgba(236, 71, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    position: relative;
    overflow: hidden;
  }

  .genesis-hero-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(236, 71, 0, 0.05) 0%, rgba(255, 107, 0, 0.03) 100%);
    pointer-events: none;
    z-index: 0;
  }

  .genesis-hero-card:hover {
    transform: translateY(-2px);
    box-shadow: 
      0 12px 40px rgba(236, 71, 0, 0.25),
      0 0 0 1px rgba(236, 71, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ff6b00 100%) 1;
  }

  .genesis-hero-card:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }

  .genesis-hero-content {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    position: relative;
    z-index: 1;
  }

  .genesis-hero-icon {
    font-size: 3rem;
    line-height: 1;
    filter: drop-shadow(0 0 8px rgba(236, 71, 0, 0.4));
  }

  .genesis-hero-text {
    flex: 1;
  }

  .genesis-hero-text h2 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: #f3f4f6;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .genesis-hero-countdown {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: #d1d5db;
  }

  .genesis-hero-arrow {
    display: flex;
    align-items: center;
    transition: transform 0.3s ease;
  }

  .arrow-icon {
    color: #d1d5db;
    transition: transform 0.3s ease;
  }

  .arrow-icon.rotated {
    transform: rotate(180deg);
  }

  .genesis-hero-progress {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(236, 71, 0, 0.2);
    position: relative;
    z-index: 1;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: rgba(236, 71, 0, 0.15);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-primary) 0%, #ff8c42 100%);
    border-radius: 2px;
    transition: width 0.5s ease;
    box-shadow: 0 0 8px rgba(236, 71, 0, 0.4);
  }

  .progress-text {
    color: #9ca3af;
    font-size: 0.9rem;
    margin: 0;
    text-align: center;
    font-weight: 500;
  }

  /* Dark mode adjustments */
  html.dark .genesis-hero-card {
    background: rgba(31, 41, 55, 0.7);
    border-image: linear-gradient(135deg, #ff5722 0%, #ff8c42 50%, #ff6b00 100%) 1;
  }

  html.dark .genesis-hero-card::before {
    background: linear-gradient(135deg, rgba(255, 87, 34, 0.08) 0%, rgba(255, 140, 66, 0.05) 100%);
  }

  html.dark .genesis-hero-text h2 {
    color: #f9fafb;
  }

  html.dark .genesis-hero-countdown {
    color: #e5e7eb;
  }

  html.dark .arrow-icon {
    color: #e5e7eb;
  }

  html.dark .progress-text {
    color: #d1d5db;
  }

  .genesis-hero-card.sold-out {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* Genesis Checkout Section */
  .genesis-checkout-section {
    margin: 2rem 0;
  }

  .genesis-checkout-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid;
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 50%, #ff4500 100%) 1;
    border-radius: 16px;
    padding: 2.5rem;
    box-shadow: 
      0 8px 32px rgba(236, 71, 0, 0.15),
      0 0 0 1px rgba(236, 71, 0, 0.1);
  }

  .genesis-checkout-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .genesis-checkout-header h3 {
    font-size: 2rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0 0 0.5rem 0;
  }

  .genesis-checkout-price {
    font-size: 2.5rem;
    font-weight: 900;
    color: var(--color-primary);
    margin: 0;
  }

  .genesis-checkout-price span {
    font-size: 1.2rem;
    font-weight: 400;
    color: #9ca3af;
  }

  .genesis-checkout-benefits {
    margin-bottom: 2rem;
  }

  .genesis-checkout-benefits h4 {
    font-size: 1.2rem;
    font-weight: 600;
    color: #f3f4f6;
    margin: 0 0 1rem 0;
  }

  .genesis-checkout-benefits ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .genesis-checkout-benefits li {
    padding: 0.75rem 0;
    color: #d1d5db;
    font-size: 1rem;
    border-bottom: 1px solid rgba(236, 71, 0, 0.1);
  }

  .genesis-checkout-benefits li:last-child {
    border-bottom: none;
  }

  .genesis-checkout-urgency {
    text-align: center;
    margin-bottom: 2rem;
    padding: 1rem;
    background: rgba(236, 71, 0, 0.1);
    border-radius: 8px;
  }

  .genesis-checkout-urgency p {
    margin: 0;
    color: #f3f4f6;
    font-size: 1.1rem;
  }

  .genesis-checkout-urgency strong {
    color: var(--color-primary);
    font-weight: 700;
  }

  .genesis-claim-button {
    width: 100%;
    padding: 1.25rem 2rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.3);
  }

  .genesis-claim-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(236, 71, 0, 0.4);
    background: linear-gradient(135deg, #ff5722 0%, #ff8c42 100%);
  }

  .genesis-claim-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  html.dark .genesis-checkout-card {
    background: rgba(31, 41, 55, 0.7);
  }

  /* Genesis Founders List */
  .genesis-founders {
    margin: 3rem 0;
  }

  .genesis-founders h2 {
    text-align: center;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
  }

  .subtitle {
    text-align: center;
    color: var(--color-text-secondary);
    margin-bottom: 2rem;
  }

  .loading-state,
  .empty-state {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-secondary);
  }

  .founders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.5rem;
  }

  .founder-card {
    background: var(--color-bg-secondary);
    border: 2px solid var(--color-primary);
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    position: relative;
    color: var(--color-text-primary);
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .founder-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.2);
  }

  .founder-number {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-primary);
    color: white;
    font-weight: bold;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.85rem;
  }

  .founder-avatar-wrapper {
    margin: 1rem auto;
    position: relative;
  }

  .founder-avatar-img {
    border: 3px solid var(--color-primary) !important;
  }

  .founder-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .founder-name {
    font-weight: 600;
    font-size: 1rem;
  }

  .founder-name-text {
    color: var(--color-text-primary);
  }

  .founder-badge {
    margin-top: 1rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--color-primary);
    font-weight: 600;
  }

  /* Membership Tiers */
  .tiers {
    margin: 4rem 0;
  }

  .tiers h2 {
    text-align: center;
    margin-bottom: 2rem;
    color: var(--color-text-primary);
  }

  .tiers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .tier-card {
    background: var(--color-bg-secondary);
    border: 2px solid var(--color-input-border);
    border-radius: 16px;
    padding: 2rem;
    position: relative;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .tier-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  }

  .tier-card.pro-kitchen {
    border-color: var(--color-primary);
    background: var(--color-bg-primary);
  }

  .popular-badge {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: bold;
    padding: 0.25rem 1rem;
    border-radius: 20px;
  }

  .tier-card h3 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
  }

  .price {
    font-size: 2.5rem;
    font-weight: bold;
    margin-bottom: 1.5rem;
    color: var(--color-text-primary);
  }

  .price span {
    font-size: 1rem;
    font-weight: normal;
    color: var(--color-text-secondary);
  }

  .tier-card ul {
    list-style: none;
    padding: 0;
    margin-bottom: 2rem;
  }

  .tier-card li {
    padding: 0.5rem 0;
    padding-left: 1.5rem;
    position: relative;
    color: var(--color-text-primary);
  }

  .tier-card li::before {
    content: '✓';
    position: absolute;
    left: 0;
    color: #22c55e;
    font-weight: bold;
  }

  .tier-button {
    width: 100%;
    padding: 1rem;
    border: 2px solid var(--color-text-primary);
    border-radius: 8px;
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tier-button:hover {
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
  }

  .tier-button.primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .tier-button.primary:hover {
    background: #d63a00;
    border-color: #d63a00;
  }

  /* Dark mode adjustments */
  html.dark .founder-card {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  }

  html.dark .tier-card {
    background: var(--color-bg-secondary);
  }

  html.dark .tier-card.pro-kitchen {
    background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
  }
</style>
