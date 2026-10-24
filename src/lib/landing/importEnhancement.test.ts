import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { EXTRACT_ERROR_FALLBACK } from '../extractErrors';

const script = readFileSync('static/landing-import.js', 'utf8');
function setup(response: unknown, ok = true, statusCode = 200) {
  const listeners: Record<string, (e: { preventDefault(): void }) => Promise<void>> = {};
  const storage = new Map<string, string>();
  const input = { value: '', addEventListener: vi.fn() };
  const button = { disabled: true, textContent: '' };
  const status = { textContent: '' };
  const form = {
    dataset: {
      errors: JSON.stringify(EXTRACT_ERROR_FALLBACK),
      handoffKey: 'handoff',
      inputKey: 'input'
    },
    querySelector: (q: string) => (q === 'input' ? input : q === 'button' ? button : status),
    addEventListener: (name: string, fn: (typeof listeners)[string]) => {
      listeners[name] = fn;
    },
    reportValidity: () => true
  };
  const fetch = vi.fn().mockResolvedValue({ ok, status: statusCode, json: async () => response });
  const assign = vi.fn();
  runInNewContext(script, {
    document: { querySelector: () => form },
    sessionStorage: {
      getItem: (k: string) => storage.get(k),
      setItem: (k: string, v: string) => storage.set(k, v)
    },
    URL,
    Date,
    fetch,
    window: { location: { assign } }
  });
  input.value = 'https://recipes.example/soup';
  return {
    input,
    button,
    status,
    storage,
    fetch,
    assign,
    submit: () => listeners.submit({ preventDefault() {} })
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
});
