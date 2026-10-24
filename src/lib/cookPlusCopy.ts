/**
 * Cook+ pitch copy shared by the membership page and the discovery modal.
 *
 * Outcome first, mechanism second: each tool is described by what the cook
 * gets, not by what the software does. Icons are mapped in the components
 * (they are Svelte components and cannot live in a plain module).
 */

import { CHEFFY_MONTHLY_MESSAGES } from '$lib/cookPlusPricing';

export const COOK_PLUS_HEADLINE = 'Your kitchen, supercharged.';

export type CookPlusToolKey = 'souschef' | 'nourish' | 'cheffy';

export interface CookPlusTool {
  key: CookPlusToolKey;
  name: string;
  /** The result, as a short headline. */
  outcome: string;
  /** How it happens, one or two sentences. */
  body: string;
  /** One line for compact surfaces (the modal). */
  short: string;
  href: string;
}

export const COOK_PLUS_TOOLS: readonly CookPlusTool[] = [
  {
    key: 'souschef',
    name: 'Sous Chef',
    outcome: 'Any recipe, in your kitchen in seconds.',
    body: 'Paste a link, snap a photo of a cookbook page, or drop in text. Sous Chef turns it into a clean recipe you can cook, scale, and keep.',
    short: 'Save any recipe from a link, photo, or text.',
    href: '/souschef'
  },
  {
    key: 'nourish',
    name: 'Nourish',
    outcome: 'Understand more than the macros.',
    body: 'See how a recipe scores across real food, gut health, protein, inflammation, blood sugar, brain health, and more. Not a grade. Just guidance.',
    short: 'See what a recipe does for your body.',
    href: '/nourish'
  },
  {
    key: 'cheffy',
    name: 'Cheffy',
    outcome: 'Help when you actually need it.',
    body: `Ask what to make, use what's already in your kitchen, or get help while you're cooking. ${CHEFFY_MONTHLY_MESSAGES} messages a month.`,
    short: `Get answers mid-cook, ${CHEFFY_MONTHLY_MESSAGES} messages a month.`,
    href: '/cheffy'
  }
];

export interface CookPlusPerk {
  key: string;
  label: string;
  detail: string;
}

/** Secondary benefits — real, but not why people buy. Kept quiet. */
export const COOK_PLUS_PERKS: readonly CookPlusPerk[] = [
  {
    key: 'nip05',
    label: 'Verified identity',
    detail: 'A you@zap.cooking NIP-05 address.'
  },
  {
    key: 'relay',
    label: 'Pantry relay',
    detail: 'Access to the private pantry.zap.cooking relay.'
  },
  {
    key: 'badge',
    label: 'Member badge',
    detail: 'Shown on your profile and posts.'
  },
  {
    key: 'market',
    label: 'Market access',
    detail: 'Buy and sell on the Zap Cooking Market.'
  },
  {
    key: 'collections',
    label: 'Featured collections',
    detail: 'Member-only recipe collections.'
  },
  {
    key: 'early',
    label: 'Early access',
    detail: 'New features before everyone else.'
  },
  {
    key: 'vote',
    label: 'A vote on the roadmap',
    detail: 'Help pick what gets built next.'
  }
];

/** The Fresh feed relay members can add to other Nostr apps. */
export const FRESH_FEED_RELAY = 'wss://feed.zap.cooking';

/** What membership adds to the Fresh feed (and the feed relay). */
export const FRESH_FEED_PERKS: readonly CookPlusPerk[] = [
  {
    key: 'history',
    label: 'Full history',
    detail:
      'The curated food & drink archive back to 2023 — nearly 37,000 posts, not just the last 14 days.'
  },
  {
    key: 'topics',
    label: 'Topic feeds',
    detail: '44 topics, including Meat, Soups, Japanese, Garden, Cakes, Cheese and Homestead.'
  },
  {
    key: 'onthisday',
    label: 'On this day',
    detail: 'What the community cooked 1–2 years ago today.'
  },
  {
    key: 'timemachine',
    label: 'Time machine',
    detail: 'Browse the archive month by month.'
  },
  {
    key: 'apps',
    label: 'Use it in other Nostr apps',
    detail: `Add ${FRESH_FEED_RELAY} and log in. Works in apps that support relay login (Amethyst, Coracle, Damus, noStrudel, Nostur); not Primal.`
  }
];

export const FRESH_FEED_FREE =
  'Free for everyone: Fresh with the last 14 days, and every recipe at any age.';

export const FRESH_FEED_PRIVACY =
  'No tracking — no view counts or reading history. Logging in to the feed only checks membership.';
