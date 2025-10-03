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
  // import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import QrIcon from 'phosphor-svelte/lib/QrCode';
  import { requestProvider } from 'webln';
  import ProfileLists from '../../../components/ProfileLists.svelte';
  import Modal from '../../../components/Modal.svelte';
  // @ts-expect-error ehm svelte-qrcode doesn't have type support or something?
  import QrCode from 'svelte-qrcode';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;
  import { Fetch } from 'hurdak';
  import { profileCacheManager } from '$lib/profileCache';

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
      
      profileName = profile && profile.name ? String(profile.name) : '';
      url = profile && profile.picture ? String(profile.picture) : '';
    } catch (error) {
      console.error('Error in loadData:', error);
      // Set default values on error
      events = [];
      profile = {};
      profileName = '';
      url = '';
      loaded = true; // Set loaded to true to prevent infinite loading
    }
  }

  let qrModal = false;

  function qrModalCleanup() {
    qrModal = false;
  }

  let editModal = false;

  function editModalCleanup() {
    editModal = false;
  }

  let input: HTMLElement;
  let url = '';

  $: {
    if (input) {
      input.addEventListener('change', async (e) => {
        try {
          const target = e.target as HTMLInputElement;
          if (target.files && target.files?.length > 0) {
            const body = new FormData();
            body.append('file[]', target.files[0]);
            const result = await uploadToNostrBuild(body);
            if (result && result.data && result.data[0].url) {
              url = result.data[0].url;
            }
          }
        } catch (error) {
          console.error('Error uploading image:', error);
          // You could show a user-friendly error message here
        }
      });
    }
  }

  export async function uploadToNostrBuild(body: any) {
    try {
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

      return await Fetch.fetchJson(url, {
        body,
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
        }
      });
    } catch (error) {
      console.error('Error in uploadToNostrBuild:', error);
      throw error; // Re-throw to be caught by the caller
    }
  }

  let profileName = '';
  async function updateProfile() {
    const metaEvent = new NDKEvent($ndk);
    metaEvent.kind = 0;
    metaEvent.tags = [];
    // @ts-expect-error typescript is wrong
    profile = user.profile;
    if (!profile) profile = {};
    
    // Use correct Nostr profile field names according to NIP-05
    profile.picture = url;
    profile.name = profileName;
    
    console.log('Updated profile:', profile);

    try {
      console.log('Publishing profile for pubkey:', hexpubkey);
      console.log('Profile data:', profile);
      console.log('Profile JSON:', JSON.stringify(profile));
      
      $ndk.cacheAdapter!.saveProfile!(hexpubkey!, profile); // for some reason the caching doesn't happen automatically
      metaEvent.content = JSON.stringify(profile);
      
      console.log('Publishing kind 0 event with content:', metaEvent.content);
      let relays = await metaEvent.publish();
      
      console.log('Published to relays:', relays.size);
      relays.forEach((relay) => {
        relay.once('published', () => {
          console.log('✅ Successfully published to relay:', relay);
        });
        relay.once('publish:failed', (relay, err) => {
          console.log('❌ Failed to publish to relay:', relay, err);
        });
      });
      
      // Invalidate the profile cache so the header avatar updates
      if (hexpubkey) {
        profileCacheManager.invalidateProfile(hexpubkey);
      }
      
      // Reload the page to refresh the header avatar
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('error while publishing update: ', error);
    }
    editModalCleanup();
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

<Modal cleanup={editModalCleanup} open={editModal}>
  <h1 slot="title">Edit Profile</h1>
  <div class="flex gap-4 md:gap-10 mx-auto">
    <div class="flex flex-col self-center">
      <h2 class="text-white mb-2">Profile Picture</h2>
      <div class="flex flex-col items-center gap-3">
        <img
          class="w-[100px] h-[100px] md:w-[200px] md:h-[200px] rounded-full bg-input border-2 border-gray-300"
          src={url}
          alt="Profile"
        />
        <label for="file-upload" class="cursor-pointer">
          <span class="text-blue-400 hover:text-blue-300 underline text-sm font-medium">
            📷 Upload New Image
          </span>
          <input id="file-upload" bind:this={input} type="file" accept="image/*" class="sr-only" />
        </label>
        <p class="text-xs text-gray-400 text-center max-w-[200px]">
          Click "Upload New Image" to change your profile picture
        </p>
      </div>
    </div>
    <div class="flex flex-col gap-3 self-center">
      <h2 class="text-white">Display Name</h2>
      <p class="text-sm text-gray-400">This will be visible to others.</p>
      <input 
        bind:value={profileName} 
        class="input bg-white text-black placeholder-gray-500 border border-gray-300 focus:border-blue-500" 
        type="text" 
        placeholder="Enter your display name" 
      />
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
    <QrCode value="nostr:{nip19.nprofileEncode({ pubkey: user?.pubkey || '', relays: user?.relayUrls || [] })}" />
  </div>
</Modal>

<div class="flex flex-col gap-6">
  <div class="flex gap-16 md:gap-20">
    <div class="flex gap-4">
      {#key hexpubkey}
      <CustomAvatar
        className="cursor-pointer self-center hidden md:flex"
        pubkey={hexpubkey || ''}
        size={100}
      />
      <h1 class="self-center"><CustomName pubkey={hexpubkey || ''} /></h1>
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
          on:click={() => (zapModal = true)}><span class="text-lg">⚡</span></Button
        >
        <!-- <Button class="flex self-center">Follow</Button> -->
      {/if}
      {#if hexpubkey === $userPublickey}
        <Button class="flex self-center" primary={false} on:click={() => (editModal = true)}
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
