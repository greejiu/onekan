import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

// appearance.js: keep Supabase auth/storage, move onekan_state read/write to shared store.
{
  const file = "js/appearance.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    "appearance import",
  );
  const pattern = /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function writeAppearance\(appearanceChanges = \{\}, uiChanges = \{\}\) \{[\s\S]*?\n\}\n\nasync function applyAppearance\(\) \{/;
  const replacement = `function normalizeState(value) {
  const next = value && typeof value === "object" ? value : {};
  next.ui = next.ui && typeof next.ui === "object" ? next.ui : {};
  next.ui.homeAppearance = { position: "center", overlay: 28, ...(next.ui.homeAppearance || {}) };
  next.ui.themeColor = validColor(next.ui.themeColor);
  const range = next.ui.timelineRange && typeof next.ui.timelineRange === "object" ? next.ui.timelineRange : {};
  const start = clamp(Math.round((Number(range.start) || 360) / 30) * 30, 0, 1350);
  const end = clamp(Math.round((Number(range.end) || 1320) / 30) * 30, start + 30, 1440);
  next.ui.timelineRange = { start, end };
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return state = null;
  const stored = await onekanStateStore.read({ userId: user.id });
  state = normalizeState(stored);
  return state;
}

async function writeAppearance(appearanceChanges = {}, uiChanges = {}) {
  const current = await readState();
  if (!current || !user) return;
  const committed = await onekanStateStore.mutate((latest) => {
    const next = normalizeState(latest);
    next.ui.homeAppearance = { ...next.ui.homeAppearance, ...appearanceChanges };
    next.ui = { ...next.ui, ...uiChanges, homeAppearance: next.ui.homeAppearance };
    return next;
  }, { userId: user.id, source: "appearance" });
  if (!committed) return;
  state = normalizeState(committed);
  await applyAppearance();
  $("#reloadCloudBtn")?.click();
}

async function applyAppearance() {`;
  text = replaceOnce(text, pattern, replacement, "appearance state helpers");
  fs.writeFileSync(file, text);
}

// load-recovery.js: shared read, strip store metadata before restoring the app state snapshot.
{
  const file = "js/load-recovery.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore } from "./supabase.js";\nimport { stripStateStoreMeta } from "./state-store.js?v=1";',
    "load recovery import",
  );
  const pattern = /    const \{ data: \{ session \}, error: sessionError \} = await supabase\.auth\.getSession\(\);\n    if \(sessionError \|\| !session\?\.user\) return;\n    const \{ data, error \} = await supabase\.from\("onekan_state"\)\.select\("data"\)\.eq\("user_id", session\.user\.id\)\.maybeSingle\(\);\n    if \(error\) return;\n    if \(data\?\.data && typeof data\.data === "object"\) \{\n      const sharedState = JSON\.parse\(JSON\.stringify\(data\.data\)\);/;
  const replacement = `    const stored = await onekanStateStore.read();
    if (!stored) return;
    const sharedState = stripStateStoreMeta(stored);
    if (sharedState && typeof sharedState === "object") {`;
  text = replaceOnce(text, pattern, replacement, "load recovery state read");
  fs.writeFileSync(file, text);
}

// project-period-popover.js: direct shared read/mutate, no duplicate state-changed dispatch.
{
  const file = "js/project-period-popover.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore } from "./supabase.js";',
    "project period import",
  );
  const pattern = /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function savePeriod\(startDate, endDate\) \{[\s\S]*?\n\}\n\nfunction installStyle\(\) \{/;
  const replacement = `async function readState() {
  const state = await onekanStateStore.read();
  if (!state) return null;
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  return state;
}

async function savePeriod(startDate, endDate) {
  const id = activeProjectId;
  if (!id) return;
  await onekanStateStore.mutate((current) => {
    current.projects = Array.isArray(current.projects) ? current.projects : [];
    const project = current.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
    if (!project) return current;
    project.startDate = startDate || null;
    project.endDate = endDate || null;
    project.updatedAt = new Date().toISOString();
    return current;
  }, { source: "project-period-popover" });
}

function installStyle() {`;
  text = replaceOnce(text, pattern, replacement, "project period state helpers");
  text = replaceOnce(text,
    'const project = current?.state.projects.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));',
    'const project = current?.projects.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));',
    "project period open state shape",
  );
  fs.writeFileSync(file, text);
}

const regression = `import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appearance = fs.readFileSync("js/appearance.js", "utf8");
const recovery = fs.readFileSync("js/load-recovery.js", "utf8");
const period = fs.readFileSync("js/project-period-popover.js", "utf8");

assert.match(appearance, /onekanStateStore\\.read\\(/);
assert.match(appearance, /onekanStateStore\\.mutate\\(/);
assert.doesNotMatch(appearance, /supabase\\.from\\(["']onekan_state["']\\)/);

assert.match(recovery, /onekanStateStore\\.read\\(\\)/);
assert.match(recovery, /stripStateStoreMeta\\(/);
assert.doesNotMatch(recovery, /supabase\\.(?:auth|from)/);

assert.match(period, /onekanStateStore\\.read\\(\\)/);
assert.match(period, /onekanStateStore\\.mutate\\(/);
assert.doesNotMatch(period, /supabase\\./);
assert.doesNotMatch(period, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/);

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
const directPattern = /\\.from\\(\\s*["']onekan_state["']\\s*\\)/g;
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
assert.deepEqual(unexpected, [], `new direct onekan_state access: ${unexpected.join(", ")}`);
console.log(`remaining direct onekan_state debt: ${debt.join(", ") || "none"}`);
console.log("small state-store migration regression: ok");
`;
fs.writeFileSync("scripts/state-store-direct-access-regression.mjs", regression);

const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/appearance.js", "js/load-recovery.js", "js/project-period-popover.js"];
const queued = new Set(queue);
const processed = new Set();
function changedAssets() {
  return execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" })
    .split(/\r?\n/).map((v) => v.trim())
    .filter((v) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(v));
}
while (queue.length) {
  const target = queue.shift();
  execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--bump", target], { stdio: "inherit" });
  processed.add(target);
  for (const asset of changedAssets()) {
    if (processed.has(asset) || queued.has(asset)) continue;
    queued.add(asset);
    queue.push(asset);
  }
}
execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--check-diff", base], { stdio: "inherit" });
console.log("small state-store migration applied");
