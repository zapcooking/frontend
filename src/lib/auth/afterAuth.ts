/**
 * Where the overlay goes once someone is signed in. One rule for sign-in
 * and signup, so the two can't drift:
 *
 *   1. A pending requireAuth() request (save / like / reply / follow / zap)
 *      → stay put; closing the overlay resumes the action on this page.
 *   2. An explicit `?redirect=` → there.
 *   3. Otherwise sign-in only navigates away from /login (to the member's
 *      start section) and stays on any other page; signup goes to its
 *      landing destination.
 *
 * Pure: the caller passes the URL, whether a request is pending, and the
 * destinations, and does the goto itself.
 */
export interface AfterAuthInput {
  url: URL;
  resumeInPlace: boolean;
  /** Sign-in from /login, or any signup, with no redirect: go here. */
  fallback: string;
}

export function afterSignInTarget({ url, resumeInPlace, fallback }: AfterAuthInput): string | null {
  if (resumeInPlace) return null;
  const redirect = url.searchParams.get('redirect');
  if (redirect) return redirect;
  return url.pathname === '/login' ? fallback : null;
}

export function afterSignupTarget({ url, resumeInPlace, fallback }: AfterAuthInput): string | null {
  if (resumeInPlace) return null;
  return url.searchParams.get('redirect') || fallback;
}
