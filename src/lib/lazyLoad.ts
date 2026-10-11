import { isNostrBuildDeadUrl, isNostrBuildImageUrl } from './placeholderImages';

export interface LazyLoadParams {
  url: string;
  /** Called when the image fails to load, or turns out to be a host's
   *  error art rather than a real image (nostr.build 404 substitution). */
  onError?: () => void;
}

/** Svelte action: lazy-load a background image via IntersectionObserver */
export function lazyLoad(node: HTMLElement, params: LazyLoadParams) {
  let currentUrl = params.url;
  let currentOnError = params.onError;

  function signalError() {
    // Ensure the element does not remain in a "loading" state on error.
    // Add a specific error class so callers can provide a visual fallback.
    node.classList.add('image-error');
    node.classList.add('image-loaded');
    currentOnError?.();
  }

  /**
   * nostr.build serves dead uploads (deleted or purged files) by redirecting
   * to its CDN's "404 image not found" artwork with HTTP 200 — an <img> load
   * succeeds and the error art renders as if it were the photo. Both redirect
   * hops carry CORS headers, so a HEAD fetch can follow them and expose
   * response.url. If it landed on the 404 art, undo the load and treat the
   * image as broken. Best-effort: a blocked or failed HEAD never breaks the
   * normal display path.
   */
  function verifyNostrBuildImage(url: string) {
    fetch(url, { method: 'HEAD', mode: 'cors' })
      .then((res) => {
        // The card may have moved on to a different image while the check
        // was in flight — drop stale results.
        if (url !== currentUrl) return;
        if (isNostrBuildDeadUrl(res.url)) {
          node.style.backgroundImage = '';
          signalError();
        }
      })
      .catch(() => {
        // Verification unavailable (CORS change, network) — keep the image.
      });
  }

  function loadImage(url: string) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      node.style.backgroundImage = `url("${url}")`;
      node.classList.add('image-loaded');
      node.classList.remove('image-error');
      if (isNostrBuildImageUrl(url)) verifyNostrBuildImage(url);
    };
    img.onerror = () => {
      signalError();
    };
    img.src = url;
  }

  // Fallback: load immediately if IntersectionObserver is unavailable
  if (typeof IntersectionObserver === 'undefined') {
    loadImage(currentUrl);
    return {
      update(p: LazyLoadParams) {
        currentOnError = p.onError;
        // Track the swap like the observed branch does — the nostr.build
        // dead-file check compares results against currentUrl, so a stale
        // value here would silently disable detection after an update.
        currentUrl = p.url;
        loadImage(p.url);
      },
      destroy() {}
    };
  }

  const scrollRoot = document.getElementById('app-scroll') || null;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadImage(currentUrl);
          observer.unobserve(node);
        }
      }
    },
    { root: scrollRoot, rootMargin: '200px' }
  );

  observer.observe(node);

  return {
    update(newParams: LazyLoadParams) {
      currentOnError = newParams.onError;
      if (newParams.url !== currentUrl) {
        currentUrl = newParams.url;
        node.classList.remove('image-loaded');
        node.style.backgroundImage = '';
        // Restart observation so the new image is lazy-loaded when the node enters the viewport
        observer.unobserve(node);
        observer.observe(node);
      }
    },
    destroy() {
      observer.disconnect();
    }
  };
}
