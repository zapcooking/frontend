import { describe, expect, it, vi } from 'vitest';
import { EXTRACT_ERROR_FALLBACK } from '../extractErrors';
import { enhanceLandingImport } from './import.client';

type Listener = (event: Event) => void | Promise<void>;
function eventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener: (name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    },
    emit: async (name: string) => {
      await Promise.all(
        [...(listeners.get(name) || [])].map((listener) => listener(new Event(name)))
      );
    }
  };
}
function setup(response: unknown, ok = true, statusCode = 200) {
  const storage = new Map<string, string>();
  const input = { value: '', ...eventTarget() };
  const button = { disabled: true, textContent: 'Import a recipe free' };
  const status = { textContent: '' };
  const form = {
    ...eventTarget(),
    dataset: {
      errors: JSON.stringify(EXTRACT_ERROR_FALLBACK),
      handoffKey: 'handoff',
      inputKey: 'input'
    },
    querySelector: (q: string) => (q === 'input' ? input : q === 'button' ? button : status),
    reportValidity: () => true
  };
  const fetch = vi.fn().mockResolvedValue({ ok, status: statusCode, json: async () => response });
  const assign = vi.fn();
  const environment = {
    sessionStorage: {
      getItem: (k: string) => storage.get(k),
      setItem: (k: string, v: string) => storage.set(k, v)
    },
    fetch,
    location: { assign }
  } as unknown as Parameters<typeof enhanceLandingImport>[1];
  const mount = () => enhanceLandingImport(form as unknown as HTMLFormElement, environment);
  const destroy = mount();
  input.value = 'https://recipes.example/soup';
  return {
    input,
    button,
    status,
    storage,
    fetch,
    assign,
    mount,
    destroy,
    submit: () => form.emit('submit')
  };
}
describe('landing URL import enhancement', () => {
  it('posts only to the public extractor, stages the result, and opens review without publishing', async () => {
    const recipe = { title: 'Soup' };
    const ui = setup({ success: true, recipe });
    await ui.submit();
    expect(ui.fetch).toHaveBeenCalledOnce();
    expect(ui.fetch.mock.calls[0][0]).toBe('/api/extract-recipe/public');
    expect(ui.fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ url: ui.input.value })
    });
    expect(JSON.parse(ui.storage.get('handoff')!)).toMatchObject({
      recipe,
      sourceUrl: ui.input.value
    });
    expect(ui.assign).toHaveBeenCalledWith('/souschef');
  });
  it('keeps the link and displays known error copy instead of a raw server exception', async () => {
    const ui = setup(
      { success: false, code: 'SOURCE_BLOCKED', error: 'secret upstream stack' },
      false,
      400
    );
    await ui.submit();
    expect(ui.status.textContent).toBe(EXTRACT_ERROR_FALLBACK.SOURCE_BLOCKED);
    expect(ui.storage.get('input')).toBe(ui.input.value);
    expect(ui.assign).not.toHaveBeenCalled();
    expect(ui.button.disabled).toBe(false);
  });
  it('handles rate limits and unknown errors without leaking raw text', async () => {
    const limited = setup({ error: 'rate_limited' }, false, 429);
    await limited.submit();
    expect(limited.status.textContent).toContain('free import limit');
    const failed = setup({ code: 'NEW_CODE', error: 'internal detail' }, false, 500);
    await failed.submit();
    expect(failed.status.textContent).toBe(EXTRACT_ERROR_FALLBACK.INTERNAL);
  });
  it('cleans up the old form and restores the saved URL on a fresh mount without duplicate handlers', async () => {
    const ui = setup({ success: false, code: 'SOURCE_UNAVAILABLE' }, false, 400);
    ui.input.value = 'https://recipes.example/saved';
    await ui.input.emit('input');
    ui.destroy();
    await ui.submit();
    expect(ui.fetch).not.toHaveBeenCalled();
    ui.input.value = '';
    const destroyAgain = ui.mount();
    expect(ui.input.value).toBe('https://recipes.example/saved');
    expect(ui.button.disabled).toBe(false);
    await ui.submit();
    expect(ui.fetch).toHaveBeenCalledOnce();
    destroyAgain();
  });

  it('aborts on navigation and ignores a late success without staging or redirecting', async () => {
    const ui = setup({ success: true, recipe: { title: 'Soup' } });
    let finish!: (response: unknown) => void;
    ui.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = ui.submit();
    const signal = ui.fetch.mock.calls[0][1].signal as AbortSignal;
    ui.destroy();
    expect(signal.aborted).toBe(true);
    // Model a response/body parser which finishes even after its signal is aborted.
    finish({ ok: true, json: async () => ({ success: true, recipe: { title: 'Soup' } }) });
    await pending;
    expect(ui.storage.has('handoff')).toBe(false);
    expect(ui.assign).not.toHaveBeenCalled();
  });
});
