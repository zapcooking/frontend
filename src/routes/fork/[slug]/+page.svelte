<script lang="ts">
  import TagsComboBox from '../../../components/TagsComboBox.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { createMarkdown, validateMarkdownTemplate } from '$lib/parser';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { recipeTags, type recipeTagSimple } from '$lib/consts';
  import FeedItem from '../../../components/RecipeCard.svelte';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import StringComboBox from '../../../components/StringComboBox.svelte';
  import { writable, type Writable } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import MediaUploader from '../../../components/MediaUploader.svelte';
  import Button from '../../../components/Button.svelte';
  import MarkdownEditor from '../../../components/MarkdownEditor.svelte';
  import { RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY } from '$lib/consts';

  let currentSlug = '';

  onMount(() => {
    if ($userPublickey == '') goto('/login');
    if ($page.params.slug) {
      currentSlug = $page.params.slug;
      loadData();
    }
  });

  // Watch for slug changes after mount
  $: if (browser && $page.params.slug && $page.params.slug !== currentSlug) {
    currentSlug = $page.params.slug;
    loadData();
  }

  let previewEvent: NDKEvent | undefined = undefined;
  let identifier: string | undefined; // THIS SHOULD ALWAYS BE THERE. IF NOT, VERY BAD!

  function addTag(query: string) {
    let tag = recipeTags.find(
      (e) => query.toLowerCase().replaceAll(' ', '-') == e.title.toLowerCase().replaceAll(' ', '-')
    );
    if (!tag) {
      tag = { title: query };
    }
    $selectedTags.push(tag);
    selectedTags = selectedTags;
  }

  async function loadData() {
    let event: NDKEvent | undefined;
    const slug = $page.params.slug;
    if (!slug) return;
    
    if (slug.startsWith('naddr1')) {
      const decoded = nip19.decode(slug);
      if (decoded.type !== 'naddr') return;
      const b = decoded.data;
      identifier = b.identifier;
      let e = await $ndk.fetchEvent({
        '#d': [b.identifier],
        authors: [b.pubkey],
        kinds: [30023]
      });
      if (e) {
        event = e;
      }
    } else {
      let e = await $ndk.fetchEvent(slug);
      if (e) {
        event = e;
        const foundIdentifier = e.tags.find((z) => z[0] == 'd')?.[1];
        if (foundIdentifier && e.kind) {
          const c = nip19.naddrEncode({
            identifier: foundIdentifier,
            kind: e.kind,
            pubkey: e.author.hexpubkey
          });
          goto(`/fork/${c}`);
        }
      }
    }
    if (event) {
      const va = validateMarkdownTemplate(event.content);
      if (typeof va == 'string') {
        resultMessage = `Error loading event to fork, error message: ${va}`;
      } else if (va) {
        let titleTagValue = event.tags.find((e) => e[0] == 'title')?.[1];
        if (titleTagValue) title = titleTagValue;
        let summaryTagValue = event.tags.find((e) => e[0] == 'summary')?.[1];
        if (summaryTagValue) summary = summaryTagValue;
        let imageTagsValue = event.tags.filter((e) => e[0] == 'image');
        if (imageTagsValue && imageTagsValue.length > 0) {
          const imageUrls = imageTagsValue.map(img => img[1]);
          images.set(imageUrls); // Replace the entire array instead of pushing
        } else {
          images.set([]); // Clear images if none found
        }
        selectedTags.set([]);
        // Support both legacy (nostrcooking-) and new (zapcooking-) tags when loading
        let tagTags = event.tags.filter(
          (e) =>
            e[0] == 't' &&
            (e[1].startsWith(`${RECIPE_TAG_PREFIX_LEGACY}-`) || e[1].startsWith(`${RECIPE_TAG_PREFIX_NEW}-`)) &&
            e[1] !== `${RECIPE_TAG_PREFIX_LEGACY}-${event.tags.find((a) => a[0] == 'd')?.[1]}` &&
            e[1] !== `${RECIPE_TAG_PREFIX_NEW}-${event.tags.find((a) => a[0] == 'd')?.[1]}`
        );
        tagTags.forEach((t) => {
          // Extract tag name by removing either prefix
          const tagName = t[1].startsWith(`${RECIPE_TAG_PREFIX_NEW}-`) 
            ? t[1].slice(RECIPE_TAG_PREFIX_NEW.length + 1)
            : t[1].slice(RECIPE_TAG_PREFIX_LEGACY.length + 1);
          addTag(tagName);
        });
        if (va.chefNotes) chefsnotes = va.chefNotes;
        if (va.directions) {
          let i = 0;
          va.directions.forEach((e) => {
            i++;
            directions += `${i}. ${e}\n`;
          });
          $directionsArray = va.directions;
        }
        if (va.ingredients) {
          va.ingredients.forEach((e) => {
            ingredients += `- ${e}\n`;
          });
          $ingredientsArray = va.ingredients;
        }
        if (va.information?.cookTime) cooktime = va.information.cookTime;
        if (va.information?.prepTime) preptime = va.information.prepTime;
        if (va.information?.servings) servings = va.information.servings;
        if (va.additionalMarkdown) additionalMarkdown = va.additionalMarkdown;
      }
    }
  }

  function formatStringArrays() {
    ingredients = '';
    $ingredientsArray.forEach((e) => {
      ingredients += `- ${e}\n`;
    });
    directions = '';
    let i = 0;
    $directionsArray.forEach((e) => {
      i++;
      directions += `${i}. ${e}\n`;
    });
  }

  let title = '';
  let images: Writable<string[]> = writable([]);
  let selectedTags: Writable<recipeTagSimple[]> = writable([]);
  let summary = '';
  let chefsnotes = '';
  let preptime = '';
  let cooktime = '';
  let servings = '';
  let ingredientsArray: Writable<string[]> = writable([]);
  let ingredients = ``;
  let directionsArray: Writable<string[]> = writable([]);
  let directions = ``;
  let additionalMarkdown = '';

  let resultMessage = ' ';
  let disablePublishButton = false;

  async function loadPreview() {
    formatStringArrays();
    if (browser) {
      const md = createMarkdown(
        chefsnotes,
        preptime,
        cooktime,
        servings,
        ingredients,
        directions,
        additionalMarkdown
      );
      const va = validateMarkdownTemplate(md);
      if (typeof va == 'string') {
        resultMessage = `Error: ${va}`;
      } else if ($images.length == 0) {
        resultMessage = `Error: No Image Uploaded`;
      } else if (va) {
        const tempEvent = new NDKEvent($ndk);
        tempEvent.kind = 30023;
        tempEvent.content = md;
        tempEvent.pubkey = $userPublickey;
        tempEvent.tags.push(['d', title.toLowerCase().replaceAll(' ', '-')]);
        tempEvent.tags.push(['title', title]);
        tempEvent.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
        if (summary !== '') {
          tempEvent.tags.push(['summary', summary]);
        }
        if ($images.length > 0) {
          for (let i = 0; i < $images.length; i++) {
            tempEvent.tags.push(['image', $images[i]]);
          }
        }
        $selectedTags.forEach((t) => {
          if (t.title) {
            tempEvent.tags.push([
              't',
              `${RECIPE_TAG_PREFIX_NEW}-${t.title.toLowerCase().replaceAll(' ', '-')}`
            ]);
          }
        });
        // Trigger Svelte reactivity by reassigning
        previewEvent = tempEvent;
        resultMessage = 'Preview loaded successfully!';
      }
    }
  }

  async function publishRecipe() {
    formatStringArrays();
    disablePublishButton = true;
    try {
      const md = createMarkdown(
        chefsnotes,
        preptime,
        cooktime,
        servings,
        ingredients,
        directions,
        additionalMarkdown
      );
      const va = validateMarkdownTemplate(md);
      if (typeof va == 'string') {
        resultMessage = `Error: ${va}`;
      } else if ($images.length == 0) {
        resultMessage = `Error: No Image Uploaded`;
      } else if (va) {
        if (identifier == undefined) { // NOT GOOD!
          identifier = title.toLowerCase().replaceAll(' ', '-');
        }

        const event = new NDKEvent($ndk);
        event.kind = 30023;
        event.content = md;
        event.tags.push(['d', identifier]);
        event.tags.push(['title', title]);
        event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
        event.tags.push(['t', `${RECIPE_TAG_PREFIX_NEW}-${title.toLowerCase().replaceAll(' ', '-')}`]);
        if (summary !== '') {
          event.tags.push(['summary', summary]);
        }
        if ($images.length > 0) {
          for (let i = 0; i < $images.length; i++) {
            event.tags.push(['image', $images[i]]);
          }
        }
        $selectedTags.forEach((t) => {
          if (t.title) {
            event.tags.push(['t', `${RECIPE_TAG_PREFIX_NEW}-${t.title.toLowerCase().replaceAll(' ', '-')}`]);
          }
        });
        await event.publish();
        const naddr = nip19.naddrEncode({
          identifier: identifier || title.toLowerCase().replaceAll(' ', '-'),
          pubkey: event.pubkey,
          kind: 30023
        });
        resultMessage = 'Success! Redirecting to your recipe...';
        
        // Clear the preview to show the user it worked
        previewEvent = undefined;
        
        // Redirect to the recipe page
        setTimeout(() => {
          goto(`/recipe/${naddr}`);
        }, 1500);
        return; // Don't reset disablePublishButton - keep it disabled until redirect
      }
    } catch (err) {
      resultMessage = 'Error: Something went wrong, Error: ' + String(err);
      disablePublishButton = false;
    } finally {
      if (resultMessage == 'Processing...') {
        resultMessage = ' ';
        disablePublishButton = false;
      }
    }
  }
