<script lang="ts" context="module">
  // Canonical types live in $lib/cheffy; re-exported here so existing
  // consumers that import them from the icon keep working.
  //  - CheffyExpression: the small, typed set of moods (each has
  //    hand-tuned eyes/brow/mouth below).
  //  - CheffyVariant: compact (face + oversized hat only, no arms — the
  //    default for 20–32px nav/buttons/cards) vs character (adds a small
  //    torso + short arms at shoulder level, for larger surfaces).
  import type { CheffyExpression, CheffyVariant } from '$lib/cheffy';
  export type { CheffyExpression, CheffyVariant };
</script>

<script lang="ts">
  /**
   * Cheffy — Zap Cooking's kitchen-companion character.
   *
   * A clean, self-contained rounded face under an oversized, slightly
   * tilted chef toque whose right fold is a Zap lightning accent (the
   * signature feature). Built from simple SVG primitives so it stays
   * crisp from a 20px nav glyph up to a 140px feature-page portrait.
   *
   * Silhouette priorities at the smallest size: hat → friendly face →
   * Zap accent. No side appendages, no thin disappearing detail.
   *
   * Two render modes:
   *  - color (default): warm character — orange toque, golden face,
   *    Zap fold. Uses CSS custom properties layered over the app theme
   *    vars so consumers can re-tint without a new palette.
   *  - mono: single-`currentColor` line-art silhouette for places that
   *    need the icon to inherit text color. Monochrome fallback.
   *
   * Accessibility: pass `title` for an accessible name (role="img" +
   * <title>); omit it and the SVG is aria-hidden (decorative).
   */
  export let size: number = 24;
  export let expression: CheffyExpression = 'neutral';
  /** compact (face + hat, default) or character (adds torso + arms). */
  export let variant: CheffyVariant = 'compact';
  /** Accessible label. When empty the icon is treated as decorative. */
  export let title: string = '';
  /** Monochrome line-art fallback that inherits `currentColor`. */
  export let mono: boolean = false;
  let className = '';
  export { className as class };

  $: decorative = title.trim().length === 0;

  // In the character variant the head is shrunk and lifted to make room
  // for a torso below; compact draws the head at full size.
  $: headTransform = variant === 'character' ? 'translate(7 1.5) scale(0.78)' : undefined;

  // ── Expression geometry ──────────────────────────────────────
  // Eyes sit on the face around y≈39; the mouth baseline is y≈47. Each
  // mood tweaks eye shape, the (asymmetrical) brow, and the mouth path.
  type EyeStyle = 'round' | 'wide' | 'small' | 'happy' | 'up';
  let eyeStyle: EyeStyle = 'round';
  let mouthPath = '';
  let mouthFilled = false;
  // Brow over the right eye — Cheffy's raised/asymmetrical detail.
  let browPath = 'M35.6 33.2 Q38.6 31.5 41.6 32.8';

  $: {
    switch (expression) {
      case 'happy':
        eyeStyle = 'happy';
        mouthPath = 'M26.8 45.6 Q32.7 51.8 38.4 45.8';
        mouthFilled = false;
        browPath = 'M35.4 32.6 Q38.6 30.8 41.8 32.2';
        break;
      case 'thinking':
        eyeStyle = 'up';
        mouthPath = 'M30.4 48.4 Q33.2 47.2 35.8 48.8';
        mouthFilled = false;
        browPath = 'M35.2 31.2 Q38.8 29.5 42.2 31.0';
        break;
      case 'excited':
        eyeStyle = 'wide';
        mouthPath = 'M27.4 45.2 Q32.5 53.0 37.6 45.2 Z';
        mouthFilled = true;
        browPath = 'M35.2 31.4 Q38.6 29.6 42.0 31.2';
        break;
      case 'concerned':
        eyeStyle = 'small';
        mouthPath = 'M28.8 49.0 Q32.5 46.4 36.2 49.0';
        mouthFilled = false;
        browPath = 'M35.4 31.0 Q38.4 32.2 41.8 30.6';
        break;
      case 'cooking':
        eyeStyle = 'small';
        mouthPath = 'M28.0 46.0 Q32.6 51.2 37.0 46.0';
        mouthFilled = false;
        browPath = 'M35.4 32.2 Q38.6 30.5 41.8 31.8';
        break;
      case 'neutral':
      default:
        eyeStyle = 'round';
        // Small, confident, very slightly off-centre smile.
        mouthPath = 'M28.6 46.4 Q33.0 49.8 36.8 46.4';
        mouthFilled = false;
        browPath = 'M35.6 33.0 Q38.6 31.3 41.6 32.6';
        break;
    }
  }

  const LEFT_EYE = 25.6;
  const RIGHT_EYE = 38.6;
  const EYE_Y = 39;
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
    <!-- Monochrome line-art fallback — single currentColor, compact
         silhouette (face + hat + Zap), no arms. -->
    <g
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <!-- Clean self-contained face -->
      <path
        d="M32 23 C20 23 13.5 31 13.5 39.5 C13.5 50 21.5 56 32 56 C42.5 56 50.5 50 50.5 39.5 C50.5 31 44 23 32 23 Z"
      />
      <!-- Oversized toque: band + asymmetrical puffs -->
      <path d="M16.5 24 L47.5 24" />
      <path d="M17 24 Q17 19 22 18.5 Q22 12 29 13 Q31 7.5 38 10.5 Q45 9.5 45.5 17 Q50.5 19 47 24" />
      <!-- Zap fold accent in the hat -->
      <path
        d="M45.5 8.5 L40.5 16 L44.8 16 L39.8 24 L51 13.5 L46.2 13.5 L49.8 8.5"
        stroke-width="2"
      />
    </g>
    <!-- Eyes + smile in currentColor -->
    <g fill="currentColor">
      <circle cx={LEFT_EYE} cy={EYE_Y} r="2.4" />
      <circle cx={RIGHT_EYE} cy={EYE_Y} r="2.4" />
    </g>
    <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d={browPath} stroke-width="1.7" opacity="0.85" />
      <path d={mouthPath} fill={mouthFilled ? 'currentColor' : 'none'} />
    </g>
  {:else}
    <!-- ── Character-only body: a dressed chef torso (shirt + apron bib)
         so he never reads as a bare blob. Drawn first so the head
         overlaps the shoulders; arms attach at shoulder level. -->
    {#if variant === 'character'}
      <g>
        <!-- Short sleeved arms from the shoulders, with small hands -->
        <path
          d="M25 47 Q19.5 48.5 19 53"
          fill="none"
          stroke="var(--cheffy-shirt, var(--color-primary, #ec4700))"
          stroke-width="4.2"
          stroke-linecap="round"
        />
        <path
          d="M39 47 Q44.5 48.5 45 53"
          fill="none"
          stroke="var(--cheffy-shirt, var(--color-primary, #ec4700))"
          stroke-width="4.2"
          stroke-linecap="round"
        />
        <circle cx="19" cy="53" r="2.4" fill="var(--cheffy-body, #F6DCA6)" />
        <circle cx="45" cy="53" r="2.4" fill="var(--cheffy-body, #F6DCA6)" />

        <!-- Shirt / torso -->
        <path
          d="M24 46 Q24 44 32 44 Q40 44 40 46 L41 56 Q41 60.5 32 60.5 Q23 60.5 23 56 Z"
          fill="var(--cheffy-shirt, var(--color-primary, #ec4700))"
        />
        <!-- Apron bib (cream) with straps and a pocket line — minimal,
             but enough to read as "dressed" rather than bare. -->
        <path
          d="M27.5 46.5 L29.5 45 M36.5 46.5 L34.5 45"
          fill="none"
          stroke="var(--cheffy-apron, #FBEAC6)"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <path
          d="M28 47 Q28 45.9 32 45.9 Q36 45.9 36 47 L36.8 57 Q36.8 59.6 32 59.6 Q27.2 59.6 27.2 57 Z"
          fill="var(--cheffy-apron, #FBEAC6)"
        />
        <path
          d="M28.4 53 L35.6 53"
          fill="none"
          stroke="var(--cheffy-shirt-shade, #C23A00)"
          stroke-width="0.8"
          opacity="0.35"
          stroke-linecap="round"
        />
      </g>
    {/if}

    <!-- ── Head group (shared geometry; scaled for the character) ── -->
    <g transform={headTransform}>
      <!-- Clean, self-contained rounded face -->
      <path
        d="M32 22.5 C19.8 22.5 13 30.5 13 39.5 C13 50.2 21.2 56.5 32 56.5 C42.8 56.5 51 50.2 51 39.5 C51 30.5 44.2 22.5 32 22.5 Z"
        fill="var(--cheffy-body, #F6DCA6)"
      />

      <!-- Oversized toque, slightly tilted for character. Drawn as one
           group so the tilt carries the puffs, band, and Zap together. -->
      <g transform="rotate(-4 32 18)">
        <!-- Puffs (asymmetrical — left larger & higher) -->
        <g fill="var(--cheffy-hat, var(--color-primary, #ec4700))">
          <circle cx="20.5" cy="12.5" r="9" />
          <circle cx="32" cy="8.5" r="10" />
          <circle cx="43.5" cy="13" r="8" />
          <!-- Band -->
          <path
            d="M16.5 18 L47.5 18 Q49 18 49 20.5 L49 23.5 Q49 25.5 47 25.5 L17 25.5 Q15 25.5 15 23.5 L15 20.5 Q15 18 16.5 18 Z"
          />
        </g>
        <!-- Zap fold accent — the signature feature. Bright fill keyed
             to the brand so the lightning shape stays legible on the
             orange toque, with an orange-red edge tying it to the hat. -->
        <path
          d="M46 6 L40.4 14.5 L45 14.5 L39.4 23.5 L52 11.5 L46.4 11.5 L50.4 6 Z"
          fill="var(--cheffy-bolt, #FFC83A)"
          stroke="var(--cheffy-hat-shade, #C23A00)"
          stroke-width="0.8"
          stroke-linejoin="round"
        />
      </g>

      <!-- Eyes -->
      <g fill="var(--cheffy-ink, #3A2415)">
        {#if eyeStyle === 'happy'}
          <path
            d="M22.6 40 Q25.6 36.4 28.6 40"
            fill="none"
            stroke="var(--cheffy-ink, #3A2415)"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <path
            d="M35.6 40 Q38.6 36.4 41.6 40"
            fill="none"
            stroke="var(--cheffy-ink, #3A2415)"
            stroke-width="2.5"
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
    </g>
  {/if}
</svg>

<style>
  .cheffy-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
