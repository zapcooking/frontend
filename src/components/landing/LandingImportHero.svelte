<script lang="ts">
  import { onMount } from 'svelte';
  import { enhanceLandingImport } from '$lib/landing/import.client';
  import { ANON_IMPORT_HANDOFF_KEY, ANON_IMPORT_INPUT_KEY } from '$lib/anonImport';
  import { EXTRACT_ERROR_FALLBACK } from '$lib/extractErrors';
  let form: HTMLFormElement;
  onMount(() => enhanceLandingImport(form));

  const errors = {
    ...EXTRACT_ERROR_FALLBACK,
    SOURCE_BLOCKED:
      'That site blocks automatic imports. You can paste the recipe text into Sous Chef with Cook+ instead.',
    SOURCE_TOO_LARGE:
      'That page is too large to import. Try its print-friendly recipe page, or paste the recipe text into Sous Chef with Cook+.'
  };
</script>

<section id="import-recipe" class="import-invitation" aria-labelledby="import-heading">
  <div>
    <h2 id="import-heading">Bring a favorite to the table.</h2>
    <p>
      Found a recipe you love? Let Sous Chef turn the link into a recipe you can review, save, and
      share.
    </p>
  </div>
  <div>
    <form
      bind:this={form}
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
    gap: 32px;
    margin: 36px 0;
    padding: 28px;
    border-block: 1px solid var(--color-input-border);
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }
  h2 {
    max-width: 20ch;
    margin: 0 0 12px;
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--explore-section, 32px);
    font-weight: 500;
    line-height: 1.12;
    letter-spacing: -0.025em;
  }
  p {
    max-width: 60ch;
    margin: 8px 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.5;
  }
  label {
    display: block;
    margin-bottom: 8px;
    font-size: var(--explore-meta, 13px);
    font-weight: 600;
  }
  .import-fields {
    display: flex;
    gap: 8px;
  }
  input {
    min-height: 48px;
    min-width: 0;
    flex: 1;
    padding: 12px;
    border: 1px solid var(--color-input-border);
    border-radius: 0;
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--explore-body, 16px);
  }
  button {
    min-height: 48px;
    padding: 12px 16px;
    border: 0;
    border-radius: 0;
    background: var(--color-primary);
    color: white;
    font-size: var(--explore-meta, 13px);
    font-weight: 600;
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
  .import-help,
  #import-status {
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
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
  @media (max-width: 900px) {
    .import-invitation {
      grid-template-columns: 1fr;
      gap: 20px;
    }
    h2 {
      max-width: none;
    }
  }
  @media (max-width: 600px) {
    .import-invitation {
      margin: 28px 0;
      padding: 20px 16px;
    }
    .import-fields {
      flex-direction: column;
    }
    button {
      width: 100%;
    }
  }
</style>
