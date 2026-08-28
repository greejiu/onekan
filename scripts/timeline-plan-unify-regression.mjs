import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/uw-time-block-plan-item uw-time-block-v2-item plan-draggable/,'projected timeline items must remain planner draggable');
assert.match(u,/data-time-block-token=.*data-time-block-block-id=.*data-time-block-after-anchor=.*data-time-block-order=/s,'projected timeline items must carry placement metadata');
assert.match(u,/const timeline=pointed\?\.closest\("\.uw-timeline"\)/,'planner drop logic must support timeline');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.nextDate,g\.planToken,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'shared drag must save time-block anchor order when dropped back into a block');
assert.match(u,/const movableRow=Boolean\(item\?\.matches\("\.uw-item\[data-uw-kind\]"\)/,'all task, event and habit cards must enter the shared move rule');
assert.match(u,/else if\(sharedDragRow\)\{mode="move";source=item\}/,'list, timeline and time-block cards must use one shared move gesture');
assert.match(u,/const DRAG_MOUSE_DISTANCE=6,TOUCH_SCROLL_DISTANCE=10,TOUCH_HOLD_MS=450/,'shared drag must preserve mouse threshold and mobile long-press rules');
assert.match(u,/const sharedDragRow=!interactive&&movableRow/,'buttons and form controls must stay clickable instead of starting a drag');
assert.doesNotMatch(u,/mode="time-block-plan"/,'time-block cards must not enter a separate drag mode');
assert.match(u,/g\.planToken=item\.dataset\.timeBlockToken\|\|""/,'shared move gesture must retain the source time-block assignment token');
assert.match(u,/if\(g\.dropType==="time"\)await saveTimedChange\([^;]+g\.planDate,g\.planToken\)/,'projected plans must move into exact timeline time through the normal save path');
assert.match(u,/clearMovedPlan\(current,planDate,planToken\)/,'moving a projected plan must clear its old time-block assignment atomically');
assert.match(u,/uw-time-block-plan-drop-surface/,'timeline plan rail should be an explicit planner drop surface');
assert.doesNotMatch(c,/uw-time-block-plan-group::before/,'plan connector line should be removed');
assert.doesNotMatch(c,/uw-time-block-plan-group::after/,'plan connector dot should be removed');
assert.doesNotMatch(c,/\.uw-time-block-plan-item\{[^}]*border-style:dashed/,'projected cards should not use special dashed border');
assert.match(c,/\.uw-time-block-plan-item\{min-height:18px;padding:2px 4px;font-size:9px;pointer-events:auto;overflow:hidden\}/,'projected cards should match normal timeline card sizing');
assert.match(c,/\.uw-time-block-plan-item \.uw-item-title\{font-size:11px\}/,'projected title size should match normal item title');
assert.match(i,/unified-workspace\.js\?v=50/);
assert.match(i,/unified-workspace\.css\?v=40/);
console.log('timeline plan unify regression: ok');
