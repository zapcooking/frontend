import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4188',dir='/workspace/artifacts/explore-performance';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
const key='zapcooking.landingImport';
function isAppScript(url){return /\/_app\/immutable\/.*\.js(?:\?|$)/.test(url)&&!url.includes('/assets/import.client.');}
async function context(){const c=await browser.newContext({viewport:{width:360,height:800}});await c.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());await c.routeWebSocket('**/*',ws=>ws.close());return c;}
try{
 {
  const c=await context(),p=await c.newPage();let posts=0,blocked=0;
  await c.route('**/_app/immutable/**/*.js',r=>{if(isAppScript(r.request().url())){blocked++;return r.abort();}return r.continue();});
  await c.route('**/api/extract-recipe/public',async r=>{posts++;await r.fulfill({status:429,contentType:'application/json',body:'{}'});});
  await p.goto(base+'/explore',{waitUntil:'domcontentloaded'});
  const form=p.locator('form[data-landing-import]');await form.locator('button').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('form[data-landing-import] button')?.disabled);
  assert.ok(blocked>0);await form.locator('input').fill('https://recipes.example/soup');await form.locator('button').click();await p.waitForFunction(()=>document.querySelector('#import-status')?.textContent?.includes('free import limit'));
  assert.equal(posts,1);assert.ok(await form.locator('button').isEnabled());
  await p.screenshot({path:dir+'/import-app-blocked-360.png',fullPage:false});
  results.push({scenario:'all app JS blocked',blockedAppScripts:blocked,posts,importEnabled:true,errorVisible:true});await c.close();
 }
 {
  const c=await context(),p=await c.newPage();let posts=0,releaseApp,releaseReply;
  const appGate=new Promise(r=>releaseApp=r),replyGate=new Promise(r=>releaseReply=r);
  await c.route('**/_app/immutable/**/*.js',async r=>{if(isAppScript(r.request().url()))await appGate;await r.continue();});
  await c.route('**/api/extract-recipe/public',async r=>{posts++;await replyGate;await r.fulfill({status:429,contentType:'application/json',body:'{}'});});
  await p.goto(base+'/explore',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!document.querySelector('form[data-landing-import] button')?.disabled);
  await p.evaluate(()=>window.__earlyImportController=document.querySelector('form[data-landing-import]')[Symbol.for('zapcooking.landingImport')]);
  await p.locator('#import-url').fill('https://recipes.example/soup');await p.locator('form[data-landing-import] button').click();await p.waitForFunction(()=>document.querySelector('#import-status')?.textContent?.includes('Reading your recipe'));
  releaseApp();
  const client=await c.newCDPSession(p),obj=await client.send('Runtime.evaluate',{expression:'document.documentElement'});
  let hydrated=false;for(let i=0;i<300;i++){if((await client.send('DOMDebugger.getEventListeners',{objectId:obj.result.objectId})).listeners.some(l=>l.type==='click')){hydrated=true;break;}await p.waitForTimeout(100);}assert.ok(hydrated,'app must hydrate');
  assert.ok(await p.evaluate(()=>window.__earlyImportController===document.querySelector('form[data-landing-import]')[Symbol.for('zapcooking.landingImport')]));
  assert.equal(await p.locator('form[data-landing-import] button').textContent(),'Importing…');assert.ok(await p.locator('form[data-landing-import] button').isDisabled());
  releaseReply();await p.waitForFunction(()=>document.querySelector('#import-status')?.textContent?.includes('free import limit'));assert.equal(posts,1);
  await p.locator('a.nav-tab[href="/feed"]').click();await p.waitForURL('**/feed');
  assert.equal(await p.evaluate(()=>document.querySelector('form[data-landing-import]')),null);
  results.push({scenario:'hydration adopts pending early request',sameController:true,posts,pendingStatePreserved:true,componentNavigation:true});await c.close();
 }
 console.log(JSON.stringify(results,null,2));await writeFile(dir+'/import-browser-results.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
