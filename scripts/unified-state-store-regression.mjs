import assert from "node:assert/strict";
import fs from "node:fs";

const unified = fs.readFileSync("js/unified-workspace.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

assert.match(unified, /import \{ onekanStateStore, supabase \} from "\.\/supabase\.js(?:\?v=\d+)?";/);
assert.match(unified, /onekanStateStore\.read\(\{userId:user\.id\}\)/);
assert.match(unified, /onekanStateStore\.mutate\(current=>\{/);
assert.match(unified, /\{userId:user\.id,source:"unified"\}/);
assert.doesNotMatch(unified, /supabase\.from\(["']onekan_state["']\)/);
assert.doesNotMatch(unified, /document\.dispatchEvent\(new CustomEvent\("onekan:state-changed",\{detail:\{source:"unified"/);
assert.match(unified, /const previous=state;state=next;try\{mutator\(next\);return next\}finally\{state=previous\}/);
assert.match(unified, /\$\("#reloadCloudBtn"\)\?\.click\(\)/);
assert.match(index, /unified-workspace\.js\?v=\d+/);
console.log("unified workspace direct state-store regression: ok");
