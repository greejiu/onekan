import assert from 'node:assert/strict';
import fs from 'node:fs';

const u=fs.readFileSync('js/unified-workspace.js','utf8');
const c=fs.readFileSync('css/unified-workspace.css','utf8');
const i=fs.readFileSync('index.html','utf8');

assert.match(u,/const planningOnly=\(g\.dropType==="time-block"\|\|g\.dropType==="time-block-unassigned"\)&&g\.start===null&&\(g\.kind==="task"\|\|g\.kind==="habit"\)/,'untimed task/habit block moves should be planning-only');
assert.match(u,/const scope=planningOnly\?"day":await dragMoveScope/,'planning-only block moves should skip recurring scope dialog');
assert.match(u,/if\(planningOnly\)\{[\s\S]*placeTimeBlockOccurrence\(next,g\.nextDate,placementToken,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/,'planning-only drop should save V2 placement directly');
assert.match(c,/\.uw-time-exact-lane\{position:absolute;inset:0;min-width:0;pointer-events:none\}\.uw-time-exact-lane \.uw-time-entry\{pointer-events:auto\}/,'empty timeline hit grid must remain pointer reachable');
assert.match(i,/unified-workspace\.js\?v=55/);
assert.match(i,/unified-workspace\.css\?v=44/);
console.log('drag/input fix regression: ok');
