import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const stage=process.argv[2]||'after',base=stage==='before'?'http://127.0.0.1:5176':'http://127.0.0.1:5173';
const dir='/workspace/artifacts/explore-shared-shell';await mkdir(`${dir}/${stage}`,{recursive:true});
const recipe='/recipe/naddr1qvzqqqr4gupzqyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qq2xyun0waek2u3dwejhy6txd93kzarfdahqq65fpc';
const allRoutes=stage==='before'?['/feed',recipe]:['/explore','/feed',recipe];const routes=process.argv[3]?allRoutes.filter(r=>r===process.argv[3]):allRoutes;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});let results=[];if(process.argv[3])results=JSON.parse(await readFile(`${dir}/${stage}/shells.json`,'utf8')).filter(r=>!routes.includes(r.route));
try {for(const mode of ['light','dark'])for(const route of routes){
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:mode});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"verification unavailable-data fixture"}'});return r.continue();});await ctx.routeWebSocket('**/*',ws=>ws.close());
 await ctx.addInitScript(mode=>{localStorage.setItem('nostrcooking_theme',mode);localStorage.setItem('zapcooking_explore_theme','original');},mode);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:90000});assert.equal(response.status(),200);
 await page.locator('.zh-root').waitFor({state:'visible',timeout:90000});await page.locator('#app-scroll').waitFor({state:'visible',timeout:90000});
 if(route==='/explore'){await page.locator('[data-explore-theme-select]').waitFor({state:'visible',timeout:60000});await page.waitForFunction(()=>document.querySelector('[data-landing-import] button')?.disabled===false,{},{timeout:60000});}
 await page.evaluate(async()=>{await document.fonts.load('400 16px "Albert Sans"');await document.fonts.load('600 16px "Albert Sans"');await document.fonts.ready;});
 for(const width of [360,768,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const snapshot=await page.evaluate(()=>{
   const sample=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,text:e.textContent.replace(/\s+/g,' ').trim(),label:e.getAttribute('aria-label'),href:e.getAttribute('href'),src:e.getAttribute('src'),geometry:{x:r.x,y:r.y,width:r.width,height:r.height},font:{family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight},box:{padding:s.padding,margin:s.margin,borderRadius:s.borderRadius},color:s.color,bg:s.backgroundColor};};
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const sidebar=document.querySelector('aside[class*="lg:block"]');const header=document.querySelector('.header-blur');const reads=sidebar?.querySelector('a[href="/reads"]');const root=getComputedStyle(document.documentElement);
   return{path:location.pathname,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,header:sample(header),headerRow:sample(document.querySelector('.zh-root')),headerControls:[...header.querySelectorAll('button,input,a,img')].filter(visible).map(sample),sidebar:sidebar&&visible(sidebar)?sample(sidebar):null,sidebarLinks:sidebar&&visible(sidebar)?[...sidebar.querySelectorAll('a')].map(sample):[],sidebarLogos:sidebar?[...sidebar.querySelectorAll('img')].filter(visible).map(sample):[],reads:{text:reads?.textContent.trim(),href:reads?.getAttribute('href'),icon:reads?.querySelector('svg')?.innerHTML},app:sample(document.querySelector('#app-scroll')),tokens:Object.fromEntries(['--color-bg-primary','--color-bg-secondary','--color-input-bg','--color-input-border','--color-text-primary','--color-text-secondary','--color-caption'].map(k=>[k,root.getPropertyValue(k).trim()])),duplicateLandingChrome:document.querySelectorAll('.landing-side-nav,.landing-header').length,walletVisible:[...document.querySelectorAll('.sidebar-wallet-wrap')].some(visible),footerCount:document.querySelectorAll('footer').length};
  });
  assert.equal(snapshot.overflow,false,`${route}/${mode}/${width} overflow`);assert.equal(snapshot.walletVisible,false);if(stage==='after'&&route==='/explore')assert.equal(snapshot.duplicateLandingChrome,0);
  results.push({stage,mode,route,width,...snapshot,errors:[...errors]});await page.screenshot({path:`${dir}/${stage}/${route.split('/')[1]}-${mode}-${width}.png`});
 }
 await writeFile(`${dir}/${stage}/shells.json`,JSON.stringify(results,null,2));await ctx.close();console.log(`${stage} ${mode} ${route.split('/')[1]} captured`);
}console.log(JSON.stringify({stage,states:results.length,passed:true}));}finally{await browser.close();}
