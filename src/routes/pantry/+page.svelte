<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import { goto } from '$app/navigation';

  let hasActiveMembership = false;
  let checkingMembership = false;

  const PANTRY_RELAY = 'wss://pantry.zap.cooking';

  // Weekly new-recipe stats (fetched via the server-side proxy so the relay
  // secret never reaches the browser).
  interface RecipeWeek {
    week_start: string;
    count: number;
  }
  let recipeWeeks: RecipeWeek[] = [];
  let recipeWeeksMax = 0;
  let recipeWeeksLoading = false;
  let recipeWeeksError = false;
  let recipeWeeksLoaded = false;

  async function loadRecipesByWeek() {
    if (recipeWeeksLoaded || recipeWeeksLoading) return;

    recipeWeeksLoading = true;
    recipeWeeksError = false;
    try {
      const res = await fetch('/api/pantry/recipes-by-week');
      if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
      const data = await res.json();
      recipeWeeks = Array.isArray(data?.weeks) ? data.weeks : [];
      recipeWeeksMax = recipeWeeks.reduce((m, w) => Math.max(m, w.count), 0);
      recipeWeeksLoaded = true;
    } catch (err) {
      console.error('Failed to load recipes-by-week:', err);
      recipeWeeksError = true;
    } finally {
      recipeWeeksLoading = false;
    }
  }

  // Load the chart once membership is confirmed.
  $: if (hasActiveMembership) {
    loadRecipesByWeek();
  }

  // Check membership status
  async function checkMembership() {
    if (!$userPublickey || checkingMembership) return;
    
    checkingMembership = true;
    try {
      const res = await fetch('/api/membership/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: $userPublickey })
      });
      
      if (res.ok) {
        const data = await res.json();
        hasActiveMembership = data.isActive === true;
      }
    } catch (err) {
      console.error('Failed to check membership:', err);
    } finally {
      checkingMembership = false;
    }
  }

  onMount(() => {
    if ($userPublickey) {
      checkMembership();
    }
  });
</script>

