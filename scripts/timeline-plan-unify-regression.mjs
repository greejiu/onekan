import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/uw-time-block-plan-item uw-time-block-v2-item plan-draggable/,'projected timeline items must remain planner draggable');
assert.match(u,/data-time-block-token=.*data-time-block-block-id=.*data-time-block-after-anchor=.*data-time-block-order=/s,'projected timeline items must carry placement metadata');
assert.match(u,/const timeline=pointed\?\.closest\("\.uw-timeline"\)/,'planner drop logic must support timeline');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.date,g\.token,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'timeline planning drag must save block anchor order');
assert.match(u,/const projectedPlannerRow=Boolean\(plannerRow&&item\.closest\("\.uw-timeline"\)\)/,'timeline-projected plans must be distinguished from list-only planning rows');
assert.match(u,/mode=plannerRow&&!projectedPlannerRow\?"time-block-plan":"move"/,'timeline-projected plans must use the shared item move gesture');
assert.match(u,/g\.planToken=item\.dataset\.timeBlockToken\|\|""/,'shared move gesture must retain the source time-block assignment token');
assert.match(u,/if\(g\.dropType==="time"\)await saveTimedChange\([^;]+g\.planDate,g\.planToken\)/,'projected plans must move into exact timeline time through the normal save path');
assert.match(u,/clearMovedPlan\(current,planDate,planToken\)/,'moving a projected plan must clear its old time-block assignment atomically');
assert.match(u,/uw-time-block-plan-drop-surface/,'timeline plan rail should be an explicit planner drop surface');
assert.doesNotMatch(c,/uw-time-block-plan-group::before/,'plan connector line should be removed');
assert.doesNotMatch(c,/uw-time-block-plan-group::after/,'plan connector dot should be removed');
assert.doesNotMatch(c,/\.uw-time-block-plan-item\{[^}]*border-style:dashed/,'projected cards should not use special dashed border');
assert.match(c,/\.uw-time-block-plan-item\{min-height:18px;padding:2px 4px;font-size:9px;pointer-events:auto;overflow:hidden\}/,'projected cards should match normal timeline card sizing');
assert.match(c,/\.uw-time-block-plan-item \.uw-item-title\{font-size:11px\}/,'projected title size should match normal item title');
assert.match(i,/unified-workspace\.js\?v=49/);
assert.match(i,/unified-workspace\.css\?v=40/);
console.log('timeline plan unify regression: ok');
