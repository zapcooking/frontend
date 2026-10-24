/**
 * The signup photo is held on the device (a File + an object-URL preview)
 * and uploaded only after "Keep your account safe" succeeds, so an
 * abandoned signup sends nothing anywhere. The upload is NIP-98 signed with
 * the new account's own key — the global signer isn't involved.
 */
import type NDK from '@nostr-dev-kit/ndk';
import { bytesToHex } from '$lib/keyBackupGate';

export const SIGNUP_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_URL = 'https://nostr.build/api/v2/upload/files';

/** Why a picked file can't be the photo, or null when it can. */
export function signupPhotoProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file (such as JPG, PNG, GIF).';
  if (file.size > SIGNUP_PHOTO_MAX_BYTES) return 'Image must be less than 5MB.';
  return null;
}

/** Upload and return the hosted URL, or null on any failure. */
export async function uploadSignupPhoto(
  ndk: NDK,
  privateKey: Uint8Array,
  file: File
): Promise<string | null> {
  try {
    const { NDKEvent, NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');
    const signer = new NDKPrivateKeySigner(bytesToHex(privateKey));
    const auth = new NDKEvent(ndk);
    const now = Math.floor(Date.now() / 1000);
    auth.kind = 27235;
    auth.created_at = now;
    auth.content = '';
    auth.tags = [
      ['u', UPLOAD_URL],
      ['method', 'POST'],
      ['expiration', String(now + 60)]
    ];
    await auth.sign(signer);
    const payload = {
      id: auth.id,
      pubkey: auth.pubkey,
      created_at: auth.created_at,
      kind: auth.kind,
      tags: auth.tags,
      content: auth.content,
      sig: auth.sig
    };
    const form = new FormData();
    form.append('file[]', file);
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(payload))}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const url = data?.data?.[0]?.url;
    return typeof url === 'string' ? url : null;
  } catch (error) {
    console.error('[Signup] photo upload failed:', (error as Error)?.message || error);
    return null;
  }
}
