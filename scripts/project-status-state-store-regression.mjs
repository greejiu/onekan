import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/project-status-automation.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

assert.match(source, /import \{ onekanStateStore, supabase \} from "\.\/supabase\.js";/);
assert.match(source, /onekanStateStore\.read\(\{ userId \}\)/);
assert.match(source, /onekanStateStore\.mutate\(\(current\) => \{/);
assert.match(source, /\{ userId, source: "project-status-automation" \}/);
assert.doesNotMatch(source, /supabase\.from\(["']onekan_state["']\)/);
assert.doesNotMatch(source, /document\.dispatchEvent\(new CustomEvent\("onekan:state-changed"/);
assert.match(source, /if \(!promotedProjects\.length && !changedGoals\.length\) return;/);
assert.match(index, /project-status-automation\.js\?v=3/);
console.log("project status automation direct state-store regression: ok");
