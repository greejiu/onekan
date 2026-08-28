import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.doesNotMatch(u,/document\.addEventListener\("click",async e=>\{if\(Date\.now\(\)<suppressItemClickUntil\)\{e\.preventDefault\(\);e\.stopImmediatePropagation\(\);return\}/,'drag click guard must not blanket-block all clicks');
assert.match(u,/Date\.now\(\)<suppressItemClickUntil&&e\.target\.closest\("\.uw-item,\.uw-inline-form"\)/,'drag click guard must only suppress item or inline-form clicks');
assert.match(u,/const scope=await dragMoveScope\(g\.kind,g\.id,g\.occurrenceSource,g\.date\)/,'drag should still ask recurring scope before saving');
assert.match(u,/if\(g\.dropType==="time-block"&&g\.planToken&&g\.nextBlockId\)/,'time block drop save path must remain present');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.nextDate,placementToken,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'time block placement must still persist block anchor order');
assert.match(i,/unified-workspace\.js\?v=54/,'cache version should be bumped');
console.log('drag scope click guard regression: ok');
