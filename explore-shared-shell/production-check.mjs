import { Server } from '/workspace/frontend/.svelte-kit/output/server/index.js';
import { manifest } from '/workspace/frontend/.svelte-kit/output/server/manifest.js';
import { readFile, writeFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
const repo='/workspace/frontend', out='/workspace/artifacts/explore-shared-shell';
const server=new Server(manifest);
await server.init({env:{},read:async(path)=>new Uint8Array(await readFile(`${repo}/static/${path}`))});
const results=[];
for(const visitor of ['guest','cookie-marker']) {
 const marker='PRIVATE_REVIEW_IDENTITY_NOT_FOR_SHARED_HTML';
 const request=new Request('http://localhost/explore',{headers:visitor==='guest'?{}:{cookie:`nostrcooking_loggedInPublicKey=${marker}; membership=active`}});
 const response=await server.respond(request,{getClientAddress:()=> '127.0.0.1',platform:{env:{}}});
 const html=await response.text();
 await writeFile(`${out}/production-${visitor}.html`,html);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'public, max-age=60, s-maxage=180');
 assert.equal(response.headers.get('set-cookie'),null);
 assert.ok(html.includes('id="community-headline"'),'Real Explore content, not catch-all shell');
 assert.ok(html.includes('id="app-scroll"'),'Shared app scroll container');
 assert.equal((html.match(/<footer\b/g)||[]).length,1,'One shared footer');
 assert.equal((html.match(/<title>/g)||[]).length,1,'No duplicate metadata');
 assert.ok(html.includes('Zap Cooking: recipes, cooks and reads'));
 assert.ok(html.includes('href="/reads"')&&html.includes('Reads'));
 assert.ok(!html.includes('landing-side-nav')&&!html.includes('landing-header'),'No duplicate landing chrome');
 assert.ok(html.includes('__sveltekit_'),'Shared app hydration is enabled');
 assert.ok(!html.includes(marker),'Cookie identity never appears in public SSR');
 assert.ok(!html.includes('landing-import.js'),'Import is owned by hydrated component');
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]*appearance\.js)"[^>]*><\/script>/g)];
 assert.equal(scripts.length,1);
 assert.ok(scripts[0].index<html.indexOf('<body'));
 assert.equal(new URL(scripts[0][1],'http://localhost/explore').pathname,'/appearance.js');
 results.push({visitor,status:response.status,cacheControl:response.headers.get('cache-control'),setCookie:false,realExploreContent:true,sharedShell:true,sharedFooterCount:1,hydration:true,privateCookieMarkerAbsent:true,prepaintControllerCount:1});
}
assert.equal(await readFile(`${repo}/.svelte-kit/cloudflare/appearance.js`,'utf8'),await readFile(`${repo}/static/appearance.js`,'utf8'));
let obsoleteImportAsset=false;try{await access(`${repo}/.svelte-kit/cloudflare/landing-import.js`);obsoleteImportAsset=true;}catch{}
assert.equal(obsoleteImportAsset,false);
const result={results,staticControllerMatchesSource:true,obsoleteStandaloneImportAssetAbsent:true,rendering:'Cached public runtime SSR plus the existing hydrated app shell. Account/wallet state remains client-side.'};
await writeFile(`${out}/production-results.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
