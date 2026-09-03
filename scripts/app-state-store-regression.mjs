import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("js/app.js", "utf8");
const store = fs.readFileSync("js/state-store.js", "utf8");

assert.match(app, /import \{ onekanStateStore \} from "\.\/supabase\.js";/);
assert.doesNotMatch(app, /supabase\.from\(["']onekan_state["']\)/);
assert.match(app, /onekanStateStore\.read\(\{ userId: user\.id \}\)/);
assert.match(app, /onekanStateStore\.commit\(snapshot, \{ userId, source: "app", baseState \}\)/);
assert.match(app, /lastSavedState = snapshot;/);
assert.match(store, /async function commit\(localState, \{ userId = null, source = "state-store-commit", baseState = null \} = \{\}\)/);
console.log("app direct state-store regression: ok");
