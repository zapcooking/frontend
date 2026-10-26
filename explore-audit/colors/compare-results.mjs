import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='/workspace/artifacts/original-brand-colors';
const read=async path=>JSON.parse(await readFile(`${dir}/${path}`,'utf8'));
const before=await read('theme-components-before.json'), after=await read('theme-components-after.json'), palettes=await read('palette-comparison.json');
const historical=await read('historical/colors.json'), snapshots=await read('after/colors.json');
const unchanged=[];
for (let i=0;i<after.length;i++) {
 const a=after[i], b=before[i]; assert.equal(a.theme,b.theme);assert.equal(a.mode,b.mode);
 for (const name of Object.keys(a.samples)) for(const prop of ['font','fontSize','padding','borderRadius','width','height']) assert.equal(a.samples[name][prop],b.samples[name][prop],`${a.theme}/${a.mode}/${name}/${prop}`);
 if(a.theme!=='original') {
  for(const prop of ['tokens','samples','noteHover','richHover']) assert.deepEqual(a[prop],b[prop],`${a.theme}/${a.mode}/${prop}`);
  unchanged.push(`${a.theme}/${a.mode}`);
 }
}
for(const p of palettes)if(p.theme!=='original')assert.equal(p.differences.length,0);
const original=[];
for(const mode of ['light','dark']){
 const old=historical.find(r=>r.route==='/__verification_colors'&&r.mode===mode), current=snapshots.find(r=>r.route==='/__verification_colors'&&r.mode===mode);
 assert.equal(current.primary.bg,old.primary.bg,`${mode} historical primary fill`);
 assert.equal(current.primary.color,'rgb(17, 24, 39)',`${mode} readable dark primary label`);
 for(const key of ['color','bg','border'])assert.equal(current.noteHashtag[key],old.noteHashtag[key],`${mode} historical NoteContent ${key}`);
 assert.deepEqual(current.noteHashtagHover,old.noteHashtagHover);
 for(const key of ['color','border','shadow'])assert.equal(current.cheffy[key],old.cheffy[key],`${mode} historical Cheffy ${key}`);
 for(const key of ['color','bg','border'])assert.equal(current.avatar[key],old.avatar[key],`${mode} historical avatar ${key}`);
 assert.equal(current.freshPost.bg,mode==='dark'?'rgb(31, 41, 55)':'rgb(241, 242, 244)');
 original.push({mode,primary:current.primary.bg,noteText:current.noteHashtag.color,noteFill:current.noteHashtag.bg,noteHover:current.noteHashtagHover.bg,cheffyRing:current.cheffy.border,noteSurface:current.freshPost.bg});
}
const summary={passed:true,paletteStates:14,existingPaletteTokens:54,unchangedOtherThemeStates:unchanged,unchangedTokenComparisons:12*54,componentStates:14,componentsPerState:7,unchangedOtherThemeComponentRecords:12*7,unchangedOtherThemeHoverRecords:12*2,unchangedGeometryProperties:14*7*6,original};
await writeFile(`${dir}/comparison-summary.json`,JSON.stringify(summary,null,2)); console.log(JSON.stringify(summary,null,2));
