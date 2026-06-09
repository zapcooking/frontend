<script lang="ts">
  /**
   * Compact Cheffy entry-point for the Explore (home) page. Lets anyone
   * see and understand Cheffy; hands a typed prompt off to /cheffy for
   * eligible members via the session-storage handoff (never a public
   * URL). Auth + membership enforcement live on the /cheffy page itself,
   * so this card stays simple and never exposes a paid AI request.
   */
  import { goto } from '$app/navigation';
  import { setCheffyPrompt } from '$lib/cheffy';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import PaperPlaneIcon from 'phosphor-svelte/lib/PaperPlaneTilt';

  // The card itself enforces nothing — auth and membership are handled
  // on /cheffy. The "Pro Kitchen" chip communicates the requirement up
  // front, so we don't need membership state here.
  let value = '';

  // Larger-screen quick starters — text prompts handed off the same way.
  const quickChips = ['Quick dinner', 'Use what I have', 'Fix my recipe'];
  const quickPrompts: Record<string, string> = {
    'Quick dinner': 'I need a quick dinner. Give me a recipe.',
    'Use what I have': 'Help me cook something with what I already have.',
    'Fix my recipe': 'Something went wrong with my recipe. Can you help me fix it?'
  };

  function go(prompt?: string) {
    const text = (prompt ?? value).trim();
    // Stash the prompt for /cheffy to pick up after auth/membership.
    if (text) setCheffyPrompt(text);
    goto('/cheffy');
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    go();
  }
</script>

<section class="cheffy-card" data-section="cheffy">
  <div class="cheffy-card-avatar" aria-hidden="true">
    <CheffyAvatar size={56} expression="happy" />
  </div>

  <div class="cheffy-card-body">
    <div class="cheffy-card-head">
      <h2 class="cheffy-card-title">Not sure what to cook?</h2>
      <span class="cheffy-card-pro">Pro Kitchen</span>
    </div>
    <p class="cheffy-card-sub">
      Ask Cheffy, your kitchen companion — questions, substitutions, or dinner from what you have.
    </p>

    <form class="cheffy-card-form" on:submit={onSubmit}>
      <label for="cheffy-home-input" class="sr-only">Ask Cheffy a cooking question</label>
      <input
        id="cheffy-home-input"
        type="text"
        bind:value
        class="cheffy-card-input"
        placeholder="What are we cooking?"
        maxlength="500"
      />
      <button type="submit" class="cheffy-card-btn">
        <PaperPlaneIcon size={16} weight="fill" />
        Ask Cheffy
      </button>
    </form>

    <!-- Starter chips only on larger screens to keep mobile compact. -->
    <div class="cheffy-card-chips">
      {#each quickChips as chip}
        <button type="button" class="cheffy-card-chip" on:click={() => go(quickPrompts[chip])}>
          {chip}
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  .cheffy-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-radius: 16px;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-secondary)) 0%,
      var(--color-bg-secondary) 60%
    );
    border: 1px solid color-mix(in srgb, var(--color-primary) 22%, var(--color-input-border));
  }

  .cheffy-card-avatar {
    flex-shrink: 0;
  }
  /* Hide the avatar on the narrowest screens so the card stays compact
     and the input keeps priority. */
  @media (max-width: 380px) {
    .cheffy-card-avatar {
      display: none;
    }
  }

  .cheffy-card-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .cheffy-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .cheffy-card-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0;
  }
  .cheffy-card-pro {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  }
  .cheffy-card-sub {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    margin: 0;
  }

  .cheffy-card-form {
    display: flex;
    gap: 8px;
    margin-top: 2px;
  }
  .cheffy-card-input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 0.9rem;
  }
  .cheffy-card-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 30%, transparent);
  }
  .cheffy-card-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    border: 0;
    background-color: var(--color-primary);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      filter 140ms ease,
      transform 140ms ease;
  }
  .cheffy-card-btn:hover {
    filter: brightness(1.06);
  }
  .cheffy-card-btn:active {
    transform: scale(0.97);
  }

  .cheffy-card-chips {
    display: none;
    gap: 8px;
    margin-top: 2px;
  }
  /* Starter chips only on roomier screens. */
  @media (min-width: 640px) {
    .cheffy-card-chips {
      display: flex;
    }
  }
  .cheffy-card-chip {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
    background-color: color-mix(in srgb, var(--color-primary) 6%, transparent);
    color: var(--color-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .cheffy-card-chip:hover {
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
  }
</style>
