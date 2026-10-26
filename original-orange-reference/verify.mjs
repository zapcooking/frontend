import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='/workspace/artifacts/original-orange-reference',base='http://127.0.0.1:5173';
const before=await readFile(`${dir}/baseline-palettes.css`,'utf8'), after=await readFile('/workspace/frontend/src/lib/themes/palettes.css','utf8');
const keys=[...new Set([...before.matchAll(/(--(?:color|explore|zap)-[a-z-]+)\s*:/g)].map(m=>m[1]))];
const themes=['original','warm-kitchen','after-hours','recipe-club','recipe-box','corner-diner','sunday-market'];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const result={palette:[],components:[],screenshots:[]};
try {
 const p=await browser.newPage();
 for(const theme of themes)for(const mode of ['light','dark']){
  const values=[];
  for(const css of [before,after]){
   await p.setContent(`<style>:root{--color-orange-500:oklch(70.5% .213 47.604);--color-amber-500:oklch(76.9% .188 70.08)}${css}</style>`);
   await p.evaluate(({theme,mode})=>{const h=document.documentElement;h.dataset.exploreTheme=theme;h.dataset.colorMode=mode;h.classList.toggle('dark',mode==='dark');},{theme,mode});
   values.push(await p.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue(k).trim()])),keys));
  }
  const differences=keys.filter(k=>values[0][k]!==values[1][k]).map(k=>({token:k,before:values[0][k],after:values[1][k]}));
  if(theme!=='original')assert.deepEqual(differences,[],`${theme}/${mode}`);
  else assert.deepEqual(differences.map(d=>d.token).sort(),['--color-auth-on-action','--color-hashtag-hover-text','--color-on-action','--explore-action-ink'].filter(k=>values[0][k]!==values[1][k]).sort());
  result.palette.push({theme,mode,tokens:keys.length,differences});
 }
 await p.close();
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark',serviceWorkers:'block'});
 await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,contentType:'application/json',body:'{}'});return r.continue();});
 await context.routeWebSocket('**/*',ws=>ws.close());
 await context.addInitScript(()=>{localStorage.setItem('nostrcooking_theme','dark');localStorage.setItem('zapcooking_explore_theme','original');});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/feed`,{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('.zh-root').waitFor({state:'visible',timeout:90000});
 await page.evaluate(async()=>{
  const [{default:Chips},{default:Day},{userPublickey,userProfilePictureOverride}]=await Promise.all([import('/src/components/FreshTopicChips.svelte'),import('/src/components/FreshOnThisDayCard.svelte'),import('/src/lib/nostr.ts')]);
  const host=document.createElement('section');host.id='reference-fixture';Object.assign(host.style,{position:'fixed',top:'150px',left:'50%',transform:'translateX(-50%)',width:'min(640px, calc(100% - 40px))',zIndex:'25',padding:'20px',background:'var(--color-bg-primary)',border:'1px solid var(--color-input-border)'});host.innerHTML='<p style="font-size:12px;color:var(--color-caption);margin-bottom:20px">Color verification · real components with sample state</p><div id="sample-chips"></div><div id="sample-day"></div>';document.body.append(host);
  new Chips({target:host.querySelector('#sample-chips'),props:{chips:[{kind:'all',slug:'',label:'All'},{kind:'topic',slug:'meat',label:'Meat'},{kind:'topic',slug:'soups',label:'Soups'}]}});
  new Day({target:host.querySelector('#sample-day'),props:{mode:'invite'}});
  userProfilePictureOverride.set('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%235b21b6"/%3E%3Ctext x="16" y="22" text-anchor="middle" fill="white" font-size="18"%3EZ%3C/text%3E%3C/svg%3E');
  userPublickey.set('1'.repeat(64));
  await document.fonts.ready;
 });
 await page.locator('.zh-avatar-ring').waitFor({state:'visible'});
 for(const theme of themes)for(const mode of ['light','dark']){
  await page.evaluate(({theme,mode})=>{const h=document.documentElement;h.dataset.exploreTheme=theme;h.dataset.colorMode=mode;h.classList.toggle('dark',mode==='dark');},{theme,mode});
  await page.waitForTimeout(350);
  const samples=await page.evaluate(()=>{
   const selectors={all:'#sample-chips button[aria-pressed="true"]',open:'#sample-day button',create:'.create-trigger-floating',nav:'.bottom-nav-ios a[href="/feed"]',ring:'.zh-avatar-ring',tab:'button.relative span.bg-gradient-to-r'};
   const snap=selector=>{const e=document.querySelector(selector);if(!e)throw Error('Missing '+selector);const s=getComputedStyle(e);return{color:s.color,backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,boxShadow:s.boxShadow,font:s.font,fontSize:s.fontSize,padding:s.padding,borderRadius:s.borderRadius};};
   return Object.fromEntries(Object.entries(selectors).map(([name,selector])=>[name,snap(selector)]));
  });
  const colors=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['--color-primary','--color-action','--color-on-action','--color-bg-primary','--color-card-sunken','--color-feed-tab-start','--color-feed-tab-end','--color-nav-active','--color-create-start','--color-create-end','--color-profile-glow','--color-profile-highlight'].map(k=>[k,s.getPropertyValue(k).trim()]));});
  if(theme==='original'){
   assert.equal(samples.all.color,'rgb(255, 255, 255)');assert.equal(samples.open.color,'rgb(255, 255, 255)');assert.equal(samples.create.color,'rgb(255, 255, 255)');
   assert.equal(samples.all.backgroundColor,mode==='dark'?'rgb(255, 87, 34)':'rgb(236, 71, 0)');assert.equal(samples.open.backgroundColor,samples.all.backgroundColor);
   assert.equal(samples.nav.color,'rgb(249, 115, 22)');assert.equal(samples.create.backgroundImage,'linear-gradient(135deg, rgb(249, 115, 22), rgb(245, 158, 11))');
   assert.match(samples.tab.backgroundImage,/oklch\(0.705 0.213 47.604\).*oklch\(0.769 0.188 70.08\)/);
   assert.match(samples.ring.backgroundImage,mode==='dark'?/0.752941 0.517647 0.988235/:/0.658824 0.333333 0.968627/);
   for(const width of [360,768,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${dir}/components-${mode}-${width}.png`});result.screenshots.push({type:'real components, sample state',mode,width});}
  }
  result.components.push({theme,mode,samples,colors});
 }
 await page.evaluate(()=>document.querySelector('#reference-fixture').remove());
 for(const route of ['/feed','/explore']){
  await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('.zh-root').waitFor({state:'visible'});if(route==='/explore')await page.waitForFunction(()=>document.querySelector('[data-landing-import] button')?.disabled===false,{},{timeout:90000});
  for(const mode of ['light','dark'])for(const width of [360,768,1440]){
   await page.evaluate(mode=>{const h=document.documentElement;h.dataset.exploreTheme='original';h.dataset.colorMode=mode;h.classList.toggle('dark',mode==='dark');const app=document.querySelector('#app-scroll');if(app)app.scrollTop=0;},mode);
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);await page.screenshot({path:`${dir}/${route.slice(1)}-${mode}-${width}.png`});
   result.screenshots.push(await page.evaluate(({route,mode,width})=>({route,mode,width,overflow:document.documentElement.scrollWidth>innerWidth}),{route,mode,width}));
  }
 }
 result.errors=errors;result.passed=true;await writeFile(`${dir}/results.json`,JSON.stringify(result,null,2));await context.close();console.log(JSON.stringify({passed:true,states:result.components.length,screenshots:result.screenshots.length}));
}finally{await browser.close();}
