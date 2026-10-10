<script lang="ts">
  /**
   * The landing page's own header: plain links, no client auth state, no
   * NDK (the app header pulls in $lib/nostr).
   */
</script>

<header class="landing-header">
  <a href="#main" class="skip-link">Skip to content</a>
  <div class="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
    <a href="/explore" class="shrink-0" aria-label="zap.cooking home">
      <img src="/zapcooking-text-light.svg" class="logo-l w-28 sm:w-32" alt="" width="128" height="32" />
      <img src="/zapcooking-text-dark.svg" class="logo-d w-28 sm:w-32" alt="" width="128" height="32" />
    </a>
    <nav aria-label="Sections" class="hidden md:flex items-center gap-5 text-sm font-medium">
      <a href="/recipes">Recipes</a>
      <a href="/feed">Feed</a>
      <a href="/reads">Reads</a>
      <a href="/packs">Packs</a>
    </nav>
    <div class="ml-auto flex items-center gap-3 text-sm font-medium">
      <a href="/login" class="signin">Sign in</a>
      <a href="/feed" class="open-app">Open the app <span aria-hidden="true">→</span></a>
    </div>
  </div>
</header>

<style>
  .landing-header {
    border-bottom: 1px solid var(--color-input-border);
    background-color: var(--color-bg-primary);
  }
  .landing-header a {
    color: var(--color-text-primary);
    text-decoration: none;
  }
  nav a:hover,
  .signin:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .open-app {
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    background-color: var(--landing-accent-bg);
    color: #fff !important;
    white-space: nowrap;
  }
  .open-app:hover {
    filter: brightness(1.08);
  }
  .logo-d {
    display: none;
  }
  :global(html.dark) .logo-l {
    display: none;
  }
  :global(html.dark) .logo-d {
    display: block;
  }
  .skip-link {
    position: absolute;
    left: -9999px;
  }
  .skip-link:focus {
    left: 1rem;
    top: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-bg-primary);
    z-index: 10;
  }
</style>
