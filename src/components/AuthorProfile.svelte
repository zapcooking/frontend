<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { format } from 'date-fns';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';

  export let pubkey: string;
  /** Event created_at (seconds) — shown as a publish date under the
   * name when provided, e.g. on article/recipe pages. */
  export let timestamp: number | undefined = undefined;
</script>

<div class="flex gap-4 items-center">
  <a href="/user/{nip19.npubEncode(pubkey)}" class="flex gap-4 self-center">
    <Avatar className="self-center" {pubkey} size={56} />
    <span class="flex flex-col self-center">
      <CustomName className="self-center" {pubkey} />
      {#if timestamp}
        <span
          class="text-caption mt-0.5"
          title={new Date(timestamp * 1000).toLocaleString()}
        >
          {format(timestamp * 1000, 'MMM d, yyyy')}
        </span>
      {/if}
    </span>
  </a>
</div>
