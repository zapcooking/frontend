<script lang="ts">
  import { browser } from '$app/environment';
  import Modal from './Modal.svelte';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import FacebookLogo from 'phosphor-svelte/lib/FacebookLogo';
  import LinkedinLogo from 'phosphor-svelte/lib/LinkedinLogo';
  import RedditLogo from 'phosphor-svelte/lib/RedditLogo';
  import TiktokLogo from 'phosphor-svelte/lib/TiktokLogo';
  import PinterestLogo from 'phosphor-svelte/lib/PinterestLogo';
  import ChatCircleText from 'phosphor-svelte/lib/ChatCircleText';
  import {
    copyToClipboard,
    canUseNativeShare,
    nativeShare,
    buildRichShareText,
    socialShareUrls
  } from '$lib/utils/share';

  export let open = false;
  export let url = '';
  export let title = 'Recipe';
  export let imageUrl = '';

  let copied = false;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let showNativeShare = false;

  // Convert localhost URLs to production for display and sharing
  const SITE_URL = 'https://zap.cooking';
  $: displayUrl = url.includes('localhost')
    ? url.replace(/https?:\/\/localhost:\d+/, SITE_URL)
    : url;

  // Check for native share support on mount
  $: if (browser) {
    showNativeShare = canUseNativeShare();
  }

  async function handleCopy() {
    if (!browser || !url) return;
    
    // Copy rich text format
    const richText = buildRichShareText(title, url);
    const success = await copyToClipboard(richText);
    
    if (success) {
      copied = true;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 2000);
    }
  }

  async function handleNativeShare() {
    if (!browser || !url) return;
    
    const success = await nativeShare({
      title,
      text: 'Shared on Zap Cooking',
      url
    });
    
    // If native share failed/cancelled, fall back to copy
    if (!success) {
      await handleCopy();
    }
  }

  function handleClose() {
    open = false;
    copied = false;
    if (copyTimeout) {
      clearTimeout(copyTimeout);
      copyTimeout = null;
    }
  }

  function handleInputFocus(e: FocusEvent) {
    const target = e.currentTarget as HTMLInputElement;
    target?.select();
  }

  function handleInputClick(e: MouseEvent) {
    const target = e.currentTarget as HTMLInputElement;
    target?.select();
  }

  function openShareWindow(shareUrl: string) {
    if (browser) {
      window.open(shareUrl, '_blank', 'noopener,noreferrer,width=600,height=500');
    }
  }

  // Social share URLs using the utility
  $: xShareUrl = socialShareUrls.x(url, title);
  $: facebookShareUrl = socialShareUrls.facebook(url);
  $: linkedinShareUrl = socialShareUrls.linkedin(url);
  $: redditShareUrl = socialShareUrls.reddit(url, title);
  $: pinterestShareUrl = socialShareUrls.pinterest(url, title, imageUrl);
  $: blueskyShareUrl = socialShareUrls.bluesky(url, title);
  $: smsShareUrl = socialShareUrls.sms(url, title);
</script>

<Modal {open} cleanup={handleClose}>
  <div slot="title">Share this recipe</div>
  
  <div class="flex flex-col gap-5">
    <p class="text-sm" style="color: var(--color-text-secondary);">
      Copy a clean link or share to a platform.
    </p>
    
    <!-- URL Display -->
    <div class="flex flex-col gap-3">
      <input
        type="text"
        readonly
        value={displayUrl}
        class="w-full input font-mono text-sm px-3 py-2.5 rounded-lg"
        style="background-color: var(--color-input); border: 1px solid var(--color-input-border);"
        on:focus={handleInputFocus}
        on:click={handleInputClick}
        aria-label="Share URL"
      />
      
      <!-- Primary Actions -->
      <div class="flex gap-2">
        {#if showNativeShare}
          <button
            on:click={handleNativeShare}
            class="flex-1 py-3 px-4 rounded-lg font-semibold transition duration-200 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white"
            aria-label="Share recipe"
          >
            <ShareIcon size={20} weight="bold" />
            <span>Share…</span>
          </button>
        {/if}
        
        <button
          on:click={handleCopy}
          class="flex-1 py-3 px-4 rounded-lg font-semibold transition duration-200 flex items-center justify-center gap-2
            {copied
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : showNativeShare 
                ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white'
                : 'bg-primary hover:bg-primary/90 text-white'}"
          aria-label={copied ? 'Link copied' : 'Copy link'}
        >
          {#if copied}
            <CheckIcon size={20} weight="bold" />
            <span>Copied</span>
          {:else}
            <CopyIcon size={20} weight="bold" />
            <span>Copy Link</span>
          {/if}
        </button>
      </div>
    </div>
    
    <!-- Social Share -->
    <div class="flex flex-col gap-3 pt-1">
      <p class="text-sm font-medium" style="color: var(--color-text-primary);">
        Share on:
      </p>
      <div class="flex gap-3 flex-wrap">
        <!-- X (Twitter) -->
        <a
          href={xShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-black dark:bg-white hover:opacity-80 text-white dark:text-black transition duration-200"
          aria-label="Share on X"
          title="Share on X"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
        
        <!-- Facebook -->
        <a
          href={facebookShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-[#1877F2] hover:opacity-80 text-white transition duration-200"
          aria-label="Share on Facebook"
          title="Share on Facebook"
        >
          <FacebookLogo size={24} weight="fill" />
        </a>
        
        <!-- LinkedIn -->
        <a
          href={linkedinShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-[#0A66C2] hover:opacity-80 text-white transition duration-200"
          aria-label="Share on LinkedIn"
          title="Share on LinkedIn"
        >
          <LinkedinLogo size={24} weight="fill" />
        </a>
        
        <!-- Reddit -->
        <a
          href={redditShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-[#FF4500] hover:opacity-80 text-white transition duration-200"
          aria-label="Share on Reddit"
          title="Share on Reddit"
        >
          <RedditLogo size={24} weight="fill" />
        </a>
        
        <!-- TikTok -->
        <button
          on:click={async () => {
            await handleCopy();
            if (browser) {
              window.open(socialShareUrls.tiktok(), '_blank', 'noopener,noreferrer');
            }
          }}
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-black hover:opacity-80 text-white transition duration-200"
          aria-label="Share on TikTok (copies link)"
          title="Share on TikTok (link copied)"
        >
          <TiktokLogo size={24} weight="fill" />
        </button>
        
        <!-- Pinterest -->
        <a
          href={pinterestShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-[#E60023] hover:opacity-80 text-white transition duration-200"
          aria-label="Share on Pinterest"
          title="Share on Pinterest"
        >
          <PinterestLogo size={24} weight="fill" />
        </a>
        
        <!-- Bluesky -->
        <a
          href={blueskyShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-[#1185FE] hover:opacity-80 text-white transition duration-200"
          aria-label="Share on Bluesky"
          title="Share on Bluesky"
        >
          <svg width="24" height="24" viewBox="0 0 600 530" fill="currentColor" aria-hidden="true">
            <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/>
          </svg>
        </a>
        
        <!-- SMS/Text Message -->
        <a
          href={smsShareUrl}
          class="flex items-center justify-center w-12 h-12 rounded-xl bg-green-600 hover:opacity-80 text-white transition duration-200"
          aria-label="Share via text message"
          title="Share via text message"
        >
          <ChatCircleText size={24} weight="fill" />
        </a>
      </div>
    </div>
  </div>
</Modal>
