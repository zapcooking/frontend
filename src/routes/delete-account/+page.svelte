<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { signNip98AuthHeader } from '$lib/nip98';

  // Cloudflare Scrape Shield rewrites every email address in the served HTML to
  // "[email protected]" at the edge — after the Worker responds — and restores it
  // only by running /cdn-cgi/scripts/.../email-decode.min.js. A no-JS fetch
  // (Play reviewer, regulator) must still show it. <!--email_off--> is
  // Cloudflare's opt-out marker.
  //
  // It has to be injected as raw HTML: Svelte strips comments from components
  // (compilerOptions.preserveComments defaults to false), so markers written
  // literally in the template never reach the edge and the opt-out silently
  // does nothing. The markers wrap the whole anchor, not just the visible text,
  // because Cloudflare rewrites the mailto: href as well as the link body.
  const SUPPORT_EMAIL =
    '<!--email_off--><a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a><!--/email_off-->';

  const ENDPOINT = '/api/account/deletion-request';

  type RequestState =
    | { kind: 'idle' }
    | { kind: 'confirming' }
    | { kind: 'sending' }
    | { kind: 'sent'; billing: string }
    | { kind: 'error'; message: string };

  let state: RequestState = { kind: 'idle' };

  async function submitRequest() {
    state = { kind: 'sending' };
    try {
      const bodyString = JSON.stringify({ source: 'web' });
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await signNip98AuthHeader($ndk, {
            method: 'POST',
            url: `${location.origin}${ENDPOINT}`,
            bodyString
          })
        },
        body: bodyString
      });
      if (res.status !== 202) throw new Error(`HTTP ${res.status}`);
      const { billing } = await res.json();
      state = { kind: 'sent', billing };
    } catch (error) {
      console.error('Deletion request failed:', error);
      state = {
        kind: 'error',
        message: 'Your request did not go through. Please try again.'
      };
    }
  }
</script>

