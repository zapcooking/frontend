<script lang="ts">
  // Cloudflare Scrape Shield rewrites every email address in the served HTML to
  // "[email protected]" at the edge — after the Worker responds — and restores it
  // only by running /cdn-cgi/scripts/.../email-decode.min.js. Legal pages must
  // remain readable with no JS. <!--email_off--> is Cloudflare's opt-out.
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
  <title>Privacy Policy | Zap Cooking</title>
  <meta
    name="description"
    content="Zap Cooking Privacy Policy — Learn how we handle your information on our decentralized recipe and food community platform."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Privacy Policy</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">Last updated: July 25, 2026</p>

    <p>Zap Cooking LLC ("Zap Cooking," "we," "our," or "us") respects your privacy and is committed to transparency about how information is handled when you use our website, mobile applications, and related services (collectively, the "Service").</p>

    <p>Zap Cooking is built on decentralized technology and is designed to minimize the collection and retention of personal data. This Privacy Policy explains what information we collect, how we use it, and your choices.</p>

    <!-- Section 1 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">1. Information We Collect</h2>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.1 Information You Provide or Publish</h3>

    <p>Zap Cooking does not require or collect email addresses, real names, phone numbers, or traditional account credentials for general use of the Service.</p>

    <p>Users interact with the Service using decentralized identifiers and cryptographic key pairs provided by the Nostr protocol. Any content you choose to publish — including recipes, comments, images, profile information, marketplace listings, and product descriptions — is user-generated and controlled by you.</p>

    <p>Most content you create is published directly to Nostr relays and is not stored on Zap Cooking servers. There are two exceptions. When you use an AI feature, the content you submit passes through our servers and is forwarded to our AI provider. And we hold a small set of records against your public key — described in "What we hold against your public key" below.</p>

    <p>If you contact us directly (for example, via email to {@html SUPPORT_EMAIL}), we may receive and retain your email address, name, and the content of your communication for the purpose of responding to your inquiry.</p>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.2 Payment Information</h3>

    <p>If you purchase a membership, boost, sponsorship, promoted listing, or other paid feature, your payment is processed by a third-party payment provider. Currently, we use:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Stripe</strong> for credit card and subscription billing</li>
      <li><strong>Lightning payment services</strong> for Bitcoin/Lightning transactions</li>
    </ul>

    <p>Zap Cooking does not directly collect or store your full credit card number, bank account number, or wallet private keys. Stripe may collect billing information, including your name, email address, card details, and billing address, in accordance with Stripe's own privacy policy. Lightning payments are processed through third-party wallets and payment infrastructure that Zap Cooking does not control.</p>

    <p>We may receive limited transaction-related information from payment providers, such as confirmation of payment, transaction identifiers, payment method type, billing country, and subscription status, as necessary to confirm payment, fulfill features, maintain records, prevent fraud, and operate the Service.</p>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.3 Marketplace Activity</h3>

    <p>If you use The Market to create listings or communicate with other users about potential transactions, the following applies:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Listings</strong> are published via the Nostr protocol and are publicly accessible on decentralized relays. Listing content (product descriptions, images, pricing) is user-generated and is not stored on centralized servers operated by Zap Cooking. Market listings may include an optional location indicating where an item ships from. If you provide one, it is published publicly with the listing.</li>
      <li><strong>Messaging</strong> between buyers and sellers uses Nostr direct messages routed through Nostr relays. Direct messages are end-to-end encrypted. We cannot read them, and neither can the relays that carry them. Media you attach to a direct message is encrypted before it is uploaded, so the media server stores content it cannot read. Group chat messages are not encrypted and are visible to the operator of the relay hosting the group.</li>
      <li><strong>Payments between users</strong> are conducted directly between parties using third-party wallets and payment tools. Zap Cooking does not process, hold, or have visibility into user-to-user payments.</li>
    </ul>

    <p>If you are required to provide documentation to Zap Cooking in connection with marketplace participation (such as identification, permits, or compliance documentation as described in our Terms of Service), we will retain that documentation only for as long as reasonably necessary for the purpose for which it was collected.</p>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.4 Technical and Analytics Information</h3>

    <p>Zap Cooking uses Cloudflare for hosting, content delivery, and analytics.</p>

    <p>Cloudflare may process limited technical information in connection with delivering the Service, including IP addresses, browser type, device type, pages visited, referring URLs, and approximate geographic location. This information is used in aggregate for performance monitoring, security, and analytics purposes.</p>

    <p>Zap Cooking does not use tracking cookies, advertising cookies, or third-party advertising networks. We do not build user profiles for targeted advertising.</p>

    <p>Cloudflare may set limited technical cookies necessary for security and performance (such as bot detection and DDoS protection). For more information, see Cloudflare's privacy policy.</p>

    <p>Cloudflare's website analytics — including pages visited, referring URLs, and browser type — apply to browsing on zap.cooking and not to the mobile applications.</p>

    <p>Requests the mobile applications make to our servers also pass through Cloudflare, which processes IP addresses and request metadata in order to route traffic and protect against abuse. We do not use this information to determine or store your location, and the mobile applications do not request location access from your device.</p>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.5 On-Device Storage</h3>

    <p>The Service stores information on your device — application preferences in the mobile apps, and browser local storage on the website — to keep settings such as your theme, session state, and wallet connection details. This information stays on your device and is not sent to us.</p>

    <p>Some settings are not only local. Your relay list and your mute and block lists are published to Nostr as events signed with your own key, which means they are stored on relays, including ours. Your private key stays on your device unless you choose to use one of our optional key backup features — Google Drive backup or passkey sign-in — each described in its own section below.</p>

    <h3 class="text-xl font-semibold mt-6 mb-3" style="color: var(--color-text-primary)">1.6 What we hold against your public key</h3>

    <p>We maintain a small set of records keyed to your Nostr public key:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Your membership status and tier, including Cook+</li>
      <li>Your AI credit balance and usage counts</li>
      <li>A reference to any payment you have made, so we can activate your membership</li>
    </ul>

    <p>These contain no name, email address, phone number, card number, or billing address, because we do not collect those. You can request deletion of all of them at any time — see our <a href="/delete-account" class="text-primary hover:underline">Account and Data Deletion</a> page.</p>

    <!-- Section 2 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">2. How We Use Information</h2>

    <p>Information is used only to:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Provide, operate, and maintain the Service</li>
      <li>Process payments and fulfill paid features, memberships, sponsorships, and promoted listings</li>
      <li>Enable community interaction, content sharing, and marketplace features</li>
      <li>Maintain performance, reliability, security, and fraud prevention</li>
      <li>Respond to user inquiries and support requests</li>
      <li>Enforce our Terms of Service and other policies</li>
      <li>Comply with applicable legal obligations</li>
      <li>Improve the Service based on aggregated, non-identifying usage data</li>
    </ul>

    <p>Zap Cooking does not sell personal data. We do not use personal data for targeted advertising, behavioral profiling, or user tracking across third-party websites or services.</p>

    <!-- Section 3 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">3. Decentralized Data and Public Content</h2>

    <p>Zap Cooking leverages the Nostr protocol, which means:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Content you choose to publish — including recipes, comments, profile information, and marketplace listings — may be publicly accessible on decentralized relays operated by Zap Cooking and by independent third parties.</li>
      <li>Once published to decentralized infrastructure, content may be copied, cached, indexed, archived, or retained by third-party relays, clients, search engines, and other systems beyond Zap Cooking's control. Complete deletion may not be possible.</li>
      <li>Marketplace listings are inherently public and commercial in nature. Product descriptions, images, and pricing published via the Nostr protocol may be indexed or cached by third-party services.</li>
      <li>Zap Cooking does not control third-party relays or their data retention, moderation, or privacy practices.</li>
    </ul>

    <p>You are responsible for managing your cryptographic keys and for the content you choose to make public.</p>

    <!-- Section 4 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">4. Community-Managed Relays</h2>

    <p>Zap Cooking operates certain community-managed relays, including:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>The Pantry</strong> (pantry.zap.cooking) — a NIP-29 group relay for public group chats</li>
    </ul>

    <p>Content published to these relays is transmitted by users and stored on relay infrastructure operated or supported by Zap Cooking. This content is generally public (or group-public in the case of NIP-29 groups) and is subject to community moderation.</p>

    <p>Zap Cooking may access, review, moderate, preserve, or remove content on relays we operate where necessary to enforce our Terms of Service, respond to reports, address safety or legal concerns, or comply with applicable law.</p>

    <p>For relays we do not operate, we have no ability to access, moderate, or remove content.</p>

    <!-- Section 5 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">5. Sharing of Information</h2>

    <p>Zap Cooking does not sell, rent, or trade personal information to third parties.</p>

    <p>Third-party services that receive information in connection with the Service:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Nostr relays.</strong> Content you publish — recipes, posts, comments, reactions, profile information, group messages, and Market listings — is transmitted to Nostr relays. Some are operated by us; most are not. The application connects by default to <code>pantry.zap.cooking</code> (ours) and to independently operated relays including <code>nos.lol</code>, <code>relay.damus.io</code>, <code>relay.primal.net</code>, <code>nostr.wine</code>, and <code>eden.nostr.land</code>. You can change this list in the application's relay settings. <strong>Publishing to third-party relays is the normal operation of the service, not an exception</strong>, and content sent to a relay we do not operate is outside our control.</li>
      <li><strong>Blossom media servers.</strong> Images and video you upload are stored on Blossom servers, which are operated independently of Zap Cooking. The default is <code>blossom.primal.net</code>; you can change it in settings. We do not host your media.</li>
      <li><strong>OpenAI.</strong> Content you submit to our AI features is sent to OpenAI for processing. See "AI features" below.</li>
      <li><strong>Giphy.</strong> When you search for a GIF, your typed search term is sent to <code>api.giphy.com</code>. We do not send your search terms anywhere else.</li>
      <li><strong>Google.</strong> Optional, only if you use the encrypted key backup feature. See "Google Sign-In and Drive backup" below.</li>
      <li><strong>Stripe.</strong> Card payment processing.</li>
      <li><strong>Cloudflare.</strong> Hosting, content delivery, security, and website analytics for zap.cooking.</li>
    </ul>

    <p>We may also share limited information in the following circumstances:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Legal compliance.</strong> We may disclose information if required by law, regulation, legal process, or governmental request, or if we believe in good faith that disclosure is necessary to protect the rights, safety, or property of Zap Cooking, our users, or the public.</li>
      <li><strong>Safety and enforcement.</strong> We may share information with law enforcement, regulators, or other third parties where we believe it is necessary to address fraud, abuse, safety concerns, child safety concerns, or violations of our Terms of Service.</li>
      <li><strong>Business transfers.</strong> If Zap Cooking is involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction. We will provide notice if your information becomes subject to a different privacy policy.</li>
    </ul>

    <!-- Section 6 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">6. AI features</h2>

    <p>Zap Cooking offers AI-assisted features including Cheffy, Sous Chef recipe extraction, note review, and Nourish scoring. They are optional. If you do not use them, none of your content is sent to OpenAI.</p>

    <p><strong>What is sent.</strong> When you use one of these features, the content you submit — recipe text, a URL, an image, or your message to Cheffy — is transmitted to our servers and forwarded to OpenAI for processing. Your Nostr public key is associated with the request so we can apply your membership entitlement and credit balance.</p>

    <p><strong>Nourish results are published publicly.</strong> When a recipe is scored, the resulting scores, suggested improvements, and ingredient signals are published to Nostr relays, including relays we do not operate. This is how Nourish scores appear across the network. Like anything published to Nostr, these results are public and permanent, and we cannot retract them from relays we do not control.</p>

    <p><strong>Cheffy conversations are not stored on our servers.</strong> Your conversation history is held on your device and sent with each request. We do not keep a copy.</p>

    <p><strong>What we retain.</strong> Your AI credit balance and usage counts, keyed to your public key.</p>

    <p><strong>Error logs.</strong> When an AI request fails to process correctly, our systems log the response so we can diagnose the failure. These logs can contain the content of that response. They are held in our infrastructure logging for a limited period and then deleted automatically.</p>

    <p><strong>OpenAI's handling.</strong> OpenAI processes this content under its API terms. As of the date of this policy, OpenAI states that data submitted through its API is not used to train its models, and that API inputs and outputs are deleted after 30 days unless it is legally required to retain them.</p>

    <!-- Section 7 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">7. Google Sign-In and Drive backup</h2>

    <p>Zap Cooking offers an optional encrypted backup of your Nostr private key to your own Google Drive.</p>

    <p>If you choose to use it, you sign in with Google. We read a single value from the sign-in response — the stable identifier Google assigns to your account — which is used only as input to the encryption of your backup. <strong>We do not receive, store, or transmit your Google email address, name, or profile information.</strong></p>

    <p>The backup is written to an application-specific folder in <strong>your own Google Drive</strong>. It is encrypted before it leaves your device. We cannot read it, and we cannot see any other content in your Drive. The file belongs to you, and deleting it is done through Google Drive — see our <a href="/delete-account" class="text-primary hover:underline">Account and Data Deletion</a> page.</p>

    <p>If you do not use this feature, no Google integration occurs.</p>

    <!-- Section 8 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">8. Passkey sign-in and encrypted key sync</h2>

    <p>On the Zap Cooking website you can optionally use a passkey to sign in. If you do, we store an encrypted copy of your Nostr private key on our servers, along with the public key of your passkey credential.</p>

    <p><strong>We cannot read it.</strong> The key is encrypted on your device before it is sent, using a secret derived from your passkey that never leaves your device. What we hold is ciphertext we have no way to decrypt.</p>

    <p><strong>This means we cannot recover it for you.</strong> If you lose access to your passkey, we cannot restore your Nostr key from this backup, because we do not hold the means to decrypt it. Keep a separate copy of your key.</p>

    <p>You can delete this stored copy at any time — see our <a href="/delete-account" class="text-primary hover:underline">Account and Data Deletion</a> page.</p>

    <p>If you do not use passkey sign-in, we store no copy of your key.</p>

    <!-- Section 9 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">9. Crash reports</h2>

    <p>The Android application can send a crash report when it encounters an error.</p>

    <p><strong>This is off unless you allow it.</strong> Each report requires your explicit confirmation before it is sent — nothing is transmitted automatically.</p>

    <p>Reports are sent as encrypted Nostr direct messages to our development team, routed through the relays <code>relay.0xchat.com</code>, <code>relay.utxo.one/chat</code>, and <code>relay.damus.io</code>. A report contains diagnostic information about the failure and is associated with your public key.</p>

    <!-- Section 10 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">10. Data Security</h2>

    <p>We take reasonable technical and organizational measures to protect the Service and the limited information we process. These measures include encryption in transit (HTTPS), access controls, and security features provided by our infrastructure providers.</p>

    <p>In the Android application, unencrypted connections are blocked at the operating-system level. All connections to relays, media servers, and our own services use encrypted transport, and the application cannot be configured to use a plaintext connection.</p>

    <p>However, no method of transmission or storage is completely secure. Decentralized systems rely on user-controlled cryptographic keys, and the security of your identity and content ultimately depends on how you manage your keys, devices, and wallet credentials.</p>

    <!-- Section 11 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">11. Data Retention</h2>

    <p>Except where described in "AI features" and "What we hold against your public key," we do not retain your user-generated content on our servers. Content published through the Nostr protocol is stored on decentralized relays and may persist on those relays even if you stop using the Service.</p>

    <p>For content on relays we operate (The Pantry), we retain content in accordance with our relay operations and moderation practices. We may remove content from our relays, but we cannot remove content from third-party relays.</p>

    <p>Payment-related records (transaction confirmations, subscription status, billing metadata) are retained for as long as reasonably necessary for accounting, fraud prevention, legal compliance, and dispute resolution purposes.</p>

    <p>Support communications are retained for as long as reasonably necessary to resolve the inquiry and for our records.</p>

    <!-- Section 12 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">12. Children's Privacy</h2>

    <p>The Service is available to users aged 13 and older. The Market (marketplace features) is restricted to users aged 18 and older. The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13.</p>

    <p>If we become aware that a user under 13 has accessed the Service, we will take reasonable steps to restrict that user's access to Zap Cooking-operated components and delete any personal information we may have inadvertently collected.</p>

    <p>If you believe a child under 13 has used the Service, please contact us at {@html SUPPORT_EMAIL}.</p>

    <p>For our policies on child sexual abuse and exploitation, including how to report it and how we respond, see our <a href="/child-safety" class="text-primary hover:underline">Child Safety Standards</a>.</p>

    <!-- Section 13 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">13. Third-Party Wallets and Payment Services</h2>

    <p>The Service may integrate with or reference third-party wallet providers (such as Spark by Breez) and payment infrastructure for Bitcoin and Lightning transactions. Zap Cooking does not operate, control, or take responsibility for any third-party wallet or payment service.</p>

    <p>Your use of any third-party wallet or payment service is governed by that provider's own terms of service and privacy policy. We encourage you to review the privacy practices of any wallet or payment provider you use.</p>

    <p>Zap Cooking does not have access to your wallet private keys, seed phrases, or the content of your Lightning or Bitcoin transactions conducted through third-party tools.</p>

    <!-- Section 14 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">14. Sponsored Placements and Boosted Content</h2>

    <p>Zap Cooking may offer paid partnerships, sponsored placements, featured listings, boosted recipes, promoted marketplace listings, and other promotional features within the Service.</p>

    <p>These features allow creators, brands, sellers, and other participants to pay for increased visibility within Zap Cooking-operated components.</p>

    <p>Zap Cooking does not use personal data for targeted advertising or user profiling in connection with these features. Sponsored and promoted placements are based on purchased placement, timing, platform design, content category, and other non-personal factors.</p>

    <p>If a payment is made for a promotional feature, Zap Cooking may process limited transaction-related information necessary to confirm payment, fulfill placement, maintain records, prevent abuse, resolve disputes, and support operation of the Service.</p>

    <p>Promotional content will be labeled with clear disclosure language such as "Promoted," "Boosted," "Sponsored," or similar wording.</p>

    <p>Zap Cooking does not provide sponsors or advertisers with users' personal information.</p>

    <!-- Section 15 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">15. International Use</h2>

    <p>The Service is operated from the United States. If you access the Service from outside the United States, you do so at your own initiative and are responsible for compliance with applicable local laws. By using the Service, you acknowledge that information may be processed and stored in the United States and other jurisdictions where our service providers operate.</p>

    <p>We do not currently offer specific mechanisms for data subject access requests under non-U.S. privacy laws (such as GDPR), but we are committed to handling privacy inquiries in good faith. If you have a privacy-related request, contact us at {@html SUPPORT_EMAIL}.</p>

    <!-- Section 16 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">16. Your Choices</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Content.</strong> You control what content you publish through the Service. Once published to decentralized relays, complete deletion may not be possible.</li>
      <li><strong>Local storage.</strong> You can clear on-device storage and cookies through your browser or device settings.</li>
      <li><strong>Wallet connections.</strong> You can disconnect or change wallet providers at any time.</li>
      <li><strong>Memberships.</strong> You can cancel paid memberships through the account settings we provide.</li>
      <li><strong>Communications.</strong> If you contact us via email, you can request deletion of your support communications.</li>
      <li><strong>Relay connections.</strong> You can choose which relays to connect to in the Zap Cooking application's relay settings.</li>
      <li><strong>Account and data deletion.</strong> You can request deletion of the records we hold against your public key — see our <a href="/delete-account" class="text-primary hover:underline">Account and Data Deletion</a> page.</li>
    </ul>

    <!-- Section 17 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">17. Changes to This Policy</h2>

    <p>We may update this Privacy Policy from time to time. If we make material changes, we will post the updated policy and revise the "Last updated" date. We may also provide notice through the Service or by other reasonable electronic means.</p>

    <p>Your continued use of the Service after the effective date of any changes constitutes acceptance of the updated Privacy Policy.</p>

    <!-- Section 18 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">18. Contact</h2>

    <p>If you have questions about this Privacy Policy or Zap Cooking's privacy practices, contact us at:</p>

    <ul class="list-none pl-0 space-y-2">
      <li>Website: <a href="https://zap.cooking" class="text-primary hover:underline">https://zap.cooking</a></li>
      <li>Email: {@html SUPPORT_EMAIL}</li>
    </ul>
  </div>
</article>
