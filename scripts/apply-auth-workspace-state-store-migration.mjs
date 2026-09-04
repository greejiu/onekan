import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

// auth.js: keep Supabase auth, move recovery state read to shared store.
{
  const file = "js/auth.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";\nimport { stripStateStoreMeta } from "./state-store.js?v=1";',
    "auth imports",
  );
  const pattern = /async function recoverLoadedState\(user\) \{[\s\S]*?\n\}\n\nfunction friendlyAuthError/;
  const replacement = `async function recoverLoadedState(user) {
  try {
    const stored = await onekanStateStore.read({ userId: user.id });
    if (stored && typeof stored === "object") {
      const sharedState = stripStateStoreMeta(stored);
      window.__ONEKAN_APP_STATE__ = sharedState;
      document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "auth-recovery", state: sharedState } }));
    }
    setAppStatus("저장됨");
    return true;
  } catch (error) {
    console.error("클라우드 상태 복구 확인 실패", error);
    setAppStatus("데이터 불러오기 실패", true);
    return false;
  }
}

function friendlyAuthError`;
  text = replaceOnce(text, pattern, replacement, "auth recovery state read");
  fs.writeFileSync(file, text);
}

// workspace-pages.js: keep auth session resolution, move state reads/writes to shared store.
{
  const file = "js/workspace-pages.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    "workspace imports",
  );
  const pattern = /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function writeState\(mutator\) \{[\s\S]*?\n\}\n\nfunction taskDateLabel/;
  const replacement = `function normalizeState(value) {
  const next = value && typeof value === "object" ? value : {};
  next.tasks = Array.isArray(next.tasks) ? next.tasks : [];
  next.eventGroups = Array.isArray(next.eventGroups) ? next.eventGroups : [];
  next.habitTemplates = Array.isArray(next.habitTemplates) ? next.habitTemplates : [];
  next.habitDays = next.habitDays && typeof next.habitDays === "object" ? next.habitDays : {};
  next.projects = Array.isArray(next.projects) ? next.projects : [];
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

async function writeState(mutator) {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return;
  const committed = await onekanStateStore.mutate((latest) => {
    const next = normalizeState(latest);
    mutator(next);
    return next;
  }, { userId: user.id, source: "workspace-pages" });
  if (!committed) return;
  state = normalizeState(committed);
  $("#reloadCloudBtn")?.click();
  await renderAll();
}

function taskDateLabel`;
  text = replaceOnce(text, pattern, replacement, "workspace state helpers");
  fs.writeFileSync(file, text);
}

// task-completed-groups.js: read tasks through shared store; auth lookup is handled there.
{
  const file = "js/task-completed-groups.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore } from "./supabase.js";',
    "task completed import",
  );
  const pattern = /async function readTasks\(\) \{[\s\S]*?\n\}/;
  const replacement = `async function readTasks() {
  const stored = await onekanStateStore.read();
  return Array.isArray(stored?.tasks) ? stored.tasks : [];
}`;
  text = replaceOnce(text, pattern, replacement, "task completed state read");
  fs.writeFileSync(file, text);
}

// Extend permanent direct-access regression and shrink debt allowlist.
{
  const file = "scripts/state-store-direct-access-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  const anchor = 'const period = fs.readFileSync("js/project-period-popover.js", "utf8");';
  text = replaceOnce(
    text,
    anchor,
    `${anchor}\nconst auth = fs.readFileSync("js/auth.js", "utf8");\nconst workspace = fs.readFileSync("js/workspace-pages.js", "utf8");\nconst completedGroups = fs.readFileSync("js/task-completed-groups.js", "utf8");`,
    "regression fixtures",
  );
  const assertionAnchor = 'assert.doesNotMatch(period, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/);';
  text = replaceOnce(
    text,
    assertionAnchor,
    `${assertionAnchor}\n\nassert.match(auth, /onekanStateStore\\.read\\(/);\nassert.match(auth, /stripStateStoreMeta\\(/);\nassert.doesNotMatch(auth, /supabase\\.from\\(["']onekan_state["']\\)/);\n\nassert.match(workspace, /onekanStateStore\\.read\\(/);\nassert.match(workspace, /onekanStateStore\\.mutate\\(/);\nassert.doesNotMatch(workspace, /supabase\\.from\\(["']onekan_state["']\\)/);\n\nassert.match(completedGroups, /onekanStateStore\\.read\\(\\)/);\nassert.doesNotMatch(completedGroups, /supabase\\.(?:auth|from)/);`,
    "regression assertions",
  );
  for (const name of ["auth.js", "task-completed-groups.js", "workspace-pages.js"]) {
    text = replaceOnce(text, `  "${name}",\n`, "", `remove ${name} debt allowlist`);
  }
  fs.writeFileSync(file, text);
}

const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/auth.js", "js/workspace-pages.js", "js/task-completed-groups.js"];
const queued = new Set(queue);
const processed = new Set();
function changedAssets() {
  return execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(value));
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
console.log("auth/workspace state-store migration applied");
