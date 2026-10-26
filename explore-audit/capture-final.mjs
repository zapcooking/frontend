import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const dir='/workspace/artifacts/explore-audit-final/final-screenshots';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
for(const mode of ['light','dark'])for(const width of [360,768,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},colorScheme:mode,serviceWorkers:'block'});
 await context.addInitScript(({mode})=>{localStorage.setItem('nostrcooking_theme',mode);localStorage.setItem('zapcooking_explore_theme','original');window.WebSocket=class{constructor(){throw new Error('External data disabled in review capture')}};},{mode});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:4188/explore',{waitUntil:'domcontentloaded'});
 await page.locator('[data-landing-guest]').first().waitFor({state:'visible',timeout:45000});
 await page.locator('[data-landing-import] button').waitFor({state:'visible'});
 await page.evaluate(async()=>{await document.fonts.ready;document.getElementById('app-scroll').scrollTop=0;});
 await page.screenshot({path:`${dir}/explore-${mode}-${width}.png`});
 results.push(await page.evaluate(({mode,width})=>({mode,width,hydratedGuestVisible:!!document.querySelector('[data-landing-guest]:not([hidden])'),importEnabled:!document.querySelector('[data-landing-import] button').disabled,documentOverflow:document.documentElement.scrollWidth>innerWidth,footerCount:document.querySelectorAll('footer').length}),{mode,width}));
 await context.close();
}
await browser.close();await writeFile(`${dir}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
