import { describe, expect, it } from 'vitest';
import { pickThumb, thumbCandidates } from './thumb';

const THUMB = 'https://cdn.example.com/small.jpg';
const IMAGE = 'https://cdn.example.com/big.jpg';

describe('thumbCandidates', () => {
  it('prefers the thumb, then the image, without duplicates', () => {
    expect(thumbCandidates({ thumb: THUMB, image: IMAGE })).toEqual([THUMB, IMAGE]);
    expect(thumbCandidates({ thumb: IMAGE, image: IMAGE })).toEqual([IMAGE]);
  });

  it('drops empty and known-broken URLs', () => {
    expect(thumbCandidates({ thumb: null, image: '' })).toEqual([]);
    expect(thumbCandidates({ thumb: 'https://host.example/Ooops/404.png', image: IMAGE })).toEqual([IMAGE]);
  });
});

describe('pickThumb', () => {
  it('uses the thumb while nothing has failed', () => {
    expect(pickThumb({ thumb: THUMB, image: IMAGE }, new Set())).toEqual({ url: THUMB, broken: false });
  });

  it('falls back to the full image when the thumb fails', () => {
    expect(pickThumb({ thumb: THUMB, image: IMAGE }, new Set([THUMB]))).toEqual({ url: IMAGE, broken: false });
  });

  it('reports broken once every candidate has failed', () => {
    expect(pickThumb({ thumb: THUMB, image: IMAGE }, new Set([THUMB, IMAGE]))).toEqual({ url: null, broken: true });
    expect(pickThumb({ image: IMAGE }, new Set([IMAGE]))).toEqual({ url: null, broken: true });
  });

  it('is not broken when the announcement never had an image', () => {
    expect(pickThumb({ thumb: null, image: null }, new Set())).toEqual({ url: null, broken: false });
  });
});
