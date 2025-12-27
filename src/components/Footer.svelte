<script lang="ts">
  import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
  import { theme } from '$lib/themeStore';

  const currentYear = new Date().getFullYear();

  // Reactive resolved theme for logo switching (handles 'system' preference)
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: logoSrc = resolvedTheme === 'dark' ? '/zap_cooking_logo_white.svg' : '/zap_cooking_logo_black.svg';
</script>

<footer
  class="mt-12 border-t py-8 mb-20 lg:mb-0 print:hidden"
  style="border-color: var(--color-input-border); background-color: var(--color-bg-secondary);"
>
  <div class="mx-auto max-w-7xl px-6">
    <div class="grid grid-cols-2 gap-8 lg:grid-cols-4">
      <!-- Brand -->
      <div class="col-span-2 lg:col-span-1">
        <img src={logoSrc} alt="zap.cooking" class="h-6" />
        <p class="mt-2 text-xs text-caption">Recipes on Nostr, built in the open.</p>
        <div class="mt-4 flex gap-4">
          <a
            href="https://primal.net/p/npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a"
            target="_blank"
            rel="noopener noreferrer"
            class="text-caption hover:text-primary transition-colors"
            title="Follow on Nostr"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 16.12 18.8">
              <path d="M14.36.03c-.5-.1-.85.09-1.01.52-.26.61-.09,1.4.45,1.98.25.26.53.48.8.72.2.17.38.37.55.57.46.57-.03,1.61-.14,1.73-.4.42-.75.49-1.45.46-.68-.03-2.46-.94-3.4-.97-2.32-.07-3.93,1-4.48,1.28-.81.42-1.97.44-2.01.45-.53.04-1.61.08-2.15.27-.76.21-1.17.56-1.45,1.34-.09.34-.1.64.02.82.27.4.98.74,1.31.92.17.1.5-.02.56-.07.37-.25.69-.44,1.12-.5.09-.01.7-.12,1.01.1.22.16.41.26.67.38.46.21,1.47.47,1.49.48.14.04.31.11.31.23,0,.17-1.61,1.52-1.7,1.56-.41.16-.64.43-.72.82-.03.13-.08.25-.15.36-.26.38-1.42,2.02-1.73,2.48-.15.21-.3.32-.51.35-.3.05-.53.06-.65.27-.08.14-.03.4.02.58.06.2-.1.44-.11.47-.14.28-.2.55-.18.82,0,.11.01.37.2.37.18.01.23-.11.25-.15.03-.05.13-.27.16-.32.12-.22.57-.69.62-.74.16-.18,2.56-3.48,2.56-3.48.13-.17.27-.35.49-.44.3-.11.52-.38.58-.69.01-.07.97-.81,1.38-1.12.15-.11,1.05-.47,1.07-.47,0,0-.82,1.25-1.08,1.91-.04.11-.11.47-.03.65.11.28.36.4.64.32.09-.03.16-.07.24-.11.03-.02.07-.04.1-.05l.1-.05c.08-.04.15-.08.23-.1.28-.09.55-.18.83-.26l.56-.17c.39-.12.79-.25,1.18-.37.09-.03.17-.06.28-.05.06,0,.12.02.15.11,0,0,.05.27.21.38.12.07.26.1.4.09.12,0,.27.03.34.09l.1.08c.07.05.14.09.22.11.06.02.18.02.25-.05.07-.08.05-.2.04-.24-.01-.05-.04-.09-.07-.13l-.06-.09c-.06-.09-.11-.18-.17-.27-.16-.25-.33-.5-.5-.75-.18-.26-.45-.36-.8-.31-.14.02-3.13.95-3.16.96.16-.3,1.12-1.62,1.39-1.79.2-.12.28-.23.65-.29.71-.12,2.24-.48,2.63-.75.74-.54.8-1.76.79-2-.01-.24.07-.41.28-.53.1-.06,1.25-.69,1.81-1.62.33-.54.51-1.13.44-1.77-.03-.42-.19-.81-.45-1.14-.24-.3-.54-.51-.83-.74-.14-.12-.53-.44-.58-.62-.06-.22.03-.44.23-.51.3-.1.8-.1,1.09-.08.25.02.5-.07.51-.17.01-.1-.14-.25-.33-.3-.15-.04-.39-.09-.53-.18-.25-.17-.51-.48-.86-.55" />
            </svg>
          </a>
          <a
            href="https://github.com/zapcooking/frontend"
            target="_blank"
            rel="noopener noreferrer"
            class="text-caption hover:text-primary transition-colors"
            title="View on GitHub"
          >
            <GithubLogo size={20} weight="fill" />
          </a>
        </div>
      </div>

      <!-- Discover -->
      <div>
        <h3 class="font-medium uppercase tracking-widest text-caption" style="font-size: 11px;">Discover</h3>
        <ul class="mt-4 space-y-2 text-sm">
          <li><a href="/recent" class="text-caption hover:text-primary transition-colors">Recipes</a></li>
          <li><a href="/explore" class="text-caption hover:text-primary transition-colors">Explore</a></li>
          <li><a href="/community" class="text-caption hover:text-primary transition-colors">Community</a></li>
        </ul>
      </div>

      <!-- Support -->
      <div>
        <h3 class="font-medium uppercase tracking-widest text-caption" style="font-size: 11px;">Support</h3>
        <ul class="mt-4 space-y-2 text-sm">
          <li>
            <a
              href="https://github.com/zapcooking/frontend/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              class="text-danger hover:underline"
            >
              Report a Bug
            </a>
          </li>
          <li>
            <a
              href="https://github.com/zapcooking/frontend"
              target="_blank"
              rel="noopener noreferrer"
              class="text-caption hover:text-primary transition-colors"
            >
              Contribute
            </a>
          </li>
        </ul>
      </div>

      <!-- About -->
      <div>
        <h3 class="font-medium uppercase tracking-widest text-caption" style="font-size: 11px;">About</h3>
        <ul class="mt-4 space-y-2 text-sm">
          <li><a href="/why" class="text-caption hover:text-primary transition-colors">Why zap.cooking?</a></li>
          <li>
            <a
              href="https://github.com/zapcooking/frontend/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              class="text-caption hover:text-primary transition-colors"
            >
              MIT License
            </a>
          </li>
        </ul>
      </div>
    </div>

    <!-- Copyright -->
    <div class="mt-8 border-t pt-6" style="border-color: var(--color-input-border);">
      <p class="text-center text-xs text-caption">
        &copy; {currentYear} zap.cooking
      </p>
    </div>
  </div>
</footer>
