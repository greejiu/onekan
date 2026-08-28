import assert from 'node:assert/strict';
import fs from 'node:fs';

const u = fs.readFileSync('js/unified-workspace.js','utf8');
const c = fs.readFileSync('css/unified-workspace.css','utf8');
const i = fs.readFileSync('index.html','utf8');

assert.doesNotMatch(u, /data-uw-time-block-drag/, 'dedicated time block drag handle should be removed');
assert.doesNotMatch(u, /uw-time-block-drag-handle/, 'dedicated drag handle markup should be removed');
assert.match(u, /plannerRow=item\?\.classList\.contains\("uw-time-block-v2-item"\).*plan-draggable/, 'untimed planner row should be detected as drag source');
assert.match(u, /!e\.target\.closest\("button,input,select,textarea,a,\[contenteditable=true\]"\)/, 'interactive controls should not start row drag');
assert.match(u, /else if\(plannerRow\)\{mode="time-block-plan";source=item\}/, 'whole planner row should be the drag source');
assert.match(u, /if\(g\.coarse\)g\.timer=setTimeout\(\(\)=>activate\(g\),450\)/, 'touch drag should require deliberate long press');
assert.match(u, /if\(g\.coarse&&distance>10\)\{g\.cancelled=true;clear\(g\);return\}/, 'touch movement before activation should remain scroll');
assert.match(u, /placeTimeBlockOccurrence\(s,g\.date,g\.token,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/, 'row drag must preserve precise block/anchor/order placement');
assert.match(u, /clearTimeBlockAssignment\(s,g\.date,g\.token\)/, 'dropping into all-day should clear assignment');
assert.match(c, /uw-time-block-v2-item\.plan-draggable\{cursor:grab;user-select:none\}/, 'desktop row should visually indicate drag affordance');
assert.doesNotMatch(c, /uw-time-block-drag-handle/, 'drag handle CSS should be removed');
assert.match(i, /unified-workspace\.js\?v=44/, 'JS cache should be bumped');
assert.match(i, /unified-workspace\.css\?v=37/, 'CSS cache should be bumped');
console.log('time block full-row drag regression: ok');
