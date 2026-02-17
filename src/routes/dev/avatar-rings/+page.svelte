<script lang="ts">
  import Avatar from '../../../components/Avatar.svelte';

  const demoUsers = [
    { pubkey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Cook Plus' },
    { pubkey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', label: 'Pro Kitchen' },
    { pubkey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', label: 'Founders' },
    { pubkey: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', label: 'Non-member' }
  ];
</script>

<svelte:head>
  <title>Avatar Membership Ring Dev</title>
</svelte:head>

<div class="max-w-xl mx-auto px-4 py-8">
  <h1 class="text-xl font-semibold mb-5">Avatar Membership Ring Dev</h1>
  <p class="text-sm mb-6" style="color: var(--color-text-secondary);">
    Tap/click a ringed avatar to open the membership tooltip.
  </p>

  <div class="space-y-4">
    {#each demoUsers as user}
      <div
        class="flex items-center justify-between rounded-xl px-4 py-3"
        style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
      >
        <div class="flex items-center gap-3">
          <Avatar pubkey={user.pubkey} size={44} />
          <span class="text-sm" style="color: var(--color-text-primary);">{user.label}</span>
        </div>
        <code class="text-xs" style="color: var(--color-caption);">{user.pubkey.slice(0, 8)}...</code>
      </div>
    {/each}
  </div>
</div>
