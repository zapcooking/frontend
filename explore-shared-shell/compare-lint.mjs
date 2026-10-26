import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const repo='/workspace/frontend';
const require=createRequire(`${repo}/package.json`);
const {ESLint}=require('eslint');
const eslint=new ESLint({cwd:repo});
const files=execFileSync('git',['diff','--name-only','--diff-filter=ACM','b416b7f7'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(file=>/\.(svelte|ts|js)$/.test(file));
const report=[];
const key=m=>JSON.stringify({ruleId:m.ruleId,severity:m.severity,message:m.message});
function counts(messages){const map=new Map();for(const m of messages){const k=key(m);map.set(k,(map.get(k)||0)+1)}return map;}
function diff(a,b){const other=counts(b),out=[];for(const m of a){const k=key(m),n=other.get(k)||0;if(n)other.set(k,n-1);else out.push(m)}return out;}
for(const file of files){
 let before=''; try { before=execFileSync('git',['show',`b416b7f7:${file}`],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']}); } catch {}
 const after=await readFile(`${repo}/${file}`,'utf8');
 const [b]=await eslint.lintText(before,{filePath:`${repo}/${file}`});
 const [a]=await eslint.lintText(after,{filePath:`${repo}/${file}`});
 report.push({file,beforeErrors:b.errorCount,beforeWarnings:b.warningCount,afterErrors:a.errorCount,afterWarnings:a.warningCount,introduced:diff(a.messages,b.messages),resolved:diff(b.messages,a.messages),baselineParseErrors:b.messages.filter(m=>m.fatal||m.message.startsWith('Parsing error:')),currentParseErrors:a.messages.filter(m=>m.fatal||m.message.startsWith('Parsing error:')),beforeMessages:b.messages,afterMessages:a.messages});
}
const summary={files:files.length,introduced:report.reduce((n,r)=>n+r.introduced.length,0),resolved:report.reduce((n,r)=>n+r.resolved.length,0),baselineErrors:report.reduce((n,r)=>n+r.beforeErrors,0),currentErrors:report.reduce((n,r)=>n+r.afterErrors,0),baselineWarnings:report.reduce((n,r)=>n+r.beforeWarnings,0),currentWarnings:report.reduce((n,r)=>n+r.afterWarnings,0),filesWithBaselineParseErrors:report.filter(r=>r.baselineParseErrors.length).map(r=>r.file),filesWithCurrentParseErrors:report.filter(r=>r.currentParseErrors.length).map(r=>r.file)};
await writeFile('/workspace/artifacts/explore-shared-shell/lint-comparison.json',JSON.stringify({summary,files:report},null,2));
let markdown='# ESLint before/after comparison\n\nRead-only ESLint API lintText comparison of every changed Svelte/TypeScript/JavaScript source file against base b416b7f7, using the same absolute filePath. Messages compared as multisets of ruleId, severity, and message; source line/column locations are ignored. No files were formatted or edited.\n\n'+`- Files checked: ${summary.files}\n- Introduced messages: ${summary.introduced}\n- Resolved messages: ${summary.resolved}\n- Errors: ${summary.baselineErrors} before, ${summary.currentErrors} after\n- Warnings: ${summary.baselineWarnings} before, ${summary.currentWarnings} after\n\n`;
markdown+='| File | Before errors/warnings | After errors/warnings | Introduced | Baseline parser limitation |\n| --- | ---: | ---: | ---: | --- |\n';
for(const r of report)markdown+=`| \`${r.file}\` | ${r.beforeErrors}/${r.beforeWarnings} | ${r.afterErrors}/${r.afterWarnings} | ${r.introduced.length} | ${r.baselineParseErrors.map(m=>m.message.replace(/\|/g,'\\|')).join('; ')||'None'} |\n`;
for(const r of report.filter(r=>r.introduced.length)){markdown+=`\n## Introduced messages: ${r.file}\n\n`;for(const m of r.introduced)markdown+=`- Line ${m.line}: ${m.ruleId||'parser'}: ${m.message}\n`;}
markdown+='\nA file with an existing parser failure cannot receive complete rule analysis. Such failures are listed above rather than counted as a clean lint pass. The repository-wide pnpm lint command also runs Prettier before ESLint; this comparison does not imply that the repository formatting gate passes.\n';
await writeFile('/workspace/artifacts/explore-shared-shell/lint-comparison.md',markdown);
console.log(JSON.stringify(summary,null,2));
for(const r of report.filter(r=>r.introduced.length))console.log(JSON.stringify({file:r.file,introduced:r.introduced},null,2));
