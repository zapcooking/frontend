<script lang="ts" context="module">
  // The small, typed set of moods Cheffy can wear. Kept intentionally
  // short — every expression below has hand-tuned eyes/brow/mouth so
  // the set stays cheap to render and easy to reason about.
  export type CheffyExpression =
    | 'neutral'
    | 'happy'
    | 'thinking'
    | 'excited'
    | 'concerned'
    | 'cooking';
</script>

<script lang="ts">
  /**
   * Cheffy — Zap Cooking's kitchen-companion character.
   *
   * A small dough-blob kitchen spirit wearing an asymmetrical chef
   * toque whose right-hand fold is a Zap lightning bolt (the
   * unmistakable signature feature). Built from clean SVG primitives
   * so it stays crisp from a 20px nav glyph up to a 140px feature-page
   * portrait.
   *
   * Two render modes:
   *  - color (default): full warm character — orange toque, dough
   *    body, bright bolt. Uses CSS custom properties layered over the
   *    app theme vars so consumers can re-tint without a new palette.
   *  - mono: single-`currentColor` line-art silhouette for places that
   *    need the icon to inherit text color (dense menus, on-accent
   *    buttons). This is the monochrome fallback.
   *
   * Accessibility: pass `title` to expose an accessible name
   * (role="img" + <title>); omit it and the SVG is aria-hidden so
   * decorative instances don't add screen-reader noise.
   */
  export let size: number = 24;
  export let expression: CheffyExpression = 'neutral';
  /** Accessible label. When empty the icon is treated as decorative. */
  export let title: string = '';
  /** Monochrome line-art fallback that inherits `currentColor`. */
  export let mono: boolean = false;
  let className = '';
  export { className as class };

  $: decorative = title.trim().length === 0;

  // ── Expression geometry ──────────────────────────────────────
  // Eyes sit on the dough face around y≈40; the mouth baseline is
  // y≈47. Each mood tweaks eye shape, the (always asymmetrical) brow,
  // and the mouth path. Kept as plain data so both render modes share
  // one source of truth.
  type EyeStyle = 'round' | 'wide' | 'small' | 'happy' | 'up';
  let eyeStyle: EyeStyle = 'round';
  let mouthPath = '';
  let mouthFilled = false;
  // Brow over the right eye — Cheffy's signature raised/asymmetrical
  // detail. `browPath` shifts with mood (calmer, higher, or angled).
  let browPath = 'M35.6 33.6 Q38.6 31.9 41.6 33.2';

  $: {
    switch (expression) {
      case 'happy':
        eyeStyle = 'happy';
        mouthPath = 'M26.5 45.8 Q32.5 52.5 38.5 45.8';
        mouthFilled = false;
        browPath = 'M35.4 33.0 Q38.6 31.2 41.8 32.6';
        break;
      case 'thinking':
        eyeStyle = 'up';
        mouthPath = 'M30.4 48.6 Q33.2 47.4 35.8 49.0';
        mouthFilled = false;
        browPath = 'M35.2 31.6 Q38.8 29.9 42.2 31.4';
        break;
      case 'excited':
        eyeStyle = 'wide';
        mouthPath = 'M27.2 45.4 Q32.5 53.6 37.8 45.4 Z';
        mouthFilled = true;
        browPath = 'M35.2 31.8 Q38.6 30.0 42.0 31.6';
        break;
      case 'concerned':
        eyeStyle = 'small';
        mouthPath = 'M28.6 49.4 Q32.5 46.6 36.4 49.4';
        mouthFilled = false;
        browPath = 'M35.4 31.4 Q38.4 32.6 41.8 31.0';
        break;
      case 'cooking':
        eyeStyle = 'small';
        mouthPath = 'M27.8 46.2 Q32.5 51.6 37.2 46.2';
        mouthFilled = false;
        browPath = 'M35.4 32.6 Q38.6 30.9 41.8 32.2';
        break;
      case 'neutral':
      default:
        eyeStyle = 'round';
        mouthPath = 'M28.4 46.6 Q32.5 50.0 36.6 46.6';
        mouthFilled = false;
        browPath = 'M35.6 33.4 Q38.6 31.7 41.6 33.0';
        break;
    }
  }

  const LEFT_EYE = 25.6;
  const RIGHT_EYE = 38.6;
  const EYE_Y = 40;
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 64 64"
  width={size}
  height={size}
  class={`cheffy-icon ${className}`}
  class:is-mono={mono}
  role={decorative ? undefined : 'img'}
  aria-hidden={decorative ? 'true' : undefined}
  aria-label={decorative ? undefined : title}
