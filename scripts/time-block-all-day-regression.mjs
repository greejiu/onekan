import assert from 'node:assert/strict';
import fs from 'node:fs';

const unified = fs.readFileSync('js/unified-workspace.js', 'utf8');
assert.match(unified, /<strong>하루종일<\/strong>/, 'home list should label the virtual unassigned section as 하루종일');
assert.match(unified, /<option value=""\$\{selected\?"":" selected"\}>하루종일<\/option>/, 'temporary picker empty option should say 하루종일');
assert.match(unified, /블럭 밖 시간/, 'exact timed items outside every block need their own section');
assert.match(unified, /outsideTimed\.push\(entry\)/, 'timed entries outside active blocks must not enter 하루종일');
assert.match(unified, /if\(target\)target\.manual\.push\(entry\);else allDay\.push\(entry\)/, 'untimed unassigned entries should enter 하루종일');
assert.match(unified, /uw-all-day-label">하루종일/, 'timeline all-day label should use the same wording');
assert.match(unified, /직접 배치한 시간 없는 할일·습관은 ‘하루종일’으로 이동합니다/, 'date-only delete copy should use 하루종일');
assert.match(unified, /직접 배치한 시간 없는 할일·습관만 ‘하루종일’으로 이동해요/, 'empty-block copy should use 하루종일');
assert.doesNotMatch(unified, /타임블럭 없음/, 'old user-facing label should be gone from unified workspace');

const index = fs.readFileSync('index.html', 'utf8');
assert.match(index, /unified-workspace\.js\?v=42/, 'cache should be bumped');
console.log('time block all-day semantics regression: ok');
