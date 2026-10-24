<header class="landing-header">
  <a href="#main" class="skip-link">Skip to content</a>
  <div class="header-inner">
    <a href="/explore" class="wordmark" aria-label="Zap Cooking home">
      <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="144" height="36" />
      <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="144" height="36" />
    </a>
    <nav aria-label="Explore Zap Cooking">
      <a href="/recipes">Recipes</a><a href="/reads">Stories</a><a href="/packs">Collections</a><a
        href="#import-recipe">Add a recipe</a
      ><a href="#membership">Membership</a>
    </nav>
    <div class="account">
      <a href="/login" data-landing-guest hidden>Sign in</a><a
        href="/login?join=1"
        class="join"
        data-landing-guest
        hidden>Join free</a
      >
    </div>
  </div>
</header>

<style>
  .landing-header {
    border-bottom: 1px solid var(--color-input-border);
  }
  .header-inner {
    max-width: 1200px;
    margin: auto;
    padding: 12px 32px;
    display: flex;
    align-items: center;
    gap: 28px;
  }
  .wordmark {
    display: flex;
    align-items: center;
    min-height: 44px;
    flex-shrink: 0;
  }
  nav {
    display: flex;
    align-items: center;
    gap: 20px;
    font-size: 12px;
    font-weight: 600;
  }
  nav a,
  .account a {
    min-width: 44px;
    align-items: center;
    min-height: 44px;
  }
  nav a {
    display: inline-flex;
    white-space: nowrap;
  }
  .account {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 18px;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
  .account a:not([hidden]) {
    display: inline-flex;
  }
  .join {
    background: var(--landing-accent-bg);
    color: white !important;
    padding: 0 18px;
    border-radius: 3px;
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
    left: 16px;
    top: 8px;
    z-index: 20;
    padding: 12px;
    background: var(--color-bg-primary);
  }
  @media (max-width: 1000px) {
    .header-inner {
      flex-wrap: wrap;
      gap: 0 20px;
    }
    nav {
      order: 3;
      width: 100%;
      justify-content: center;
    }
  }
  @media (max-width: 767px) {
    .header-inner {
      padding: 8px 20px 0;
    }
    .wordmark img {
      width: 118px;
    }
    nav {
      justify-content: space-between;
      gap: 14px;
      overflow-x: auto;
      font-size: 11px;
    }
    .account {
      gap: 12px;
    }
    .join {
      padding: 0 12px;
    }
  }
</style>
