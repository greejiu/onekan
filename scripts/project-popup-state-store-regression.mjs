import assert from "node:assert/strict";
import fs from "node:fs";

const popup = fs.readFileSync("js/project-popup-planning.js", "utf8");
const sidebar = fs.readFileSync("js/sidebar-navigation.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

assert.match(popup, /import \{ onekanStateStore, supabase \} from "\.\/supabase\.js";/);
assert.match(popup, /onekanStateStore\.read\(\{ userId: user\.id \}\)/);
assert.match(popup, /onekanStateStore\.mutate\(\(current\) => \{/);
assert.doesNotMatch(popup, /supabase\.from\(["']onekan_state["']\)/);
assert.doesNotMatch(popup, /document\.dispatchEvent\(new CustomEvent\("onekan:state-changed"/);
assert.match(popup, /document\.querySelector\("#reloadCloudBtn"\)\?\.click\(\)/);
assert.match(sidebar, /project-popup-planning\.js\?v=2/);
assert.match(index, /sidebar-navigation\.js\?v=2/);
console.log("project popup direct state-store regression: ok");
