<script lang="ts">
  import { recipeTags, type recipeTagSimple, RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY } from '$lib/consts';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  export let event: NDKEvent;

  let nameTagFound = false;

  let tags: recipeTagSimple[] = [];

  event.tags.forEach((t) => {
    if (t[0] == 't' && t[1]) {
      const dTag = event.tags.find((a) => a[0] == 'd')?.[1];
      const isLegacyPrefix = t[1].startsWith(`${RECIPE_TAG_PREFIX_LEGACY}-`);
      const isNewPrefix = t[1].startsWith(`${RECIPE_TAG_PREFIX_NEW}-`);
      
      if ((isLegacyPrefix || isNewPrefix) && nameTagFound == false) {
        // Extract tag name by removing either prefix
        const tagName = isNewPrefix 
          ? t[1].slice(RECIPE_TAG_PREFIX_NEW.length + 1)
          : t[1].slice(RECIPE_TAG_PREFIX_LEGACY.length + 1);
        
        if (tagName == dTag) {
          nameTagFound = true;
        }
      } else if (isLegacyPrefix || isNewPrefix) {
        // Extract tag name by removing either prefix
        const tagName = isNewPrefix 
          ? t[1].slice(RECIPE_TAG_PREFIX_NEW.length + 1)
          : t[1].slice(RECIPE_TAG_PREFIX_LEGACY.length + 1);
        
        let coupleRecipeTagInfo = recipeTags.find(
          (e) => e.title.toLowerCase().replaceAll(' ', '-') == tagName
        );
        if (coupleRecipeTagInfo) {
          tags.push(coupleRecipeTagInfo);
        } else {
          tags.push({ title: tagName.replaceAll('-', ' ') });
        }
      }
    }
  });
</script>

<div class="flex flex-wrap gap-2 text-[14px]">
  {#each tags as tag}
    <a
      href="/tag/{tag.title}"
      class="rounded-full px-2 py-1 bg-input hover:bg-accent-gray transition duration-300 cursor-pointer"
      style="color: var(--color-text-primary)"
    >
      {tag.title}
    </a>
  {/each}
</div>
