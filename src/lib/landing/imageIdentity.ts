/** Resizing a photograph does not make it a different editorial image. */
export function imageIdentity(image: string): string {
  try {
    const url = new URL(image, 'https://zap.cooking');
    const cloudflare = url.pathname.match(/^\/cdn-cgi\/image\/[^/]+\/(.+)$/);
    if (cloudflare)
      return imageIdentity(cloudflare[1].startsWith('http') ? cloudflare[1] : `/${cloudflare[1]}`);
    for (const key of [
      'w',
      'h',
      'width',
      'height',
      'q',
      'quality',
      'format',
      'fit',
      'crop',
      'auto',
      'dpr'
    ])
      url.searchParams.delete(key);
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return image;
  }
}
