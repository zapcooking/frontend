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
  import { Avatar, Name } from '@nostr-dev-kit/ndk-svelte-components';
  import Button from '../../../components/Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import QrIcon from 'phosphor-svelte/lib/QrCode';
  import { requestProvider } from 'webln';
  import ProfileLists from '../../../components/ProfileLists.svelte';
  import Modal from '../../../components/Modal.svelte';
  // @ts-expect-error ehm svelte-qrcode doesn't have type support or something?
  import QrCode from 'svelte-qrcode';
  import { Fetch } from 'hurdak';

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
    events = [];
    profile = {};
    hexpubkey = undefined;
    loaded = false;
    console.log('loadData');
    if ($page.params.slug.startsWith(`npub1`)) {
      hexpubkey = nip19.decode($page.params.slug).data.toString();
    } else {
      goto(`/user/${nip19.npubEncode($page.params.slug)}`);
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

subscription.on('event', (ev) => {
  if (validateMarkdownTemplate(ev.content) != null) {
    events.push(ev);
    events = events;
  }
});

subscription.on('eose', () => {
  loaded = true;
});
    }
    profileName = profile && profile.displayName ? profile.displayName : '';
    url = profile && profile.image ? profile.image : '';
  }

  let qrModal = false;

  function qrModalCleanup() {
    qrModal = false;
  }

  let editModal = false;

  function editModalCleanup() {
    editModal = false;
  }

  let input: HTMLElement, listener;
  let url = '';

  $: {
    if (input) {
      input.addEventListener('change', async (e) => {
        const target = e.target as HTMLInputElement;
        console.log('attempted');
        if (target.files && target.files?.length > 0) {
          const body = new FormData();
          body.append('file[]', target.files[0]);
          const result = await uploadToNostrBuild(body);
          console.log(result);
          if (result && result.data && result.data[0].url) {
            url = result.data[0].url;
          }
        }
      });
    }
  }

  export async function uploadToNostrBuild(body: any) {
    const url = 'https://nostr.build/api/v2/upload/profile';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();
    
    // Ensure all fields are properly formatted according to NIP-98
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    return Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });
  }

  let profileName = '';
  async function updateProfile() {
    const metaEvent = new NDKEvent($ndk);
    metaEvent.kind = 0;
    metaEvent.tags = [];
    // @ts-expect-error typescript is wrong
    profile = user.profile;
    if (!profile) profile = {};
    profile.image = url;
    profile.displayName = profileName;
    console.log(profile);

    try {
      console.log(hexpubkey, profile);
      $ndk.cacheAdapter!.saveProfile!(hexpubkey!, profile); // for some reason the caching doesn't happen automatically
      metaEvent.content = JSON.stringify(profile);
      let relays = await metaEvent.publish();
      relays.forEach((relay) => {
        relay.once('published', () => {
          console.log('published to', relay);
        });
        relay.once('publish:failed', (relay, err) => {
          console.log('publish failed to', relay, err);
        });
      });
    } catch (error) {
      console.error('error while publishing update: ', error);
    }
    editModalCleanup();
  }

  $: og_meta = {
    title:
      (profile
        ? profile.displayName ||
          profile.name ||
          (user ? user.npub.slice(0, 10) + '...' : 'Unknown User')
        : 'Unknown User') + ' on Zap Cooking',
    description: "View this user's recipes on Zap Cooking",
    image: profile ? profile.image : 'https://zap.cooking/logo_with_text.png'
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
    <meta property="og:image" content={og_meta.image} />

    <meta name="twitter:card" content="summary" />
    <meta property="twitter:domain" content="zap.cooking" />
    <meta property="twitter:url" content={`https://zap.cooking/user/${$page.params.slug}`} />
    <meta name="twitter:title" content={og_meta.title} />
    <meta name="twitter:description" content={og_meta.description} />
    <meta name="twitter:image" content={og_meta.image} />
  {/if}
</svelte:head>

<ZapModal bind:open={zapModal} event={user} />

<Modal cleanup={editModalCleanup} open={editModal}>
  <h1 slot="title">Edit Profile</h1>
  <div class="flex gap-4 md:gap-10 mx-auto">
    <div class="flex flex-col self-center">
      <h2 class="text-white">Picture</h2>
      <label for="file-upload" class="cursor-pointer self-center">
        <img
          class="w-[100px] h-[100px] md:w-[200px] md:h-[200px] rounded-full bg-input self-center"
          src={url}
          alt="Profile"
        />
        <input id="file-upload" bind:this={input} type="file" class="sr-only self-center" />
      </label>
    </div>
    <div class="flex flex-col gap-2 self-center">
      <h2>Display Name</h2>
      <p class="break-words hidden md:visible">This will be visible to others.</p>
      <input bind:value={profileName} class="input" type="text" placeholder="Zap Cooking Chef" />
    </div>
  </div>
  <div class="flex gap-2 justify-end">
    <Button
      class="!text-black bg-white border border-[#ECECEC] hover:bg-accent-gray"
      on:click={editModalCleanup}>Cancel</Button
    >
    <Button on:click={updateProfile}>Save</Button>
  </div>
</Modal>

<Modal cleanup={qrModalCleanup} open={qrModal}>
  <h1 slot="title">{profile && profile.name ? profile.name : '...'}'s QR Code</h1>
  Scan this on your mobile device to see their profile!
  <div>
    <QrCode value="nostr:{nip19.nprofileEncode({ pubkey: user.pubkey, relays: user.relayUrls })}" />
  </div>
</Modal>

<div class="flex flex-col gap-6">
  <div class="flex gap-16 md:gap-20">
    <div class="flex gap-4">
      {#key hexpubkey}
      <Avatar
        class="cursor-pointer w-[100px] h-[100px] object-center rounded-full self-center hidden md:flex"
        ndk={$ndk}
        pubkey={hexpubkey}
      />
      <h1 class="self-center"><Name ndk={$ndk} pubkey={hexpubkey} npubMaxLength={10} /></h1>
      {/key}
    </div>
    <div class="flex gap-2 self-center">
      <Button
        class="flex self-center !bg-accent-gray !text-[#675F5F] !px-3"
        on:click={() => (qrModal = true)}><QrIcon /></Button
      >
      {#if hexpubkey !== $userPublickey}
        <Button
          class="flex self-center !bg-accent-gray !text-[#675F5F] !px-3"
          on:click={() => (zapModal = true)}><LightningIcon /></Button
        >
        <!-- <Button class="flex self-center">Follow</Button> -->
      {/if}
      {#if hexpubkey === $userPublickey}
        <Button class="flex self-center" primary="false" on:click={() => (editModal = true)}
          >Edit Profile</Button
        >
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
        <Name ndk={$ndk} pubkey={hexpubkey} npubMaxLength={10} />'s Recipes
      {/key}
      </h2>
        <Feed {events} />
    {:else}
      <h2>
        <Name ndk={$ndk} pubkey={hexpubkey} npubMaxLength={10} />'s Lists
      </h2>
      <ProfileLists {hexpubkey} />
    {/if}
  </div>
</div>
