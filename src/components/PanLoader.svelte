<script lang="ts">
  import { onMount } from 'svelte';
  import ZapRingBadge from './ZapRingBadge.svelte';

  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'lg';

  // The badge is the visual anchor; sizes are much smaller than the old
  // full-width animated pan. Phrase text scales alongside.
  const sizeClasses = {
    sm: 'w-12',      // 48px
    md: 'w-16',      // 64px
    lg: 'w-[72px]',  // 72px
    xl: 'w-[84px]'   // 84px
  };

  const phraseClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-sm',
    xl: 'text-base'
  };

  const phrases = [
    'Bon appétit',
    'Buen provecho',
    'Buon appetito',
    'Guten Appetit',
    'Bom apetite',
    'Smakelijk eten',
    'Καλή όρεξη',
    'Приятного аппетита',
    'Smacznego',
    'Jó étvágyat',
    'いただきます',
    '잘 먹겠습니다',
    '慢慢吃',
    'Afiyet olsun',
    'بالهنا والشفا',
    'בתיאבון',
    'कृपया भोजन का आनंद लीजिये',
    'ทานให้อร่อย',
    'Furahia chakula chako',
    'Geniet jou ete',
    'Chúc ngon miệng'
  ];

  let currentPhrase = '';

  onMount(() => {
    currentPhrase = phrases[Math.floor(Math.random() * phrases.length)];
  });
</script>

<!-- The size class sizes the badge wrapper only — the root stays
     content-width so the phrase renders on a single row and the whole
     block centers correctly in consumers' page-loader flex containers. -->
<div class="flex flex-col items-center gap-3">
  <div class="{sizeClasses[size]}">
    <ZapRingBadge />
  </div>
  <p class="pan-loader-phrase text-center text-caption whitespace-nowrap {phraseClasses[size]}">
    {currentPhrase}
  </p>
</div>

<style>
  .pan-loader-phrase {
    font-family: 'Avenir Next Rounded', 'Avenir Next', 'Avenir', 'Helvetica', sans-serif;
    font-weight: 400;
    letter-spacing: 0.01em;
    min-height: 1.2em;
  }
</style>
