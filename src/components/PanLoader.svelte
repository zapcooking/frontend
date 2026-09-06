<script lang="ts">
  import { onMount } from 'svelte';
  import ZapRingBadge from './ZapRingBadge.svelte';

  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'lg';

  // The badge is the visual anchor; sizes are much smaller than the old
  // full-width animated pan. Phrase text scales alongside.
  const sizeClasses = {
    sm: 'w-8',   // 32px
    md: 'w-11',  // 44px
    lg: 'w-12',  // 48px
    xl: 'w-14'   // 56px
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

<div class="flex flex-col items-center gap-3 {sizeClasses[size]}">
  <div class="w-full">
    <ZapRingBadge />
  </div>
  <p class="pan-loader-phrase text-center text-caption {phraseClasses[size]}">{currentPhrase}</p>
</div>

<style>
  .pan-loader-phrase {
    font-family: 'Avenir Next Rounded', 'Avenir Next', 'Avenir', 'Helvetica', sans-serif;
    font-weight: 400;
    letter-spacing: 0.01em;
    min-height: 1.2em;
  }
</style>
