import lighthouse from '/workspace/artifacts/explore-promises/lighthouse-tool/node_modules/lighthouse/core/index.js';
import {launch} from '/workspace/artifacts/explore-promises/lighthouse-tool/node_modules/chrome-launcher/dist/index.js';
import {writeFile} from 'node:fs/promises';
const stage=process.argv[2],port=Number(process.argv[3]),runs=Number(process.argv[4]||3),dir='/workspace/artifacts/explore-performance';
const results=[];
for(let i=1;i<=runs;i++){
 const chrome=await launch({chromePath:'/usr/bin/chromium',chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update']});
 try{
  const result=await lighthouse(`http://127.0.0.1:${port}/explore`,{port:chrome.port,onlyCategories:['performance','accessibility'],output:['json','html'],logLevel:'error',formFactor:'mobile',screenEmulation:{mobile:true,width:360,height:800,deviceScaleFactor:1,disabled:false},throttlingMethod:'simulate',blockedUrlPatterns:['https://*','wss://*'],maxWaitForLoad:30000});
  await writeFile(`${dir}/${stage}-${i}.lighthouse.json`,result.report[0]);await writeFile(`${dir}/${stage}-${i}.lighthouse.html`,result.report[1]);
  const lhr=result.lhr, requests=lhr.audits['network-requests'].details.items,js=requests.filter(r=>r.resourceType==='Script');
  const row={stage,run:i,lighthouseVersion:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,performance:lhr.categories.performance.score,accessibility:lhr.categories.accessibility.score,LCP:lhr.audits['largest-contentful-paint'].numericValue,TBT:lhr.audits['total-blocking-time'].numericValue,FCP:lhr.audits['first-contentful-paint'].numericValue,CLS:lhr.audits['cumulative-layout-shift'].numericValue,scriptRequests:js.length,jsTransferBytes:js.reduce((n,r)=>n+(r.transferSize||0),0),jsResourceBytes:js.reduce((n,r)=>n+(r.resourceSize||0),0),runtimeError:lhr.runtimeError||null,warnings:lhr.runWarnings};
  results.push(row);console.log(JSON.stringify(row));
 }finally{await chrome.kill();}
}
await writeFile(`${dir}/${stage}-summary.json`,JSON.stringify(results,null,2));
