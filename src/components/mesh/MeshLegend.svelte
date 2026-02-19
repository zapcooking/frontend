<script lang="ts">
  import type { MeshVisualTheme } from '$lib/mesh/meshTypes';

  export let isDarkMode: boolean = false;
  export let visualTheme: MeshVisualTheme = 'default';

  $: isConstellation = visualTheme === 'constellation';
</script>

<div class="mesh-legend" class:dark={isDarkMode || isConstellation} class:constellation={isConstellation}>
  <div class="mesh-legend-item">
    <span class="mesh-legend-dot mesh-legend-hero" class:constellation={isConstellation}></span>
    <span>{isConstellation ? 'Brightest stars' : 'Most loved'}</span>
  </div>
  <div class="mesh-legend-item">
    <span class="mesh-legend-dot mesh-legend-notable" class:constellation={isConstellation}></span>
    <span>{isConstellation ? 'Notable stars' : 'Notable'}</span>
  </div>
  <div class="mesh-legend-item">
    <span class="mesh-legend-dot mesh-legend-community" class:constellation={isConstellation}></span>
    <span>{isConstellation ? 'Stars' : 'Community'}</span>
  </div>
  <div class="mesh-legend-item">
    <svg width="24" height="8" viewBox="0 0 24 8" class="mesh-legend-curve" class:constellation={isConstellation}>
      <path d="M 0 6 Q 12 0 24 6" stroke="currentColor" stroke-width="1.5" fill="none" />
    </svg>
    <span>{isConstellation ? 'Constellations' : 'Shared culture'}</span>
  </div>
</div>

<style>
  .mesh-legend {
    position: absolute;
    bottom: 16px;
    left: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 11px;
    z-index: 20;
    background-color: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(0, 0, 0, 0.08);
    color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
  }

  .mesh-legend.dark {
    background-color: rgba(20, 15, 12, 0.7);
    border-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
  }

  .mesh-legend.constellation {
    background-color: rgba(10, 12, 25, 0.7);
    border-color: rgba(180, 200, 240, 0.1);
    color: rgba(180, 200, 240, 0.5);
  }

  .mesh-legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mesh-legend-dot {
    display: inline-block;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  .mesh-legend-hero {
    width: 14px;
    height: 14px;
    background: rgb(249, 115, 22);
    box-shadow: 0 0 6px 2px rgba(249, 115, 22, 0.5);
  }

  .mesh-legend-hero.constellation {
    background: rgba(220, 230, 255, 0.9);
    box-shadow: 0 0 6px 2px rgba(200, 220, 255, 0.5);
  }

  .mesh-legend-notable {
    width: 10px;
    height: 10px;
    background: rgb(249, 115, 22);
    opacity: 0.7;
  }

  .mesh-legend-notable.constellation {
    background: rgba(180, 200, 240, 0.7);
    opacity: 1;
  }

  .mesh-legend-community {
    width: 7px;
    height: 7px;
    background: rgb(160, 160, 160);
    opacity: 0.5;
  }

  .mesh-legend-community.constellation {
    background: rgba(140, 160, 200, 0.5);
    opacity: 1;
  }

  .mesh-legend-curve {
    color: rgba(251, 191, 36, 0.6);
    flex-shrink: 0;
  }

  .mesh-legend.dark .mesh-legend-curve {
    color: rgba(251, 191, 36, 0.5);
  }

  .mesh-legend-curve.constellation {
    color: rgba(180, 200, 240, 0.5);
  }
</style>
