<svelte:head>
  <title>Child Safety Standards | Zap Cooking</title>
  <meta
    name="description"
    content="Zap Cooking's child safety policies, practices, and tools for protecting children across the Service."
  />
</svelte:head>

<article class="max-w-2xl mx-auto">
  <h1 class="text-3xl font-bold mb-8" style="color: var(--color-text-primary)">Child Safety Standards</h1>

  <div class="flex flex-col gap-6 leading-relaxed" style="color: var(--color-text-primary)">
    <p class="text-sm opacity-75">Last updated: March 13, 2026</p>

    <p>Zap Cooking LLC ("Zap Cooking," "we," "our," or "us") takes child safety seriously. This page describes our policies, practices, and tools related to the protection of children across the Service.</p>

    <p>Zap Cooking is a recipe and food community platform built on the Nostr protocol. The Service operates primarily as a client application that reads and publishes content to decentralized Nostr relays. We also operate community-managed relays and marketplace features. Regardless of architecture, we are committed to keeping our community safe for all users.</p>

    <!-- Our Position on CSAE -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Our Position on CSAE</h2>

    <p>Zap Cooking maintains an absolute zero-tolerance policy toward child sexual abuse and exploitation ("CSAE"). This includes, but is not limited to:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Child sexual abuse material ("CSAM") — any visual depiction involving a minor engaged in sexually explicit conduct</li>
      <li>Grooming — building a relationship with a minor for the purpose of sexual exploitation</li>
      <li>Sextortion of minors</li>
      <li>Trafficking of children for sexual purposes</li>
      <li>Any content or behavior that sexually exploits, abuses, or endangers children</li>
    </ul>

    <p>Any such content discovered on Zap Cooking-operated components will be removed immediately. Any account found to be distributing CSAM or engaging in CSAE will be permanently banned from all Zap Cooking-operated components. We will report such content and conduct to the appropriate authorities.</p>

    <!-- Age Requirements -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Age Requirements</h2>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">General Use</h3>

    <p>The Service is available to users aged 13 and older. Users under 13 are not permitted to use the Service. If you are between 13 and 17, your parent or legal guardian must review and agree to our <a href="/terms" class="text-primary hover:underline">Terms of Service</a> on your behalf.</p>

    <p>We reserve the right to use age-screening or age-verification measures and to restrict access to Zap Cooking-operated components if we believe a user does not meet the applicable age requirement.</p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">The Market</h3>

    <p>The Market (our marketplace feature) is restricted to users aged 18 and older. Users under 18 may not create listings, purchase goods, or communicate with other users for the purpose of a transaction. The Market involves peer-to-peer commercial transactions and Lightning/Bitcoin payments that are designed for adult users.</p>

    <h3 class="text-xl font-semibold mt-4 mb-2" style="color: var(--color-text-primary)">Age-Appropriate Experience</h3>

    <p>Zap Cooking is a food and recipe community. While the platform is available to users 13 and older, we are mindful that younger users may be present. We expect all users to keep interactions appropriate and to refrain from publishing content that is harmful, exploitative, or inappropriate for a community that includes minors.</p>

    <!-- Architecture -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">How Our Architecture Works</h2>

    <p>Understanding our architecture is important context for this policy:</p>

    <p><strong>Zap Cooking as a client.</strong> The zap.cooking web and mobile applications are Nostr clients. They display content published to relays by users across the Nostr network. The majority of content users see is stored on relays operated by independent third parties, each with their own moderation policies.</p>

    <p><strong>Zap Cooking-operated components.</strong> We operate and control certain components of the Service, including the zap.cooking client interface, The Market listing surface, and community-managed relays. Within these components, we have the ability to moderate content, remove listings, restrict access, and take enforcement action.</p>

    <p><strong>Community-managed relays.</strong> We operate two relays as a service to the zap.cooking community:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li><strong>The Garden</strong> (garden.zap.cooking) — a community relay running Pyramid software, with community-driven moderation in coordination with Zap Cooking.</li>
      <li><strong>The Pantry</strong> (pantry.zap.cooking) — a NIP-29 group relay for public group chats, moderated by group administrators and Zap Cooking.</li>
    </ul>

    <p>For content on our relays and within Zap Cooking-operated components, we accept direct responsibility for moderation and will act promptly on any reports of CSAE content. For content on third-party relays, our role is to provide tools that help users report harmful content to those relay operators.</p>

    <!-- Moderation -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Moderation on Zap Cooking-Operated Components</h2>

    <p>Within Zap Cooking-operated components — including our relays, the client interface, The Market, and promotional features — we implement the following:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Active moderation by community moderators and Zap Cooking administrators</li>
      <li>Immediate removal of any CSAE content upon discovery or report</li>
      <li>Permanent banning of accounts found to be distributing CSAM or engaging in CSAE from all Zap Cooking-operated components</li>
      <li>Removal of marketplace listings, sponsored placements, or boosted content that violate child safety standards</li>
      <li>Cooperation with law enforcement, NCMEC, and other authorities as required by law</li>
      <li>Support for community-maintained block lists and content labels published via the Nostr protocol</li>
    </ul>

    <p>Because content may also exist on third-party relays and decentralized infrastructure beyond our control, actions taken within Zap Cooking-operated components may not result in removal of content from the broader Nostr network.</p>

    <!-- Reporting -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Reporting Harmful Content</h2>

    <p>If you encounter CSAM, CSAE, or any content that endangers children while using zap.cooking, please take the following steps:</p>

    <ol class="list-decimal pl-6 space-y-2">
      <li><strong>Report to us.</strong> Use the in-app reporting tools to flag content, or email us directly at <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a>. For content on The Garden or The Pantry, reports come directly to our moderation team. For content on third-party relays, we will direct the report to the appropriate relay operator where possible.</li>
      <li><strong>Mute or block.</strong> Immediately mute or block the offending account to remove the content from your view.</li>
      <li><strong>Report to relay operators.</strong> If the content is hosted on a third-party relay, use available tools to report it to that relay's operator.</li>
      <li><strong>Report to authorities.</strong> We strongly encourage reporting CSAM or CSAE content to the <a href="https://report.cybertipline.org/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">NCMEC CyberTipline</a> and your local law enforcement.</li>
    </ol>

    <!-- Client-Side Protections -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Client-Side Protections</h2>

    <p>On the client side, zap.cooking provides tools to help users manage their experience:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>User-driven muting and blocking to remove harmful content and accounts from view</li>
      <li>Reporting workflows that direct reports to relay operators and to Zap Cooking for content within our components</li>
      <li>Support for Nostr content labels and community-maintained block lists</li>
      <li>Feed customization and filtering tools</li>
    </ul>

    <!-- The Market -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">The Market and Child Safety</h2>

    <p>The Market is restricted to users aged 18 and older. In addition to the age restriction:</p>

    <ul class="list-disc pl-6 space-y-2">
      <li>Listings involving products marketed toward children (such as children's cookware or lunchbox items) must comply with all applicable product safety laws and regulations. Zap Cooking does not verify product safety compliance — sellers are solely responsible.</li>
      <li>The Market may not be used to facilitate any interaction with, solicitation of, or transaction involving a minor.</li>
      <li>Promoted or boosted marketplace listings are subject to the same child safety standards as all other content.</li>
    </ul>

    <!-- User Responsibility -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">User Responsibility</h2>

    <p>All users of zap.cooking must comply with applicable laws regarding child safety. By using the Service, you agree that you will not use the platform to create, distribute, solicit, or access CSAM or engage in any form of CSAE.</p>

    <p>Users who encounter such content should:</p>

    <ol class="list-decimal pl-6 space-y-2">
      <li>Use the in-app report function or email <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a></li>
      <li>Mute or block the offending account</li>
      <li>Report to the <a href="https://report.cybertipline.org/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">NCMEC CyberTipline</a> or local law enforcement</li>
    </ol>

    <!-- Compliance -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Compliance with Law</h2>

    <p>Zap Cooking LLC is committed to complying with all applicable child safety laws. Our practices are informed by the Tech Coalition's best practices for combating online child sexual exploitation and abuse. Should we obtain actual knowledge of CSAM through our relays, reporting channels, or any Zap Cooking-operated component, we will report it to NCMEC and relevant authorities in accordance with U.S. federal law (18 U.S.C. &sect; 2258A).</p>

    <!-- Contact -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Contact</h2>

    <p>For child safety concerns or inquiries related to zap.cooking:</p>

    <ul class="list-none pl-0 space-y-2">
      <li>Email: <a href="mailto:support@zap.cooking" class="text-primary hover:underline">support@zap.cooking</a></li>
    </ul>

    <p>For immediate concerns regarding a child's safety, please contact the <a href="https://report.cybertipline.org/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">NCMEC CyberTipline</a> or your local law enforcement directly.</p>

    <!-- Open Source -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Open Source Transparency</h2>

    <p>zap.cooking is built on open-source principles. Client-side safety mechanisms, reporting features, and moderation tools are available for review in our public repositories.</p>

    <!-- Updates -->
    <h2 class="text-2xl font-bold mt-8 mb-4" style="color: var(--color-text-primary)">Updates</h2>

    <p>This policy may be updated to reflect improvements in our safety practices, changes to our infrastructure, or changes in legal requirements. Updates will be posted on this page with a revised date.</p>
  </div>
</article>
