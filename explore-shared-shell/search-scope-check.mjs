import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const repo='/workspace/frontend';
const require=createRequire(repo+'/package.json');
const ts=require('typescript');
function functions(file,names){
 const script=readFileSync(repo+'/'+file,'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
 const tree=ts.createSourceFile(file+'.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const selected=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
 assert.equal(selected.length,names.length);
 return ts.transpileModule(selected.map(n=>n.getText(tree)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const results=[];
for(const file of ['src/components/Header.svelte','src/components/MobileSearchOverlay.svelte']){
 const source=functions(file,['openSearch','openTag']);
 for(const recipeOnly of [false,true]){
  const routes=[];const closed=[];
  const f=new Function('recipeOnly','goto','mobileSearchOpen','parseNip19Input','isSecretKeyInput',source+';return{openSearch,openTag}')(recipeOnly,p=>routes.push(p),{set:v=>closed.push(v)},q=>q==='known-id'?{path:'/recipe/known-id'}:null,q=>q.startsWith('nsec1'));
  f.openSearch('soup & rice');assert.equal(routes.pop(),`/search?${recipeOnly?'type=recipes&':''}q=soup%20%26%20rice`);
  f.openTag('Soup');assert.equal(routes.pop(),recipeOnly?'/search?type=recipes&q=Soup':'/tag/Soup');
  f.openSearch('known-id');assert.equal(routes.pop(),'/recipe/known-id');
  f.openSearch('nsec1secret');f.openTag('nsec1secret');assert.deepEqual(routes,[]);
  assert.ok(closed.length>=4&&closed.every(v=>v===false));
  results.push({file,recipeOnly,keywordRoute:true,tagRoute:true,identifierRoute:true,secretsBlocked:true});
 }
}
const runSource=functions('src/components/TagsSearchAutocomplete.svelte',['runSearchFor','updateRecipeScope']);
for(const initialScope of [false,true]){
 const factory=new Function('initialScope',`
 let recipeOnly=initialScope,isTagPicker=false,userSearchVersion=0,searchTimeout=null,showAutocomplete=false,isSearching=false;
 let searchResults={tags:[],recipes:[],users:[],note:null};
 const recipeTags=[{title:'Soup'}],timers=[],calls={recipes:[],network:[],users:[]};
 const clearTimeout=()=>{},setTimeout=fn=>(timers.push(fn),timers.length),cancelNetworkSearch=()=>{};
 const isSecretKeyInput=q=>q.startsWith('nsec1');
 const parseNip19Input=q=>q==='note-id'?{kind:'note',id:q}:null;
 const searchRecipes=q=>calls.recipes.push(q),searchNetworkRecipes=q=>calls.network.push(q),searchUsers=async q=>calls.users.push(q);
 ${runSource}
 return{runSearchFor,calls,timers,state:()=>searchResults,visible:()=>showAutocomplete,seed:()=>{searchResults.users=[{npub:'stale'}];searchResults.note={id:'stale'};},scope:(value)=>{recipeOnly=value;updateRecipeScope(value)}};
 `);
 const f=factory(initialScope);f.runSearchFor('soup');await f.timers.pop()();
 assert.deepEqual(f.calls.recipes,['soup']);assert.deepEqual(f.calls.network,['soup']);assert.deepEqual(f.calls.users,initialScope?[]:['soup']);
 f.runSearchFor('note-id');assert.equal(!!f.state().note,!initialScope);
 f.seed();f.scope(true);assert.deepEqual(f.state().users,[]);assert.equal(f.state().note,null);
 results.push({component:'TagsSearchAutocomplete',recipeOnly:initialScope,recipesQueried:true,usersScoped:true,notesScoped:true,staleSuggestionsCleared:true});
}
const profileSource=functions('src/components/TagsSearchAutocomplete.svelte',['searchUsers','updateRecipeScope']);
let resolve;
const pending=new Promise(r=>{resolve=r});
const f=new Function('searchProfiles',`
 let recipeOnly=false,userSearchVersion=0,searchResults={tags:[],recipes:[],users:[],note:null};
 const getDisplayName=p=>p.name;
 ${profileSource}
 return{searchUsers,scope:()=>{recipeOnly=true;updateRecipeScope(true)},state:()=>searchResults};
 `)(()=>pending);
const request=f.searchUsers('cook');f.scope();resolve([{name:'Late user',npub:'late'}]);await request;assert.deepEqual(f.state().users,[]);
results.push({component:'TagsSearchAutocomplete',lateProfileReplyIgnored:true});
writeFileSync('/workspace/artifacts/explore-shared-shell/search-scope-results.json',JSON.stringify({passed:true,results},null,2));
console.log(JSON.stringify({passed:true,cases:results.length}));
