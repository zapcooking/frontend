import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const repo=process.argv[2],port=Number(process.argv[3]);
const {Server}=await import(pathToFileURL(`${repo}/.svelte-kit/output/server/index.js`));
const {manifest}=await import(pathToFileURL(`${repo}/.svelte-kit/output/server/manifest.js`));
const app=new Server(manifest);
await app.init({env:{},read:async name=>new Uint8Array(await readFile(`${repo}/static/${name}`))});
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function send(req,res,status,headers,body){
 if(/gzip/.test(req.headers['accept-encoding']||'')&&/^(text\/|application\/json|image\/svg)/.test(headers['content-type']||'')){
  body=gzipSync(body);headers['content-encoding']='gzip';headers.vary='Accept-Encoding';
 }
 headers['content-length']=body.length;res.writeHead(status,headers);res.end(req.method==='HEAD'?null:body);
}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://127.0.0.1:${port}`),name=decodeURIComponent(url.pathname).replace(/^\/+/,''),safe=path.normalize(name);
  if(safe.startsWith('..')){res.writeHead(400);res.end();return;}
  for(const dir of ['.svelte-kit/output/client','static']){
   try{const body=await readFile(`${repo}/${dir}/${safe}`);send(req,res,200,{'content-type':mime[path.extname(safe)]||'application/octet-stream','cache-control':safe.startsWith('_app/immutable/')?'public,max-age=31536000,immutable':'no-cache'},body);return;}catch{}
  }
  if(url.pathname.startsWith('/api/')){send(req,res,503,{'content-type':'application/json','cache-control':'no-store'},Buffer.from('{"error":"Unavailable in controlled audit"}'));return;}
  const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
  const response=await app.respond(new Request(url,{method:req.method,headers}),{getClientAddress:()=> '127.0.0.1',platform:{env:{}}});
  send(req,res,response.status,Object.fromEntries(response.headers.entries()),Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error);res.writeHead(500);res.end(String(error));}
}).listen(port,'127.0.0.1',()=>console.log(`Serving ${repo} on ${port}; gzip enabled, no external data or API credentials.`));
