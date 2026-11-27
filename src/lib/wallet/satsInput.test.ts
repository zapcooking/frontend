import { describe, it, expect } from 'vitest';
import { sanitizeSatsInput, satsFromInput } from './satsInput';

describe('the Send amount field', () => {
  it('starts empty, so typing never lands behind a preset 0', () => {
    expect(sanitizeSatsInput('')).toBe('');
    expect(satsFromInput('')).toBe(0);
    expect(sanitizeSatsInput('0')).toBe('');
  });

  it('drops a leading zero typed in front of the amount ("01000" → 1000)', () => {
    expect(sanitizeSatsInput('01000')).toBe('1000');
    expect(satsFromInput('01000')).toBe(1000);
    expect(sanitizeSatsInput('0005000')).toBe('5000');
  });

  it('keeps digits only: no signs, decimals, separators or exponents', () => {
    expect(sanitizeSatsInput('5,000')).toBe('5000');
    expect(sanitizeSatsInput('-50')).toBe('50');
    expect(sanitizeSatsInput('1e3')).toBe('13');
    expect(sanitizeSatsInput('12.5')).toBe('125');
    expect(satsFromInput(' 5000 ')).toBe(5000);
  });
});
