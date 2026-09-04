import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appearance = fs.readFileSync("js/appearance.js", "utf8");
const recovery = fs.readFileSync("js/load-recovery.js", "utf8");
const period = fs.readFileSync("js/project-period-popover.js", "utf8");

assert.match(appearance, /onekanStateStore\.read\(/);
assert.match(appearance, /onekanStateStore\.mutate\(/);
assert.doesNotMatch(appearance, /supabase\.from\(["']onekan_state["']\)/);

assert.match(recovery, /onekanStateStore\.read\(\)/);
assert.match(recovery, /stripStateStoreMeta\(/);
assert.doesNotMatch(recovery, /supabase\.(?:auth|from)/);

assert.match(period, /onekanStateStore\.read\(\)/);
assert.match(period, /onekanStateStore\.mutate\(/);
assert.doesNotMatch(period, /supabase\.(?:auth|from|storage)/);
assert.doesNotMatch(period, /dispatchEvent\(new CustomEvent\("onekan:state-changed"/);

const debtAllowlist = new Set([
  "auth.js",
  "backup-manager.js",
  "context-menu.js",
  "direction-context-extension.js",
  "project-bookmark.js",
  "project-context-extension.js",
  "project-direction-tabs.js",
  "project-status.js",
  "task-completed-groups.js",
  "time-block-v2-settings.js",
  "tracking-stats.js",
  "workspace-pages.js",
]);
const coreAllowlist = new Set(["state-store.js"]);
const directPattern = /\.from\(\s*["']onekan_state["']\s*\)/g;
const unexpected = [];
const debt = [];
for (const name of fs.readdirSync("js").filter((value) => value.endsWith(".js")).sort()) {
  const text = fs.readFileSync(path.join("js", name), "utf8");
  if (!directPattern.test(text)) { directPattern.lastIndex = 0; continue; }
  directPattern.lastIndex = 0;
  if (coreAllowlist.has(name)) continue;
  if (debtAllowlist.has(name)) debt.push(name);
  else unexpected.push(name);
}
assert.deepEqual(unexpected, [], "new direct onekan_state access: " + unexpected.join(", "));
console.log("remaining direct onekan_state debt: " + (debt.join(", ") || "none"));
console.log("small state-store migration regression: ok");
