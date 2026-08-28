import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/const DRAG_MOUSE_DISTANCE=6,TOUCH_SCROLL_DISTANCE=10,TOUCH_HOLD_MS=450;/,'shared drag thresholds must be centralized');
assert.match(u,/const plannerRow=Boolean\(item\?\.classList\.contains\("uw-time-block-v2-item"\).*plan-draggable/,'planner rows must join shared drag source detection');
assert.match(u,/const timelineRow=Boolean\(item\?\.classList\.contains\("uw-time-entry"\).*closest\("\.uw-timeline"\)/,'timeline rows must join shared drag source detection');
assert.match(u,/const sharedDragRow=!interactive&&\(plannerRow\|\|timelineRow\);/,'list and timeline must share one drag candidate rule');
assert.match(u,/else if\(sharedDragRow\)\{mode=plannerRow\?"time-block-plan":"move";source=item\}/,'shared gesture must only differ in save mode');
assert.match(u,/if\(g\.coarse\)g\.timer=setTimeout\(\(\)=>activate\(g\),TOUCH_HOLD_MS\);/,'touch hold threshold must be common');
assert.match(u,/if\(g\.coarse&&distance>TOUCH_SCROLL_DISTANCE\)\{g\.cancelled=true;clear\(g\);return\}/,'touch scroll cancellation must be common');
assert.match(u,/if\(!g\.coarse&&distance>=DRAG_MOUSE_DISTANCE\)activate\(g\);/,'mouse movement threshold must be common');
assert.match(u,/placeTimeBlockOccurrence\(next,g\.date,g\.token,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'planner drag save semantics must remain precise');
assert.match(u,/saveTimedChange\(g\.kind,g\.id,g\.nextDate,g\.nextStart,g\.duration,g\.occurrenceSource\)/,'timeline drag save semantics must remain time-based');
assert.match(c,/\.uw-timeline \.uw-time-entry\.uw-item \.uw-move-handle\{display:none!important\}/,'home timeline legacy move handle must be hidden');
assert.match(i,/unified-workspace\.js\?v=45/,'JS cache must bump');
assert.match(i,/unified-workspace\.css\?v=38/,'CSS cache must bump');
console.log('shared home drag gesture regression: ok');
