/**
 * Read a request body with a hard byte cap, enforced WHILE reading.
 *
 * `request.arrayBuffer()` buffers the whole body before any length check
 * can run, so an unauthenticated chunked upload (no Content-Length) could
 * make the Worker hold far more than the cap. This reads the stream chunk
 * by chunk and cancels it the moment the total passes `maxBytes`.
 *
 * A declared Content-Length over the cap is refused without reading at all.
 *
 * Returns the bytes (possibly empty), or:
 *   'too_large'  the body is, or declares itself, larger than the cap
 *   'unreadable' the stream failed
 */
export async function readBodyCapped(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | 'too_large' | 'unreadable'> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try {
      await request.body?.cancel();
    } catch {
      /* nothing to release */
    }
    return 'too_large';
  }

  const stream = request.body;
  if (!stream) return new Uint8Array(0);

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        return 'too_large';
      }
      chunks.push(value);
    }
  } catch {
    return 'unreadable';
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
