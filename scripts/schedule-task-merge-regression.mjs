import assert from "node:assert/strict";
import fs from "node:fs";

const merge = fs.readFileSync(new URL("../js/schedule-task-merge.js", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../js/sidebar-navigation.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/schedule-task-merge.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(sidebar, /removeTaskNavigation[\s\S]*?data-page=\\?"tasks\\?"/, "sidebar must remove the standalone task navigation item");
assert.match(sidebar, /schedule-task-merge\.js\?v=1/, "sidebar loader must start the merged schedule module");
assert.match(html, /id="page-tasks"/, "legacy task page stays available internally during migration");
assert.match(merge, /visibleScheduleKinds/, "eye toggle state must be stored in account UI state");
assert.match(merge, /\["event","task"\]/, "events and tasks must both be visible by default");
assert.match(merge, /data-merged-kind-toggle="\$\{kind\}"/, "schedule kind eye toggles must be rendered");
assert.match(merge, /\[\["month","월"\],\["week","주"\],\["day","일"\]\]/, "calendar month/week/day views must remain available");
assert.match(merge, /\[\["all","전체"\],\["upcoming","예정"\],\["someday","언젠가"\],\["done","완료"\]\]/, "task list tabs must survive inside schedule list mode");
assert.match(merge, /function monthBoard\(/);
assert.match(merge, /function board\(/);
assert.match(merge, /function timeline\(/);
assert.match(merge, /function somedayList\(/);
assert.match(merge, /supabase\.from\("onekan_state"\)\.upsert/, "eye toggle state must persist to the signed-in account");
assert.match(merge, /data-manual-list/, "someday/manual task ordering hooks must be preserved");
assert.match(merge, /data-uw-toggle-sessions/, "time tracking visibility must continue to use the existing toggle contract");
assert.match(css, /\.merged-kind-toggle\.active/, "eye toggle active state must be styled");
assert.match(css, /@media\(max-width:700px\)/, "merged schedule controls must be mobile responsive");
assert.doesNotMatch(merge, /#page-home\b/, "merged module must not take over the home page");
assert.doesNotMatch(merge, /#page-repeat\b/, "merged module must not take over the habit page");

console.log("schedule task merge regression: ok");
