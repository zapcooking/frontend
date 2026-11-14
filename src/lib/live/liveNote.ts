/**
 * The "Live now" note a Go live host posts when the broadcast starts.
 *
 * A plain kind 1 note from the host's own account, so the stream shows on
 * their profile and in their followers' feeds in any Nostr app. It names
 * the stream with the shared rule ("<host> is cooking <recipe>" or "Live
 * from Zap Cooking"), links the watch page, and carries the recipe photo.
 * After the stream ends the same link shows "This live stream has ended".
 *
 * The stream's comments are replies to this note, and its zaps target it.
 */

export interface LiveNoteInput {
  /** The stream's name, from $lib/live/streamName. */
  name: string;
  /** Absolute watch page URL, `<origin>/live/s/<id>`. */
  watchUrl: string;
  /** The recipe's photo (https), when there is one. */
  image?: string | null;
  /** The attached recipe's address, `<kind>:<pubkey>:<d>`. */
  recipeA?: string | null;
}

export interface LiveNoteTemplate {
  kind: 1;
  created_at: number;
  content: string;
  tags: string[][];
}

const HTTPS_IMAGE = /^https:\/\/\S+$/;
const RECIPE_A = /^(30023|35000):[0-9a-f]{64}:.{1,200}$/;

export function liveNoteTemplate(input: LiveNoteInput, now = Date.now()): LiveNoteTemplate {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const image = input.image && HTTPS_IMAGE.test(input.image) ? input.image : null;
  const lines = [name, '', `Watch live: ${input.watchUrl}`];
  if (image) lines.push('', image);
  const tags: string[][] = [
    ['r', input.watchUrl],
    ['t', 'zapcooking'],
    ['t', 'live']
  ];
  if (input.recipeA && RECIPE_A.test(input.recipeA)) tags.push(['a', input.recipeA]);
  if (image) tags.push(['imeta', `url ${image}`]);
  return { kind: 1, created_at: Math.floor(now / 1000), content: lines.join('\n'), tags };
}
