<script lang="ts">
  export let onZoomIn: () => void;
  export let onZoomOut: () => void;
  export let onResetZoom: () => void;
</script>

<div class="mesh-zoom-controls" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
  <button
    on:click={onZoomIn}
    class="mesh-zoom-btn"
    style="color: var(--color-text-primary);"
    aria-label="Zoom in"
  >+</button>
  <div style="border-top: 1px solid var(--color-input-border);" />
  <button
    on:click={onZoomOut}
    class="mesh-zoom-btn"
    style="color: var(--color-text-primary);"
    aria-label="Zoom out"
  >&minus;</button>
  <div style="border-top: 1px solid var(--color-input-border);" />
  <button
    on:click={onResetZoom}
    class="mesh-zoom-btn text-xs"
    style="color: var(--color-caption);"
    aria-label="Reset zoom"
  >Reset</button>
</div>

<style>
  .mesh-zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 20;
  }

  .mesh-zoom-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .mesh-zoom-btn:hover {
    opacity: 0.7;
  }
</style>
