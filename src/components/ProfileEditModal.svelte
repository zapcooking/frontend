<script lang="ts">
  import Modal from './Modal.svelte';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwise';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';
  import Button from './Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';
  import { profileCacheManager } from '$lib/profileCache';
  import {
    backupProfile,
    listProfileBackups,
    restoreProfileFromBackup,
    type ProfileBackupData
  } from '$lib/profileBackup';

  export let open = false;
  export let profile: any = null;
  export let onProfileUpdated: () => void = () => {};

  // Form state. `noffer` is the user's CLINK static offer (matches the
  // `noffer` custom field bxrd.app's profile editor writes — see
  // https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md).
  let formData = {
    display_name: '',
    name: '',
    about: '',
    picture: '',
    banner: '',
    nip05: '',
    website: '',
    lud16: '',
    noffer: ''
  };

  // Advanced section visibility — image URL fields (picture / banner)
  // live under here so the main form stays focused on identity fields.
  let showAdvanced = false;

  // UI state
  let saving = false;
  let error: string | null = null;
  let backupStatus: 'idle' | 'backing-up' | 'backed-up' | 'error' = 'idle';
  let uploadingPicture = false;
  let uploadingBanner = false;
  let showRestorePanel = false;
  let backupList: Array<{ timestamp: number; eventId: string; createdAt: number; data?: import('$lib/profileBackup').ProfileBackupData }> = [];
  let loadingBackups = false;
  let restoringBackupIndex: number | null = null;
  let lastBackupTimestamp: number | null = null;
  let creatingManualBackup = false;
  let backupSectionEl: HTMLElement;

  // NIP-05 and lud16 are both `local@domain.tld` shaped. NIP-05 allows
  // `_` as the local part (root identifier); both fields are
  // case-insensitive in practice. This is the shape check — actual
  // resolution against the domain's /.well-known endpoint is done
  // below after a debounce.
  const ADDRESS_REGEX = /^[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  type FieldStatus = 'idle' | 'invalid' | 'checking' | 'valid' | 'unresolved';
  let nip05Status: FieldStatus = 'idle';
  let lud16Status: FieldStatus = 'idle';
  let nip05Message = '';
  let lud16Message = '';
  let nip05Controller: AbortController | null = null;
  let lud16Controller: AbortController | null = null;
  let nip05Timer: ReturnType<typeof setTimeout> | null = null;
  let lud16Timer: ReturnType<typeof setTimeout> | null = null;

  function onNip05Change(value: string) {
    const trimmed = value.trim();
    if (nip05Timer) {
      clearTimeout(nip05Timer);
      nip05Timer = null;
    }
    nip05Controller?.abort();
    nip05Controller = null;
    if (!trimmed) {
      nip05Status = 'idle';
      nip05Message = '';
      return;
    }
    if (!ADDRESS_REGEX.test(trimmed)) {
      nip05Status = 'invalid';
      nip05Message = 'Use the form name@example.com';
      return;
    }
    nip05Status = 'checking';
    nip05Message = '';
    nip05Timer = setTimeout(() => {
      verifyNip05(trimmed);
    }, 500);
  }

  async function verifyNip05(value: string) {
    const at = value.indexOf('@');
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const controller = new AbortController();
    nip05Controller = controller;
    try {
      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        nip05Status = 'unresolved';
        nip05Message = `Could not reach ${domain} (${res.status})`;
        return;
      }
      const json = await res.json();
      const found: string | undefined = json?.names?.[local];
      if (!found) {
        nip05Status = 'unresolved';
        nip05Message = `${domain} has no entry for "${local}"`;
        return;
      }
      if ($userPublickey && found.toLowerCase() !== $userPublickey.toLowerCase()) {
        nip05Status = 'unresolved';
        nip05Message = 'Domain points to a different pubkey than yours';
        return;
      }
      nip05Status = 'valid';
      nip05Message = '';
    } catch (e: any) {
      if (e?.name === 'AbortError' || controller.signal.aborted) return;
      nip05Status = 'unresolved';
      nip05Message = `Could not verify with ${domain}`;
    }
  }

  function onLud16Change(value: string) {
    const trimmed = value.trim();
    if (lud16Timer) {
      clearTimeout(lud16Timer);
      lud16Timer = null;
    }
    lud16Controller?.abort();
    lud16Controller = null;
    if (!trimmed) {
      lud16Status = 'idle';
      lud16Message = '';
      return;
    }
    if (!ADDRESS_REGEX.test(trimmed)) {
      lud16Status = 'invalid';
      lud16Message = 'Use the form name@example.com';
      return;
    }
    lud16Status = 'checking';
    lud16Message = '';
    lud16Timer = setTimeout(() => {
      verifyLud16(trimmed);
    }, 500);
  }

  async function verifyLud16(value: string) {
    const at = value.indexOf('@');
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const controller = new AbortController();
    lud16Controller = controller;
    try {
      const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(local)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        lud16Status = 'unresolved';
        lud16Message = `Could not reach ${domain} (${res.status})`;
        return;
      }
      const json = await res.json();
      if (json?.tag !== 'payRequest' || !json?.callback) {
        lud16Status = 'unresolved';
        lud16Message = `${domain} did not return a valid LNURL response`;
        return;
      }
      lud16Status = 'valid';
      lud16Message = '';
    } catch (e: any) {
      if (e?.name === 'AbortError' || controller.signal.aborted) return;
      lud16Status = 'unresolved';
      lud16Message = `Could not verify Lightning address with ${domain}`;
    }
  }

  // Drive verification off form changes (debounced inside the handlers).
  $: onNip05Change(formData.nip05);
  $: onLud16Change(formData.lud16);
  $: hasValidationError = nip05Status === 'invalid' || lud16Status === 'invalid';

  // Track modal open state to initialize only once per open
  let wasOpen = false;

  // Initialize form when modal transitions from closed to open
  function initializeForm() {
    if (!profile) return;

    // Read noffer tolerantly — the field key isn't formally
    // standardised; `noffer` is what bxrd.app writes but accept
    // `offer` / `clink_offer` as fallbacks in case a different client
    // chose a slightly different key for the same value.
    const rawNoffer =
      (typeof profile.noffer === 'string' && profile.noffer) ||
      (typeof profile.offer === 'string' && profile.offer) ||
      (typeof profile.clink_offer === 'string' && profile.clink_offer) ||
      '';

    formData = {
      display_name: profile.displayName || profile.display_name || '',
      name: profile.name || '',
      about: profile.about || profile.bio || '',
      picture: profile.picture || profile.image || '',
      banner: profile.banner || '',
      nip05: profile.nip05 || '',
      website: profile.website || '',
      lud16: profile.lud16 || '',
      noffer: rawNoffer
    };
    error = null;
    backupStatus = 'idle';
    showRestorePanel = false;
    showAdvanced = false;
    fetchLastBackupTimestamp();
  }

  // Watch for open state change - only initialize when transitioning from closed to open
  $: if (open !== wasOpen) {
    if (open && profile) {
      initializeForm();
    }
    wasOpen = open;
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
    // Avatars use nostr.build's profile endpoint, which crops to a square pfp.
    // Banners must NOT be square-cropped — that endpoint squares the image
    // regardless of the NIP-96 `media_type` hint, which is why banners came
    // out pfp-shaped. Route banners through the general media endpoint, which
    // preserves the uploaded aspect ratio (same endpoint the composer uses).
    const url =
      type === 'picture'
        ? 'https://nostr.build/api/v2/upload/profile'
        : 'https://nostr.build/api/v2/upload/files';

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
    body.append('media_type', type === 'picture' ? 'avatar' : 'banner');

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

    if (hasValidationError) {
      error =
        (nip05Status === 'invalid' && nip05Message) ||
        (lud16Status === 'invalid' && lud16Message) ||
        'Please fix the highlighted fields.';
      return;
    }

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
        lud16: formData.lud16.trim(),
        noffer: formData.noffer.trim()
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
        const editedFields = Object.keys(formData);

        // Check if we would lose any fields that had values
        const lostFields = currentKeys.filter(
          k => !updatedKeys.includes(k) && !editedFields.includes(k)
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

  async function restoreBackup(backup: import('$lib/profileBackup').ProfileBackupData, index: number) {
    if (restoringBackupIndex !== null) return;

    restoringBackupIndex = index;
    error = null;

    try {
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
      restoringBackupIndex = null;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
</script>

<Modal bind:open cleanup={close} noHeader>
  <!-- Banner Upload Area. Top corners inherit the dialog's rounding
       (clipped via the dialog's overflow-hidden); bottom is squared so
       the banner sits flush against the avatar / form below instead of
       carving an awkward curve into the modal content area. -->
  <div class="relative h-40 overflow-hidden -mx-4 md:-mx-8 -mt-6" style="background-color: var(--color-input-bg);">
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

    <!-- Close button — overlays the banner's top-right corner so it
         sits in the actual top-right of the dialog (the banner bleeds
         past the dialog padding via -mx/-mt). Z-index above the
         upload label so clicks land on the X, not the upload picker. -->
    <button
      type="button"
      class="profile-edit-close-btn"
      on:click={close}
      aria-label="Close"
    >
      <CloseIcon size={24} weight="fill" />
    </button>
  </div>

  <!-- Avatar row -->
  <div class="flex -mt-12 mb-4 relative z-10">
    <!-- Avatar Upload Area -->
    <div class="relative w-24 h-24 ml-2">
      <div
        class="w-24 h-24 rounded-full overflow-hidden border-4"
        style="border-color: var(--color-bg-secondary); background-color: var(--color-input-bg);"
      >
        {#if formData.picture}
          <img src={formData.picture} alt="Profile" class="w-full h-full object-cover" />
        {:else}
          <div class="w-full h-full flex items-center justify-center">
            <CameraIcon size={32} class="text-caption" />
          </div>
        {/if}
      </div>
      <label
        class="absolute inset-0 w-24 h-24 rounded-full flex items-center justify-center cursor-pointer bg-black/30 hover:bg-black/50 transition-all"
      >
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

  <!-- Form Fields. Order matches the natural profile-page reading
       order — identity first, then payment fields, then website at the
       end. Image URL inputs live under "Advanced" because the avatar /
       banner are typically set via the upload UI above, not the URL
       field; surfacing them inline crowded the form. -->
  <div class="flex flex-col gap-4" style="touch-action: auto; user-select: text;">
    <div>
      <label for="profile-display-name" class="block text-sm font-medium mb-1 text-caption">Display Name</label>
      <input
        id="profile-display-name"
        type="text"
        class="input w-full"
        style="touch-action: auto; user-select: text; -webkit-user-select: text;"
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
        style="touch-action: auto; user-select: text; -webkit-user-select: text;"
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
        style="touch-action: auto; user-select: text; -webkit-user-select: text;"
        placeholder="Tell us about yourself..."
        bind:value={formData.about}
      />
    </div>

    <div>
      <label for="profile-nip05" class="block text-sm font-medium mb-1 text-caption">NIP-05 Identifier</label>
      <div class="relative">
        <input
          id="profile-nip05"
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          inputmode="email"
          class="input w-full pr-10"
          class:input-error={nip05Status === 'invalid'}
          class:input-warning={nip05Status === 'unresolved'}
          class:input-valid={nip05Status === 'valid'}
          style="touch-action: auto; user-select: text; -webkit-user-select: text;"
          placeholder="you@example.com"
          aria-invalid={nip05Status === 'invalid' || nip05Status === 'unresolved'}
          aria-describedby={nip05Message ? 'profile-nip05-msg' : undefined}
          bind:value={formData.nip05}
        />
        {#if nip05Status === 'checking'}
          <SpinnerIcon
            size={20}
            class="absolute right-3 top-1/2 -translate-y-1/2 text-caption animate-spin pointer-events-none"
          />
        {:else if nip05Status === 'valid'}
          <CheckCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 pointer-events-none"
          />
        {:else if nip05Status === 'unresolved'}
          <WarningCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 pointer-events-none"
          />
        {:else if nip05Status === 'invalid'}
          <WarningCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 pointer-events-none"
          />
        {/if}
      </div>
      {#if nip05Message}
        <p
          id="profile-nip05-msg"
          class="text-xs mt-1"
          class:text-red-500={nip05Status === 'invalid'}
          class:text-amber-500={nip05Status === 'unresolved'}
        >{nip05Message}</p>
      {/if}
    </div>

    <div>
      <label for="profile-lud16" class="block text-sm font-medium mb-1 text-caption">Lightning Address</label>
      <div class="relative">
        <input
          id="profile-lud16"
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          inputmode="email"
          class="input w-full pr-10"
          class:input-error={lud16Status === 'invalid'}
          class:input-warning={lud16Status === 'unresolved'}
          class:input-valid={lud16Status === 'valid'}
          style="touch-action: auto; user-select: text; -webkit-user-select: text;"
          placeholder="you@getalby.com"
          aria-invalid={lud16Status === 'invalid' || lud16Status === 'unresolved'}
          aria-describedby={lud16Message ? 'profile-lud16-msg' : undefined}
          bind:value={formData.lud16}
        />
        {#if lud16Status === 'checking'}
          <SpinnerIcon
            size={20}
            class="absolute right-3 top-1/2 -translate-y-1/2 text-caption animate-spin pointer-events-none"
          />
        {:else if lud16Status === 'valid'}
          <CheckCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 pointer-events-none"
          />
        {:else if lud16Status === 'unresolved'}
          <WarningCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 pointer-events-none"
          />
        {:else if lud16Status === 'invalid'}
          <WarningCircleIcon
            size={20}
            weight="fill"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 pointer-events-none"
          />
        {/if}
      </div>
      {#if lud16Message}
        <p
          id="profile-lud16-msg"
          class="text-xs mt-1"
          class:text-red-500={lud16Status === 'invalid'}
          class:text-amber-500={lud16Status === 'unresolved'}
        >{lud16Message}</p>
      {/if}
    </div>

    <div>
      <label for="profile-website" class="block text-sm font-medium mb-1 text-caption">Website</label>
      <input
        id="profile-website"
        type="url"
        class="input w-full"
        style="touch-action: auto; user-select: text; -webkit-user-select: text;"
        placeholder="https://yourwebsite.com"
        bind:value={formData.website}
      />
    </div>

    <!-- Advanced: image URLs. Collapsed by default — most users set
         these via the avatar/banner upload widgets above. -->
    <div class="border-t pt-3" style="border-color: var(--color-input-border);">
      <button
        type="button"
        class="w-full flex items-center justify-between text-sm font-medium text-caption hover:text-primary transition-colors"
        on:click={() => (showAdvanced = !showAdvanced)}
        aria-expanded={showAdvanced}
        aria-controls="profile-advanced-section"
      >
        <span>Advanced</span>
        <CaretDownIcon
          size={16}
          weight="bold"
          class="transition-transform {showAdvanced ? 'rotate-180' : ''}"
        />
      </button>

      {#if showAdvanced}
        <div id="profile-advanced-section" class="flex flex-col gap-4 mt-4">
          <div>
            <label
              for="profile-picture-url"
              class="block text-sm font-medium mb-1 text-caption">Profile Picture URL</label
            >
            <input
              id="profile-picture-url"
              type="url"
              class="input w-full"
              style="touch-action: auto; user-select: text; -webkit-user-select: text;"
              placeholder="https://..."
              bind:value={formData.picture}
            />
            <p class="text-xs text-caption mt-1">Or click the avatar above to upload</p>
          </div>

          <div>
            <label
              for="profile-banner-url"
              class="block text-sm font-medium mb-1 text-caption">Banner URL</label
            >
            <input
              id="profile-banner-url"
              type="url"
              class="input w-full"
              style="touch-action: auto; user-select: text; -webkit-user-select: text;"
              placeholder="https://..."
              bind:value={formData.banner}
            />
            <p class="text-xs text-caption mt-1">Or click the banner above to upload</p>
          </div>

          <div>
            <label
              for="profile-noffer"
              class="block text-sm font-medium mb-1 text-caption">CLINK offer</label
            >
            <input
              id="profile-noffer"
              type="text"
              class="input w-full"
              style="touch-action: auto; user-select: text; -webkit-user-select: text;"
              placeholder="noffer1..."
              bind:value={formData.noffer}
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
            <p class="text-xs text-caption mt-1">
              CLINK static offer for self-custodial Lightning payments. Generate one with Zeus,
              ShockWallet or Lightning.Pub.
            </p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Action Buttons -->
  <div class="flex gap-3 mt-6">
    <Button primary={false} on:click={close} disabled={saving}>
      Cancel
    </Button>
    <Button
      on:click={saveProfile}
      disabled={saving || uploadingPicture || uploadingBanner || hasValidationError}
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
            {#each backupList as backup, i}
              <div class="flex justify-between items-center p-3 rounded-xl" style="background-color: var(--color-input-bg)">
                <span class="text-sm" style="color: var(--color-text-primary)">
                  {formatDate(backup.timestamp)}
                </span>
                <button
                  on:click={() => backup.data && restoreBackup(backup.data, i)}
                  disabled={restoringBackupIndex !== null || !backup.data}
                  class="text-sm text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {restoringBackupIndex === i ? 'Restoring...' : 'Restore'}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<style>
  /* Close (×) — overlays the banner's top-right corner. The banner
     bleeds past the dialog's padding via `-mx-2 md:-mx-8 -mt-6` and
     this button rides along, sitting in the actual top-right of the
     dialog regardless of the dialog's padding. Translucent black pill
     so the X reads on both light and dark banner photos. */
  .profile-edit-close-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background-color: rgba(0, 0, 0, 0.45);
    color: #fff;
    border: none;
    cursor: pointer;
    z-index: 20;
    transition: background-color 0.15s ease-out;
  }
  .profile-edit-close-btn:hover {
    background-color: rgba(0, 0, 0, 0.65);
  }
  .profile-edit-close-btn:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }


  .input-error {
    border-color: rgb(239 68 68) !important;
  }
  .input-error:focus {
    outline-color: rgb(239 68 68);
    box-shadow: 0 0 0 1px rgb(239 68 68);
  }
  .input-valid {
    border-color: rgb(34 197 94) !important;
  }
  .input-valid:focus {
    outline-color: rgb(34 197 94);
    box-shadow: 0 0 0 1px rgb(34 197 94);
  }
  .input-warning {
    border-color: rgb(245 158 11) !important;
  }
  .input-warning:focus {
    outline-color: rgb(245 158 11);
    box-shadow: 0 0 0 1px rgb(245 158 11);
  }
</style>
