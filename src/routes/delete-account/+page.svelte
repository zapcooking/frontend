<script lang="ts">
  // Cloudflare Scrape Shield rewrites every email address in the served HTML to
  // "[email protected]" at the edge — after the Worker responds — and restores it
  // only by running /cdn-cgi/scripts/.../email-decode.min.js. This page's stated
  // remedy is "email this address", so a no-JS fetch (Play reviewer, regulator)
  // must still show it. <!--email_off--> is Cloudflare's opt-out marker.
  //
  // It has to be injected as raw HTML: Svelte strips comments from components
  // (compilerOptions.preserveComments defaults to false), so markers written
  // literally in the template never reach the edge and the opt-out silently
  // does nothing. The markers wrap the whole anchor, not just the visible text,
  // because Cloudflare rewrites the mailto: href as well as the link body.
  const SUPPORT_EMAIL =
    '<!--email_off--><a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a><!--/email_off-->';
</script>

<svelte:head>
  <title>Account and Data Deletion | Zap Cooking</title>
  <meta
    name="description"
    content="How to request deletion of your Zap Cooking account and data — what we delete, what we cannot delete, and what we are required to keep."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Account and Data Deletion</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">
      <strong>Zap Cooking</strong> — operated by Zap Cooking LLC<br />
      Last updated: 25 July 2026
    </p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- How to request deletion -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">How to request deletion of your Zap Cooking account</h2>

    <p><strong>Email {@html SUPPORT_EMAIL} with the subject line "Delete my account."</strong></p>

    <p>Include the public key (npub) of the account you want deleted. You do not need to explain why.</p>

    <p>We will acknowledge your request within 3 business days and complete deletion within 30 days.</p>

    <p><strong>Paid memberships.</strong> If you have a recurring membership, requesting deletion cancels future renewals so you are not charged again. You keep access until we complete the deletion. Deleting our membership record alone does not stop billing at Stripe — when you request deletion, we cancel the subscription.</p>

    <p>If you are unsure which npub is yours, open your profile in the app — it is shown on your profile screen and can be copied from there.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- What we delete -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">What we delete</h2>

    <p>When your request is processed, we permanently delete:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Your membership and subscription records</strong> — Cook+ status, tier, and renewal state held against your public key</li>
      <li><strong>Your AI credit balance and usage records</strong> — Cheffy and Sous Chef</li>
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

    <p><strong>Your keypair.</strong> Your Nostr private key belongs to you and exists independently of Zap Cooking. Protecting it with a passkey on the website keeps the encrypted copy in your own browser; it is not sent to us, so there is nothing of it for us to delete. Deleting your Zap Cooking account does not delete or revoke your key, and you can continue using it with any other Nostr application. If you want to stop using the identity entirely, stop using the key — and consider publishing a NIP-62 request-to-vanish, which asks relays across the network to remove your data.</p>

    <p><strong>Your Google Drive backup.</strong> The encrypted backup is stored in your own Google Drive, in an app-specific folder — Zap Cooking can see the backup files it put there, and nothing else in your Drive. We read that file when you restore your key, and it is encrypted before it leaves your device. Deleting your Zap Cooking account does not remove the file, and it does not withdraw the access you granted: to delete it, go to Google Drive → Settings → Manage apps → Zap Cooking → Delete hidden app data.</p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- What we keep -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">What we keep, and for how long</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Payment and transaction records</strong> — retained for 7 years as required by tax and accounting law. These records are keyed to your public key and a payment reference. They contain no name, card number, or billing address, because we never collect those.</li>
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
