<svelte:head>
  <title>Child Safety Standards | Zap Cooking</title>
  <meta
    name="description"
    content="Zap Cooking's child safety standards — what we prohibit, how we prevent and detect CSAE, how to report it, and the limits of what we can technically do."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Child Safety Standards</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">
      <strong>Zap Cooking LLC</strong><br />
      Last updated: 25 July 2026<br />
      Next scheduled review: 25 January 2027
    </p>

    <hr style="border-color: var(--color-input-border)" />

    <!-- Section 1 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">1. Our commitment</h2>

    <p>Zap Cooking has zero tolerance for child sexual abuse and exploitation (CSAE). Content or conduct that sexualizes, exploits, endangers, or abuses a minor is prohibited on every surface we operate, without exception and regardless of intent, framing, or claimed artistic purpose.</p>

    <p>This document sets out what we prohibit, what we do to prevent and detect it, how anyone can report it, how we respond, and — importantly — the limits of what we are technically able to do. We would rather publish an honest account of our capabilities than an aspirational one we cannot deliver.</p>

    <!-- Section 2 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">2. Definitions</h2>

    <p><strong>CSAE</strong> — child sexual abuse and exploitation, including sexualized depiction of minors, sexual solicitation or grooming of a minor, sextortion, trafficking, and the promotion or facilitation of any of these.</p>

    <p><strong>CSAM</strong> — child sexual abuse material: visual depictions of sexually explicit conduct involving a minor.</p>

    <p><strong>Minor</strong> — any person under 18 years of age, or under the age of majority in their jurisdiction where that age is higher.</p>

    <!-- Section 3 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">3. Prohibited conduct</h2>

    <p>The following are prohibited on all Zap Cooking surfaces:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Uploading, publishing, linking to, or requesting CSAM</li>
      <li>Sexualized depiction or description of minors, including text, illustration, and AI-generated material</li>
      <li>Sexual solicitation of a minor, or grooming behavior — including attempts to move a minor to a private channel, to obtain images, or to establish secrecy from parents or guardians</li>
      <li>Sextortion, or threatening to distribute intimate imagery of a minor</li>
      <li>Trafficking, or the advertisement or facilitation of the sexual exploitation of a minor</li>
      <li>Any attempt to use Zap Cooking's features, including its AI features, to generate, locate, or distribute the above</li>
    </ul>

    <p>Violations result in immediate removal from surfaces we control and permanent blocking of the responsible key, with no warning and no appeal for CSAM.</p>

    <!-- Section 4 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">4. Scope — what we operate and what we do not</h2>

    <p>Zap Cooking is built on Nostr, an open protocol. This has direct consequences for what enforcement means, and we state them plainly rather than implying control we do not have.</p>

    <p><strong>Surfaces we operate and fully control:</strong></p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Pantry</strong> (pantry.zap.cooking), our relay. We can and do refuse, remove, and block here.</li>
      <li><strong>The Zap Cooking web application and our Android and iOS clients.</strong> We control what our clients fetch, render, and serve.</li>
      <li><strong>Our own feeds, discovery surfaces, and AI features.</strong></li>
    </ul>

    <p>On these surfaces, removal is immediate and effective.</p>

    <p><strong>Surfaces we do not operate:</strong></p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Third-party Nostr relays.</strong> Zap Cooking clients read from public relays operated by unrelated parties. When we identify violating content, we issue deletion requests (NIP-09) to relays where it appears. <strong>These are requests. Whether a third-party relay honors them is entirely at that relay's discretion, and we cannot compel it.</strong></li>
      <li><strong>Third-party media hosts.</strong> Images and video are stored on Blossom servers, which are operated independently of Zap Cooking. We can stop serving and referencing such media in our clients; we cannot delete it from a host we do not run.</li>
    </ul>

    <p><strong>What we can always do, regardless of where content lives:</strong> stop serving it to our users, remove it from our feeds and search, block the responsible key from our relay and clients, and report it to the appropriate authorities.</p>

    <p>We consider this the honest boundary of our capability as a small team. Within that boundary we enforce fully and promptly.</p>

    <!-- Section 5 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">5. Prevention</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Zap Cooking is not an anonymous or random chat service.</strong> There is no stranger pairing, no chat roulette, no random matching, and no anonymous direct-message surface. Group chat is topic-based and joined deliberately. Nostr as a protocol permits pseudonymous participation, but our product does not offer or promote anonymous contact between strangers as a feature.</li>
      <li><strong>The application is not directed to children.</strong> It is rated and marketed for a general adult audience, and we do not target children in our store listings, marketing, or product design.</li>
      <li><strong>Relay-level constraints on Pantry:</strong> an allowlist restricting accepted event kinds to those our application uses, per-key and per-IP rate limits, and event size caps.</li>
      <li><strong>Content filtering in our clients:</strong> muted-tag enforcement and content filtering applied to feeds and discovery surfaces.</li>
      <li><strong>User-level controls:</strong> every user can mute and block any other user, and can mute words and phrases, from within the application.</li>
      <li><strong>Group moderation:</strong> NIP-29 group chats on Pantry are moderated by their group administrators as well as by Zap Cooking.</li>
      <li><strong>Paid placement:</strong> sponsored and boosted content is subject to these standards in full. Violating sponsored placements are removed and not refunded.</li>
      <li><strong>AI safeguards:</strong> our AI features are prohibited from generating sexualized content involving minors and are subject to the same enforcement as user-generated content.</li>
    </ul>

    <p><strong>Current limitation, stated openly:</strong> we do not presently operate automated perceptual-hash matching against known-CSAM databases. Our detection relies on user reports, operator review, and the moderation controls described above. We are evaluating hash-matching options appropriate to our scale and will update this document when that changes.</p>

    <!-- Section 6 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">6. How to report</h2>

    <p><strong>By email</strong> — <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a>. This inbox is monitored and child safety reports are prioritized above all other correspondence. This is the reporting route from the web application and from any surface where an in-app control is not yet available.</p>

    <p><strong>In the Android application</strong> — reporting controls are available in group chats today, including a dedicated child safety category, and are being extended across posts, recipes, comments, and profiles. Reports route directly to designated moderation accounts and require no email address or account.</p>

    <p><strong>To relay operators</strong> — where content is hosted on a third-party relay, users may also report it directly to that relay's operator under its own policies. Where possible, we forward reports to the relevant operator.</p>

    <p>Reports may be made by anyone, whether or not they use Zap Cooking, and whether or not they are the person depicted.</p>

    <p><strong>If a child is in immediate danger, contact local law enforcement first.</strong> In the United States you can also reach the NCMEC CyberTipline at <a href="https://report.cybertip.org" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">report.cybertip.org</a> or 1-800-843-5678.</p>

    <!-- Section 7 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">7. How we respond</h2>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>Acknowledgement and triage within 24 hours of receipt.</strong> CSAE reports take priority over every other category of report we receive.</li>
      <li><strong>On confirmation:</strong> immediate removal from all surfaces we control, permanent block of the responsible key from Pantry and our clients, and deletion requests issued to third-party relays where the content appears.</li>
      <li><strong>Preservation:</strong> we preserve relevant records as required by law and do not delete evidence prior to reporting.</li>
      <li><strong>Reporting:</strong> confirmed CSAM is reported to the National Center for Missing &amp; Exploited Children (NCMEC), and to law enforcement where circumstances warrant.</li>
      <li><strong>No appeal</strong> for CSAM determinations. Other enforcement decisions may be appealed to the contact below.</li>
    </ul>

    <!-- Section 8 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">8. What we ask of users</h2>

    <p>If you encounter content or conduct covered by these standards:</p>

    <ol class="list-decimal pl-6 space-y-2">
      <li><strong>Report it</strong> using the in-app report control or by emailing <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a></li>
      <li><strong>Block the account</strong> so it is removed from your view immediately</li>
      <li><strong>Report it directly to NCMEC</strong> at <a href="https://report.cybertip.org" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">report.cybertip.org</a>, or to local law enforcement — you do not need to wait for us, and you should not</li>
    </ol>

    <p><strong>Do not download, save, forward, or share the material, including to show it to us.</strong> Describe what you saw and where. Possession creates legal exposure for you.</p>

    <p>By using Zap Cooking you agree not to create, publish, request, or seek access to CSAM, or to engage in any form of CSAE.</p>

    <!-- Section 9 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">9. Age and audience</h2>

    <p>Zap Cooking is intended for users aged 13 and older. It is not designed for, marketed to, or targeted at children under 13. Users under 13 are not permitted to use the Service, and we do not knowingly collect information from them.</p>

    <p>Users aged 13 to 17 represent that a parent or legal guardian has reviewed and agreed to our <a href="/terms" class="text-primary hover:underline">Terms of Service</a> on their behalf and has authorized their use of the Service.</p>

    <p><strong>The Zap Cooking Market is restricted to users 18 and older</strong>, including creating listings, purchasing goods, and communicating with other users for the purpose of a transaction. The Market may not be used to facilitate any interaction, solicitation, or transaction involving a minor. Promoted and boosted listings are subject to these same standards.</p>

    <!-- Section 10 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">10. Point of contact</h2>

    <p>
      Seth Sager, Founder and Safety Lead<br />
      Zap Cooking LLC<br />
      <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a>
    </p>

    <p>This is a monitored address and the designated point of contact for child safety matters, including inquiries from Google Play, NCMEC, and law enforcement.</p>

    <!-- Section 11 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">11. Legal compliance and transparency</h2>

    <p>We comply with applicable law in the jurisdictions where we operate, including U.S. federal reporting obligations for providers of electronic communication services under 18 U.S.C. § 2258A, COPPA, and the GDPR where it applies.</p>

    <p>Our practices are informed by the Tech Coalition's developer good practices for combating online child sexual exploitation and abuse.</p>

    <p>The Zap Cooking clients are open source — github.com/zapcooking/zap_cooking_android and github.com/zapcooking/frontend. The safety mechanisms, reporting features, and content controls described here can be verified in the source.</p>

    <!-- Section 12 -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">12. Review</h2>

    <p>These standards are reviewed at least every six months, and immediately following any material change to our product, our moderation capability, or applicable law.</p>

    <hr style="border-color: var(--color-input-border)" />

    <p><em>Zap Cooking LLC · Tyrone, Pennsylvania, United States</em></p>
  </div>
</article>
