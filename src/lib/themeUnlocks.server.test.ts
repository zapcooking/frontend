import { describe, expect, it } from 'vitest';
import { localAllowlistPubkeys } from './themeUnlocks.server';

const NPUB = 'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx';
const HEX = 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74';

describe('localAllowlistPubkeys', () => {
  it('decodes npubs and passes hex through', () => {
    expect(localAllowlistPubkeys(`${NPUB}, ${HEX.toUpperCase()}`)).toEqual(new Set([HEX]));
  });

  it('is empty when unset or blank', () => {
    expect(localAllowlistPubkeys(undefined).size).toBe(0);
    expect(localAllowlistPubkeys('  ').size).toBe(0);
  });

  it('skips malformed tokens without dying', () => {
    expect(localAllowlistPubkeys(`nope, ${NPUB}, npub1notarealnotestamp`)).toEqual(new Set([HEX]));
  });

  it('keeps only lowercase hex', () => {
    expect(localAllowlistPubkeys(HEX.toUpperCase()).has(HEX)).toBe(true);
  });
});
