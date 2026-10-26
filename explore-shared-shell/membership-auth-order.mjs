import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173',dir='/workspace/artifacts/explore-shared-shell',browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const observations=[],pending=[],settled=new Set(),failures=[];let releaseStale;
const gate=new Promise(resolve=>{releaseStale=resolve;});
const keys={nonmember:'1'.repeat(64),member:'2'.repeat(64),stale:'3'.repeat(64),unknown:'4'.repeat(64)};
async function waitAudience(p,wanted){await p.waitForFunction(w=>{const s=document.querySelector('#membership');return s&&['guest','upgrade','account'].every(k=>[...s.querySelectorAll(`[data-landing-${k}]`)].some(e=>!e.hidden)===w[k]);},wanted);return p.locator('#membership').evaluate(s=>Object.fromEntries(['guest','upgrade','account'].map(k=>[k,[...s.querySelectorAll(`[data-landing-${k}]`)].some(e=>!e.hidden)])));}
try {
 const c=await browser.newContext({viewport:{width:1440,height:1000}});await c.routeWebSocket('**/*',ws=>ws.close());
 await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/membership/check-status'){let body={};try{body=r.request().postDataJSON();}catch{}if(body.pubkey===keys.unknown)return r.fulfill({status:503,contentType:'application/json',body:'{}'});if(body.pubkey===keys.stale){pending.push(r.request());await gate;}try{return await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isActive:body.pubkey!==keys.nonmember})});}catch(e){if(body.pubkey!==keys.stale)throw e;return;}}if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,contentType:'application/json',body:'{}'});return r.continue();});
 const p=await c.newPage();p.on('requestfinished',r=>settled.add(r));p.on('requestfailed',r=>{settled.add(r);if(new URL(r.url()).pathname==='/api/membership/check-status')failures.push({body:r.postData(),error:r.failure()?.errorText});});
 await p.goto(base+'/explore',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelector('[data-landing-import] button')?.disabled===false,{},{timeout:90000});await waitAudience(p,{guest:true,upgrade:true,account:false});
 async function change(pubkey){await p.evaluate(async pubkey=>{const {userPublickey}=await import('/src/lib/nostr.ts');userPublickey.set(pubkey);if(pubkey)localStorage.setItem('nostrcooking_loggedInPublicKey',pubkey);else localStorage.removeItem('nostrcooking_loggedInPublicKey');},pubkey);}
 await change(keys.nonmember);observations.push({step:'store then storage: nonmember',state:await waitAudience(p,{guest:false,upgrade:true,account:true})});
 await change(keys.member);observations.push({step:'store then storage: member',state:await waitAudience(p,{guest:false,upgrade:false,account:true})});
 await change(keys.unknown);observations.push({step:'store then storage: status unavailable',state:await waitAudience(p,{guest:false,upgrade:false,account:true})});
 await change('');observations.push({step:'empty store then storage removal: logout',state:await waitAudience(p,{guest:true,upgrade:true,account:false})});
 await change(keys.stale);for(let i=0;i<300&&!pending.length;i++)await p.waitForTimeout(10);assert.ok(pending.length>0,'Delayed membership request was sent');await waitAudience(p,{guest:false,upgrade:false,account:true});
 await change('');observations.push({step:'logout while membership response pending',state:await waitAudience(p,{guest:true,upgrade:true,account:false})});releaseStale();
 for(let i=0;i<300&&!pending.every(r=>settled.has(r));i++)await p.waitForTimeout(10);assert.ok(pending.every(r=>settled.has(r)),'All delayed request outcomes settled');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const finalState=await waitAudience(p,{guest:true,upgrade:true,account:false});assert.ok(failures.some(x=>x.body.includes(keys.stale)&&x.error.includes('ABORTED')),'Component aborts its stale membership request');observations.push({step:'stale member response cannot repaint logged-out page',state:finalState,delayedRequests:pending.length,abortedRequests:failures.filter(x=>x.body.includes(keys.stale)).length});
 await writeFile(`${dir}/membership-auth-order.json`,JSON.stringify({passed:true,observations,requestFailures:failures},null,2));console.log(JSON.stringify({checks:observations.length,passed:true}));await c.close();
} finally {releaseStale();await browser.close();}
