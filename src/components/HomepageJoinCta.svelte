<!--
  Logged-out homepage entry for cold visitors (e.g. paid ads).
  Links to /login → LoginOverlay “Create Profile”. No signup logic here.
-->
<section class="join-cta" aria-label="Join Zap Cooking">
  <h2 class="text-2xl font-bold" style="color: var(--color-text-primary);">
    New here? Join free
  </h2>
  <p class="text-sm" style="color: var(--color-text-secondary);">
    Save recipes, follow cooks, and share your kitchen — create your profile in under a minute.
  </p>
  <a
    href="/login"
    class="rounded-full whitespace-nowrap inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold transition duration-300 bg-primary text-white hover:opacity-80"
  >
    Join free
  </a>
</section>

<style>
  .join-cta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-top: 0.25rem;
  }
</style>
