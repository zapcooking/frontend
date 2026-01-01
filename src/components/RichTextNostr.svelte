<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { ndk } from '$lib/nostr';
  import { resolveProfile, getProfileDisplayName, resolveRecipe, resolveNote } from '$lib/utils/nostrRefs';
  import type { ProfileData } from '$lib/profileResolver';
  import { nip19 } from 'nostr-tools';
  import NoteEmbed from './NoteEmbed.svelte';
  import ProfileLink from './ProfileLink.svelte';

  export let text: string = '';

  interface ParsedToken {
    type: 'text' | 'hashtag' | 'npub' | 'naddr' | 'nevent' | 'note';
    content: string;
    raw?: string; // Original raw reference
    key: string;
  }

  let parsedTokens: ParsedToken[] = [];
  const resolvedProfiles = new Map<string, ProfileData | null>();
  const resolvedRecipes = new Map<string, { title: string; url: string } | null>();
  const resolvedNotes = new Map<string, { title: string; url: string } | null>();

  // Parse text into tokens
  function parseText(input: string): ParsedToken[] {
    const tokens: ParsedToken[] = [];
    let lastIndex = 0;
    let keyCounter = 0;

    // Combined regex for all Nostr references
    // Matches: nostr:naddr1..., nostr:nevent1..., nostr:note1..., nostr:npub1...
    // Also matches without nostr: prefix: naddr1..., nevent1..., note1..., npub1...
    const nostrRegex = /(?:nostr:)?(naddr1|nevent1|note1|npub1)([023456789acdefghjklmnpqrstuvwxyz]+)/g;
    
    // Hashtag regex (must not be inside a Nostr reference)
    const hashtagRegex = /#[\w]+/g;

    const allMatches: Array<{ index: number; length: number; type: string; content: string; raw: string }> = [];

    // Find all Nostr references
    let match;
    nostrRegex.lastIndex = 0;
    while ((match = nostrRegex.exec(input)) !== null) {
      const fullMatch = match[0];
      const prefix = match[1];
      const data = match[2];
      
      allMatches.push({
        index: match.index,
        length: fullMatch.length,
        type: prefix,
        content: `${prefix}${data}`,
        raw: fullMatch
      });
    }

    // Helper to check if index is inside a Nostr reference
    function isInNostrRef(index: number): boolean {
      return allMatches.some(m => index >= m.index && index < m.index + m.length);
    }

    // Find hashtags (excluding those inside Nostr references)
    hashtagRegex.lastIndex = 0;
    while ((match = hashtagRegex.exec(input)) !== null) {
      if (!isInNostrRef(match.index)) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          type: 'hashtag',
          content: match[0],
          raw: match[0]
        });
      }
    }

    // Sort all matches by index
    allMatches.sort((a, b) => a.index - b.index);

    // Build tokens
    for (const match of allMatches) {
      // Add text before match
      if (match.index > lastIndex) {
        const textContent = input.substring(lastIndex, match.index);
        if (textContent) {
          tokens.push({
            type: 'text',
            content: textContent,
            key: `text-${keyCounter++}`
          });
        }
      }

      // Add the matched token
      const type = match.type === 'hashtag' ? 'hashtag' :
                   match.type === 'npub1' ? 'npub' :
                   match.type === 'naddr1' ? 'naddr' :
                   match.type === 'nevent1' ? 'nevent' :
                   match.type === 'note1' ? 'note' : 'text';
      
      tokens.push({
        type,
        content: match.content,
        raw: match.raw,
        key: `${type}-${keyCounter++}`
      });

      lastIndex = match.index + match.length;
    }

    // Add remaining text
    if (lastIndex < input.length) {
      const remainingText = input.substring(lastIndex);
      if (remainingText) {
        tokens.push({
          type: 'text',
          content: remainingText,
          key: `text-${keyCounter++}`
        });
      }
    }

    // If no matches, return the whole text as a single token
    if (tokens.length === 0) {
      tokens.push({
        type: 'text',
        content: input,
        key: `text-${keyCounter++}`
      });
    }

    return tokens;
  }

  // Resolve all references in the tokens
  async function resolveReferences(tokens: ParsedToken[]) {
    if (!browser || !$ndk) return;

    const resolvePromises: Promise<void>[] = [];

    for (const token of tokens) {
      if (token.type === 'npub' && token.content) {
        // Resolve profile
        if (!resolvedProfiles.has(token.content)) {
          resolvedProfiles.set(token.content, null); // Placeholder
          resolvePromises.push(
            resolveProfile(token.content, $ndk).then(profile => {
              resolvedProfiles.set(token.content, profile);
            })
          );
        }
      } else if (token.type === 'naddr' && token.content) {
        // Resolve recipe
        if (!resolvedRecipes.has(token.content)) {
          resolvedRecipes.set(token.content, null); // Placeholder
          resolvePromises.push(
            resolveRecipe(token.content, $ndk).then(recipe => {
              resolvedRecipes.set(token.content, recipe ? { title: recipe.title, url: recipe.canonicalUrl } : null);
            })
          );
        }
      } else if ((token.type === 'nevent' || token.type === 'note') && token.content) {
        // Resolve note/event
        if (!resolvedNotes.has(token.content)) {
          resolvedNotes.set(token.content, null); // Placeholder
          resolvePromises.push(
            resolveNote(token.content, $ndk).then(note => {
              resolvedNotes.set(token.content, note);
            })
          );
        }
      }
    }

    // Wait for all resolutions (don't block UI, but update when done)
    Promise.allSettled(resolvePromises).then(() => {
      // Trigger reactivity by reassigning
      parsedTokens = [...parsedTokens];
    });
  }

  function handleHashtagClick(hashtag: string) {
    const tag = hashtag.slice(1); // Remove #
    goto(`/tag/${tag}`);
  }

  function handleNpubClick(npub: string) {
    goto(`/user/${npub}`);
  }

  function handleRecipeClick(naddr: string) {
    const resolved = resolvedRecipes.get(naddr);
    if (resolved?.url) {
      goto(resolved.url);
    } else {
      // Fallback to /r/ route
      goto(`/r/${naddr}`);
    }
  }

  function handleNoteClick(noteId: string) {
    const resolved = resolvedNotes.get(noteId);
    if (resolved?.url) {
      goto(resolved.url);
    } else {
      // Fallback to /nip19 route
      goto(`/${noteId}`);
    }
  }

  // Parse on mount and when text changes
  $: if (text) {
    parsedTokens = parseText(text);
    resolveReferences(parsedTokens);
  }
</script>

<div class="rich-text-nostr whitespace-pre-wrap break-words">
  {#each parsedTokens as token}
    {#if token.type === 'text'}
      {token.content}
    {:else if token.type === 'hashtag'}
      <button
        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white transition-colors cursor-pointer"
        on:click={() => handleHashtagClick(token.content)}
      >
        {token.content}
      </button>
    {:else if token.type === 'npub'}
      <ProfileLink nostrString={token.raw || `nostr:${token.content}`} />
    {:else if token.type === 'naddr'}
      <div class="my-2">
        <NoteEmbed nostrString={token.raw || token.content} />
      </div>
    {:else if token.type === 'nevent'}
      <div class="my-2">
        <NoteEmbed nostrString={token.raw || token.content} />
      </div>
    {:else if token.type === 'note'}
      {@const note = resolvedNotes.get(token.content)}
      {@const displayText = note?.title || 'Note link…'}
      <button
        class="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
        on:click={() => handleNoteClick(token.content)}
        title={token.content}
      >
        {displayText}
      </button>
    {/if}
  {/each}
</div>

<style>
  .rich-text-nostr {
    line-height: 1.625;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>

