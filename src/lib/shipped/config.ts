/**
 * /pow ("Proof of Work") configuration.
 *
 * REPOS is the ONLY allowlist. Nothing in the pow pipeline reads the org
 * as a whole: the sync walks these repos by name, rollup() drops any
 * record from elsewhere, and PR 2's org webhook must filter against this
 * same list (the org also holds private repos, e.g. member-relay, whose
 * PR titles must never reach a public page). The fine-grained token is
 * scoped to these repos too — that's the second wall.
 */

export const POW_ORG = 'zapcooking';

/** `mobile` is dormant in 2026 and deliberately left out; re-add here. */
export const REPOS = ['frontend', 'zap_cooking_android', 'zapcooking_ios'] as const;
export type PowRepo = (typeof REPOS)[number];

export function isPowRepo(repo: string): repo is PowRepo {
  return (REPOS as readonly string[]).includes(repo);
}

/**
 * Inclusive lower bound on mergedAt: midnight in TIME_ZONE, so the year
 * boundary uses the same zone as every other bucket. The live count gate
 * searches `merged:>=2026-01-01T00:00:00-05:00` to match.
 *
 * It carries an offset, so never compare it to GitHub's `…Z` timestamps
 * as strings — use START_MS.
 */
export const START = '2026-01-01T00:00:00-05:00';
export const START_MS = Date.parse(START);

/**
 * Days, months and streaks are bucketed in this zone: the team merges in
 * the Eastern evening, and UTC would push those onto the next day.
 */
export const TIME_ZONE = 'America/New_York';

/**
 * GraphQL `author.login` values for bots (the REST/CLI form is `app/<login>`).
 * Their PRs count in totals but are credited to one Automation bucket.
 */
export const BOT_AUTHORS: readonly string[] = ['copilot-swe-agent', 'dependabot'];

/**
 * Files whose line counts are noise (lockfiles, images, the spam model,
 * BIP-39 wordlists, Xcode project files). Subtracted into counted*; the
 * raw additions/deletions are kept alongside.
 */
export const EXCLUDE: readonly string[] = [
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/Package.resolved',
  '**/Podfile.lock',
  '**/gradle.lockfile',
  '**/*.png',
  '**/*.svg',
  '**/*.jpg',
  '**/model.txt',
  '**/bip39-*.txt',
  '**/*.pbxproj'
];

/** Minimal glob → RegExp: `**\/` = any directory prefix (incl. none), `*` = within one segment. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 2;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

const EXCLUDE_RES = EXCLUDE.map(globToRegExp);

export function isExcludedPath(path: string): boolean {
  return EXCLUDE_RES.some((re) => re.test(path));
}

export function isBotAuthor(login: string | null): boolean {
  return login !== null && BOT_AUTHORS.includes(login);
}
