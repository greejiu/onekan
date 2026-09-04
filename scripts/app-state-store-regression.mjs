import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("js/app.js", "utf8");
assert.match(app, /import \{ onekanStateStore \} from "\.\/supabase\.js(?:\?v=\d+)?";/);
assert.doesNotMatch(app, /supabase\.from\(["']onekan_state["']\)/);
assert.match(app, /onekanStateStore\.read\(\{ userId: user\.id \}\)/);
assert.match(app, /onekanStateStore\.mutate\(\(remote\) => threeWayMerge\(baseState, snapshot, remote\), \{ userId, source: "app" \}\)/);
assert.match(app, /lastSavedState = snapshot;/);
assert.match(app, /import \{ threeWayMerge \} from "\.\/state-store\.js\?v=\d+";/);
console.log("app direct state-store regression: ok");
