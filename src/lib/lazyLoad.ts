/** Svelte action: lazy-load a background image via IntersectionObserver */
export function lazyLoad(node: HTMLElement, params: { url: string }) {
  let currentUrl = params.url;

  function loadImage(url: string) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      node.style.backgroundImage = `url('${url}')`;
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
        loadImage(currentUrl);
      }
    },
    destroy() {
      observer.disconnect();
    }
  };
}
