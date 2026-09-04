import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

function replaceImport(file) {
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    `${file} import`,
  );
  fs.writeFileSync(file, text);
}

// 1) project-bookmark.js: read-only state access.
{
  const file = "js/project-bookmark.js";
  replaceImport(file);
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    /async function loadState\(\) \{[\s\S]*?\n  appState = normalizeState\(data\?\.data\);\n  return true;\n\}/,
    `async function loadState() {\n  const { data: authData } = await supabase.auth.getSession();\n  const user = authData?.session?.user;\n  if (!user) {\n    appState = emptyState();\n    return false;\n  }\n  const stored = await onekanStateStore.read({ userId: user.id });\n  appState = normalizeState(stored);\n  return true;\n}`,
    "project bookmark loadState",
  );
  fs.writeFileSync(file, text);
}

// 2) project-direction-tabs.js: goal/identity reads and writes.
{
  const file = "js/project-direction-tabs.js";
  replaceImport(file);
  let text = fs.readFileSync(file, "utf8");
  const block = /async function readGoalState\(\) \{[\s\S]*?\n\}\n\nasync function writeGoalState\(mutator, source = "direction-goals"\) \{[\s\S]*?\n\}/;
  const replacement = `function normalizeDirectionState(value) {\n  const next = value && typeof value === "object" ? value : {};\n  next.directionGoals = Array.isArray(next.directionGoals) ? next.directionGoals : [];\n  next.identities = Array.isArray(next.identities) ? next.identities : [];\n  next.projects = Array.isArray(next.projects) ? next.projects : [];\n  return next;\n}\n\nfunction normalizeStoredGoalStatuses(current) {\n  let changed = false;\n  current.directionGoals.forEach((goal) => {\n    const normalized = normalizeGoalStatus(goal.status);\n    if (goal.status === normalized) return;\n    goal.status = normalized;\n    changed = true;\n  });\n  return changed;\n}\n\nasync function readGoalState() {\n  const { data: { session } } = await supabase.auth.getSession();\n  goalUser = session?.user || null;\n  if (!goalUser) {\n    goalState = null;\n    return null;\n  }\n  const stored = await onekanStateStore.read({ userId: goalUser.id });\n  goalState = normalizeDirectionState(stored);\n  if (normalizeStoredGoalStatuses(goalState)) {\n    const committed = await onekanStateStore.mutate((latest) => {\n      const next = normalizeDirectionState(latest);\n      normalizeStoredGoalStatuses(next);\n      return next;\n    }, { userId: goalUser.id, source: "direction-goals-status-migration" });\n    goalState = normalizeDirectionState(committed);\n  }\n  return goalState;\n}\n\nasync function writeGoalState(mutator, source = "direction-goals") {\n  const { data: { session } } = await supabase.auth.getSession();\n  goalUser = session?.user || null;\n  if (!goalUser) return false;\n  const committed = await onekanStateStore.mutate((latest) => {\n    const next = normalizeDirectionState(latest);\n    normalizeStoredGoalStatuses(next);\n    mutator(next);\n    return next;\n  }, { userId: goalUser.id, source });\n  goalState = normalizeDirectionState(committed);\n  $("#reloadCloudBtn")?.click();\n  return true;\n}`;
  text = replaceOnce(text, block, replacement, "direction state helpers");
  fs.writeFileSync(file, text);
}

