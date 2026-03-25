<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { profileCacheManager } from '$lib/profileCache';
  import { fetchPopularCooks } from '$lib/exploreUtils';
  import Modal from './Modal.svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import Button from './Button.svelte';

  export let open = false;
  export let onComplete: () => void = () => {};
  export let userPubkey: string = '';

  // Friends of Zap Cooking — curated community npubs (shuffled into unified list)
  const COMMUNITY_NPUBS = [
    'npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq',
    'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx',
    'npub1cgcwm56v5hyrrzl5ty4vq4kdud63n5u4czgycdl2r3jshzk55ufqe52ndy',
    'npub1chakany8dcz93clv4xgcudcvhnfhdyqutprq2yh72daydevv8zasmuhf02',
    'npub16e3vzr7dk2uepjcnl85nfare3kdapxge08gr42s99n9kg7xs8xhs90y9v6',
    'npub150eky5egxszxl7dw2kwn6mkmhag7d6e84eyls22dkjrmjsd89qtsqlve3l'
  ];

  const COMMUNITY_PUBKEYS = COMMUNITY_NPUBS.map((npub) => {
    try {
      const decoded = nip19.decode(npub);
      return decoded.type === 'npub' ? (decoded.data as string) : null;
    } catch {
      return null;
    }
  }).filter((pk): pk is string => pk !== null);

  interface SuggestedUser {
    pubkey: string;
    displayName: string;
    picture: string | null;
    nip05?: string;
  }

  let suggestedUsers: SuggestedUser[] = [];
  let selectedPubkeys = new Set<string>();
  let loading = true;
  let publishing = false;

  $: if (open) {
    loadSuggestions();
  }

  $: selectedCount = selectedPubkeys.size;
  $: totalCount = suggestedUsers.length;
  $: allSelected = selectedCount === totalCount && totalCount > 0;

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function loadSuggestions() {
    loading = true;
    suggestedUsers = [];
    selectedPubkeys = new Set();

    try {
      // Fetch community profiles and active cooks in parallel
      const [communityProfiles, popularCooks] = await Promise.all([
        fetchProfiles(COMMUNITY_PUBKEYS.filter((pk) => pk !== userPubkey)),
        fetchPopularCooks(30)
      ]);

      const communityUsers: SuggestedUser[] = communityProfiles
        .filter((p) => p !== null)
        .map((p) => ({
          pubkey: p!.pubkey,
          displayName: p!.displayName,
          picture: p!.picture,
          nip05: p!.nip05
        }));

      // Active cooks — exclude community members and self
      const communityPubkeySet = new Set(COMMUNITY_PUBKEYS);
      const cookPubkeys = popularCooks
        .map((c) => c.pubkey)
        .filter((pk) => !communityPubkeySet.has(pk) && pk !== userPubkey);

      // Fill up to 21 total
      const targetCooks = Math.max(0, 21 - communityUsers.length);
      const cookProfiles = await fetchProfiles(cookPubkeys.slice(0, targetCooks));
      const cookUsers: SuggestedUser[] = cookProfiles
        .filter((p) => p !== null)
        .map((p) => ({
          pubkey: p!.pubkey,
          displayName: p!.displayName,
          picture: p!.picture,
          nip05: p!.nip05
        }));

      // Merge into one unified list, shuffled so there's no visible ranking
      suggestedUsers = shuffle([...communityUsers, ...cookUsers]);

      // Pre-select all
      selectedPubkeys = new Set(suggestedUsers.map((u) => u.pubkey));
    } catch (error) {
      console.error('Error loading suggestions:', error);
    } finally {
      loading = false;
    }
  }

  async function fetchProfiles(
    pubkeys: string[]
  ): Promise<
    Array<{ pubkey: string; displayName: string; picture: string | null; nip05?: string } | null>
  > {
    const results = await Promise.all(
      pubkeys.map(async (pubkey) => {
        try {
          const user = await profileCacheManager.getProfile(pubkey);
          if (!user?.profile) return null;

          const profile = user.profile;
          const displayName = String(
            profile.displayName || profile.display_name || profile.name || 'Unknown'
          );
          const picture =
            profile.image || profile.picture
              ? String(profile.image || profile.picture)
              : null;
          const nip05 = profile.nip05 ? String(profile.nip05) : undefined;

          return { pubkey, displayName, picture, nip05 };
        } catch {
          return null;
        }
      })
    );
    return results;
  }

  function toggleUser(pubkey: string) {
    if (selectedPubkeys.has(pubkey)) {
      selectedPubkeys.delete(pubkey);
    } else {
      selectedPubkeys.add(pubkey);
    }
    selectedPubkeys = selectedPubkeys;
  }

  function followAll() {
    selectedPubkeys = new Set(suggestedUsers.map((u) => u.pubkey));
    followSelected();
  }

  async function followSelected() {
    if (selectedPubkeys.size === 0 || publishing) {
      onComplete();
      return;
    }

    publishing = true;

    try {
      const contactEvent = new NDKEvent($ndk);
      contactEvent.kind = 3;
      contactEvent.content = '';
      contactEvent.tags = Array.from(selectedPubkeys).map((pk) => ['p', pk]);

      await contactEvent.publish();
    } catch (error) {
      console.error('Error publishing follow list:', error);
    } finally {
      publishing = false;
      onComplete();
    }
  }

  function skip() {
    onComplete();
  }
