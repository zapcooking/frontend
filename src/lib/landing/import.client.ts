/** Mount the existing URL-import enhancement after hydration, once per form. */
export function enhanceLandingImport(
  form: HTMLFormElement,
  environment: Pick<Window, 'sessionStorage' | 'fetch' | 'location'> = window
): () => void {
  const input = form.querySelector<HTMLInputElement>('input');
  const button = form.querySelector<HTMLButtonElement>('button');
  const status = form.querySelector<HTMLElement>('[role="status"]');
  if (!input || !button || !status) return () => {};
  const errors = JSON.parse(form.dataset.errors || '{}') as Record<string, string>;
  const inputKey = form.dataset.inputKey!;
  const handoffKey = form.dataset.handoffKey!;
  const request = new AbortController();
  let busy = false;
  let disposed = false;
  try {
    input.value = environment.sessionStorage.getItem(inputKey) || '';
  } catch {
    /* Input remains usable. */
  }
  button.disabled = false;
  const rememberInput = () => {
    try {
      environment.sessionStorage.setItem(inputKey, input.value);
    } catch {
      /* Checked before import. */
    }
  };
  const submit = async (event: Event) => {
    event.preventDefault();
    if (disposed || busy || !form.reportValidity()) return;
    let url: URL;
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
      environment.sessionStorage.setItem(inputKey, url.href);
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
      const response = await environment.fetch('/api/extract-recipe/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href }),
        signal: request.signal
      });
      const data = await response.json();
      // Leaving the page must not stage a result or redirect a later page.
      if (disposed) return;
      if (!response.ok || !data.success || !data.recipe) {
        status.textContent =
          response.status === 429
            ? 'You have reached the free import limit. Please try again later; your link is still here.'
            : errors[data.code] || errors.INTERNAL;
        return;
      }
      try {
        environment.sessionStorage.setItem(
          handoffKey,
          JSON.stringify({ recipe: data.recipe, sourceUrl: url.href, at: Date.now() })
        );
      } catch {
        status.textContent =
          'Your recipe was read, but could not be kept in this tab. Allow browser storage and try again.';
        return;
      }
      environment.location.assign('/souschef');
    } catch {
      if (!disposed) status.textContent = errors.SOURCE_UNAVAILABLE;
    } finally {
      busy = false;
      if (!disposed) {
        button.disabled = false;
        button.textContent = 'Import a recipe free';
      }
    }
  };
  input.addEventListener('input', rememberInput);
  form.addEventListener('submit', submit);
  return () => {
    disposed = true;
    request.abort();
    input.removeEventListener('input', rememberInput);
    form.removeEventListener('submit', submit);
  };
}
