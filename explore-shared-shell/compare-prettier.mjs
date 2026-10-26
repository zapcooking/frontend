import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const repo='/workspace/frontend';
const require=createRequire(`${repo}/package.json`);
const prettier=require('prettier');
const files=execFileSync('git',['diff','--name-only','--diff-filter=ACM','b416b7f7'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const details=[];
for(const file of files){
 const path=`${repo}/${file}`;
 const config=await prettier.resolveConfig(path);
 const options={...config,filepath:path};
 // Current Prettier ignores this legacy configuration key; removing it only
 // avoids repeating the same existing warning, without changing formatting.
 delete options.pluginSearchDirs;
 let before=''; try {before=execFileSync('git',['show',`b416b7f7:${file}`],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']});} catch {}
 const after=await readFile(path,'utf8');
 let b,a,error;
 try {b=await prettier.check(before,options);a=await prettier.check(after,options);}catch(e){error=String(e);}
 const result={file,beforePass:b,afterPass:a,introducedFailure:b===true&&a===false,error};
 if(result.introducedFailure){
  const formatted=await prettier.format(after,options);
  const beforeLines=after.split('\n'),formattedLines=formatted.split('\n');
  let n=0;while(n<beforeLines.length&&beforeLines[n]===formattedLines[n])n++;
  result.firstFormatDifference={line:n+1,current:beforeLines.slice(Math.max(0,n-2),n+5),formatted:formattedLines.slice(Math.max(0,n-2),n+9)};
 }
 details.push(result);
}
const summary={files:files.length,beforePassing:details.filter(r=>r.beforePass).length,afterPassing:details.filter(r=>r.afterPass).length,existingFailures:details.filter(r=>r.beforePass===false).map(r=>r.file),introducedFailures:details.filter(r=>r.introducedFailure).map(r=>r.file),resolvedFailures:details.filter(r=>r.beforePass===false&&r.afterPass===true).map(r=>r.file),errors:details.filter(r=>r.error)};
const jsonPath='/workspace/artifacts/explore-shared-shell/lint-comparison.json';
const prior=JSON.parse(await readFile(jsonPath,'utf8'));prior.prettier={summary,files:details};await writeFile(jsonPath,JSON.stringify(prior,null,2));
const mdPath='/workspace/artifacts/explore-shared-shell/lint-comparison.md';
let md=(await readFile(mdPath,'utf8')).split('\n## Prettier before/after comparison')[0];
md+='\n## Prettier before/after comparison\n\nEvery changed file was checked with `Prettier.check`, using the same resolved repository config and absolute filepath for base b416b7f7 and the working file. The legacy ignored `pluginSearchDirs` option was omitted to suppress duplicate warnings; no formatting options were changed. No source files were written.\n\n'+`- Files checked: ${summary.files}\n- Passing before/after: ${summary.beforePassing}/${summary.afterPassing}\n- Existing failures among changed files: ${summary.existingFailures.length}\n- Newly failing files: ${summary.introducedFailures.length}\n- Resolved failures: ${summary.resolvedFailures.length}\n\n`;
md+='| File | HEAD | Working | New failure |\n| --- | --- | --- | --- |\n';
for(const r of details)md+=`| \`${r.file}\` | ${r.beforePass?'Pass':r.error?'Error':'Fail'} | ${r.afterPass?'Pass':r.error?'Error':'Fail'} | ${r.introducedFailure?'Yes':'No'} |\n`;
for(const r of details.filter(r=>r.introducedFailure)){md+=`\n### ${r.file}\n\nFirst formatting difference at line ${r.firstFormatDifference.line}:\n\nCurrent:\n\n\`\`\`\n${r.firstFormatDifference.current.join('\n')}\n\`\`\`\n\nPrettier output:\n\n\`\`\`\n${r.firstFormatDifference.formatted.join('\n')}\n\`\`\`\n`;}
await writeFile(mdPath,md);
console.log(JSON.stringify(summary,null,2));
for(const r of details.filter(r=>r.introducedFailure))console.log(JSON.stringify({file:r.file,...r.firstFormatDifference},null,2));
