<script lang="ts">
  // Cloudflare Scrape Shield rewrites email addresses in the served HTML to
  // "[email protected]" and restores them only via a JS decoder. Apple's
  // reviewer (and any no-JS fetch) must see a working address. <!--email_off-->
  // is Cloudflare's opt-out. Svelte strips comments from templates, so the
  // markers are injected as raw HTML and wrap the whole anchor — Cloudflare
  // rewrites mailto: hrefs as well as visible text.
  const SUPPORT_EMAIL =
    '<!--email_off--><a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a><!--/email_off-->';
</script>

<svelte:head>
  <title>Support | Zap Cooking</title>
  <meta
    name="description"
    content="Get help with Zap Cooking — contact support, common questions, how to report content or a user, and how to report a bug."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Support</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">Last updated: September 7, 2026</p>

    <p>
      This page is how to reach us, how common parts of Zap Cooking work, and how to report a
      problem. Zap Cooking is a recipe and food community built on Nostr. You can use the website
      and the iOS and Android apps.
    </p>

    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">
      How to get help
    </h2>

    <p>Email us at {@html SUPPORT_EMAIL}.</p>

    <p>
      Use that address for questions, account help, membership issues, and reports. It is a
      monitored inbox. We do not publish a response-time promise here. Child safety reports are
      prioritized; see our
      <a href="/child-safety" class="text-primary hover:underline">Child Safety Standards</a> for
      how those are handled.
    </p>

    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">
      Common questions
    </h2>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">
      What is a Nostr account, and why is there no password?
    </h3>

    <p>
      Zap Cooking does not create a traditional username-and-password account. When you join, a
      cryptographic key pair is created on your device. Your public key (it starts with
      <code>npub</code>) is your identity. Your private key (it starts with <code>nsec</code>) is
      how you sign in and prove that identity. We do not store a password, so there is nothing for
      us to reset. If you lose the private key and have no backup, we cannot recover the account.
    </p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">
      How do I back up and recover my key?
    </h3>

    <p>
      When you create an account, the app shows your private key and lets you download a backup
      file or copy the key. Keep that copy somewhere safe and private. You can also save an
      encrypted backup to your own Google Drive, unlocked with a PIN you choose. On the website,
      you can protect the key on this device with a passkey (Face ID, Touch ID, or your screen
      lock). A passkey is not a backup — it only unlocks the copy already on that device.
    </p>

    <p>
      To recover an account, sign in by entering your private key, or restore the Google Drive
      backup with your PIN. Signed-in users can also reveal the private key in Settings if it is
      stored on that device. If you used a browser extension or a remote signer, the key stays in
      that tool, not in Zap Cooking.
    </p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">
      What does Cook+ include, and how do I cancel?
    </h3>

    <p>
      Cook+ is the optional paid membership. On the
      <a href="/membership" class="text-primary hover:underline">membership page</a> it currently
      includes Sous Chef (pull a recipe from a link, photo, or pasted text), Nourish (how a recipe
      scores for things like gut health, protein, and real food), Cheffy (300 cooking-help
      messages per month), buying and selling on the Market, featured recipe collections, a Cook+
      member badge, a verified <code>you@zap.cooking</code> identity, access to the
      pantry.zap.cooking member relay, early access to new features, and a vote on the roadmap.
      Pricing shown there is $49/year or $4.99/month, paid with Bitcoin via Lightning or with a
      card.
    </p>

    <p>
      To cancel a card membership, open
      <a href="/membership" class="text-primary hover:underline">/membership</a> while signed in
      and choose Cancel Membership. That opens the billing portal. A Lightning payment covers one
      term and does not renew on its own — you renew it yourself if you want another term. If you
      still need help canceling, email {@html SUPPORT_EMAIL}. Access continues through the end of
      the period you already paid for. Your published recipes stay yours if you cancel.
    </p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">
      What is a zap?
    </h3>

    <p>
      A zap is an optional Bitcoin tip sent over the Lightning Network. On Zap Cooking you can
      send one to a cook or a recipe from the lightning button. The payment goes to that person's
      Lightning address, not to Zap Cooking. It is not a membership and it is not required to use
      the app.
    </p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">
      How do I delete my account?
    </h3>

    <p>
      Email {@html SUPPORT_EMAIL} with the subject line "Delete my account" and include the public
      key (npub) of the account you want deleted. You can copy the npub from your profile. We
      acknowledge deletion requests within 3 business days and complete deletion within 30 days.
      If you have a recurring card membership, requesting deletion also cancels future renewals.
      What we delete, what we cannot delete (because content lives on public Nostr relays we do
      not operate), and what the law requires us to keep are explained on
      <a href="/delete-account" class="text-primary hover:underline">Account and Data Deletion</a>.
    </p>

    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">
      How to report content or a user
    </h2>

    <p>
      Email {@html SUPPORT_EMAIL} with a link to the post, recipe, listing, or profile, and a
      short description of the problem. Anyone can report, including people who do not have a Zap
      Cooking account. This is the reporting route from the website and from any surface that does
      not yet have an in-app report control.
    </p>

    <p>
      To hide someone from your own view: open their profile while signed in and tap Mute User.
      Their recipes and posts stop appearing in your feeds. You can review muted people, words,
      and phrases from the Muted tab on your own profile.
    </p>

    <p>
      On Android, group chats also have an in-app report control, including a dedicated child
      safety category. Those reports go to our moderation accounts and do not require an email
      address.
    </p>

    <p>
      We can act on surfaces we operate — our website and apps, our feeds, and the
      pantry.zap.cooking relay we run. Content that has been copied onto other Nostr relays may
      remain there; we can stop showing it in Zap Cooking and ask those relays to delete it, but
      we cannot compel them.
    </p>

    <p>
      For child sexual abuse material or exploitation, follow the steps on
      <a href="/child-safety" class="text-primary hover:underline">Child Safety Standards</a>. Do
      not download, save, or attach the material. If a child is in immediate danger, contact local
      law enforcement first.
    </p>

    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">
      How to report a bug
    </h2>

    <p>
      Email {@html SUPPORT_EMAIL} if something in the app or website is broken. That is the path
      for most people.
    </p>

    <p>
      If you are comfortable using GitHub, you can also open an issue at
      <a
        href="https://github.com/zapcooking/frontend/issues/new"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary hover:underline">github.com/zapcooking/frontend/issues/new</a
      >. That is the developer path, not the main support channel.
    </p>

    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Legal</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li>
        <a href="/terms" class="text-primary hover:underline">Terms of Service</a>
      </li>
      <li>
        <a href="/privacy" class="text-primary hover:underline">Privacy Policy</a>
      </li>
      <li>
        <a href="/child-safety" class="text-primary hover:underline">Child Safety Standards</a>
      </li>
    </ul>
  </div>
</article>
