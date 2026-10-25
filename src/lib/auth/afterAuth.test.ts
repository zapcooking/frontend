import { describe, it, expect } from 'vitest';
import { afterSignInTarget, afterSignupTarget } from './afterAuth';

const u = (path: string) => new URL(path, 'https://zap.cooking');
const FALLBACK = '/feed';

describe('afterSignInTarget', () => {
  it('stays put while a requireAuth request is pending', () => {
    expect(afterSignInTarget({ url: u('/recipe/x'), resumeInPlace: true, fallback: FALLBACK })).toBeNull();
  });

  it('follows an explicit redirect', () => {
    expect(
      afterSignInTarget({ url: u('/login?redirect=/drafts'), resumeInPlace: false, fallback: FALLBACK })
    ).toBe('/drafts');
  });

  it('leaves /login for the start section, and stays on any other page', () => {
    expect(afterSignInTarget({ url: u('/login'), resumeInPlace: false, fallback: FALLBACK })).toBe(FALLBACK);
    expect(afterSignInTarget({ url: u('/recipes'), resumeInPlace: false, fallback: FALLBACK })).toBeNull();
  });
});

describe('afterSignupTarget', () => {
  it('stays put while a requireAuth request is pending', () => {
    expect(
      afterSignupTarget({ url: u('/recipe/x?redirect=/drafts'), resumeInPlace: true, fallback: FALLBACK })
    ).toBeNull();
  });

  it('follows an explicit redirect, else the landing destination from any page', () => {
    expect(
      afterSignupTarget({ url: u('/login?redirect=/drafts'), resumeInPlace: false, fallback: FALLBACK })
    ).toBe('/drafts');
    expect(afterSignupTarget({ url: u('/recipes'), resumeInPlace: false, fallback: FALLBACK })).toBe(FALLBACK);
  });
});
