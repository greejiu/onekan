import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/focus-task-card.js", "utf8");
assert.match(source, /import \{ onekanStateStore, supabase \} from "\.\/supabase\.js(?:\?v=\d+)?";/);
assert.doesNotMatch(source, /supabase\.from\(["']onekan_state["']\)/);
assert.match(source, /onekanStateStore\.read\(\{ userId: user\.id \}\)/);
assert.match(source, /onekanStateStore\.mutate\(\(current\) => \{/);
assert.match(source, /source: "focus-task-card"/);
assert.match(source, /supabase\.auth\.onAuthStateChange/);
const index = fs.readFileSync("index.html", "utf8");
const focusCardVersion = Number(index.match(/focus-task-card\.js\?v=(\d+)/)?.[1] || 0);
assert.ok(focusCardVersion >= 3, "focus-task-card cache version must not go backwards");
console.log("focus task direct state-store regression: ok");
