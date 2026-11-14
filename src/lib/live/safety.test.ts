import { describe, expect, it } from 'vitest';
import { createLiveDatabase } from '../../test/liveDatabase';
import { createSession, endSession, deleteOldEndedRows } from './sessions.server';
import { submitLiveSafetyReport, isLiveSafetyHostSuspended, releaseLiveSafetyHold, cleanupReleasedSafetyRecords } from './safety.server';

const PUBKEY='a'.repeat(64);
const HASH_A='1'.repeat(64);
const HASH_B='2'.repeat(64);
const HASH_C='3'.repeat(64);
const NOW=2000000000;
async function fixture() {
  const db=createLiveDatabase();
  const created=await createSession(db,{hostPubkey:PUBKEY,title:'Test cooking stream',recipeA:null,now:NOW-100});
  if (!created.ok) throw new Error('fixture failed');
  return {db,id:created.session.id};
}
const report=(db:ReturnType<typeof createLiveDatabase>,id:string,hash:string,options:{autoShutdown?:boolean,reason?:'other'|'child_safety'}={}) =>
  submitLiveSafetyReport(db,null,{
    sessionId:id,reporterHash:hash,reason:options.reason??'other',
    details:'Test only',autoShutdown:options.autoShutdown??false,now:NOW
  });

describe('live safety D1 incidents',()=>{
  it('records anonymous report and snapshot, with a hold',async()=>{
    const {db,id}=await fixture();
    const result=await report(db,id,HASH_A);
    expect(result).toMatchObject({recorded:true,count:1,ended:false});
    const hold=db.raw.prepare('SELECT * FROM live_safety_holds WHERE session_id=?').get(id);
    expect(hold.status).toBe('open');
    expect(JSON.parse(hold.snapshot_json).title).toBe('Test cooking stream');
  });
  it('does not count duplicate reporters repeatedly',async()=>{
    const {db,id}=await fixture();
    await report(db,id,HASH_A);
    expect(await report(db,id,HASH_A)).toMatchObject({duplicate:true,count:1});
    await report(db,id,HASH_B);
    expect((await report(db,id,HASH_C)).count).toBe(3);
  });
  it('does not auto-end when Cloudflare is unavailable or automation is disabled',async()=>{
    const {db,id}=await fixture();
    for(const h of [HASH_A,HASH_B,HASH_C]) await report(db,id,h,{autoShutdown:true});
    expect(db.raw.prepare('SELECT status FROM live_sessions WHERE id=?').get(id).status).toBe('created');
    expect(await isLiveSafetyHostSuspended(db,PUBKEY,NOW)).toBe(false);
  });
  it('preserves ended rows beyond 30 days during open hold',async()=>{
    const {db,id}=await fixture();
    await report(db,id,HASH_A,{reason:'child_safety'});
    await endSession(db,id,'admin',NOW);
    expect(await deleteOldEndedRows(db,NOW+31*86400)).toBe(0);
    expect(db.raw.prepare('SELECT id FROM live_sessions WHERE id=?').get(id)).toBeTruthy();
  });
  it('only releases hold on explicit action and cleans up after normal report period',async()=>{
    const {db,id}=await fixture();
    await report(db,id,HASH_A);
    expect(await releaseLiveSafetyHold(db,id,NOW+1)).toBe(true);
    await endSession(db,id,'admin',NOW);
    await cleanupReleasedSafetyRecords(db,NOW+91*86400);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM live_safety_reports').get().n).toBe(0);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM live_safety_holds').get().n).toBe(0);
    expect(await deleteOldEndedRows(db,NOW+91*86400)).toBe(1);
  });
});
