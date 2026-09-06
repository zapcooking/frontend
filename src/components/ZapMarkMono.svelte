<!--
  Monochrome zap ring mark — the favicon/badge geometry (ring + bolt)
  in a single currentColor, no gradient disc and no shine. Used where a
  quiet placeholder mark is needed (e.g. empty article rail thumbnails).
  Fills the parent container; it scales to whatever box it's given.
-->
<div class="zap-mark-mono">
  <svg viewBox="0 0 382 382" fill="none" aria-hidden="true">
    <path
      class="zap-mono-bolt"
      fill="currentColor"
      d="M221.87 96.87C219.23 95.53 216.2 96.16 214.32 98.45L125.94 206.16C124.41 208.02 124.1 210.53 125.13 212.7C126.16 214.88 128.29 216.23 130.7 216.23H172.61L172.81 216.49L156.56 279.01C155.82 281.88 157.09 284.71 159.73 286.05C160.65 286.52 161.62 286.75 162.57 286.75C164.34 286.75 166.06 285.96 167.28 284.47L255.66 176.76C257.19 174.9 257.5 172.39 256.47 170.22C255.44 168.04 253.31 166.69 250.9 166.69H208.99L208.79 166.43L225.04 103.91C225.78 101.04 224.51 98.21 221.87 96.87Z"
    />
    <path
      class="zap-mono-ring"
      fill="currentColor"
      fill-rule="evenodd"
      d="M191 0C296.486 0 382 85.514 382 191C382 296.486 296.486 382 191 382C85.514 382 0 296.486 0 191C0 85.514 85.514 0 191 0ZM303.113 79.249C241.291 17.438 141.07 17.438 79.258 79.249C17.446 141.071 17.446 241.294 79.258 303.105C141.08 364.917 241.302 364.917 303.113 303.105C364.925 241.284 364.925 141.061 303.113 79.249Z"
    />
  </svg>
</div>

<style>
  .zap-mark-mono {
    position: relative;
    width: 100%;
    height: 100%;
    aspect-ratio: 1;
  }
  .zap-mark-mono svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
