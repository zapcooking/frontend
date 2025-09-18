<script lang="ts">
  import ProfileLink from './ProfileLink.svelte';
  import NoteEmbed from './NoteEmbed.svelte';
  import NoteContent from './NoteContent.svelte';
  import { profileActions } from '$lib/profileStore';

  // Test nostr profile strings
  const testProfiles = [
    'nostr:nprofile1qqsqqx9hacelkffcgd3ecchzjtlvwq9xn2fmprhrwnzmm2t3exee2eqpr9mhxue69uhhyetvv9ujuumwdae8gtnnda3kjctv9uq32mfd',
    'nostr:nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhytr9t3s5t3l',
    'nostr:nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhytr9t3s5t3l'
  ];

  // Test content with various nostr links
  const testContent = `Check out this profile: nostr:nprofile1qqsqqx9hacelkffcgd3ecchzjtlvwq9xn2fmprhrwnzmm2t3exee2eqpr9mhxue69uhhyetvv9ujuumwdae8gtnnda3kjctv9uq32mfd

And here's a note embed: nostr:nevent1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhytr9t3s5t3l

This should show both profile links and note embeds!`;

  function clearCache() {
    profileActions.clearAll();
  }
</script>

<div class="p-6 max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Profile Resolver Test</h1>
  
  <div class="mb-4">
    <button 
      on:click={clearCache}
      class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
    >
      Clear Cache
    </button>
  </div>

  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Test Profile Links:</h2>
    
    {#each testProfiles as profile, index}
      <div class="border p-4 rounded">
        <p class="text-sm text-gray-600 mb-2">Profile {index + 1}:</p>
        <ProfileLink nostrString={profile} />
      </div>
    {/each}
  </div>

  <div class="mt-6 space-y-6">
    <div class="p-4 bg-gray-100 rounded">
      <h3 class="font-semibold mb-2">Test Content with Mixed Nostr Links:</h3>
      <div class="bg-white p-4 rounded border">
        <NoteContent content={testContent} />
      </div>
    </div>

    <div class="p-4 bg-gray-100 rounded">
      <h3 class="font-semibold mb-2">How it works:</h3>
      <ul class="text-sm space-y-1">
        <li>• Decodes nostr:nprofile1... strings to get pubkey</li>
        <li>• Fetches kind 0 profile metadata from relays</li>
        <li>• Displays @username or @display_name</li>
        <li>• Falls back to truncated npub if no name available</li>
        <li>• Embeds nostr:nevent1... as note previews</li>
        <li>• Caches results for 5 minutes to avoid repeated queries</li>
      </ul>
    </div>
  </div>
</div>
