import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const repo='/workspace/frontend',require=createRequire(repo+'/package.json');
const {ESLint}=require('eslint'),{compile,preprocess}=require('svelte/compiler'),ts=require('typescript'),prettier=require('prettier');
const lint=new ESLint({cwd:repo});
const files=['src/components/Header.svelte','src/components/MobileSearchOverlay.svelte','src/components/TagsSearchAutocomplete.svelte'];
const results=[];
for(const file of files){
 const path=repo+'/'+file,before=execFileSync('git',['show','HEAD:'+file],{cwd:repo,encoding:'utf8'}),after=await readFile(path,'utf8');
 const compiled=[];for(const source of [before,after]){const pre=await preprocess(source,{script:({content,attributes})=>attributes.lang==='ts'?{code:ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText}:undefined},{filename:path});compiled.push(compile(pre.code,{filename:path,generate:'ssr'}));}
 const warn=c=>c.warnings.map(w=>w.code+':'+w.message);const prior=warn(compiled[0]),introduced=warn(compiled[1]).filter(w=>!prior.includes(w));
 const linted=[];for(const source of [before,after])linted.push((await lint.lintText(source,{filePath:path}))[0].messages.map(m=>m.ruleId+':'+m.message));
 const newLint=linted[1].filter(m=>!linted[0].includes(m));
 const config=await prettier.resolveConfig(path);delete config.pluginSearchDirs;const options={...config,filepath:path};
 const beforeFormat=await prettier.check(before,options),afterFormat=await prettier.check(after,options);
 results.push({file,compiled:true,newCompilerWarnings:introduced,newLintMessages:newLint,beforeLintMessages:linted[0].length,afterLintMessages:linted[1].length,beforeFormat,afterFormat,introducedFormatFailure:beforeFormat&&!afterFormat});
}
const passed=results.every(r=>!r.newCompilerWarnings.length&&!r.newLintMessages.length&&!r.introducedFormatFailure);
await writeFile('/workspace/artifacts/explore-shared-shell/search-source-results.json',JSON.stringify({passed,results},null,2));console.log(JSON.stringify({passed,results},null,2));if(!passed)process.exitCode=1;