<svelte:head>
  <title>The Pantry 🏪 - zap.cooking</title>
  <meta name="description" content="The Pantry is a members-only corner of Zap Cooking for deeper conversations, early access, and shaping what's next." />
  <meta property="og:url" content="https://zap.cooking/pantry" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="The Pantry 🏪 - zap.cooking" />
  <meta property="og:description" content="The Pantry is a members-only corner of Zap Cooking for deeper conversations, early access, and shaping what's next." />
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/pantry" />
  <meta name="twitter:title" content="The Pantry 🏪 - zap.cooking" />
  <meta name="twitter:description" content="The Pantry is a members-only corner of Zap Cooking for deeper conversations, early access, and shaping what's next." />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<div class="flex flex-col gap-8">
  <!-- Hero Section -->
  <section class="flex flex-col gap-4">
    <div class="text-center py-8">
      <h1 class="text-4xl md:text-5xl font-bold mb-3" style="color: var(--color-text-primary)">
        The Pantry 🏪
      </h1>
      <p class="text-xl md:text-2xl font-medium mb-2" style="color: var(--color-text-secondary)">
        A members-only corner of Zap Cooking
      </p>
      <p class="text-base md:text-lg max-w-2xl mx-auto" style="color: var(--color-text-secondary)">
        The Pantry is a members-only corner of Zap Cooking for deeper conversations, early access, and shaping what's next. It's a place for people who care about food, community, and building in the open — together.
      </p>
    </div>
  </section>

  <!-- Membership Check -->
  {#if !$userPublickey}
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <div class="text-center">
        <h2 class="text-2xl font-bold mb-4" style="color: var(--color-text-primary)">
          Members Only
        </h2>
        <p class="mb-6" style="color: var(--color-text-secondary)">
          The Pantry is exclusive to Zap Cooking members. Sign in and become a member to access this community.
        </p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            on:click={() => goto('/login')}
            class="px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-[#d64000] transition-colors"
          >
            Sign In
          </button>
          <button
            on:click={() => goto('/membership')}
            class="px-6 py-3 rounded-lg border-2 font-medium transition-colors"
            style="border-color: var(--color-primary); color: var(--color-primary);"
          >
            Become a Member
          </button>
        </div>
      </div>
    </section>
  {:else if checkingMembership}
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <div class="text-center">
        <p style="color: var(--color-text-secondary)">Checking membership status...</p>
      </div>
    </section>
  {:else if !hasActiveMembership}
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <div class="text-center">
        <h2 class="text-2xl font-bold mb-4" style="color: var(--color-text-primary)">
          Members Only
        </h2>
        <p class="mb-6" style="color: var(--color-text-secondary)">
          The Pantry is exclusive to Zap Cooking members. Become a member to access deeper conversations, early access features, and help shape what's next.
        </p>
        <button
          on:click={() => goto('/membership')}
          class="px-6 py-3 rounded-lg bg-primary text-white font-medium hover:bg-[#d64000] transition-colors"
        >
          Become a Member
        </button>
      </div>
    </section>
  {:else}
    <!-- Relay Info Card -->
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
        <span>🔌</span>
        <span>Relay Information</span>
      </h2>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
          <span class="font-medium text-sm" style="color: var(--color-text-secondary)">WebSocket URL:</span>
          <code class="text-sm px-3 py-1.5 rounded bg-input-bg font-mono" style="color: var(--color-text-primary); border: 1px solid var(--color-input-border)">
            {PANTRY_RELAY}
          </code>
        </div>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Add this relay to your client to access The Pantry. This is a members-only relay for deeper conversations and exclusive content.
        </p>
      </div>
    </section>

    <!-- What's in The Pantry Section -->
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
        <span>✨</span>
        <span>What's in The Pantry</span>
      </h2>
      <div class="flex flex-col gap-4" style="color: var(--color-text-secondary)">
        <div class="flex flex-col gap-2">
          <h3 class="font-semibold text-base" style="color: var(--color-text-primary)">As a member, you get:</h3>
          <ul class="list-disc list-inside space-y-2 ml-2">
            <li>Deeper conversations about food, cooking, and community</li>
            <li>Early access to new features and updates</li>
            <li>Opportunity to shape what's next for Zap Cooking</li>
            <li>Exclusive content from the Zap Cooking team</li>
            <li>A space to build in the open — together</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- New Recipes by Week Section -->
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
        <span>📈</span>
        <span>New Recipes by Week</span>
      </h2>

      {#if recipeWeeksLoading}
        <p class="text-sm" style="color: var(--color-text-secondary)">Loading…</p>
      {:else if recipeWeeksError}
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Recipe stats are unavailable right now. Please check back later.
        </p>
      {:else if !recipeWeeks.length || recipeWeeksMax === 0}
        <p class="text-sm" style="color: var(--color-text-secondary)">
          No new recipes recorded yet.
        </p>
      {:else}
        <div class="flex items-end gap-1 h-40">
          {#each recipeWeeks as week (week.week_start)}
            <div class="flex flex-1 flex-col items-center justify-end h-full">
              <div class="text-[10px] mb-1" style="color: var(--color-text-secondary)">{week.count}</div>
              <div
                class="w-full rounded-t transition-all duration-300"
                style="height: {recipeWeeksMax ? Math.max(2, (week.count / recipeWeeksMax) * 100) : 2}%; background-color: {week.count === 0 ? 'var(--color-input-border)' : 'var(--color-primary)'};"
                title="{week.week_start}: {week.count} recipes"
              ></div>
              <div class="text-[9px] mt-1" style="color: var(--color-text-secondary)">{week.week_start.slice(5)}</div>
            </div>
          {/each}
        </div>
        <p class="text-xs mt-4" style="color: var(--color-text-secondary)">
          Recipes added to the Pantry each week. The July spike reflects a one-time import of existing recipes.
        </p>
      {/if}
    </section>

    <!-- Browse Content Section -->
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
        <span>🔍</span>
        <span>Browse Pantry Content</span>
      </h2>
      <p class="mb-4" style="color: var(--color-text-secondary)">
        Explore posts and conversations from Pantry members:
      </p>
      <div class="flex flex-col sm:flex-row gap-3">
        <a 
          href="https://fevela.me/?r=wss%3A%2F%2Fpantry.zap.cooking" 
          target="_blank" 
          rel="noopener noreferrer"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-[#d64000] transition-colors"
        >
          <span>Browse on fevela.me</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <a
          href="/community?tab=members"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 font-medium transition-colors"
          style="border-color: var(--color-primary); color: var(--color-primary);"
        >
          <span>View in Community Feed</span>
        </a>
      </div>
    </section>
  {/if}
</div>