<svelte:head>
  <title>Account and Data Deletion | Zap Cooking</title>
  <meta
    name="description"
    content="How to delete your Zap Cooking account and data — in the app or on this page — what we delete, what we cannot delete, and what we are required to keep."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Account and Data Deletion</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">
      <strong>Zap Cooking</strong> — operated by Zap Cooking LLC<br />
      Last updated: 22 September 2026
    </p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- How to delete -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">How to delete your Zap Cooking account</h2>

    <p>You start the deletion yourself, in the app or on this page. You don't need to email us or explain why.</p>

    <p><strong>In the iPhone app:</strong> open the menu, then <strong>Settings → About → Account → Delete Account</strong>. The app walks you through saving your key first, removes your key and its iCloud Keychain backup, and sends us your deletion request.</p>

    <p><strong>In the Android app:</strong> open the menu, then <strong>About → Account and Data Deletion</strong>, which brings you to this page. Sign in with the same account and use the button below.</p>

    <p><strong>On the web:</strong> sign in with the account you want deleted and use the button below.</p>

    <div
      class="rounded-lg p-4 flex flex-col gap-3"
      style="border: 1px solid var(--color-input-border); background-color: var(--color-input-bg)"
    >
      {#if !$userPublickey}
        <p>
          <a href="/login?redirect=%2Fdelete-account" class="text-primary hover:underline font-medium">Sign in</a>
          to request deletion of this account.
        </p>
      {:else if !$ndk.signer}
        <p>You're signed in with a public key only, which can't sign a request. <a href="/login?redirect=%2Fdelete-account" class="text-primary hover:underline font-medium">Sign in</a> with your private key, a signing extension, or a remote signer to request deletion.</p>
      {:else if state.kind === 'sent'}
        <p><strong>Your deletion request has been received.</strong> We will complete it within 30 days.</p>
        {#if state.billing === 'cancelled'}
          <p>Your membership will not renew. You won't be charged again.</p>
        {:else}
          <p>If you have a card membership, we couldn't confirm that its renewal was stopped. We'll cancel it as part of your request. You can also cancel it now from Membership in <a href="/settings" class="text-primary hover:underline">Settings</a>.</p>
        {/if}
        <p>This page doesn't sign you out or remove your key from this browser. To finish on this device, log out from Settings.</p>
      {:else if state.kind === 'confirming' || state.kind === 'sending'}
        <p><strong>Delete this account's Zap Cooking data?</strong> This can't be undone. Before you continue, make sure you have a copy of your private key if you want to keep using this identity anywhere else.</p>
        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            class="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
            disabled={state.kind === 'sending'}
            on:click={submitRequest}
          >
            {state.kind === 'sending' ? 'Sending…' : 'Yes, delete my account'}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg font-medium"
            style="border: 1px solid var(--color-input-border)"
            disabled={state.kind === 'sending'}
            on:click={() => (state = { kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      {:else}
        {#if state.kind === 'error'}
          <p class="text-red-600">{state.message}</p>
        {/if}
        <p>You'll be asked to approve a signature. It proves the request comes from this account's key.</p>
        <div>
          <button
            type="button"
            class="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700"
            on:click={() => (state = { kind: 'confirming' })}
          >
            Delete my account
          </button>
        </div>
      {/if}
    </div>

    <p><strong>What happens right away.</strong> We stop your card membership from renewing, so you won't be charged again, and you keep access until we complete the deletion. For some older memberships we can't do this automatically. If so, the confirmation tells you, and we cancel the renewal by hand as part of your request. Any posts you scheduled are deleted and will not be published.</p>

    <p><strong>What happens within 30 days.</strong> We delete everything else listed under "What we delete" below.</p>

    <p><strong>If you can no longer sign in with your key,</strong> email {@html SUPPORT_EMAIL} with your public key (npub). A public key is public, so anyone can name one. Before acting on an emailed request, we will ask you to show that the account is yours.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- What we delete -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">What we delete</h2>

    <p>When your request is processed, we permanently delete:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Your membership and subscription records</strong> — Cook+ status, tier, and renewal state held against your public key</li>
      <li><strong>Your AI credit balance and usage records</strong> — Cheffy and Sous Chef</li>
      <li><strong>Your scheduled posts</strong> — the encrypted copies we hold until their publish time</li>
      <li><strong>Your content stored on Pantry</strong>, the Nostr relay we operate at pantry.zap.cooking — recipes, posts, comments, reactions, and group messages held there</li>
      <li><strong>Any support correspondence</strong> associated with your account</li>
    </ul>

    <p>We also issue deletion requests to other Nostr relays where we can identify your content.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- What we cannot delete -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">What we cannot delete, and why</h2>

    <p>Zap Cooking is built on Nostr, an open protocol. Some things are outside our control, and we would rather tell you plainly than imply otherwise.</p>

    <p><strong>Content on relays we do not operate.</strong> Your posts and recipes are published to public Nostr relays run by unrelated parties. We can send deletion requests, and many relays honor them, but <strong>whether any given relay deletes your content is entirely that relay's decision. We cannot compel it.</strong></p>

    <p><strong>Media on third-party hosts.</strong> Images and video are stored on Blossom media servers operated independently of Zap Cooking. We stop referencing and serving your media, but we cannot delete files from a host we do not run.</p>

    <p><strong>Copies made by others.</strong> Anything published publicly may have been downloaded, screenshotted, or re-published by other users or services.</p>

    <p><strong>Your keypair.</strong> Your Nostr private key belongs to you and exists independently of Zap Cooking. Deleting your Zap Cooking account does not delete or revoke your key, and you can continue using it with any other Nostr application. If you want to stop using the identity entirely, stop using the key — and consider publishing a NIP-62 request-to-vanish, which asks relays across the network to remove your data.</p>

    <!-- Key backups -->
    <h3 class="text-xl font-bold mt-4" style="color: var(--color-text-primary)">Your key backups</h3>

    <p>Optional key backups are stored in places you control, not on our servers, so a deletion request can't remove them. Each one is encrypted before it leaves your device. Where yours is depends on how you set it up:</p>

    <p><strong>iPhone — iCloud Keychain.</strong> If you set up recovery with Sign in with Apple, your encrypted key is stored in your iCloud Keychain. Delete Account in the iPhone app removes it. You'll sign in with Apple and enter your recovery PIN to confirm it's yours. Logging out of the app does <em>not</em> remove it, so you can recover your key later.</p>

    <p><strong>Android and web — Google Drive.</strong> If you backed up with Google, your encrypted key is stored in a hidden, app-specific folder in your own Google Drive. The Android app and the website use the same backup. Zap Cooking can see only the backup files it put there, and nothing else in your Drive. Deleting your account does not remove the file or withdraw the access you granted. To delete it, go to Google Drive → Settings → Manage apps → Zap Cooking → Delete hidden app data.</p>

    <p><strong>Web — passkey sign-in.</strong> If you sign in on the website with a passkey and "Sign in on other devices" is on, we hold an encrypted copy of your key that we cannot read. Turn that option off in <a href="/settings" class="text-primary hover:underline">Settings</a> before you delete your account to remove it right away. If you don't, it expires automatically about a year after it was last used.</p>

    <p>An iCloud backup can't restore a Google Drive backup, and a Google Drive backup can't restore an iCloud one, even with the same PIN.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- What we keep -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">What we keep, and for how long</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Payment and transaction records</strong> — retained for 7 years as required by tax and accounting law. These records are keyed to your public key and a payment reference. They contain no name, card number, or billing address, because we never collect those.</li>
      <li><strong>A record of your deletion request</strong> — your public key and when you asked, so we can show that we completed it.</li>
      <li><strong>Records related to child safety, abuse, or law-enforcement matters</strong> — retained as required by law, including preservation obligations that follow a report to the National Center for Missing &amp; Exploited Children. See our <a href="/child-safety" class="text-primary hover:underline">Child Safety Standards</a>.</li>
      <li><strong>Aggregate, non-identifying statistics</strong> — retained indefinitely. These cannot be linked back to you.</li>
    </ul>

    <p>Everything else is deleted.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- Partial deletion -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Deleting some of your data without deleting your account</h2>

    <p>You do not have to delete your account to remove specific content. Within the app you can delete individual recipes, posts, and comments at any time. This issues a Nostr deletion request for that item, subject to the same relay limitations described above.</p>

    <p>You can also mute or block other users, and mute words and phrases, from the app's safety settings.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- Questions -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Questions</h2>

    <p>{@html SUPPORT_EMAIL}</p>

    <p>
      Zap Cooking LLC<br />
      Tyrone, Pennsylvania, United States
    </p>
  </div>
</article>
