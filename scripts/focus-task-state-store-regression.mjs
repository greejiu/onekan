import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/focus-task-card.js", "utf8");
assert.match(source, /import \{ onekanStateStore, supabase \} from "\.\/supabase\.js";/);
assert.doesNotMatch(source, /supabase\.from\(["']onekan_state["']\)/);
assert.match(source, /onekanStateStore\.read\(\{ userId: user\.id \}\)/);
assert.match(source, /onekanStateStore\.mutate\(\(current\) => \{/);
assert.match(source, /source: "focus-task-card"/);
assert.match(source, /supabase\.auth\.onAuthStateChange/);
const index = fs.readFileSync("index.html", "utf8");
assert.match(index, /focus-task-card\.js\?v=3/);
console.log("focus task direct state-store regression: ok");
