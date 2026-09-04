import assert from "node:assert/strict";
import fs from "node:fs";

const task = fs.readFileSync("js/task-area-list.js", "utf8");
const habit = fs.readFileSync("js/habit-area-list.js", "utf8");

for (const [label, source] of [["task", task], ["habit", habit]]) {
  assert.match(source, /import \{ onekanStateStore \} from "\.\/supabase\.js";/, `${label} area list should import the shared state store`);
  assert.match(source, /onekanStateStore\.read\(\)/, `${label} area list should read through the shared state store`);
  assert.doesNotMatch(source, /supabase\.from\(["'"]onekan_state["'"]\)/, `${label} area list should not query oneKan state directly`);
  assert.doesNotMatch(source, /supabase\.auth\.getSession\(\)/, `${label} area list should let the shared state store resolve the session`);
}

console.log("area list direct state-store regression: ok");