>
  {#if !decorative}<title>{title}</title>{/if}

  {#if mono}
    <!-- Monochrome line-art fallback — single currentColor. Reads as a
         friendly outlined character at nav sizes. -->
    <g
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <!-- Dough body / face -->
      <path
        d="M32 24.5 C19 24.5 12 33 12 42 C12 51.5 20.5 56.5 32 56.5 C43.5 56.5 52 51.5 52 42 C52 33 45 24.5 32 24.5 Z"
        fill="none"
      />
      <!-- Toque: band + three asymmetrical puffs -->
      <path d="M17 25 Q17 21 21 21 L43 21 Q47 21 47 25" />
      <path
        d="M21 21 C13.5 21 12 11 19 9.5 C19.5 4.5 27 3.5 29.5 8 C33 4 41 5.5 41.5 11 C48 10.5 49.5 18.5 43 21"
      />
      <!-- Lightning-bolt hat fold (signature feature) -->
      <path
        d="M45.5 8.5 L40.5 16.5 L44.8 16.5 L39.8 25 L51 14.5 L46.2 14.5 L49.8 8.5"
        stroke-width="2"
      />
    </g>
    <!-- Eyes + mouth in currentColor -->
    <g fill="currentColor">
      <circle cx={LEFT_EYE} cy={EYE_Y} r="2.4" />
      <circle cx={RIGHT_EYE} cy={EYE_Y} r="2.4" />
    </g>
    <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d={browPath} stroke-width="1.8" opacity="0.85" />
      <path d={mouthPath} fill={mouthFilled ? 'currentColor' : 'none'} />
    </g>
  {:else}
    <!-- Full colored character. -->
    <!-- Short functional arms — only read at larger sizes; harmless at
         small ones. Drawn first so the body overlaps their roots. -->
    <g class="cheffy-arms">
      <path
        d="M13.5 43 Q8 44 7.5 49"
        fill="none"
        stroke="var(--cheffy-body-shade, #E6B765)"
        stroke-width="3.4"
        stroke-linecap="round"
      />
      <path
        d="M50.5 43 Q56 44 56.5 49"
        fill="none"
        stroke="var(--cheffy-body-shade, #E6B765)"
        stroke-width="3.4"
        stroke-linecap="round"
      />
    </g>

    <!-- Dough body / face -->
    <path
      d="M32 24 C18.5 24 11.5 33 11.5 42 C11.5 52 20 57 32 57 C44 57 52.5 52 52.5 42 C52.5 33 45.5 24 32 24 Z"
      fill="var(--cheffy-body, #F6DCA6)"
    />
    <!-- Soft underside shading for a touch of volume -->
    <path
      d="M14 46 C17 53 24 56.5 32 56.5 C40 56.5 47 53 50 46 C47 51 40 53.5 32 53.5 C24 53.5 17 51 14 46 Z"
      fill="var(--cheffy-body-shade, #E6B765)"
      opacity="0.55"
    />

    <!-- Toque puffs (asymmetrical — left puff larger & higher) -->
    <g fill="var(--cheffy-hat, var(--color-primary, #ec4700))">
      <circle cx="21.5" cy="14.5" r="8.5" />
      <circle cx="32.5" cy="11" r="9.2" />
      <circle cx="42.5" cy="16" r="7" />
      <!-- Hat band -->
      <path
        d="M16.5 19 L47.5 19 Q49 19 49 21.5 L49 25 Q49 27 47 27 L18 27 Q16 27 16 25 L16 21.5 Q16 19 16.5 19 Z"
      />
    </g>
    <!-- Band shadow where it meets the face -->
    <path
      d="M16 25.5 Q32 29 49 25.5 L49 26.5 Q49 27 47 27 L18 27 Q16 27 16 26 Z"
      fill="var(--cheffy-hat-shade, #C23A00)"
      opacity="0.5"
    />

    <!-- Lightning-bolt hat fold — the signature feature. Bright zap
         tone so it reads even at small sizes. -->
    <path
      d="M45.5 7.5 L39.8 17 L44.6 17 L38.8 27 L51.5 14.5 L46 14.5 L50.2 7.5 Z"
      fill="var(--cheffy-bolt, #FFD23F)"
      stroke="var(--cheffy-hat-shade, #C23A00)"
      stroke-width="0.8"
      stroke-linejoin="round"
    />

    <!-- Cheek blush + subtle spark detail -->
    <ellipse
      cx="45.5"
      cy="45"
      rx="3"
      ry="2"
      fill="var(--cheffy-hat, var(--color-primary, #ec4700))"
      opacity="0.18"
    />
    <path
      d="M47.8 43.6 l0.7 1.6 l1.6 0.7 l-1.6 0.7 l-0.7 1.6 l-0.7 -1.6 l-1.6 -0.7 l1.6 -0.7 Z"
      fill="var(--cheffy-bolt, #FFD23F)"
      opacity="0.9"
    />

    <!-- Eyes -->
    <g fill="var(--cheffy-ink, #3A2415)">
      {#if eyeStyle === 'happy'}
        <path
          d="M22.6 41 Q25.6 37.4 28.6 41"
          fill="none"
          stroke="var(--cheffy-ink, #3A2415)"
          stroke-width="2.4"
          stroke-linecap="round"
        />
        <path
          d="M35.6 41 Q38.6 37.4 41.6 41"
          fill="none"
          stroke="var(--cheffy-ink, #3A2415)"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      {:else}
        {@const r = eyeStyle === 'wide' ? 3.9 : eyeStyle === 'small' ? 2.8 : 3.3}
        {@const pupilDy = eyeStyle === 'up' ? -0.8 : 0}
        <circle cx={LEFT_EYE} cy={EYE_Y + pupilDy} {r} />
        <circle cx={RIGHT_EYE} cy={EYE_Y + pupilDy} {r} />
        <!-- Catchlights -->
        <circle
          cx={LEFT_EYE + 1.1}
          cy={EYE_Y + pupilDy - 1.1}
          r={r * 0.32}
          fill="#fff"
          opacity="0.9"
        />
        <circle
          cx={RIGHT_EYE + 1.1}
          cy={EYE_Y + pupilDy - 1.1}
          r={r * 0.32}
          fill="#fff"
          opacity="0.9"
        />
      {/if}
    </g>

    <!-- Raised / asymmetrical brow -->
    <path
      d={browPath}
      fill="none"
      stroke="var(--cheffy-ink, #3A2415)"
      stroke-width="1.9"
      stroke-linecap="round"
    />

    <!-- Mouth -->
    <path
      d={mouthPath}
      fill={mouthFilled ? 'var(--cheffy-ink, #3A2415)' : 'none'}
      stroke="var(--cheffy-ink, #3A2415)"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {/if}
</svg>

<style>
  .cheffy-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
