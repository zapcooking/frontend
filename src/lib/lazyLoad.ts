/** Svelte action: lazy-load a background image via IntersectionObserver */
export function lazyLoad(node: HTMLElement, params: { url: string }) {
  let currentUrl = params.url;

  function loadImage(url: string) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      node.style.backgroundImage = `url("${url}")`;
      node.classList.add('image-loaded');
      node.classList.remove('image-error');
    };
    img.onerror = () => {
      // Ensure the element does not remain in a "loading" state on error.
      // Add a specific error class so callers can provide a visual fallback.
      node.classList.add('image-error');
      node.classList.add('image-loaded');
    };
    img.src = url;
  }

  // Fallback: load immediately if IntersectionObserver is unavailable
  if (typeof IntersectionObserver === 'undefined') {
    loadImage(currentUrl);
    return { update(p: { url: string }) { loadImage(p.url); }, destroy() {} };
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
    update(newParams: { url: string }) {
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
