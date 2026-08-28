import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/function timeBlockV2TimelinePlanItemMarkup\(entry,k,row\)/,'timeline plan card should receive row placement metadata');
assert.match(u,/uw-time-block-plan-item uw-time-block-v2-item plan-draggable/,'timeline projected cards should use shared planner drag class');
assert.match(u,/data-time-block-token=\\"\$\{esc\(token\)\}\\"/,'timeline projected cards should expose occurrence token');
assert.match(u,/data-time-block-anchor=\\"\$\{esc\(timeBlockV2EntryToken\(x,k\)\)\}\\"/,'exact timeline rows should expose anchor token');
assert.match(u,/const timeline=pointed\?\.closest\("\.uw-timeline"\)/,'planner drop resolver should understand timeline targets');
assert.match(u,/timelineAllDay=pointed\?\.closest\("\.uw-all-day\[data-uw-all-day-drop\]"\)/,'timeline all-day should clear planning assignment');
assert.match(u,/return\{dropType:"time-block",date,blockId:String\(exactBlock.id\),afterAnchor,order:peers.length\+1\}/,'dropping around an exact anchor should resolve placement data');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.date,g\.token,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'timeline planning drag should persist through the same placement helper');
assert.doesNotMatch(c,/uw-time-block-plan-item\{[^}]*border-style:dashed/,'projected cards should no longer use dashed borders');
assert.match(c,/uw-time-block-v2-list\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'desktop time block lists should be two columns');
assert.match(c,/uw-time-block-v2-item\.fixed-anchor,.uw-time-block-v2-list \.uw-time-block-v2-empty\{grid-column:1\/-1\}/,'exact anchors and empty rows should span both columns');
assert.match(c,/@media\(max-width:700px\)\{\.uw-time-block-v2-list\{grid-template-columns:minmax\(0,1fr\)\}\}/,'mobile list should return to one column');
assert.match(i,/unified-workspace\.js\?v=46/,'JS cache should be bumped');
assert.match(i,/unified-workspace\.css\?v=39/,'CSS cache should be bumped');
console.log('timeline plan drag + two-column list regression: ok');
