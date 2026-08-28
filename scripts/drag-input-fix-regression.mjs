import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.ok(u.includes('data-time-block-anchor="${esc(token)}" data-time="${Number(entry.time)}" data-duration="${Math.max(SLOT,Number(entry.duration)||SLOT)}"'),'timed list cards must expose time and duration to shared drag');
assert.ok(u.includes('const directPlanningMove=Boolean(g.planToken&&g.start===null&&(g.kind==="task"||g.kind==="habit")'),'untimed task/habit time-block moves should stay date-specific planning moves');
assert.ok(u.includes('placeTimeBlockOccurrence(next,g.date,g.planToken,g.nextBlockId,g.nextAfterAnchor,g.nextOrder)'),'direct planning move must persist block placement');
assert.ok(c.includes('.uw-time-exact-lane{position:absolute;inset:0;min-width:0;pointer-events:none}.uw-time-exact-lane .uw-time-entry{pointer-events:auto}'),'empty timeline hit grid must remain pointer reachable');
assert.ok(i.includes('unified-workspace.js?v=56'));
assert.ok(i.includes('unified-workspace.css?v=44'));
console.log('drag/input fix regression: ok');
