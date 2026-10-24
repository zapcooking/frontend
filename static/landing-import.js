/* Isolated enhancement for the server-rendered landing page. No app runtime. */
(() => {
  const form = document.querySelector('[data-landing-import]');
  if (!form) return;
  const input = form.querySelector('input');
  const button = form.querySelector('button');
  const status = form.querySelector('[role="status"]');
  const errors = JSON.parse(form.dataset.errors);
  let busy = false;
  try {
    input.value = sessionStorage.getItem(form.dataset.inputKey) || '';
  } catch {
    /* Input remains usable. */
  }
  button.disabled = false;
  input.addEventListener('input', () => {
    try {
      sessionStorage.setItem(form.dataset.inputKey, input.value);
    } catch {
      /* Checked before import. */
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    let url;
    try {
      url = new URL(input.value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error();
      url.hash = '';
    } catch {
      status.textContent = errors.INVALID_URL;
      return;
    }
    try {
      sessionStorage.setItem(form.dataset.inputKey, url.href);
    } catch {
      status.textContent =
        'Allow storage for this tab so your recipe can stay with you while you review it.';
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = 'Importing…';
    status.textContent = 'Reading your recipe. This can take a moment.';
    try {
      const response = await fetch('/api/extract-recipe/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.recipe) {
        status.textContent =
          response.status === 429
            ? 'You have reached the free import limit. Please try again later; your link is still here.'
            : errors[data.code] || errors.INTERNAL;
        return;
      }
      try {
        sessionStorage.setItem(
          form.dataset.handoffKey,
          JSON.stringify({ recipe: data.recipe, sourceUrl: url.href, at: Date.now() })
        );
      } catch {
        status.textContent =
          'Your recipe was read, but could not be kept in this tab. Allow browser storage and try again.';
        return;
      }
      window.location.assign('/souschef');
    } catch {
      status.textContent = errors.SOURCE_UNAVAILABLE;
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'Import a recipe free';
    }
  });
})();
