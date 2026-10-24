<script lang="ts">
  export let id = 'maya';
  export let mood: 'waiting' | 'happy' | 'thoughtful' = 'waiting';
  export let size = 80;
  const faces: Record<string, { skin: string; hair: string; shirt: string; back: string }> = {
    maya: { skin: '#d3946e', hair: '#372c29', shirt: '#d57752', back: '#f0cf9a' },
    theo: { skin: '#a56d50', hair: '#282b25', shirt: '#647f6a', back: '#d4ddbb' },
    jules: { skin: '#efc0a1', hair: '#63452c', shirt: '#897298', back: '#e7d9e9' },
    robin: { skin: '#f2c5a5', hair: '#b86a37', shirt: '#44757a', back: '#c7ddd7' },
    alex: { skin: '#c3916a', hair: '#333b45', shirt: '#937e4c', back: '#e9d7a8' }
  };
  $: face = faces[id] || faces.maya;
</script>

<svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <circle cx="50" cy="50" r="49" fill={face.back} />
  <path d="M18 95Q18 68 49 66Q80 68 83 95" fill={face.shirt} />
  {#if id === 'maya' || id === 'robin'}<path
      d="M24 64V38Q23 8 52 10Q80 11 78 41V71Z"
      fill={face.hair}
    />{/if}
  <path d="M42 60V72Q50 81 58 72V60" fill={face.skin} />
  <ellipse cx="50" cy="43" rx="23" ry="29" fill={face.skin} />
  <path
    d={id === 'theo'
      ? 'M26 37Q16 10 40 13Q50 4 65 14Q85 13 75 36L66 26Q41 32 32 24Z'
      : id === 'jules'
        ? 'M27 41Q17 14 42 12Q76 3 77 38L68 29Q56 33 47 23L30 40Z'
        : 'M27 39Q20 11 50 12Q78 11 74 36Q56 32 44 22Q37 36 27 39Z'}
    fill={face.hair}
  />
  <path d="M38 42h4M59 42h4" stroke="#382b26" stroke-width="3" stroke-linecap="round" />
  <path d="M50 44l-2 8h4" stroke="#9e6850" stroke-width="1.5" stroke-linecap="round" />
  {#if mood === 'happy'}<path d="M39 57Q50 73 62 57Z" fill="#6b3e32" /><path
      d="M42 58h17"
      stroke="#fff5dc"
      stroke-width="3"
    />
  {:else if mood === 'thoughtful'}<path
      d="M44 61Q50 57 57 60"
      stroke="#75493b"
      stroke-width="2"
      stroke-linecap="round"
    />
  {:else}<path
      d="M42 58Q50 65 59 57"
      stroke="#75493b"
      stroke-width="2"
      stroke-linecap="round"
    />{/if}
  {#if id === 'theo' || id === 'alex'}<g stroke="#403e34" stroke-width="2"
      ><rect x="31" y="36" width="17" height="13" rx="5" /><rect
        x="53"
        y="36"
        width="17"
        height="13"
        rx="5"
      /><path d="M48 40h5" /></g
    >{/if}
  {#if id === 'jules'}<path
      d="M30 51Q32 71 50 73Q70 69 71 50Q64 66 50 65Q36 64 30 51Z"
      fill={face.hair}
    />{/if}
  <circle cx="35" cy="54" r="4" fill="#bd725c" opacity=".3" /><circle
    cx="65"
    cy="54"
    r="4"
    fill="#bd725c"
    opacity=".3"
  />
</svg>
