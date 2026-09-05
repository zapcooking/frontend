<script lang="ts">
  import { historyBook, restoreService } from '../history';
  import type { BookState } from '../serviceBook';
  import Stars from './Stars.svelte';
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import Check from 'phosphor-svelte/lib/Check';
  export let book: BookState;
  export let onSync: () => void;
  export let onLogin: () => void;
  $: summary = historyBook(book.entries);
  $: pending = book.entries.filter((e) => !e.synced).length;
</script>

<div class="book-summary">
  <div><b>{summary.services}</b><span>services cooked</span></div>
  <div><b>{summary.best.toLocaleString()}</b><span>best in your book</span></div>
</div>
<div class="save-status">
  <Check size={18} />
  <p>
    {!book.entries.length
      ? 'A fresh page for your next service.'
      : !book.localSaved
        ? 'This browser cannot save. Keep this page open.'
        : book.owner
          ? pending
            ? 'Saved here · waiting to sync'
            : 'Saved to your Zap identity'
          : 'Saved on this device'}
  </p>
</div>
{#if book.owner}<button class="table-secondary" disabled={book.saving} on:click={onSync}
    >{book.saving ? 'Syncing your book…' : 'Sync now'}</button
  >{:else}<p class="sign-in">
    Sign in to keep new services with your Zap identity across devices. Your guest book stays here.
  </p>
  <button class="table-secondary" on:click={onLogin}>Sign in to Zap</button>{/if}
{#if book.message}<p class="book-message" role="status">{book.message}</p>{/if}
{#if !book.entries.length}<div class="empty-book">
    <BookOpen size={42} weight="duotone" />
    <h3>A fresh page.</h3>
    <p>Three guests. Three plates.<br />Your first service belongs right here.</p>
  </div>{:else}<div class="pages">
    {#each book.entries as entry (entry.run.id)}{@const service = restoreService(entry.run)}
      <article>
        <div class="date">
          <span
            >{new Date(entry.run.completedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}</span
          ><strong
            >{service.reviews.reduce((sum, r) => sum + r.score, 0).toLocaleString()}
            <small>pts</small></strong
          >
        </div>
        <span class="mode"
          >{entry.run.mode === 'daily' ? `Today’s Table · ${entry.run.date} UTC` : 'Open Kitchen'} ·
          {book.owner ? (entry.synced ? 'Saved' : 'Waiting to sync') : 'This device'}</span
        >
        <div class="past-guests">
          {#each service.reviews as r}<div>
              <span>{r.customer.name}</span><Stars value={r.stars} />
            </div>{/each}
        </div>
        <details>
          <summary>The plates & lessons</summary>{#each service.reviews as r}<p>
              <b>{r.name}</b> · {r.score} points<br />{r.discovery}
            </p>{/each}
        </details>
      </article>{/each}
  </div>{/if}
<details>
  <summary>How saving works</summary>
  <p>
    Your latest 100 services make up this book. Personal scores are calculated on your device; this
    is not a competitive leaderboard.
  </p>
  <p>
    Signed-in services use encrypted Nostr app data (kind 30078) on your relays. Only acknowledged
    uploads are marked synced. Sync now can ask your signer to decrypt older services. We retry
    pending uploads when you reconnect; denied requests can be retried manually.
  </p>
  <p>
    Dish choices and scores are encrypted to you. Your public key, timestamps and app tags remain
    visible on Nostr. Browser backups are plaintext and separate for each identity. Switching
    accounts starts a fresh service.
  </p>
</details>

<style>
  .book-summary {
    display: flex;
    gap: 40px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--table-line);
  }
  .book-summary b {
    display: block;
    font-size: 35px;
    font-weight: 800;
    letter-spacing: -1px;
  }
  .book-summary span {
    display: block;
    font-size: 13px;
    color: var(--table-muted);
  }
  .save-status {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--table-success);
    margin: 20px 0 14px;
    font-size: 14px;
  }
  .sign-in,
  .book-message {
    font-size: 13px;
    color: var(--table-muted);
    margin: 12px 0 16px;
  }
  .empty-book {
    padding: 35px 0;
    text-align: center;
    color: var(--table-muted);
  }
  .empty-book :global(svg) {
    margin: auto;
  }
  .empty-book h3 {
    font-size: 23px;
    color: var(--table-ink);
    margin: 12px 0 8px;
  }
  .empty-book p {
    font-size: 14px;
  }
  .pages article {
    padding: 22px 0;
    border-bottom: 1px solid var(--table-line);
  }
  .date {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .date > span {
    font-weight: 700;
    font-size: 14px;
  }
  .date strong {
    font-size: 24px;
  }
  .date small {
    font-size: 12px;
    color: var(--table-muted);
  }
  .mode {
    display: block;
    font-size: 12px;
    color: var(--table-muted);
    margin-top: 5px;
  }
  .past-guests {
    display: flex;
    gap: 18px;
    margin-top: 14px;
  }
  .past-guests > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .past-guests span {
    font-size: 13px;
  }
  .pages details {
    border: 0;
    margin-top: 8px;
    padding: 0;
  }
</style>
