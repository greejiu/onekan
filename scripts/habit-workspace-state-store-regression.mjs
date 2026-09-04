import assert from "node:assert/strict";
import fs from "node:fs";

const overview = fs.readFileSync("js/repeat-overview.js", "utf8");
const history = fs.readFileSync("js/habit-history-view.js", "utf8");
const helper = fs.readFileSync("js/repeat-after-completion.js", "utf8");

assert.match(overview, /import \{ onekanStateStore \} from "\.\/supabase\.js(?:\?v=\d+)?";/);
assert.match(overview, /onekanStateStore\.read\(\)/);
assert.match(overview, /onekanStateStore\.mutate\(/);
assert.doesNotMatch(overview, /supabase\.(?:auth|from)/);
assert.doesNotMatch(overview, /let user=/);
assert.doesNotMatch(overview, /dispatchEvent\(new CustomEvent\("onekan:state-changed"/);

assert.match(history, /import \{ onekanStateStore \} from "\.\/supabase\.js(?:\?v=\d+)?";/);
assert.match(history, /onekanStateStore\.read\(\)/);
assert.doesNotMatch(history, /supabase\.(?:auth|from)/);

assert.doesNotMatch(helper, /from "\.\/supabase\.js(?:\?v=\d+)?"/);
assert.doesNotMatch(helper, /onekan_state/);

console.log("habit workspace direct state-store regression: ok");