</script>

<Modal bind:open noHeader={true} allowOverflow={false}>
  <div class="flex flex-col gap-3">
    <!-- Header -->
    <div class="text-center px-2">
      <h2 class="text-xl font-bold" style="color: var(--color-text-primary);">
        Friends of Zap Cooking
      </h2>
      <p class="text-sm mt-1.5 leading-relaxed" style="color: var(--color-text-secondary);">
        Start your feed by connecting with cooks from the Zap Cooking network
      </p>
    </div>

    {#if loading}
      <div class="flex flex-col items-center justify-center py-10 gap-3">
        <div
          class="animate-spin w-7 h-7 border-2 border-orange-500 border-t-transparent rounded-full"
        ></div>
        <p class="text-sm" style="color: var(--color-text-secondary);">
          Finding your people...
        </p>
      </div>
    {:else}
      <!-- Selected count -->
      {#if suggestedUsers.length > 0}
        <div class="text-center">
          <span class="text-xs font-medium" style="color: var(--color-text-secondary);">
            {selectedCount} selected
          </span>
        </div>
      {/if}

      <!-- Unified user list -->
      <div class="flex flex-col gap-0.5 max-h-[50vh] overflow-y-auto -mx-1 px-1">
        {#each suggestedUsers as user (user.pubkey)}
          <button
            class="user-row flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all w-full text-left"
            class:user-row-selected={selectedPubkeys.has(user.pubkey)}
            on:click={() => toggleUser(user.pubkey)}
          >
            <CustomAvatar
              pubkey={user.pubkey}
              size={44}
              imageUrl={user.picture}
              interactive={false}
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span
                  class="font-medium text-sm truncate"
                  style="color: var(--color-text-primary);"
                >
                  {user.displayName}
                </span>
                {#if user.nip05}
                  <span class="nip05-badge">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="w-3.5 h-3.5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </span>
                {/if}
              </div>
              {#if user.nip05}
                <p class="text-xs truncate leading-snug mt-0.5" style="color: var(--color-text-secondary);">
                  {user.nip05}
                </p>
              {/if}
            </div>
            <div
              class="check-circle flex-shrink-0"
              class:check-on={selectedPubkeys.has(user.pubkey)}
              class:check-off={!selectedPubkeys.has(user.pubkey)}
            >
              {#if selectedPubkeys.has(user.pubkey)}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-3.5 h-3.5 text-white"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clip-rule="evenodd"
                  />
                </svg>
              {/if}
            </div>
          </button>
        {/each}

        {#if suggestedUsers.length === 0}
          <p class="text-center text-sm py-6" style="color: var(--color-text-secondary);">
            No cooks found right now. You can follow people anytime from the explore page.
          </p>
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex flex-col gap-2 pt-1">
        <Button on:click={followSelected} disabled={publishing || selectedCount === 0} primary={true}>
          {#if publishing}
            Connecting...
          {:else}
            ⚡ Follow Friends
          {/if}
        </Button>

        {#if !allSelected && suggestedUsers.length > 0}
          <button class="action-link" on:click={followAll} disabled={publishing}>
            Follow all
          </button>
        {/if}

        <button class="action-link" on:click={skip} disabled={publishing}>
          Skip for now
        </button>
        <p class="text-center text-[11px]" style="color: var(--color-text-secondary); opacity: 0.7;">
          You can follow more anytime
        </p>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .user-row {
    border: 1.5px solid transparent;
  }

  .user-row-selected {
    background: color-mix(in srgb, var(--color-primary, #f97316) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-primary, #f97316) 25%, transparent);
  }

  .user-row:not(.user-row-selected):hover {
    background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  }

  .check-circle {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .check-on {
    background-color: var(--color-primary, #f97316);
    border-color: var(--color-primary, #f97316);
  }

  .check-off {
    border-color: var(--color-input-border, #d1d5db);
    background-color: transparent;
  }

  .nip05-badge {
    color: var(--color-primary, #f97316);
    display: inline-flex;
    flex-shrink: 0;
  }

  .action-link {
    text-align: center;
    font-size: 0.875rem;
    padding: 0.375rem 0;
    color: var(--color-text-secondary);
    transition: opacity 0.15s;
    background: none;
    border: none;
    cursor: pointer;
  }

  .action-link:hover {
    opacity: 0.7;
  }

  .action-link:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