// 3) project-status.js: project surface reads and writes.
{
  const file = "js/project-status.js";
  replaceImport(file);
  let text = fs.readFileSync(file, "utf8");
  const block = /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function writeState\(mutator, source = "project-status"\) \{[\s\S]*?\n\}/;
  const replacement = `function normalizeProjectState(value) {\n  const next = value && typeof value === "object" ? value : {};\n  ensureWritableStructure(next);\n  return next;\n}\n\nasync function readState() {\n  const { data: { session } } = await supabase.auth.getSession();\n  user = session?.user || null;\n  if (!user) {\n    state = null;\n    return null;\n  }\n  const stored = await onekanStateStore.read({ userId: user.id });\n  state = normalizeProjectState(stored);\n  return state;\n}\n\nasync function writeState(mutator, source = "project-status") {\n  const { data: { session } } = await supabase.auth.getSession();\n  user = session?.user || null;\n  if (!user) return false;\n  const committed = await onekanStateStore.mutate((latest) => {\n    const next = normalizeProjectState(latest);\n    mutator(next);\n    return next;\n  }, { userId: user.id, source });\n  state = normalizeProjectState(committed);\n  $("#reloadCloudBtn")?.click();\n  scheduleRender(100);\n  return true;\n}`;
  text = replaceOnce(text, block, replacement, "project status state helpers");
  fs.writeFileSync(file, text);
}

// Permanent direct-access regression: assert the three migrated modules and shrink debt.
{
  const file = "scripts/state-store-direct-access-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  const fixtureAnchor = 'const projectContext = fs.readFileSync("js/project-context-extension.js", "utf8");';
  text = replaceOnce(
    text,
    fixtureAnchor,
    `${fixtureAnchor}\nconst projectBookmark = fs.readFileSync("js/project-bookmark.js", "utf8");\nconst projectDirectionTabs = fs.readFileSync("js/project-direction-tabs.js", "utf8");\nconst projectStatus = fs.readFileSync("js/project-status.js", "utf8");`,
    "state-store regression fixtures",
  );
  const assertionAnchor = `for (const [name, source] of [["context-menu", contextMenu], ["direction-context", directionContext], ["project-context", projectContext]]) {\n  assert.match(source, /onekanStateStore\\.read\\(/, name + " shared read");\n  assert.match(source, /onekanStateStore\\.mutate\\(/, name + " shared mutate");\n  assert.doesNotMatch(source, /supabase\\.from\\(["']onekan_state["']\\)/, name + " direct state access");\n  assert.doesNotMatch(source, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/, name + " duplicate state event");\n}`;
  text = replaceOnce(
    text,
    assertionAnchor,
    `${assertionAnchor}\n\nassert.match(projectBookmark, /onekanStateStore\\.read\\(/, "project bookmark shared read");\nassert.doesNotMatch(projectBookmark, /supabase\\.from\\(["']onekan_state["']\\)/, "project bookmark direct state access");\nfor (const [name, source] of [["project-direction-tabs", projectDirectionTabs], ["project-status", projectStatus]]) {\n  assert.match(source, /onekanStateStore\\.read\\(/, name + " shared read");\n  assert.match(source, /onekanStateStore\\.mutate\\(/, name + " shared mutate");\n  assert.doesNotMatch(source, /supabase\\.from\\(["']onekan_state["']\\)/, name + " direct state access");\n  assert.doesNotMatch(source, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/, name + " duplicate state event");\n}`,
    "state-store regression assertions",
  );
  for (const name of ["project-bookmark.js", "project-direction-tabs.js", "project-status.js"]) {
    text = replaceOnce(text, `  "${name}",\n`, "", `remove ${name} debt`);
  }
  fs.writeFileSync(file, text);
}

// Existing bookshelf regression should permit future valid cache bumps.
{
  const file = "scripts/project-bookshelf-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'if (!index.includes("project-status.js?v=14")) throw new Error("프로젝트 서재 스크립트 캐시 버전이 갱신되지 않았습니다.");',
    'const projectStatusVersion = Number(index.match(/project-status\\.js\\?v=(\\d+)/)?.[1] || 0);\nif (projectStatusVersion < 14) throw new Error("프로젝트 서재 스크립트 캐시 버전이 갱신되지 않았습니다.");',
    "bookshelf cache assertion",
  );
  fs.writeFileSync(file, text);
}

const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/project-bookmark.js", "js/project-direction-tabs.js", "js/project-status.js"];
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
console.log("project surfaces state-store migration applied");
