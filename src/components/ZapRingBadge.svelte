<!--
  The zap ring badge: static orange-red gradient disc, white/off-white
  bolt, themed outer ring, with a 120° white shine band sweeping across
  it (masked to the circle) — the wallet onboarding bolt-shine, sized
  down. Shared by PanLoader and LoadingState. Fill the parent container;
  it scales to whatever box it's given.
-->
<div class="zap-ring">
  <svg viewBox="0 0 382 382" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="zap-ring-badge-grad" x1="191" y1="322" x2="191" y2="60" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF0C1C" />
        <stop offset="1" stop-color="#FFAA00" />
      </linearGradient>
    </defs>
    <circle cx="191" cy="191" r="131" fill="url(#zap-ring-badge-grad)" />
    <path
      class="zap-ring-bolt"
      fill="currentColor"
      d="M221.87 96.87C219.23 95.53 216.2 96.16 214.32 98.45L125.94 206.16C124.41 208.02 124.1 210.53 125.13 212.7C126.16 214.88 128.29 216.23 130.7 216.23H172.61L172.81 216.49L156.56 279.01C155.82 281.88 157.09 284.71 159.73 286.05C160.65 286.52 161.62 286.75 162.57 286.75C164.34 286.75 166.06 285.96 167.28 284.47L255.66 176.76C257.19 174.9 257.5 172.39 256.47 170.22C255.44 168.04 253.31 166.69 250.9 166.69H208.99L208.79 166.43L225.04 103.91C225.78 101.04 224.51 98.21 221.87 96.87Z"
    />
    <path
      class="zap-ring-ring"
      fill="currentColor"
      fill-rule="evenodd"
      d="M191 0C296.486 0 382 85.514 382 191C382 296.486 296.486 382 191 382C85.514 382 0 296.486 0 191C0 85.514 85.514 0 191 0ZM303.113 79.249C241.291 17.438 141.07 17.438 79.258 79.249C17.446 141.071 17.446 241.294 79.258 303.105C141.08 364.917 241.302 364.917 303.113 303.105C364.925 241.284 364.925 141.061 303.113 79.249Z"
    />
  </svg>
  <div class="zap-ring-shine"><div class="zap-ring-band"></div></div>
</div>

<style>
  .zap-ring {
    position: relative;
    width: 100%;
    height: 100%;
    aspect-ratio: 1;
  }
  .zap-ring svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .zap-ring-bolt {
    color: #ffffff;
  }
  :global(.dark) .zap-ring-bolt {
    color: #fafaf9;
  }
  .zap-ring-ring {
    color: #1c1917;
  }
  :global(.dark) .zap-ring-ring {
    color: #fafaf9;
  }
  .zap-ring-shine {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
  }
  .zap-ring-band {
    position: absolute;
    inset: -25%;
    background: linear-gradient(
      120deg,
      transparent 0%,
      transparent 40%,
      rgba(255, 255, 255, 0.45) 50%,
      transparent 60%,
      transparent 100%
    );
    transform: translateX(-110%);
    animation: zap-ring-badge-shine 1.9s ease-in-out infinite;
  }
  @keyframes zap-ring-badge-shine {
    0% {
      transform: translateX(-110%);
    }
    72%,
    100% {
      transform: translateX(110%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .zap-ring-band {
      animation: none;
    }
  }
</style>
