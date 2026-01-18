<script lang="ts">
  import { onMount } from 'svelte';

  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'lg';

  const sizeClasses = {
    sm: 'w-32',
    md: 'w-52',
    lg: 'w-64',
    xl: 'w-80'
  };

  const phraseClasses = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
    xl: 'text-4xl'
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
    <img src="/pan-animated-light.svg" alt="Loading" class="dark:hidden w-full" />
    <img src="/pan-animated-dark.svg" alt="Loading" class="hidden dark:block w-full" />
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
