<div class="theme-picker" data-explore-theme-control hidden>
  <label>
    <span>Choose your style</span>
    <select data-explore-theme-select>
      <option value="original">Zap Original</option>
      <option value="after-hours">After Hours ’80s</option>
      <option value="recipe-club">Recipe Club ’90s</option>
      <option value="recipe-box">Recipe Box</option>
    </select>
  </label>
  <span class="sr-only" data-explore-theme-status role="status" aria-live="polite"></span>
</div>

<style>
  .theme-picker[hidden] {
    display: none;
  }
  .theme-picker {
    min-width: 0;
  }
  label {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    color: var(--explore-masthead-muted, var(--color-text-secondary));
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
  }
  select {
    min-width: 0;
    max-width: 100%;
    min-height: 44px;
    padding: 10px 32px 10px 12px;
    border: 1px solid var(--color-input-border);
    border-radius: var(--explore-control-radius, 8px);
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 16px;
    cursor: pointer;
  }
  select:focus-visible {
    outline: 3px solid var(--explore-picker-focus, var(--color-primary));
    outline-offset: 4px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
