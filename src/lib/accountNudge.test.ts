import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { NudgeContext, NudgeState } from './accountNudge';

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear()
  };
}

let local: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  vi.resetModules();
  local = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('window', {});
});

const load = () => import('./accountNudge');

describe('nudgeFor', () => {
  const EMPTY_STATE: NudgeState = {
    moment: 'saved-recipe',
    visits: 1,
    dismissed: false,
    seen: false,
    passkeyUnsupported: false
  };
  const base: NudgeContext = {
    isAuthenticated: true,
    authMethod: 'passkey',
    vault: 'confirmed',
    support: 'full',
    backupSaved: false,
    state: EMPTY_STATE,
    legacyDismissedForever: false
  };

  it('offers the backup nudge to a confirmed passkey session with no backup recorded', async () => {
    const { nudgeFor } = await load();
    expect(nudgeFor(base)).toBe('backup');
  });

  it('offers the passkey nudge to an nsec session that can do passkeys', async () => {
    const { nudgeFor } = await load();
    expect(nudgeFor({ ...base, authMethod: 'privateKey', vault: 'none' })).toBe('passkey');
  });

  const none: Array<[string, Partial<NudgeContext>]> = [
    ['signed out', { isAuthenticated: false }],
    ['no natural moment yet', { state: { ...EMPTY_STATE, moment: null } }],
    ['dismissed', { state: { ...EMPTY_STATE, dismissed: true } }],
    ['passkey session with a backup recorded', { backupSaved: true }],
    ['unconfirmed one-prompt passkey (passkey session)', { vault: 'unconfirmed' }],
    [
      'unconfirmed one-prompt passkey (nsec session)',
      { authMethod: 'privateKey', vault: 'unconfirmed' }
    ],
    ["nsec session, another account's vault here", { authMethod: 'privateKey', vault: 'other' }],
    [
      'nsec session, browser without PRF',
      { authMethod: 'privateKey', vault: 'none', support: 'no-prf' }
    ],
    [
      'nsec session, no passkeys at all',
      { authMethod: 'privateKey', vault: 'none', support: 'none' }
    ],
    [
      'nsec session after a PRF failure here',
      {
        authMethod: 'privateKey',
        vault: 'none',
        state: { ...EMPTY_STATE, passkeyUnsupported: true }
      }
    ],
    [
      'nsec session that chose "Don\'t ask again" on the old card',
      { authMethod: 'privateKey', vault: 'none', legacyDismissedForever: true }
    ],
    ['extension session', { authMethod: 'nip07', vault: 'none' }],
    ['remote signer session', { authMethod: 'nip46', vault: 'none' }]
  ];
  for (const [name, change] of none) {
    it(`offers nothing: ${name}`, async () => {
      const { nudgeFor } = await load();
      expect(nudgeFor({ ...base, ...change })).toBeNull();
    });
  }

  it("a backup saved doesn't hide the passkey nudge", async () => {
    const { nudgeFor } = await load();
    expect(nudgeFor({ ...base, authMethod: 'privateKey', vault: 'none', backupSaved: true })).toBe(
      'passkey'
    );
  });
});

describe('natural moments', () => {
  it('the first moment wins and later ones change nothing', async () => {
    const { recordNudgeMoment, readNudgeState } = await load();
    expect(readNudgeState(PK).moment).toBeNull();
    recordNudgeMoment(PK, 'wallet');
    recordNudgeMoment(PK, 'saved-recipe');
    expect(readNudgeState(PK).moment).toBe('wallet');
    expect(readNudgeState(OTHER).moment).toBeNull();
  });

  it('the third visit is the fallback, counted once per browser session', async () => {
    const { recordVisit, readNudgeState } = await load();
    recordVisit(PK);
    recordVisit(PK); // same session
    expect(readNudgeState(PK)).toMatchObject({ visits: 1, moment: null });
    session.clear();
    recordVisit(PK);
    expect(readNudgeState(PK)).toMatchObject({ visits: 2, moment: null });
    session.clear();
    recordVisit(PK);
    expect(readNudgeState(PK)).toMatchObject({ visits: 3, moment: 'third-visit' });
  });

  it('a moment reached before the third visit is kept', async () => {
    const { recordVisit, recordNudgeMoment, readNudgeState } = await load();
    recordNudgeMoment(PK, 'saved-recipe');
    for (let i = 0; i < 3; i++) {
      session.clear();
      recordVisit(PK);
    }
    expect(readNudgeState(PK).moment).toBe('saved-recipe');
  });
});

describe('per-account state', () => {
  it('records a saved backup per account', async () => {
    const { markBackupSaved, hasBackupSaved } = await load();
    markBackupSaved(PK);
    expect(hasBackupSaved(PK)).toBe(true);
    expect(hasBackupSaved(OTHER)).toBe(false);
  });

  it('dismiss, seen and PRF-unsupported persist across a reload', async () => {
    let m = await load();
    m.dismissNudge(PK);
    m.markNudgeSeen(PK);
    m.markPasskeyUnsupported(PK);
    vi.resetModules();
    m = await load();
    expect(m.readNudgeState(PK)).toMatchObject({
      dismissed: true,
      seen: true,
      passkeyUnsupported: true
    });
  });

  it('every change bumps nudgeChanges so views recompute', async () => {
    const { nudgeChanges, markBackupSaved, dismissNudge } = await load();
    const before = get(nudgeChanges);
    markBackupSaved(PK);
    dismissNudge(PK);
    expect(get(nudgeChanges)).toBe(before + 2);
  });

  it('reads garbage state as empty', async () => {
    local.setItem('zapcooking_account_nudge_' + PK, '{not json');
    const { readNudgeState } = await load();
    expect(readNudgeState(PK)).toMatchObject({ moment: null, dismissed: false });
  });

  it("honors only the old card's permanent dismissal, not its snooze", async () => {
    const { legacyPromptDismissedForever } = await load();
    expect(legacyPromptDismissedForever()).toBe(false);
    local.setItem('nostrcooking_vault_prompt_dismissed', new Date().toISOString());
    expect(legacyPromptDismissedForever()).toBe(false);
    local.setItem('nostrcooking_vault_prompt_dismissed', 'never');
    expect(legacyPromptDismissedForever()).toBe(true);
    local.setItem('nostrcooking_vault_prompt_dismissed', '1');
    expect(legacyPromptDismissedForever()).toBe(true);
  });
});

describe('nudgeUnread', () => {
  it('counts 1 while offered and unseen', async () => {
    const { activeNudge, nudgeUnread } = await load();
    expect(get(nudgeUnread)).toBe(0);
    activeNudge.set({ kind: 'backup', pubkey: PK, seen: false });
    expect(get(nudgeUnread)).toBe(1);
    activeNudge.set({ kind: 'backup', pubkey: PK, seen: true });
    expect(get(nudgeUnread)).toBe(0);
  });
});
