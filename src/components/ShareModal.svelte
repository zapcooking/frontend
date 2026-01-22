<script lang="ts">
  import { browser } from '$app/environment';
  import Modal from './Modal.svelte';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import DownloadIcon from 'phosphor-svelte/lib/Download';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import FacebookLogo from 'phosphor-svelte/lib/FacebookLogo';
  import LinkedinLogo from 'phosphor-svelte/lib/LinkedinLogo';
  import RedditLogo from 'phosphor-svelte/lib/RedditLogo';
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
  export let imageBlob: Blob | null = null;
  export let imageName: string = 'zap-cooking-note.png';
  export let isGeneratingImage: boolean = false;
  export let onGenerateImage: (() => Promise<void>) | null = null;

  let copied = false;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let showNativeShare = false;
  let imagePreviewUrl: string | null = null;

  // Create preview URL when blob changes
  $: if (imageBlob && browser) {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = URL.createObjectURL(imageBlob);
  }

  // Cleanup preview URL
  $: if (!open && imagePreviewUrl) {
    URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
  }

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
    
    // If we have an image blob, try to share it with the link
    if (imageBlob) {
      try {
        const file = new File([imageBlob], imageName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title,
            text: `Found on zap.cooking ⚡\n${url}`,
          });
          return;
        }
      } catch (err) {
        console.warn('Failed to share with image:', err);
      }
    }
    
    // Fall back to sharing just the URL
    const success = await nativeShare({
      title,
      text: 'Found on zap.cooking ⚡',
      url
    });
    
    // If native share failed/cancelled, fall back to copy
    if (!success) {
      await handleCopy();
    }
  }

  async function handleDownloadImage() {
    if (!browser || !imageBlob) return;
    
    const url = URL.createObjectURL(imageBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = imageName;
    a.style.display = 'none';
    document.body.appendChild(a);
    
    // Safari needs a slight delay and different handling
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    if (isSafari) {
      // For Safari, open in new tab - user can save from there
      window.open(url, '_blank');
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } else {
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
  }

  async function copyImageToClipboard() {
    if (!browser || !imageBlob) return false;
    
    try {
      // Try to copy the image to clipboard
      const item = new ClipboardItem({ 'image/png': imageBlob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      console.warn('Failed to copy image to clipboard:', err);
      // Fall back to downloading
      handleDownloadImage();
      return false;
    }
  }

  async function handleGenerateImage() {
    if (onGenerateImage) {
      await onGenerateImage();
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
  $: whatsappShareUrl = socialShareUrls.whatsapp(url, title);
  $: telegramShareUrl = socialShareUrls.telegram(url, title);

  // Download image and open platform share dialog
  async function shareToplatform(shareUrl: string) {
    if (!browser) return;
    
    // Download the image first so user can attach it
    if (imageBlob) {
      await handleDownloadImage();
    }
    
    // Open the platform's share dialog
    window.open(shareUrl, '_blank', 'noopener,noreferrer,width=600,height=500');
  }
</script>

<Modal {open} cleanup={handleClose}>
  <div slot="title">Share</div>
  
  <div class="flex flex-col gap-4">
    <!-- Generate Image Button (shown first when no image yet) -->
    {#if onGenerateImage && !imageBlob}
      <button
        on:click={handleGenerateImage}
        disabled={isGeneratingImage}
        class="w-full py-2.5 px-4 rounded-lg font-semibold transition duration-200 flex items-center justify-center gap-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white disabled:opacity-50"
        aria-label="Generate share image"
      >
        {#if isGeneratingImage}
          <div class="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          <span>Generating image...</span>
        {:else}
          <ImageIcon size={18} weight="bold" />
          <span>Generate Share Image</span>
        {/if}
      </button>
      <div class="border-t" style="border-color: var(--color-input-border);"></div>
    {/if}

    <!-- Image Share Section (compact layout) -->
    {#if imageBlob && imagePreviewUrl}
      <div class="flex gap-3 items-start">
        <!-- Small image preview -->
        <div class="relative rounded-lg overflow-hidden bg-black/20 flex-shrink-0" style="width: 72px; height: 72px;">
          <img 
            src={imagePreviewUrl} 
            alt="Share preview" 
            class="w-full h-full object-cover"
          />
        </div>
        
        <!-- Share buttons grid -->
        <div class="flex-1 min-w-0">
          <p class="text-xs mb-2" style="color: var(--color-text-secondary);">Share image to:</p>
          <div class="grid grid-cols-6 gap-1.5">
            {#if showNativeShare}
              <button
                on:click={handleNativeShare}
                class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary hover:opacity-80 text-white transition"
                title="More apps"
              >
                <ShareIcon size={18} weight="bold" />
              </button>
            {/if}
            <button on:click={() => shareToplatform(xShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-black dark:bg-white hover:opacity-80 text-white dark:text-black transition" title="X">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </button>
            <button on:click={() => shareToplatform(facebookShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#1877F2] hover:opacity-80 text-white transition" title="Facebook">
              <FacebookLogo size={18} weight="fill" />
            </button>
            <button on:click={async () => { await copyImageToClipboard(); if (browser) { alert('Image copied! Paste in Instagram.'); window.open('https://instagram.com', '_blank'); }}} class="flex items-center justify-center w-9 h-9 rounded-lg hover:opacity-80 text-white transition" style="background: linear-gradient(45deg, #f09433, #dc2743, #bc1888);" title="Instagram">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
            </button>
            <button on:click={() => shareToplatform(blueskyShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#1185FE] hover:opacity-80 text-white transition" title="Bluesky">
              <svg width="18" height="18" viewBox="0 0 600 530" fill="currentColor"><path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/></svg>
            </button>
            <button on:click={() => shareToplatform(whatsappShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#25D366] hover:opacity-80 text-white transition" title="WhatsApp">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </button>
            <button on:click={() => shareToplatform(telegramShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#0088cc] hover:opacity-80 text-white transition" title="Telegram">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            </button>
            <button on:click={() => shareToplatform(linkedinShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#0A66C2] hover:opacity-80 text-white transition" title="LinkedIn">
              <LinkedinLogo size={18} weight="fill" />
            </button>
            <button on:click={() => shareToplatform(redditShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#FF4500] hover:opacity-80 text-white transition" title="Reddit">
              <RedditLogo size={18} weight="fill" />
            </button>
            <button on:click={() => shareToplatform(pinterestShareUrl)} class="flex items-center justify-center w-9 h-9 rounded-lg bg-[#E60023] hover:opacity-80 text-white transition" title="Pinterest">
              <PinterestLogo size={18} weight="fill" />
            </button>
            <button on:click={handleDownloadImage} class="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-600 hover:opacity-80 text-white transition" title="Download">
              <DownloadIcon size={18} weight="bold" />
            </button>
          </div>
        </div>
      </div>
      <div class="border-t" style="border-color: var(--color-input-border);"></div>
    {/if}
    
    <!-- URL Display -->
    <div class="flex flex-col gap-2">
      <p class="text-sm font-medium" style="color: var(--color-text-primary);">Share Link</p>
      <input
        type="text"
        readonly
        value={displayUrl}
        class="w-full input font-mono text-sm px-3 py-2 rounded-lg"
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
            class="flex-1 py-2.5 px-4 rounded-lg font-semibold transition duration-200 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white"
            aria-label="Share"
          >
            <ShareIcon size={18} weight="bold" />
            <span>Share</span>
          </button>
        {/if}
        
        <button
          on:click={handleCopy}
          class="flex-1 py-2.5 px-4 rounded-lg font-semibold transition duration-200 flex items-center justify-center gap-2
            {copied
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : showNativeShare 
                ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white'
                : 'bg-primary hover:bg-primary/90 text-white'}"
          aria-label={copied ? 'Copied' : 'Copy link'}
        >
          {#if copied}
            <CheckIcon size={18} weight="bold" />
            <span>Copied</span>
          {:else}
            <CopyIcon size={18} weight="bold" />
            <span>Copy</span>
          {/if}
        </button>
      </div>
    </div>
    
    <!-- Social Share (Link only) -->
    <div class="flex flex-col gap-2">
      <p class="text-xs" style="color: var(--color-text-secondary);">Share link on:</p>
      <div class="flex gap-2 flex-wrap">
        <a href={xShareUrl} target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-10 h-10 rounded-xl bg-black dark:bg-white hover:opacity-80 text-white dark:text-black transition" title="X">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a href={facebookShareUrl} target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#1877F2] hover:opacity-80 text-white transition" title="Facebook">
          <FacebookLogo size={20} weight="fill" />
        </a>
        <a href={linkedinShareUrl} target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0A66C2] hover:opacity-80 text-white transition" title="LinkedIn">
          <LinkedinLogo size={20} weight="fill" />
        </a>
        <a href={redditShareUrl} target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#FF4500] hover:opacity-80 text-white transition" title="Reddit">
          <RedditLogo size={20} weight="fill" />
        </a>
        <a href={blueskyShareUrl} target="_blank" rel="noopener noreferrer" class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#1185FE] hover:opacity-80 text-white transition" title="Bluesky">
          <svg width="20" height="20" viewBox="0 0 600 530" fill="currentColor"><path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/></svg>
        </a>
        <a href={smsShareUrl} class="flex items-center justify-center w-10 h-10 rounded-xl bg-green-600 hover:opacity-80 text-white transition" title="Text">
          <ChatCircleText size={20} weight="fill" />
        </a>
      </div>
    </div>
  </div>
</Modal>
