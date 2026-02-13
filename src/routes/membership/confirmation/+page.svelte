<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey, ndk } from '$lib/nostr';
  import { claimNip05, checkUsernameAvailable, validateUsername, updateProfileWithNip05 } from '$lib/nip05Service';

  // --- Tier Configuration ---
  const TIERS: Record<string, {
    name: string;
    tagline: string;
    accent: string;
    accentGlow: string;
    badgeIcon: string;
    perks: string[];
  }> = {
    genesis: {
      name: 'Genesis Founder',
      tagline: "You're part of the beginning.",
      accent: '#F59E0B',
      accentGlow: 'rgba(245, 158, 11, 0.25)',
      badgeIcon: '\u26A1',
      perks: ['Private relay access', 'NIP-05 verified identity', 'Founder badge on profile', 'Priority support'],
    },
    cook: {
      name: 'Cook+',
      tagline: 'Your kitchen just leveled up.',
      accent: '#10B981',
      accentGlow: 'rgba(16, 185, 129, 0.25)',
      badgeIcon: '\uD83C\uDF73',
      perks: ['Private relay access', 'NIP-05 verified identity', 'Sous Chef AI assistant', 'Ad-free experience'],
    },
    pro: {
      name: 'Pro Kitchen',
      tagline: 'Welcome to the professional tier.',
      accent: '#8B5CF6',
      accentGlow: 'rgba(139, 92, 246, 0.25)',
      badgeIcon: '\uD83D\uDC68\u200D\uD83C\uDF73',
      perks: ['Private relay access', 'NIP-05 verified identity', 'Full AI suite access', 'Priority recipe promotion'],
    },
  };

  // --- State ---
  let loading = true;
  let error: string | null = null;
  let showContent = false;

  let tierKey = 'cook';
  let paymentMethod = 'stripe';
  let subscriptionEnd: string | null = null;
  let founderNumber: string | null = null;

  // NIP-05 / username state
  let nip05: string | null = null;
  let nip05Username: string | null = null;
  let username = '';
  let isFocused = false;
  let isAvailable: boolean | null = null;
  let isChecking = false;
  let validationError: string | null = null;
  let isClaiming = false;
  let confirmed = false;
  let chosenName = '';
  let profileUpdated = false;
  let isUpdatingProfile = false;
  let profileUpdateError: string | null = null;

  // Confetti
  let canvasEl: HTMLCanvasElement;
  let animFrame: number;

  $: config = TIERS[tierKey] || TIERS.cook;
  $: pubkeyPrefix = $userPublickey ? $userPublickey.substring(0, 8) : '00000000';
  $: displayName = username || pubkeyPrefix;
  $: hasCustomName = username.length > 0;
  $: canUpdateProfile = !!$ndk && !!$userPublickey && !!chosenName;

  // Debounced availability check
  let checkTimeout: ReturnType<typeof setTimeout>;
  $: if (browser && username) {
    clearTimeout(checkTimeout);
    isAvailable = null;
    const validation = validateUsername(username);
    if (!validation.valid) {
      validationError = validation.error || null;
      isAvailable = null;
      isChecking = false;
    } else {
      validationError = null;
      isChecking = true;
      const capturedUsername = username;
      checkTimeout = setTimeout(async () => {
        const available = await checkUsernameAvailable(capturedUsername);
        // Only update if username hasn't changed during the async check
        if (username === capturedUsername) {
          isAvailable = available;
          isChecking = false;
          if (!available) {
            validationError = 'Username is already taken';
          }
        }
      }, 400);
    }
  } else if (browser && !username) {
    validationError = null;
    isAvailable = null;
    isChecking = false;
  }

  $: canClaim = hasCustomName && isAvailable === true && !validationError && !isChecking;

  onMount(async () => {
    if (!browser) return;

    const params = $page.url.searchParams;
    tierKey = params.get('tier') || 'cook';
    paymentMethod = params.get('payment_method') || 'stripe';
    const sessionId = params.get('session_id');
    const nip05Param = params.get('nip05');
    const nip05UsernameParam = params.get('nip05_username');
    const founderNumberParam = params.get('founder_number');

    if (founderNumberParam) founderNumber = founderNumberParam;

    // Lightning flow — data already in URL
    if (paymentMethod === 'lightning') {
      nip05 = nip05Param;
      nip05Username = nip05UsernameParam;
      // If NIP-05 was already assigned during payment, show success state
      if (nip05Username) {
        chosenName = nip05Username;
        confirmed = true;
      }
      loading = false;
      setTimeout(() => { showContent = true; }, 100);
      initConfetti();
      return;
    }

    // Stripe flow — complete payment via API
    if (!sessionId) {
      error = 'No session ID provided';
      loading = false;
      return;
    }
    if (!$userPublickey) {
      error = 'User not logged in';
      loading = false;
      return;
    }

    try {
      const endpoint = tierKey === 'genesis'
        ? '/api/genesis/complete-payment'
        : '/api/membership/complete-payment';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, pubkey: $userPublickey }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        let errorMessage = `Failed to complete payment (${response.status})`;
        try {
          const data = JSON.parse(responseText);
          errorMessage = data.error || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      const data = JSON.parse(responseText);
      subscriptionEnd = data.subscriptionEnd || null;
      nip05 = data.nip05 || null;
      nip05Username = data.nip05Username || null;
      if (data.founderNumber) founderNumber = data.founderNumber.toString();
      // If NIP-05 was already assigned during payment, show success state
      if (nip05Username) {
        chosenName = nip05Username;
        confirmed = true;
      }

      loading = false;
      setTimeout(() => { showContent = true; }, 100);
      initConfetti();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to complete payment';
      loading = false;
    }
  });

  onDestroy(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    if (checkTimeout) clearTimeout(checkTimeout);
  });

  // --- Confetti ---
  function initConfetti() {
    if (!browser) return;
    // Wait for canvas to be in the DOM
    requestAnimationFrame(() => {
      if (!canvasEl) return;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvasEl.offsetWidth;
      const h = canvasEl.offsetHeight;
      canvasEl.width = w * dpr;
      canvasEl.height = h * dpr;
      ctx.scale(dpr, dpr);

      const accent = config.accent;
      const colors = ['#E8652B', '#F28C5A', '#FBBF24', '#F97316', '#FB923C', '#FCD34D', '#fff', accent];
      const pieces = Array.from({ length: 60 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h * -1.5,
        w: Math.random() * 8 + 3,
        h: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 1.8 + 0.8,
        spin: Math.random() * 0.1 - 0.05,
        angle: Math.random() * Math.PI * 2,
        drift: Math.random() * 0.8 - 0.4,
        opacity: Math.random() * 0.5 + 0.3,
      }));

      const startTime = performance.now();
      const duration = 4000;

      function animate() {
        const elapsed = performance.now() - startTime;
        const fade = elapsed > duration ? Math.max(0, 1 - (elapsed - duration) / 1000) : 1;

        ctx.clearRect(0, 0, w, h);
        if (fade <= 0) return; // done

        pieces.forEach((p) => {
          p.y += p.speed;
          p.x += p.drift;
          p.angle += p.spin;
          if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.globalAlpha = p.opacity * fade;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        });
        animFrame = requestAnimationFrame(animate);
      }
      animate();
    });
  }

  // --- Username claim ---
  function handleUsernameInput(e: Event) {
    const input = e.target as HTMLInputElement;
    username = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }

  async function claimUsername(name: string) {
    if (!$userPublickey || isClaiming) return;
    isClaiming = true;

    const claimTier: 'cook' | 'pro' = (tierKey === 'pro' || tierKey === 'genesis') ? 'pro' : 'cook';
    const result = await claimNip05(name, $userPublickey, claimTier);

    if (result.success && result.nip05) {
      chosenName = name;
      confirmed = true;
    } else {
      validationError = result.error || 'Failed to claim username';
    }
    isClaiming = false;
  }

  function handleClaim() {
    if (canClaim) claimUsername(username);
  }

  function handleSkip() {
    claimUsername(pubkeyPrefix);
  }

  async function updateProfile() {
    if (isUpdatingProfile) return;
    
    // Defense in depth: Check prerequisites even though button is disabled
    // This protects against programmatic calls or edge cases
    if (!$ndk || !$userPublickey || !chosenName) {
      if (!$userPublickey) {
        profileUpdateError = 'Unable to update profile. Please log in and try again.';
      } else if (!chosenName) {
        profileUpdateError = 'Unable to update profile. Please claim a username first.';
      } else {
        profileUpdateError = 'Unable to update profile. Nostr connection not available.';
      }
      return;
    }
    
    isUpdatingProfile = true;
    profileUpdateError = null;
    try {
      const nip05Address = `${chosenName}@zap.cooking`;
      const success = await updateProfileWithNip05($ndk, $userPublickey, nip05Address);
      if (success) {
        profileUpdated = true;
      } else {
        profileUpdateError = 'Failed to update profile. You can add it manually in settings.';
      }
    } catch (err) {
      console.error('Failed to update profile:', err);
      profileUpdateError = 'Failed to update profile. You can add it manually in settings.';
    }
    isUpdatingProfile = false;
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<svelte:head>
  <title>Welcome to {config.name}! - zap.cooking</title>
  <link
    href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="confirmation-page" style="--tier-accent: {config.accent}; --tier-glow: {config.accentGlow};">
  <!-- Background glow -->
  <div class="bg-glow"></div>

  <!-- Confetti canvas -->
  <canvas class="confetti-canvas" bind:this={canvasEl}></canvas>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p class="loading-text">Completing your membership...</p>
    </div>
  {:else if error}
    <div class="error-state">
      <h1 class="error-heading">Something went wrong</h1>
      <p class="error-text">{error}</p>
      <button class="error-button" on:click={() => goto('/membership')}>
        Back to Membership
      </button>
    </div>
  {:else}
    <div class="content" class:visible={showContent}>
      <!-- Tier badge -->
      <div class="badge-container">
        <div class="tier-badge">{config.badgeIcon}</div>
      </div>

      <!-- Welcome heading -->
      <h1 class="welcome-heading">Welcome to {config.name}!</h1>

      <!-- Tagline -->
      <p class="tagline">{config.tagline}</p>

      <!-- Status bar -->
      <div class="status-bar">
        <div class="status-left">
          <div class="status-dot"></div>
          <span class="status-text">Membership active</span>
        </div>
        {#if subscriptionEnd}
          <span class="status-date">until {formatDate(subscriptionEnd)}</span>
        {:else if tierKey === 'genesis'}
          <span class="status-date">lifetime</span>
        {/if}
      </div>

      <!-- Perks card -->
      <div class="perks-card">
        <p class="perks-label">WHAT'S INCLUDED</p>
        <div class="perks-list">
          {#each config.perks as perk, i}
            <div
              class="perk-item"
              class:visible={showContent}
              style="transition-delay: {0.4 + i * 0.1}s"
            >
              <div class="perk-check">{'\u2713'}</div>
              <span class="perk-text">{perk}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Username claim or success -->
      {#if !confirmed}
        <div class="claim-card" class:has-username={hasCustomName}>
          <!-- Live preview pill -->
          <div class="preview-container">
            <div class="preview-pill" class:has-username={hasCustomName}>
              <div class="preview-check" class:active={hasCustomName}>{'\u2713'}</div>
              <span class="preview-name" class:active={hasCustomName}>
                {displayName}<span class="preview-domain">@zap.cooking</span>
              </span>
            </div>
          </div>

          <h3 class="claim-heading">Claim your identity</h3>
          <p class="claim-subtext">
            Choose a username for your verified Nostr address.<br />
            This is how other clients will verify you.
          </p>

          <!-- Input -->
          <div class="input-wrapper" class:focused={isFocused}>
            <input
              type="text"
              placeholder="yourname"
              value={username}
              on:input={handleUsernameInput}
              on:focus={() => (isFocused = true)}
              on:blur={() => (isFocused = false)}
              class="username-input"
              autocapitalize="none"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="input-suffix">@zap.cooking</span>
          </div>

          {#if validationError && username}
            <p class="validation-error">{validationError}</p>
          {:else if isChecking && username}
            <p class="validation-checking">Checking availability...</p>
          {:else if isAvailable && username}
            <p class="validation-available">Username is available!</p>
          {/if}

          <!-- Buttons -->
          <div class="claim-buttons">
            <button
              class="claim-button"
              class:active={canClaim}
              disabled={!canClaim || isClaiming}
              on:click={handleClaim}
            >
              {#if isClaiming}
                Claiming...
              {:else if canClaim}
                Claim {username}@zap.cooking
              {:else}
                Type a username above
              {/if}
            </button>
            <button class="skip-button" on:click={handleSkip} disabled={isClaiming}>
              Skip — use {pubkeyPrefix}@zap.cooking instead
            </button>
          </div>
        </div>
      {:else}
        <!-- Success card -->
        <div class="success-card">
          <div class="success-check">{'\u2713'}</div>
          <h3 class="success-heading">You're all set!</h3>
          <p class="success-nip05">{chosenName}@zap.cooking</p>
          {#if profileUpdated}
            <p class="success-subtext">
              Your verified identity has been added to your profile.<br />
              Other Nostr clients can now verify you.
            </p>
          {:else}
            <p class="success-subtext">
              Your identity has been claimed.<br />
              Update your Nostr profile to make it visible to other clients.
            </p>
          {/if}
          {#if profileUpdateError}
            <p class="profile-update-error">{profileUpdateError}</p>
          {/if}
          <div class="success-buttons">
            {#if !profileUpdated}
              <button
                class="update-profile-button"
                on:click={updateProfile}
                disabled={isUpdatingProfile || !canUpdateProfile}
              >
                {#if isUpdatingProfile}
                  Updating Profile...
                {:else}
                  Update Profile
                {/if}
              </button>
            {/if}
            <button class="start-cooking-button" on:click={() => goto('/explore')}>
              Start Cooking →
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ===== Page shell ===== */
  .confirmation-page {
    position: relative;
    min-height: 100vh;
    background: #0F1219;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    overflow: hidden;
    /* Full bleed: counteract parent padding */
    margin: 0 -1rem;
    padding-left: 1rem;
    padding-right: 1rem;
    margin-bottom: -4rem;
    padding-bottom: 4rem;
  }

  .bg-glow {
    position: absolute;
    top: -30%;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    height: 800px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 101, 43, 0.3) 0%, transparent 70%);
    opacity: 0.5;
    pointer-events: none;
    filter: blur(80px);
  }

  .confetti-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  /* ===== Loading / Error ===== */
  .loading-state,
  .error-state {
    position: relative;
    z-index: 1;
    text-align: center;
    padding: 3rem 1rem;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 3px solid rgba(232, 101, 43, 0.2);
    border-top-color: #E8652B;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    font-family: 'DM Sans', sans-serif;
    color: rgba(255, 255, 255, 0.5);
    font-size: 15px;
  }

  .error-heading {
    font-family: 'Outfit', 'DM Sans', sans-serif;
    color: #ef4444;
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .error-text {
    font-family: 'DM Sans', sans-serif;
    color: rgba(255, 255, 255, 0.45);
    font-size: 14px;
    margin: 0 0 24px 0;
  }

  .error-button {
    padding: 12px 28px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .error-button:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  /* ===== Main content ===== */
  .content {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 480px;
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .content.visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* ===== Tier badge ===== */
  .badge-container {
    text-align: center;
    margin-bottom: 8px;
  }

  .tier-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid color-mix(in srgb, var(--tier-accent) 21%, transparent);
    font-size: 36px;
    box-shadow: 0 0 40px var(--tier-glow);
  }

  /* ===== Welcome heading ===== */
  .welcome-heading {
    font-family: 'Playfair Display', 'DM Serif Display', Georgia, serif;
    font-size: clamp(28px, 6vw, 40px);
    font-weight: 700;
    text-align: center;
    margin: 20px 0 0 0;
    background: linear-gradient(135deg, #F28C5A 0%, #E8652B 50%, #C4501E 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  /* ===== Tagline ===== */
  .tagline {
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
    margin: 10px 0 32px 0;
  }

  /* ===== Status bar ===== */
  .status-bar {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 18px 24px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #22C55E;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.3);
  }

  .status-text {
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.55);
  }

  .status-date {
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    color: #E8652B;
    font-weight: 600;
  }

  /* ===== Perks card ===== */
  .perks-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 20px 24px;
    margin-bottom: 24px;
  }

  .perks-label {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 14px 0;
  }

  .perks-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .perk-item {
    display: flex;
    align-items: center;
    gap: 10px;
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .perk-item.visible {
    opacity: 1;
    transform: translateX(0);
  }

  .perk-check {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--tier-accent) 9%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--tier-accent);
    flex-shrink: 0;
  }

  .perk-text {
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
  }

  /* ===== Username claim card ===== */
  .claim-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 32px 28px;
    transition: border-color 0.4s ease, box-shadow 0.4s ease;
  }

  .claim-card.has-username {
    border-color: rgba(232, 101, 43, 0.31);
    box-shadow: 0 0 30px rgba(232, 101, 43, 0.3);
  }

  /* Preview pill */
  .preview-container {
    text-align: center;
    margin-bottom: 28px;
  }

  .preview-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 50px;
    padding: 14px 24px;
    transition: all 0.4s ease;
    transform: scale(1);
  }

  .preview-pill.has-username {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
    transform: scale(1.02);
  }

  .preview-check {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #fff;
    flex-shrink: 0;
    transition: background 0.4s ease, box-shadow 0.4s ease;
  }

  .preview-check.active {
    background: #22C55E;
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.3);
  }

  .preview-name {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: -0.02em;
    transition: color 0.3s ease;
  }

  .preview-name.active {
    color: #fff;
  }

  .preview-domain {
    color: rgba(255, 255, 255, 0.25);
  }

  /* Claim headings */
  .claim-heading {
    font-family: 'Outfit', 'DM Sans', sans-serif;
    font-size: 19px;
    font-weight: 600;
    color: #fff;
    text-align: center;
    margin: 0 0 6px 0;
  }

  .claim-subtext {
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    margin: 0 0 24px 0;
    line-height: 1.5;
  }

  /* Input */
  .input-wrapper {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 14px;
    border: 2px solid rgba(255, 255, 255, 0.08);
    padding: 4px 6px 4px 4px;
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
  }

  .input-wrapper.focused {
    border-color: #E8652B;
    box-shadow: 0 0 20px rgba(232, 101, 43, 0.3);
  }

  .username-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 16px;
    color: #fff;
    padding: 12px 14px;
    min-width: 0;
  }

  .username-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
  }

  .input-suffix {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.2);
    padding-right: 12px;
    white-space: nowrap;
  }

  /* Validation messages */
  .validation-error {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    color: #ef4444;
    margin: 8px 0 0 4px;
  }

  .validation-checking {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.3);
    margin: 8px 0 0 4px;
  }

  .validation-available {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    color: #22C55E;
    margin: 8px 0 0 4px;
  }

  /* Buttons */
  .claim-buttons {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .claim-button {
    width: 100%;
    padding: 15px 24px;
    border-radius: 14px;
    border: none;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.3);
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    font-weight: 600;
    cursor: default;
    transition: all 0.3s ease;
    box-shadow: none;
  }

  .claim-button.active {
    background: linear-gradient(135deg, #F28C5A 0%, #E8652B 50%, #C4501E 100%);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(232, 101, 43, 0.3);
  }

  .claim-button.active:hover {
    box-shadow: 0 6px 28px rgba(232, 101, 43, 0.4);
    transform: translateY(-1px);
  }

  .claim-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .skip-button {
    width: 100%;
    padding: 12px 24px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    background: transparent;
    color: rgba(255, 255, 255, 0.25);
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .skip-button:hover {
    border-color: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.4);
  }

  .skip-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ===== Success card ===== */
  .success-card {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(34, 197, 94, 0.02));
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 20px;
    padding: 32px 28px;
    text-align: center;
  }

  .success-check {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #34D399 0%, #22C55E 50%, #16A34A 100%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    color: #fff;
    margin-bottom: 16px;
    box-shadow: 0 0 24px rgba(34, 197, 94, 0.3);
  }

  .success-heading {
    font-family: 'Outfit', 'DM Sans', sans-serif;
    font-size: 20px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 8px 0;
  }

  .success-nip05 {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    color: #22C55E;
    margin: 0 0 6px 0;
  }

  .success-subtext {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.35);
    margin: 0 0 24px 0;
    line-height: 1.6;
  }

  .start-cooking-button {
    padding: 14px 36px;
    border-radius: 14px;
    border: none;
    background: linear-gradient(135deg, #F28C5A 0%, #E8652B 50%, #C4501E 100%);
    color: #fff;
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(232, 101, 43, 0.3);
    transition: all 0.3s ease;
  }

  .start-cooking-button:hover {
    box-shadow: 0 6px 28px rgba(232, 101, 43, 0.4);
    transform: translateY(-1px);
  }

  .success-buttons {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .update-profile-button {
    padding: 14px 36px;
    border-radius: 14px;
    border: none;
    background: linear-gradient(135deg, #34D399 0%, #22C55E 50%, #16A34A 100%);
    color: #fff;
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(34, 197, 94, 0.3);
    transition: all 0.3s ease;
  }

  .update-profile-button:hover {
    box-shadow: 0 6px 28px rgba(34, 197, 94, 0.4);
    transform: translateY(-1px);
  }

  .update-profile-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }

  .profile-update-error {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    color: #ef4444;
    margin: 0 0 16px 0;
  }

  /* ===== Responsive ===== */
  @media (max-width: 520px) {
    .confirmation-page {
      padding: 24px 16px;
      padding-bottom: 4rem;
    }

    .claim-card {
      padding: 24px 20px;
    }

    .success-card {
      padding: 24px 20px;
    }

    .status-bar {
      padding: 14px 18px;
    }

    .perks-card {
      padding: 16px 18px;
    }

    .preview-pill {
      padding: 10px 16px;
      gap: 8px;
    }

    .preview-name {
      font-size: 14px;
    }
  }
</style>
