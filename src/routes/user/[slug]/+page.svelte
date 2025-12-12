<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { NDKFilter, NDKUser, NDKUserProfile } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import ZapModal from '../../../components/ZapModal.svelte';
  import Feed from '../../../components/Feed.svelte';
  import { validateMarkdownTemplate } from '$lib/pharser';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import CustomAvatar from '../../../components/CustomAvatar.svelte';
  import CustomName from '../../../components/CustomName.svelte';
  import Button from '../../../components/Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import QrIcon from 'phosphor-svelte/lib/QrCode';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import { requestProvider } from 'webln';
  import ProfileLists from '../../../components/ProfileLists.svelte';
  import Modal from '../../../components/Modal.svelte';
  // @ts-expect-error ehm svelte-qrcode doesn't have type support or something?
  import QrCode from 'svelte-qrcode';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let user: NDKUser | null = null;
  let profile: NDKUserProfile | null = null;
  let loaded = false;
  let zapModal = false;
  let recipesTab = true;

  $: {
    if ($page.params.slug) {
      loadData();
    }
  }

  async function loadData() {
    try {
      events = [];
      profile = {};
      hexpubkey = undefined;
      loaded = false;
      console.log('loadData');
      
      if ($page.params.slug?.startsWith(`npub1`)) {
        hexpubkey = nip19.decode($page.params.slug).data.toString();
      } else if ($page.params.slug) {
        goto(`/user/${nip19.npubEncode($page.params.slug)}`);
        return;
      } else {
        throw new Error('Invalid user slug');
      }
      
      if (hexpubkey) {
        // load user
        const u = $ndk.getUser({ pubkey: hexpubkey });
        const p = await u.fetchProfile();
        user = u;
        if (p) {
          profile = p;
        }

        // load feed
        let filter: NDKFilter = {
          authors: [hexpubkey],
          limit: 256,
          kinds: [30023],
          '#t': ['nostrcooking']
        };

        let subscription = $ndk.subscribe(filter);

        subscription.on('event', (ev: NDKEvent) => {
          if (validateMarkdownTemplate(ev.content) != null) {
            events.push(ev);
            events = events;
          }
        });

        subscription.on('eose', () => {
          loaded = true;
        });
      }
    } catch (error) {
      console.error('Error in loadData:', error);
      // Set default values on error
      events = [];
      profile = {};
      loaded = true; // Set loaded to true to prevent infinite loading
    }
  }

  let qrModal = false;
  let npubCopied = false;

  function qrModalCleanup() {
    qrModal = false;
    npubCopied = false;
  }

  async function copyNpub() {
    if (user?.npub) {
      await navigator.clipboard.writeText(user.npub);
      npubCopied = true;
      setTimeout(() => {
        npubCopied = false;
      }, 2000);
    }
  }


  $: profileTitleBase = profile
    ? profile.name || (user ? user.npub.slice(0, 10) + '...' : 'Unknown User')
    : 'Unknown User';

  $: og_meta = {
    title: `${profileTitleBase} - zap.cooking`,
    description: "View this user's recipes on zap.cooking",
    image: profile ? profile.picture : 'https://zap.cooking/logo_with_text.png'
  };
</script>

