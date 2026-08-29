import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('js/app.js', 'utf8');
const repeat = fs.readFileSync('js/repeat-overview.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(repeat, /let habitMode="calendar";/, 'habit page must open in calendar mode');
assert.match(repeat, /let habitCalendarView="day";/, 'habit calendar must open on day');
assert.match(repeat, /let habitCalendarLayout="board";/, 'habit day must open on board layout');
assert.match(repeat, /data-habit-cal-layout-toggle/, 'habit week and day calendars must expose the timeline toggle');
assert.match(repeat, /function habitTimelineDay\(/, 'habit calendar must render a dedicated timeline day');
assert.match(repeat, /data-uw-all-day-drop/, 'untimed habits must remain movable through the all-day area');
assert.match(app, /GROUP_DRAG_MOUSE_DISTANCE = 6;/, 'desktop group drag must use the shared movement threshold');
assert.match(app, /GROUP_DRAG_TOUCH_SCROLL_DISTANCE = 10;/, 'touch scrolling must cancel group drag before activation');
assert.match(app, /GROUP_DRAG_TOUCH_HOLD_MS = 450;/, 'mobile group drag must use the shared long-press delay');
assert.match(app, /groupList\.addEventListener\("pointerdown"/, 'group drag must use delegated pointer handling');
assert.doesNotMatch(app, /data-event-group-drag[^>]*disabled/, 'every group must be reorderable');
assert.match(app, /group\.id === "default"/, 'default group deletion protection must follow its identity, not its position');
assert.match(index, /app\.js\?v=43/);
assert.match(index, /repeat-overview\.js\?v=10/);

console.log('habit default and group drag regression: ok');
