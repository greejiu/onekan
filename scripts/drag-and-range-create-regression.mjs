import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/const planningMove=g\.canUseTimeBlock&&g\.planToken&&g\.start===null;/,'untimed planning items must use planner drag path');
assert.match(u,/\.uw-time-block-v2-section,\.uw-timeline,\.uw-all-day\[data-uw-all-day-drop\]/,'planner surfaces must include blank timeline and all-day');
assert.match(u,/const directPlanningMove=Boolean\(g\.planToken&&g\.start===null&&\(g\.kind==="task"\|\|g\.kind==="habit"\)&&!dateChanged/,'same-day task/habit time-block moves must bypass recurrence scope');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.date,g\.planToken,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'direct planning move must persist placement');
assert.match(c,/\.uw-time-exact-lane\{position:absolute;inset:0;min-width:0;pointer-events:none\}\.uw-time-exact-lane \.uw-time-entry\{pointer-events:auto\}/,'exact lane must not block blank time hits');
assert.match(u,/if\(hit\)\{mode="time-create";source=hit\}/,'drag-to-create path must remain active');
assert.match(i,/unified-workspace\.js\?v=55/);
assert.match(i,/unified-workspace\.css\?v=44/);
console.log('drag and range-create regression: ok');
