<script lang="ts">
  /**
   * Store-driven wrapper: the layout's avatar-click interceptor sets a
   * pubkey, this puts the shared profile sheet on screen for it.
   *
   * Everything the sheet shows and does lives in ProfileSheet, which the
   * profile page mounts too. The only difference from there is the way
   * through to /user/<npub>, which is worth offering here and redundant on
   * the profile page itself.
   */
  import { profilePreviewPubkey, closeProfilePreview } from '$lib/stores/profilePreview';
  import ProfileSheet from './ProfileSheet.svelte';
</script>

<ProfileSheet
  open={!!$profilePreviewPubkey}
  pubkey={$profilePreviewPubkey || ''}
  showViewFullProfile
  on:close={closeProfilePreview}
/>