<svelte:head>
  <title>{og_meta.title}</title>

  {#if loaded}
    <meta name="description" content={og_meta.description} />
    <meta property="og:url" content={`https://zap.cooking/user/${$page.params.slug}`} />
    <meta property="og:type" content="profile" />
    <meta property="og:title" content={og_meta.title} />
    <meta property="og:description" content={og_meta.description} />
    <meta property="og:image" content={String(og_meta.image)} />

    <meta name="twitter:card" content="summary" />
    <meta property="twitter:domain" content="zap.cooking" />
    <meta property="twitter:url" content={`https://zap.cooking/user/${$page.params.slug}`} />
    <meta name="twitter:title" content={og_meta.title} />
    <meta name="twitter:description" content={og_meta.description} />
    <meta name="twitter:image" content={String(og_meta.image)} />
  {/if}
</svelte:head>

{#if user}
  <ZapModal bind:open={zapModal} event={user} />
{/if}

<Modal cleanup={qrModalCleanup} open={qrModal}>
  <h1 slot="title">{profile && profile.name ? profile.name : '...'}'s Profile</h1>

  <div class="flex flex-col items-center gap-6">
    <!-- QR Code -->
    <div class="flex flex-col items-center gap-3">
      <p class="text-sm text-gray-600">Scan to view profile on mobile</p>
      <div class="bg-white p-4 rounded-lg">
        <QrCode value="nostr:{nip19.nprofileEncode({ pubkey: user?.pubkey || '', relays: user?.relayUrls || [] })}" />
      </div>
    </div>

    <!-- Profile Info -->
    <div class="w-full space-y-3 border-t pt-4">
      <!-- NIP-05 -->
      {#if profile?.nip05}
        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-500 font-medium">NIP-05:</span>
          <span class="text-gray-900">{profile.nip05}</span>
        </div>
      {/if}

      <!-- Lightning Address -->
      {#if profile?.lud16 || profile?.lud06}
        <div class="flex items-center gap-2 text-sm">
          <LightningIcon size={16} class="text-yellow-500" />
          <span class="text-gray-500 font-medium">Lightning:</span>
          <span class="text-gray-900 break-all">{profile.lud16 || profile.lud06}</span>
        </div>
      {/if}

      <!-- Copy Npub Button -->
      <button
        on:click={copyNpub}
        class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium"
      >
        {#if npubCopied}
          <CheckIcon size={18} weight="bold" />
          <span>Copied!</span>
        {:else}
          <CopyIcon size={18} />
          <span>Copy npub</span>
        {/if}
      </button>

      <!-- Zap Button -->
      {#if hexpubkey !== $userPublickey}
        <Button
          class="w-full flex items-center justify-center gap-2"
          on:click={() => {
            qrModal = false;
            zapModal = true;
          }}
        >
          <LightningIcon size={18} weight="fill" />
          <span>Send Zap</span>
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<div class="flex flex-col gap-6">
  <div class="flex gap-16 md:gap-20">
    <button class="flex gap-4 hover:opacity-80 transition-opacity" on:click={() => (qrModal = true)}>
      {#key hexpubkey}
      <CustomAvatar
        className="cursor-pointer self-center hidden md:flex"
        pubkey={hexpubkey || ''}
        size={100}
      />
      <h1 class="self-center"><CustomName pubkey={hexpubkey || ''} /></h1>
      {/key}
    </button>
    <div class="flex gap-2 self-center">
      <button
        class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        on:click={() => (qrModal = true)}
        aria-label="Show QR code"
      >
        <QrIcon size={28} weight="regular" />
      </button>
      {#if hexpubkey !== $userPublickey}
        <button
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          on:click={() => (zapModal = true)}
          aria-label="Zap user"
        >
          <LightningIcon size={28} weight="regular" />
        </button>
        <!-- <Button class="flex self-center">Follow</Button> -->
      {/if}
    </div>
  </div>

  <hr />

  <div class="flex flex-col gap-4">
    <div class="flex gap-2">
      <button
        class="rounded-full px-4 py-2 font-semibold cursor-pointer bg-accent-gray {recipesTab
          ? ''
          : 'opacity-70'}"
        on:click={() => (recipesTab = true)}
      >
        Recipes
      </button>
      <button
        class="rounded-full px-4 py-2 font-semibold bg-accent-gray cursor-pointer {recipesTab
          ? 'opacity-70'
          : ''}"
        on:click={() => (recipesTab = false)}
      >
        Lists
      </button>
    </div>

    {#if recipesTab}
      <h2>
      {#key hexpubkey}
        <CustomName pubkey={hexpubkey || ''} />'s Recipes
      {/key}
      </h2>
        <Feed {events} />
    {:else}
      <h2>
        <CustomName pubkey={hexpubkey || ''} />'s Lists
      </h2>
      <ProfileLists {hexpubkey} />
    {/if}
  </div>
</div>
