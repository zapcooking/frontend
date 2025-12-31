<script lang="ts">
  import { blur, scale } from 'svelte/transition';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import Button from './Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';
  import { profileCacheManager } from '$lib/profileCache';
  import {
    backupProfile,
    fetchProfileBackup,
    listProfileBackups,
    restoreProfileFromBackup,
    fetchBackupById,
    type ProfileBackupData
  } from '$lib/profileBackup';

  export let open = false;
  export let profile: any = null;
  export let onProfileUpdated: () => void = () => {};

  // Form state
  let formData = {
    display_name: '',
    name: '',
    about: '',
    picture: '',
    banner: '',
    nip05: '',
    website: '',
    lud16: ''
  };

  // UI state
  let saving = false;
  let error: string | null = null;
  let backupStatus: 'idle' | 'backing-up' | 'backed-up' | 'error' = 'idle';
  let uploadingPicture = false;
  let uploadingBanner = false;
  let showRestorePanel = false;
  let backupList: Array<{ timestamp: number; eventId: string; createdAt: number }> = [];
  let loadingBackups = false;
  let restoringBackup = false;
  let lastBackupTimestamp: number | null = null;
  let creatingManualBackup = false;
  let backupSectionEl: HTMLElement;

  // Initialize form when modal opens
  $: if (open && profile) {
    formData = {
      display_name: profile.displayName || profile.display_name || '',
      name: profile.name || '',
      about: profile.about || profile.bio || '',
      picture: profile.picture || profile.image || '',
      banner: profile.banner || '',
      nip05: profile.nip05 || '',
      website: profile.website || '',
      lud16: profile.lud16 || ''
    };
    error = null;
    backupStatus = 'idle';
    showRestorePanel = false;
    // Fetch last backup timestamp
    fetchLastBackupTimestamp();
  }

  async function fetchLastBackupTimestamp() {
    if (!$userPublickey) return;
    try {
      const backups = await listProfileBackups($ndk, $userPublickey);
      if (backups.length > 0) {
        lastBackupTimestamp = backups[0].timestamp;
      } else {
        lastBackupTimestamp = null;
      }
    } catch (e) {
      console.error('[ProfileEdit] Failed to fetch last backup:', e);
      lastBackupTimestamp = null;
    }
  }

  async function createManualBackup() {
    if (!$userPublickey || creatingManualBackup) return;

    creatingManualBackup = true;
    error = null;

    try {
      // Fetch current profile from relay
      const currentProfile = await fetchCurrentProfile();
      if (!currentProfile) {
        error = 'Could not fetch current profile to backup';
        return;
      }

      const success = await backupProfile($ndk, $userPublickey, currentProfile);
      if (success) {
        lastBackupTimestamp = Date.now();
        backupStatus = 'backed-up';
        setTimeout(() => {
          if (backupStatus === 'backed-up') backupStatus = 'idle';
        }, 3000);
      } else {
        error = 'Failed to create backup';
      }
    } catch (e) {
      console.error('[ProfileEdit] Manual backup failed:', e);
      error = 'Failed to create backup';
    } finally {
      creatingManualBackup = false;
    }
  }

  function close() {
    open = false;
    error = null;
    backupStatus = 'idle';
    showRestorePanel = false;
  }

  async function uploadImage(file: File, type: 'picture' | 'banner'): Promise<string | null> {
    const url = 'https://nostr.build/api/v2/upload/profile';

    // Validate file
    if (!file.type.startsWith('image/')) {
      throw new Error('Please upload an image file');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Image must be less than 10MB');
    }

    // Create NIP-98 auth event
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];
    await template.sign();

    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    const body = new FormData();
    body.append('file[]', file);

    const result = await Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });

    if (result?.data?.[0]?.url) {
      return result.data[0].url;
    }
    throw new Error('Upload failed - no URL returned');
  }

  async function handlePictureUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    uploadingPicture = true;
    error = null;

    try {
      const newUrl = await uploadImage(target.files[0], 'picture');
      if (newUrl) {
        formData.picture = newUrl;
      }
    } catch (err: any) {
      error = err.message || 'Failed to upload picture';
    } finally {
      uploadingPicture = false;
      target.value = '';
    }
  }

  async function handleBannerUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    uploadingBanner = true;
    error = null;

    try {
      const newUrl = await uploadImage(target.files[0], 'banner');
      if (newUrl) {
        formData.banner = newUrl;
      }
    } catch (err: any) {
      error = err.message || 'Failed to upload banner';
    } finally {
      uploadingBanner = false;
      target.value = '';
    }
  }

  async function fetchCurrentProfile(): Promise<Record<string, any> | null> {
    try {
      const user = $ndk.getUser({ pubkey: $userPublickey });
      await user.fetchProfile();

      if (!user.profile) return null;

      // Get the raw profile content - preserve all fields
      const events = await $ndk.fetchEvents({
        kinds: [0],
        authors: [$userPublickey],
        limit: 1
      });

      if (events.size === 0) return null;

      const latestEvent = Array.from(events).sort((a, b) =>
        (b.created_at || 0) - (a.created_at || 0)
      )[0];

      return JSON.parse(latestEvent.content);
    } catch (e) {
      console.error('[ProfileEdit] Failed to fetch current profile:', e);
      return null;
    }
  }

  async function saveProfile() {
    if (!$userPublickey || saving) return;

    saving = true;
    error = null;
    backupStatus = 'backing-up';

    try {
      // Step 1: Fetch current profile to preserve all fields
      const currentProfile = await fetchCurrentProfile();

      if (currentProfile) {
        // Step 2: Create backup before making changes
        const backupSuccess = await backupProfile($ndk, $userPublickey, currentProfile);
        if (backupSuccess) {
          backupStatus = 'backed-up';
          console.log('[ProfileEdit] Backup created successfully');
        } else {
          backupStatus = 'error';
          console.warn('[ProfileEdit] Backup failed, but continuing with save');
        }
      }

      // Step 3: Merge form data with existing profile (preserve all fields)
      const updatedProfile: Record<string, any> = {
        ...(currentProfile || {}),
        // Update only the fields we're editing
        display_name: formData.display_name.trim(),
        name: formData.name.trim(),
        about: formData.about.trim(),
        picture: formData.picture.trim(),
        banner: formData.banner.trim(),
        nip05: formData.nip05.trim(),
        website: formData.website.trim(),
        lud16: formData.lud16.trim()
      };

      // Remove empty strings (optional - keeps profile clean)
      Object.keys(updatedProfile).forEach(key => {
        if (updatedProfile[key] === '') {
          delete updatedProfile[key];
        }
      });

      // Step 4: Safety check - ensure we're not losing data
      if (currentProfile) {
        const currentKeys = Object.keys(currentProfile).filter(k => currentProfile[k]);
        const updatedKeys = Object.keys(updatedProfile).filter(k => updatedProfile[k]);

        // Check if we would lose any fields that had values
        const lostFields = currentKeys.filter(k =>
          !updatedKeys.includes(k) && !['display_name', 'name', 'about', 'picture', 'banner', 'nip05', 'website', 'lud16'].includes(k)
        );

        if (lostFields.length > 0) {
          console.warn('[ProfileEdit] Would lose fields:', lostFields);
          // Re-add lost fields
          lostFields.forEach(field => {
            updatedProfile[field] = currentProfile[field];
          });
        }
      }

      // Step 5: Create and publish kind:0 event
      const profileEvent = new NDKEvent($ndk);
      profileEvent.kind = 0;
      profileEvent.content = JSON.stringify(updatedProfile);
      profileEvent.tags = [];

      await profileEvent.sign();
      const publishedRelays = await profileEvent.publish();

      console.log('[ProfileEdit] Profile published to', publishedRelays.size, 'relays');

      if (publishedRelays.size === 0) {
        throw new Error('Failed to publish profile - no relays confirmed');
      }

      // Step 6: Clear cache and notify parent
      profileCacheManager.invalidateProfile($userPublickey);

      // Wait briefly for relays to propagate
      await new Promise(resolve => setTimeout(resolve, 1500));

      onProfileUpdated();
      close();

    } catch (err: any) {
      console.error('[ProfileEdit] Save failed:', err);
      error = err.message || 'Failed to save profile';
      backupStatus = 'error';
    } finally {
      saving = false;
    }
  }

  async function loadBackups() {
    loadingBackups = true;
    try {
      backupList = await listProfileBackups($ndk, $userPublickey);
    } catch (err) {
      console.error('[ProfileEdit] Failed to load backups:', err);
      backupList = [];
    } finally {
      loadingBackups = false;
    }
  }

  async function toggleRestorePanel() {
    showRestorePanel = !showRestorePanel;
    if (showRestorePanel) {
      if (backupList.length === 0) {
        await loadBackups();
      }
      // Scroll to backup section after panel opens
      setTimeout(() => {
        backupSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  async function restoreBackup(eventId: string) {
    if (restoringBackup) return;

    restoringBackup = true;
    error = null;

    try {
      const backup = await fetchBackupById($ndk, eventId);
      if (!backup) {
        throw new Error('Could not fetch backup');
      }

      const success = await restoreProfileFromBackup($ndk, $userPublickey, backup);
      if (!success) {
        throw new Error('Failed to restore profile');
      }

      // Clear cache and notify
      profileCacheManager.invalidateProfile($userPublickey);
      await new Promise(resolve => setTimeout(resolve, 1500));

      onProfileUpdated();
      close();

    } catch (err: any) {
      error = err.message || 'Failed to restore backup';
    } finally {
      restoringBackup = false;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
</script>

{#if open}
  <div
    on:click|self={close}
    on:keydown={(e) => e.key === 'Escape' && close()}
    role="presentation"
    transition:blur={{ duration: 250 }}
    class="fixed top-0 left-0 z-30 w-full h-full backdrop-brightness-50 backdrop-blur"
  >
    <dialog
      transition:scale={{ duration: 250 }}
      aria-labelledby="profile-edit-title"
      aria-modal="true"
      class="absolute m-0 top-1/2 left-1/2 rounded-3xl w-full md:w-[calc(100vw-4em)] max-w-xl max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2"
      style="background-color: var(--color-bg-secondary);"
      open
    >
      <div class="flex flex-col">
        <!-- Banner Upload Area -->
        <div class="relative h-40 rounded-t-3xl overflow-hidden" style="background-color: var(--color-input-bg);">
          {#if formData.banner}
            <img src={formData.banner} alt="Banner" class="w-full h-full object-cover" />
          {:else}
            <div class="w-full h-full flex items-center justify-center">
              <CloudArrowUpIcon size={32} class="text-caption" />
            </div>
          {/if}
          <label class="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/30 hover:bg-black/50 transition-all">
            {#if uploadingBanner}
              <SpinnerIcon size={32} class="text-white animate-spin" />
            {:else}
              <div class="flex flex-col items-center text-white">
                <CloudArrowUpIcon size={32} />
                <span class="text-sm mt-1">Upload Banner</span>
              </div>
            {/if}
            <input
              type="file"
              class="sr-only"
              accept="image/*"
              on:change={handleBannerUpload}
              disabled={uploadingBanner}
            />
          </label>
        </div>

        <!-- Avatar Upload Area (overlapping banner) -->
        <div class="relative -mt-12 ml-6 mb-4">
          <div class="w-24 h-24 rounded-full overflow-hidden border-4" style="border-color: var(--color-bg-secondary); background-color: var(--color-input-bg);">
            {#if formData.picture}
              <img src={formData.picture} alt="Profile" class="w-full h-full object-cover" />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <CameraIcon size={32} class="text-caption" />
              </div>
            {/if}
          </div>
          <label class="absolute inset-0 w-24 h-24 rounded-full flex items-center justify-center cursor-pointer bg-black/30 hover:bg-black/50 transition-all">
            {#if uploadingPicture}
              <SpinnerIcon size={24} class="text-white animate-spin" />
            {:else}
              <CameraIcon size={24} class="text-white" />
            {/if}
            <input
              type="file"
              class="sr-only"
              accept="image/*"
              on:change={handlePictureUpload}
              disabled={uploadingPicture}
            />
          </label>
        </div>

        <!-- Form Content -->
        <div class="px-6 pb-6">
          <!-- Header -->
          <div class="flex justify-between items-center mb-6">
            <h2 id="profile-edit-title" class="text-lg font-semibold" style="color: var(--color-text-primary)">
              Edit Profile
            </h2>
            <button class="cursor-pointer" style="color: var(--color-text-primary)" on:click={close}>
              <CloseIcon size={24} />
            </button>
          </div>

          <!-- Error Message -->
          {#if error}
            <div class="mb-4 p-3 rounded-xl bg-red-500/10 text-red-500 text-sm">
              {error}
            </div>
          {/if}

          <!-- Backup Status -->
          {#if backupStatus === 'backing-up'}
            <div class="mb-4 p-3 rounded-xl bg-blue-500/10 text-blue-500 text-sm flex items-center gap-2">
              <SpinnerIcon size={16} class="animate-spin" />
              Creating backup...
            </div>
          {:else if backupStatus === 'backed-up'}
            <div class="mb-4 p-3 rounded-xl bg-green-500/10 text-green-500 text-sm">
              Backup created successfully
            </div>
          {/if}

          <!-- Form Fields -->
          <div class="flex flex-col gap-4">
            <div>
              <label for="profile-display-name" class="block text-sm font-medium mb-1 text-caption">Display Name</label>
              <input
                id="profile-display-name"
                type="text"
                class="input w-full"
                placeholder="Your display name"
                bind:value={formData.display_name}
                maxlength="50"
              />
            </div>

            <div>
              <label for="profile-username" class="block text-sm font-medium mb-1 text-caption">Username</label>
              <input
                id="profile-username"
                type="text"
                class="input w-full"
                placeholder="username"
                bind:value={formData.name}
                maxlength="30"
              />
            </div>

            <div>
              <label for="profile-bio" class="block text-sm font-medium mb-1 text-caption">Bio</label>
              <textarea
                id="profile-bio"
                class="input w-full h-24 resize-none"
                placeholder="Tell us about yourself..."
                bind:value={formData.about}
                maxlength="500"
              />
            </div>

            <div>
              <label for="profile-picture-url" class="block text-sm font-medium mb-1 text-caption">Profile Picture URL</label>
              <input
                id="profile-picture-url"
                type="url"
                class="input w-full"
                placeholder="https://..."
                bind:value={formData.picture}
              />
              <p class="text-xs text-caption mt-1">Or click the avatar above to upload</p>
            </div>

            <div>
              <label for="profile-banner-url" class="block text-sm font-medium mb-1 text-caption">Banner URL</label>
              <input
                id="profile-banner-url"
                type="url"
                class="input w-full"
                placeholder="https://..."
                bind:value={formData.banner}
              />
              <p class="text-xs text-caption mt-1">Or click the banner above to upload</p>
            </div>

            <div>
              <label for="profile-nip05" class="block text-sm font-medium mb-1 text-caption">NIP-05 Identifier</label>
              <input
                id="profile-nip05"
                type="text"
                class="input w-full"
                placeholder="you@example.com"
                bind:value={formData.nip05}
              />
            </div>

            <div>
              <label for="profile-website" class="block text-sm font-medium mb-1 text-caption">Website</label>
              <input
                id="profile-website"
                type="url"
                class="input w-full"
                placeholder="https://yourwebsite.com"
                bind:value={formData.website}
              />
            </div>

            <div>
              <label for="profile-lud16" class="block text-sm font-medium mb-1 text-caption">Lightning Address</label>
              <input
                id="profile-lud16"
                type="text"
                class="input w-full"
                placeholder="you@getalby.com"
                bind:value={formData.lud16}
              />
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex gap-3 mt-6">
            <Button primary={false} on:click={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              on:click={saveProfile}
              disabled={saving || uploadingPicture || uploadingBanner}
              class="flex-1"
            >
              {#if saving}
                <SpinnerIcon size={18} class="animate-spin" />
                Saving...
              {:else}
                Save Profile
              {/if}
            </Button>
          </div>

          <!-- Backup Section -->
          <div bind:this={backupSectionEl} class="mt-6 pt-4 border-t" style="border-color: var(--color-input-border)">
            <!-- Backup Info & Actions -->
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div class="text-sm text-caption">
                {#if lastBackupTimestamp}
                  Last backup: {formatDate(lastBackupTimestamp)}
                {:else}
                  No backups found
                {/if}
              </div>
              <div class="flex gap-2">
                <button
                  on:click={createManualBackup}
                  disabled={creatingManualBackup || saving}
                  class="text-sm text-primary hover:opacity-80 transition-opacity disabled:opacity-50 flex items-center gap-1"
                >
                  {#if creatingManualBackup}
                    <SpinnerIcon size={14} class="animate-spin" />
                    Backing up...
                  {:else}
                    <CloudArrowUpIcon size={14} />
                    Create Backup
                  {/if}
                </button>
                <button
                  on:click={toggleRestorePanel}
                  class="text-sm text-caption hover:text-primary transition-colors flex items-center gap-1"
                >
                  <ClockCounterClockwiseIcon size={14} />
                  {showRestorePanel ? 'Hide' : 'Restore'}
                </button>
              </div>
            </div>

            {#if showRestorePanel}
              <div class="mt-2">
                {#if loadingBackups}
                  <div class="flex items-center gap-2 text-caption">
                    <SpinnerIcon size={16} class="animate-spin" />
                    Loading backups...
                  </div>
                {:else if backupList.length === 0}
                  <p class="text-sm text-caption italic">No backups found. Backups are created automatically when you save profile changes.</p>
                {:else}
                  <div class="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {#each backupList as backup}
                      <div class="flex justify-between items-center p-3 rounded-xl" style="background-color: var(--color-input-bg)">
                        <span class="text-sm" style="color: var(--color-text-primary)">
                          {formatDate(backup.timestamp)}
                        </span>
                        <button
                          on:click={() => restoreBackup(backup.eventId)}
                          disabled={restoringBackup}
                          class="text-sm text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
                        >
                          {restoringBackup ? 'Restoring...' : 'Restore'}
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </dialog>
  </div>
{/if}
