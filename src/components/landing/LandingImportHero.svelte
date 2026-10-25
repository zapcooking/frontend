<script lang="ts">
  import { ANON_IMPORT_HANDOFF_KEY, ANON_IMPORT_INPUT_KEY } from '$lib/anonImport';
  import { EXTRACT_ERROR_FALLBACK } from '$lib/extractErrors';
  const errors = {
    ...EXTRACT_ERROR_FALLBACK,
    SOURCE_BLOCKED:
      'That site blocks automatic imports. You can paste the recipe text into Sous Chef with Cook+ instead.',
    SOURCE_TOO_LARGE:
      'That page is too large to import. Try its print-friendly recipe page, or paste the recipe text into Sous Chef with Cook+.'
  };
</script>

<svelte:head><script src="/landing-import.js" defer></script></svelte:head>

<section id="import-recipe" class="import-invitation" aria-labelledby="import-heading">
  <div>
    <p class="eyebrow">Sous Chef</p>
    <h2 id="import-heading">Bring your recipes to the table.</h2>
    <p>Turn a recipe link into a recipe you can review, save, and share.</p>
  </div>
  <div>
    <form
      data-landing-import
      data-errors={JSON.stringify(errors)}
      data-handoff-key={ANON_IMPORT_HANDOFF_KEY}
      data-input-key={ANON_IMPORT_INPUT_KEY}
      action="/souschef"
      method="get"
    >
      <label for="import-url">Recipe link</label>
      <div class="import-fields">
        <input
          id="import-url"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://…"
          required
          maxlength="2048"
          aria-describedby="import-help import-status"
        />
        <button type="submit" disabled>Import a recipe free</button>
      </div>
      <p id="import-status" role="status" aria-live="polite"></p>
      <p id="import-help" class="import-help">Review and edit first. Sign in to save or publish.</p>
      <noscript
        ><p>
          Enable JavaScript to import a recipe link. You can still <a href="/recipes"
            >browse recipes</a
          >.
        </p></noscript
      >
    </form>
    <p class="import-help">
      Photos and pasted text? <a href="#membership">Explore Cook+ and Sous Chef.</a>
    </p>
  </div>
</section>

<style>
  .import-invitation {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 1.5rem;
    padding: 1.5rem 1.75rem;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    margin: 28px 0 36px;
    background: var(--color-explore-peach, var(--color-bg-secondary));
    color: var(--color-text-primary);
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.13em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-primary);
    margin: 0 0 0.6rem;
  }
  h2 {
    font-family: var(--font-editorial, Georgia, serif);
    font-size: clamp(1.65rem, 2.5vw, 2rem);
    line-height: 1.12;
    margin: 0 0 0.7rem;
    font-weight: 700;
  }
  p {
    font-size: 0.9rem;
    line-height: 1.55;
    margin: 0.5rem 0;
    color: var(--color-text-secondary);
  }
  label {
    display: block;
    font-size: 0.8rem;
    font-weight: 650;
    margin-bottom: 0.5rem;
  }
  .import-fields {
    display: flex;
    gap: 0.5rem;
  }
  input {
    min-height: 44px;
    min-width: 0;
    flex: 1;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    padding: 0.75rem;
    color: var(--color-text-primary);
    font: inherit;
    font-size: 0.85rem;
  }
  button {
    min-height: 44px;
    background: var(--color-primary);
    color: white;
    border: 0;
    border-radius: 12px;
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
    font-weight: 650;
    border-radius: 9999px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  input:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 3px;
  }
  .import-help {
    font-size: 0.75rem;
  }
  a {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .import-help a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  #import-status:empty {
    display: none;
  }
  #import-status {
    font-size: 0.85rem;
  }
  @media (max-width: 700px) {
    .import-invitation {
      grid-template-columns: 1fr;
      gap: 1rem;
      padding: 1.25rem;
    }
    .import-fields {
      flex-direction: column;
    }
    button {
      width: 100%;
    }
  }
</style>
