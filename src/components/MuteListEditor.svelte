<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { muteListStore } from '$lib/muteListStore';
  import {
    fetchMuteList,
    parseMuteListEvent,
    publishMuteList,
    type MuteList
  } from '$lib/mutableIntegration';
  import { resolveProfileByPubkey, getDisplayName, type ProfileData } from '$lib/profileResolver';
  import { clickOutside } from '$lib/clickOutside';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import LockOpenIcon from 'phosphor-svelte/lib/LockOpen';
  import XIcon from 'phosphor-svelte/lib/X';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import SpinnerGapIcon from 'phosphor-svelte/lib/SpinnerGap';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';

  export let pubkey: string;

  type Tab = 'people' | 'words' | 'hashtags' | 'notes';
  type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
  type SaveState = 'idle' | 'saving' | 'saved' | 'error';

  let activeTab: Tab = 'people';
  let loadState: LoadState = 'idle';
  let saveState: SaveState = 'idle';
  let saveError = '';

  let muteList: MuteList = { pubkeys: [], words: [], tags: [], threads: [] };
  let savedSnapshot = '';  // JSON snapshot of last-saved/loaded state
  let profiles = new Map<string, ProfileData | null>();

  $: hasChanges = loadState === 'loaded' && JSON.stringify(muteList) !== savedSnapshot;

  const PAGE_SIZE = 20;
  let peoplePageOffset = 0;
  $: visiblePeople = muteList.pubkeys.slice(0, peoplePageOffset + PAGE_SIZE);
  $: hasMorePeople = muteList.pubkeys.length > peoplePageOffset + PAGE_SIZE;

  let popupPubkey: string | null = null;
  let copiedNpub = false;

  let addWordInput = '';
  let addTagInput = '';
  let addNoteInput = '';

  $: allPrivate = [...muteList.pubkeys, ...muteList.words, ...muteList.tags, ...muteList.threads]
    .every((i) => i.private);
  $: allPublic = [...muteList.pubkeys, ...muteList.words, ...muteList.tags, ...muteList.threads]
    .every((i) => !i.private);
  $: totalItems = muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length;

  onMount(() => { load(); });

  async function load() {
    loadState = 'loading';
    try {
      const ndkInstance = get(ndk);
      if (!ndkInstance) throw new Error('NDK not ready');
      const event = await fetchMuteList(pubkey);
      muteList = event ? await parseMuteListEvent(event) : { pubkeys: [], words: [], tags: [], threads: [] };
      savedSnapshot = JSON.stringify(muteList);
      await resolveVisibleProfiles();
      loadState = 'loaded';
    } catch {
      loadState = 'error';
    }
  }

  async function resolveVisibleProfiles() {
    const ndkInstance = get(ndk);
    if (!ndkInstance) return;
    const toResolve = visiblePeople.filter((item) => !profiles.has(item.value));
    await Promise.all(
      toResolve.map(async (item) => {
        const p = await resolveProfileByPubkey(item.value, ndkInstance);
        profiles.set(item.value, p);
      })
    );
    profiles = profiles;
  }

  async function loadMorePeople() {
    peoplePageOffset += PAGE_SIZE;
    await resolveVisibleProfiles();
  }

  function togglePrivacy(list: any[], index: number) {
    list[index] = { ...list[index], private: !list[index].private };
    muteList = { ...muteList };
  }

  function setAllPrivacy(makePrivate: boolean) {
    muteList = {
      pubkeys: muteList.pubkeys.map((i) => ({ ...i, private: makePrivate })),
      words: muteList.words.map((i) => ({ ...i, private: makePrivate })),
      tags: muteList.tags.map((i) => ({ ...i, private: makePrivate })),
      threads: muteList.threads.map((i) => ({ ...i, private: makePrivate }))
    };
  }

  function removePubkey(index: number) {
    muteList.pubkeys = muteList.pubkeys.filter((_, i) => i !== index);
    popupPubkey = null;
  }
  function removeWord(index: number) {
    muteList.words = muteList.words.filter((_, i) => i !== index);
  }
  function removeTag(index: number) {
    muteList.tags = muteList.tags.filter((_, i) => i !== index);
  }
  function removeThread(index: number) {
    muteList.threads = muteList.threads.filter((_, i) => i !== index);
  }

  function newItemPrivacy(): boolean {
    // New items inherit the current majority privacy
    return allPrivate || !allPublic;
  }

  function addWord() {
    const val = addWordInput.trim();
    if (!val || muteList.words.some((w) => w.value.toLowerCase() === val.toLowerCase())) return;
    muteList.words = [...muteList.words, { type: 'word', value: val, private: newItemPrivacy() }];
    addWordInput = '';
  }

  function addTag() {
    const val = addTagInput.trim().replace(/^#/, '').toLowerCase();
    if (!val || muteList.tags.some((t) => t.value === val)) return;
    muteList.tags = [...muteList.tags, { type: 'tag', value: val, private: newItemPrivacy() }];
    addTagInput = '';
  }

  function addNote() {
    let val = addNoteInput.trim();
    // Accept bare hex or nevent
    if (val.startsWith('nevent')) {
      try { const d = nip19.decode(val); val = (d.data as any).id ?? ''; } catch { val = ''; }
    }
    if (!val || muteList.threads.some((t) => t.value === val)) return;
    muteList.threads = [...muteList.threads, { type: 'thread', value: val, private: newItemPrivacy() }];
    addNoteInput = '';
  }

  async function save() {
    const authorPubkey = get(userPublickey);
    if (!authorPubkey) return;
    saveState = 'saving';
    saveError = '';
    try {
      await publishMuteList(muteList, authorPubkey);
      savedSnapshot = JSON.stringify(muteList);
      muteListStore.invalidate();
      await muteListStore.load(true);
      saveState = 'saved';
      setTimeout(() => { if (saveState === 'saved') saveState = 'idle'; }, 3000);
    } catch (e) {
      saveState = 'error';
      saveError = e instanceof Error ? e.message : 'Failed to save';
    }
  }

  function profileName(pk: string): string {
    const p = profiles.get(pk);
    return p ? (getDisplayName(p) || npubShort(pk)) : npubShort(pk);
  }
  function profilePicture(pk: string): string | null {
    return profiles.get(pk)?.picture ?? null;
  }
  function npubShort(pk: string): string {
    try { const n = nip19.npubEncode(pk); return n.slice(0, 12) + '…'; } catch { return pk.slice(0, 12) + '…'; }
  }
  function npubFull(pk: string): string {
    try { return nip19.npubEncode(pk); } catch { return pk; }
  }
  function noteShort(id: string): string {
    try { return nip19.noteEncode(id).slice(0, 14) + '…'; } catch { return id.slice(0, 14) + '…'; }
  }

  function openPopup(pk: string) {
    popupPubkey = popupPubkey === pk ? null : pk;
    copiedNpub = false;
  }

  async function copyNpub(pk: string) {
    await navigator.clipboard.writeText(npubFull(pk));
    copiedNpub = true;
    setTimeout(() => { copiedNpub = false; }, 2000);
  }

  const tabs: { id: Tab; label: string; count: () => number }[] = [
    { id: 'people',   label: 'People',   count: () => muteList.pubkeys.length  },
    { id: 'words',    label: 'Words',    count: () => muteList.words.length    },
    { id: 'hashtags', label: 'Hashtags', count: () => muteList.tags.length     },
    { id: 'notes',    label: 'Notes',    count: () => muteList.threads.length  },
  ];
</script>

<div class="py-4 space-y-4">

  {#if loadState === 'loading'}
    <div class="flex items-center justify-center py-16" style="color: var(--color-text-secondary)">
      <SpinnerGapIcon size={24} class="animate-spin mr-2" />
      <span class="text-sm">Loading mute list…</span>
    </div>

  {:else if loadState === 'error'}
    <div class="flex items-center justify-center py-16 gap-2" style="color: var(--color-text-secondary)">
      <WarningCircleIcon size={20} />
      <span class="text-sm">Failed to load mute list.</span>
    </div>

  {:else}

    <!-- Top bar: move-all + save -->
    <div class="flex items-center gap-2 flex-wrap">
      {#if totalItems > 0}
        <div class="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 flex-1 min-w-0" style="background: var(--color-bg-secondary)">
          <LockIcon size={12} weight="fill" style="color: var(--color-accent-orange); flex-shrink:0" />
          <span class="truncate" style="color: var(--color-text-secondary)">Private recommended for mobile</span>
          <div class="flex gap-1 ml-auto flex-shrink-0">
            <button
              on:click={() => setAllPrivacy(true)}
              class="px-2 py-0.5 rounded text-xs font-medium transition-all"
              style="background: {allPrivate ? 'var(--color-accent-orange)' : 'var(--color-input-border)'}; color: {allPrivate ? 'white' : 'var(--color-text-secondary)'};"
            >Private</button>
            <button
              on:click={() => setAllPrivacy(false)}
              class="px-2 py-0.5 rounded text-xs font-medium transition-all"
              style="background: {allPublic ? 'var(--color-input-border)' : 'var(--color-input-border)'}; color: var(--color-text-secondary);"
            >Public</button>
          </div>
        </div>
      {/if}

      <!-- Pending changes label + save -->
      <div class="flex items-center gap-2 flex-shrink-0">
        {#if hasChanges && saveState !== 'saving' && saveState !== 'saved'}
          <span class="text-xs font-medium" style="color: var(--color-accent-orange)">Unsaved changes</span>
        {/if}
        <button
          on:click={save}
          disabled={saveState === 'saving' || (!hasChanges && saveState !== 'saved')}
          title="Publishes your mute list to Nostr relays so all your clients stay in sync"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
          style="background: {hasChanges || saveState === 'saving' ? 'linear-gradient(135deg, #f97316, #f59e0b)' : 'var(--color-input-border)'}; color: {hasChanges || saveState === 'saving' ? 'white' : 'var(--color-text-secondary)'};"
        >
          {#if saveState === 'saving'}
            <SpinnerGapIcon size={14} class="animate-spin" />Saving…
          {:else if saveState === 'saved'}
            <CheckCircleIcon size={14} weight="fill" />Saved
          {:else}
            Publish
          {/if}
        </button>
      </div>
    </div>

    {#if saveState === 'error'}
      <p class="text-sm rounded-lg px-3 py-2" style="background: color-mix(in srgb, #ef4444 10%, transparent); color: #ef4444;">{saveError}</p>
    {/if}

    <!-- Tabs -->
    <div class="border-b" style="border-color: var(--color-input-border)">
      <div class="flex gap-0">
        {#each tabs as tab}
          <button
            on:click={() => (activeTab = tab.id)}
            class="px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-1.5"
            style="color: {activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
          >
            {tab.label}
            {#if tab.count() > 0}
              <span class="text-xs rounded-full px-1.5 py-0.5 leading-none"
                style="background: {activeTab === tab.id ? 'var(--color-accent-orange)' : 'var(--color-input-border)'}; color: {activeTab === tab.id ? 'white' : 'var(--color-text-secondary)'};">
                {tab.count()}
              </span>
            {/if}
            {#if activeTab === tab.id}
              <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Tab panels -->
    <div class="min-h-[200px]">

      {#if activeTab === 'people'}
        {#if muteList.pubkeys.length === 0}
          <p class="text-sm py-8 text-center" style="color: var(--color-caption)">No muted people.</p>
        {:else}
          <ul class="space-y-1">
            {#each visiblePeople as item, i}
              <li class="relative">
                <div class="flex items-center gap-2 rounded-lg px-3 py-2" style="background: var(--color-bg-secondary)">
                  <button
                    on:click={() => openPopup(item.value)}
                    class="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {#if profilePicture(item.value)}
                      <img src={profilePicture(item.value)} alt="" class="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    {:else}
                      <div class="w-7 h-7 rounded-full flex-shrink-0" style="background: var(--color-input-border)" />
                    {/if}
                    <span class="text-sm truncate" style="color: var(--color-text-primary)">{profileName(item.value)}</span>
                  </button>
                  <button
                    on:click={() => togglePrivacy(muteList.pubkeys, i)}
                    title={item.private ? 'Private — click to make public' : 'Public — click to make private'}
                    class="p-1 rounded transition-opacity hover:opacity-70 flex-shrink-0"
                    style="color: {item.private ? 'var(--color-accent-orange)' : 'var(--color-text-secondary)'}"
                  >
                    {#if item.private}<LockIcon size={14} weight="fill" />{:else}<LockOpenIcon size={14} />{/if}
                  </button>
                  <button
                    on:click={() => removePubkey(i)}
                    class="p-1 rounded transition-opacity hover:opacity-70 flex-shrink-0"
                    style="color: var(--color-text-secondary)" title="Unmute"
                  >
                    <XIcon size={14} />
                  </button>
                </div>

                {#if popupPubkey === item.value}
                  <div
                    use:clickOutside
                    on:click_outside={() => { popupPubkey = null; }}
                    class="absolute left-0 right-0 z-50 mt-1 rounded-xl shadow-xl border p-4"
                    style="background: var(--color-bg-primary); border-color: var(--color-input-border);"
                  >
                    <div class="flex items-start gap-3">
                      {#if profilePicture(item.value)}
                        <img src={profilePicture(item.value)} alt="" class="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                      {:else}
                        <div class="w-12 h-12 rounded-full flex-shrink-0" style="background: var(--color-input-border)" />
                      {/if}
                      <div class="flex-1 min-w-0">
                        <p class="font-semibold text-sm truncate" style="color: var(--color-text-primary)">{profileName(item.value)}</p>
                        {#if profiles.get(item.value)?.name}
                          <p class="text-xs mt-0.5" style="color: var(--color-text-secondary)">@{profiles.get(item.value)?.name}</p>
                        {/if}
                        <div class="flex items-center gap-1.5 mt-2">
                          <code class="text-xs truncate flex-1 rounded px-1.5 py-0.5" style="background: var(--color-bg-secondary); color: var(--color-caption); font-size: 10px;">{npubFull(item.value)}</code>
                          <button
                            on:click={() => copyNpub(item.value)}
                            class="flex-shrink-0 p-1 rounded transition-opacity hover:opacity-70"
                            style="color: {copiedNpub ? '#22c55e' : 'var(--color-text-secondary)'}" title="Copy npub"
                          >
                            {#if copiedNpub}<CheckIcon size={13} weight="bold" />{:else}<CopyIcon size={13} />{/if}
                          </button>
                        </div>
                      </div>
                      <button
                        on:click={() => { popupPubkey = null; }}
                        class="flex-shrink-0 p-0.5 rounded transition-opacity hover:opacity-70"
                        style="color: var(--color-caption)"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if hasMorePeople}
            <button
              on:click={loadMorePeople}
              class="mt-3 w-full text-sm py-2 rounded-lg transition-opacity hover:opacity-70"
              style="background: var(--color-bg-secondary); color: var(--color-text-secondary)"
            >
              Show more ({muteList.pubkeys.length - (peoplePageOffset + PAGE_SIZE)} remaining)
            </button>
          {/if}
        {/if}

      {:else if activeTab === 'words'}
        {#if muteList.words.length > 0}
          <div class="flex flex-wrap gap-2 mb-4">
            {#each muteList.words as item, i}
              <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm" style="background: var(--color-bg-secondary); color: var(--color-text-primary)">
                {item.value}
                <button on:click={() => togglePrivacy(muteList.words, i)} title={item.private ? 'Private' : 'Public'}
                  class="transition-opacity hover:opacity-70 ml-0.5"
                  style="color: {item.private ? 'var(--color-accent-orange)' : 'var(--color-caption)'}">
                  {#if item.private}<LockIcon size={11} weight="fill" />{:else}<LockOpenIcon size={11} />{/if}
                </button>
                <button on:click={() => removeWord(i)} class="transition-opacity hover:opacity-70" style="color: var(--color-caption)" title="Remove">
                  <XIcon size={11} />
                </button>
              </span>
            {/each}
          </div>
        {:else}
          <p class="text-sm py-6" style="color: var(--color-caption)">No muted words.</p>
        {/if}
        <form on:submit|preventDefault={addWord} class="flex gap-2">
          <input bind:value={addWordInput} placeholder="Add a word…"
            class="flex-1 px-3 py-1.5 rounded-lg text-sm border outline-none"
            style="background: var(--color-input-bg); border-color: var(--color-input-border); color: var(--color-text-primary);" />
          <button type="submit" class="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style="background: var(--color-bg-secondary); color: var(--color-text-secondary)" title="Add">
            <PlusIcon size={16} />
          </button>
        </form>

      {:else if activeTab === 'hashtags'}
        {#if muteList.tags.length > 0}
          <div class="flex flex-wrap gap-2 mb-4">
            {#each muteList.tags as item, i}
              <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm" style="background: var(--color-bg-secondary); color: var(--color-text-primary)">
                #{item.value}
                <button on:click={() => togglePrivacy(muteList.tags, i)} title={item.private ? 'Private' : 'Public'}
                  class="transition-opacity hover:opacity-70 ml-0.5"
                  style="color: {item.private ? 'var(--color-accent-orange)' : 'var(--color-caption)'}">
                  {#if item.private}<LockIcon size={11} weight="fill" />{:else}<LockOpenIcon size={11} />{/if}
                </button>
                <button on:click={() => removeTag(i)} class="transition-opacity hover:opacity-70" style="color: var(--color-caption)" title="Remove">
                  <XIcon size={11} />
                </button>
              </span>
            {/each}
          </div>
        {:else}
          <p class="text-sm py-6" style="color: var(--color-caption)">No muted hashtags.</p>
        {/if}
        <form on:submit|preventDefault={addTag} class="flex gap-2">
          <input bind:value={addTagInput} placeholder="Add a hashtag…"
            class="flex-1 px-3 py-1.5 rounded-lg text-sm border outline-none"
            style="background: var(--color-input-bg); border-color: var(--color-input-border); color: var(--color-text-primary);" />
          <button type="submit" class="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style="background: var(--color-bg-secondary); color: var(--color-text-secondary)" title="Add">
            <PlusIcon size={16} />
          </button>
        </form>

      {:else if activeTab === 'notes'}
        {#if muteList.threads.length > 0}
          <ul class="space-y-1 mb-4">
            {#each muteList.threads as item, i}
              <li class="flex items-center gap-2 rounded-lg px-3 py-2" style="background: var(--color-bg-secondary)">
                <code class="flex-1 text-xs truncate" style="color: var(--color-text-secondary)">{noteShort(item.value)}</code>
                <button on:click={() => togglePrivacy(muteList.threads, i)} title={item.private ? 'Private' : 'Public'}
                  class="p-1 rounded transition-opacity hover:opacity-70 flex-shrink-0"
                  style="color: {item.private ? 'var(--color-accent-orange)' : 'var(--color-text-secondary)'}">
                  {#if item.private}<LockIcon size={14} weight="fill" />{:else}<LockOpenIcon size={14} />{/if}
                </button>
                <button on:click={() => removeThread(i)} class="p-1 rounded transition-opacity hover:opacity-70 flex-shrink-0"
                  style="color: var(--color-text-secondary)" title="Remove">
                  <XIcon size={14} />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm py-6" style="color: var(--color-caption)">No muted notes.</p>
        {/if}
        <form on:submit|preventDefault={addNote} class="flex gap-2">
          <input bind:value={addNoteInput} placeholder="Paste note ID or nevent…"
            class="flex-1 px-3 py-1.5 rounded-lg text-sm border outline-none"
            style="background: var(--color-input-bg); border-color: var(--color-input-border); color: var(--color-text-primary);" />
          <button type="submit" class="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style="background: var(--color-bg-secondary); color: var(--color-text-secondary)" title="Add">
            <PlusIcon size={16} />
          </button>
        </form>

      {/if}
    </div>

    <!-- Mutable attribution -->
    <div class="flex items-center justify-end gap-1.5 pt-2 border-t" style="border-color: var(--color-input-border); color: var(--color-caption)">
      <span class="text-xs">Powered by</span>
      <img src="/mutable_logo.svg" alt="" class="w-3.5 h-3.5 rounded-sm" />
      <span class="text-xs font-medium">Mutable</span>
    </div>

  {/if}
</div>