</script>

<svelte:head>
  <title>{title ? `Edit Recipe ${title}` : 'Edit Recipe'} - zap.cooking</title>
</svelte:head>

<form on:submit|preventDefault={publishRecipe} class="flex flex-col gap-6 max-w-[760px] mx-auto">
  <h1>Edit Recipe</h1>
  <div class="flex flex-col gap-2">
    <h3>Title*</h3>
    <span class="text-caption">Remember to make your title unique!</span>
    <input placeholder="Title" bind:value={title} class="input" />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Tags*</h3>
    <span class="text-caption">Remember to make your title unique!</span>
    <TagsComboBox {selectedTags} />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Brief Summary</h3>
    <textarea
      placeholder="Some brief description of the dish (can be the same as chef’s notes)"
      bind:value={summary}
      rows="6"
      class="input"
    />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Chef's Notes</h3>
    <span class="text-caption">Some notes about this recipe. (Markdown is supported)</span>
    <MarkdownEditor
      bind:value={chefsnotes}
      placeholder="Eg. where the recipe is from, or any additional information"
      rows={6}
    />
  </div>

  <div class="flex flex-col gap-4">
    <h3>Details</h3>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Prep Time</span>
      <input placeholder="20 min" bind:value={preptime} class="input" />
    </div>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Cooking Time</span>
      <input placeholder="1 hour and 5 min" bind:value={cooktime} class="input" />
    </div>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Servings (persons)</span>
      <input placeholder="4" bind:value={servings} class="input" />
    </div>
  </div>
  <div class="flex flex-col gap-2">
    <h3>Ingredients*</h3>
    <StringComboBox placeholder={'2 eggs'} selected={ingredientsArray} showIndex={false} />
  </div>
  <div class="flex flex-col gap-2">
    <h3>Directions*</h3>
    <StringComboBox placeholder={'Bake for 30 min'} selected={directionsArray} showIndex={false} />
  </div>
  <div>
    <h3>Photos & Videos*</h3>
    <span class="text-caption">First image will be your cover photo</span>
    <MediaUploader uploadedImages={images} />
  </div>
  <div class="flex justify-end">
    <div>
      {resultMessage}
      <button />
      <Button disabled={disablePublishButton} type="submit">Publish Edits</Button>
    </div>
  </div>
  {#if $images.length > 0 && title && $selectedTags.length > 0 && $directionsArray.length > 0 && $ingredientsArray.length > 0}
    <div class="flex flex-col gap-4 p-4 rounded-lg" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary);">
      <h2>Card Preview</h2>
      <div>
        <Button on:click={loadPreview}>Load Preview</Button>
      </div>
      {#if previewEvent}
        <div class="p-4 rounded-lg" style="background-color: var(--color-bg-primary);">
          <p class="text-sm text-caption mb-4">Preview of how your recipe card will look:</p>
          <FeedItem event={previewEvent} />
        </div>
      {:else}
        <p class="text-sm text-caption">Click "Load Preview" to see how your recipe will look</p>
      {/if}
    </div>
  {/if}
</form>
