<script lang="ts">
  import MagnifyingIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import UtensilsIcon from 'phosphor-svelte/lib/ForkKnife';
</script>

<nav
  class="lg:hidden pt-2 bg-white w-full fixed bottom-0 left-0 grid grid-cols-4 grid-rows-1 text-center print:hidden"
>
  <a href="/recent" class="flex flex-col">
    <MagnifyingIcon class="self-center" size={24} />
    Recipes
  </a>
  <a href="/foodstr" class="flex flex-col">
    <UtensilsIcon class="self-center" size={24} />
    Feed
  </a>
  <a href="/tags" class="flex flex-col">
    <LightningIcon class="self-center" size={24} />
    Categories
  </a>
  <a href="/bookmarks" class="flex flex-col">
    <BookmarkIcon class="self-center" size={24} />
    Bookmarks
  </a>
</nav>
