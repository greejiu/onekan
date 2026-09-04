import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

function migrateStateHelpers(file, normalizeBody, sourceExpr) {
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    `${file} import`,
  );

  const helperPattern = /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function writeState\(mutator(?:, source)?\) \{[\s\S]*?\n\}/;
  const writeSignature = file === "js/project-context-extension.js" ? "async function writeState(mutator, source)" : "async function writeState(mutator)";
  const sourceOption = file === "js/project-context-extension.js" ? "source" : JSON.stringify(sourceExpr);
  const replacement = `function normalizeState(value) {\n  const state = value && typeof value === "object" ? value : {};\n${normalizeBody}\n  return state;\n}\n\nasync function readState() {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session?.user) return null;\n  const stored = await onekanStateStore.read({ userId: session.user.id });\n  return { user: session.user, state: normalizeState(stored) };\n}\n\n${writeSignature} {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session?.user) return false;\n  await onekanStateStore.mutate((latest) => {\n    const state = normalizeState(latest);\n    mutator(state);\n    return state;\n  }, { userId: session.user.id, source: ${sourceOption} });\n  $("#reloadCloudBtn")?.click();\n  return true;\n}`;
  text = replaceOnce(text, helperPattern, replacement, `${file} state helpers`);
  fs.writeFileSync(file, text);
}

migrateStateHelpers(
  "js/context-menu.js",
  `  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];\n  state.events = Array.isArray(state.events) ? state.events : [];\n  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];\n  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];\n  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];\n  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};\n  state.projects = Array.isArray(state.projects) ? state.projects : [];\n  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];\n  state.identities = Array.isArray(state.identities) ? state.identities : [];\n  state.projectGroups = Array.isArray(state.projectGroups) ? state.projectGroups : [];\n  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];\n  state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};\n  state.ui.homeDashboard = state.ui.homeDashboard && typeof state.ui.homeDashboard === "object" ? state.ui.homeDashboard : {};\n  state.ui.homeDashboard.secondaryDdays = Array.isArray(state.ui.homeDashboard.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays.slice(0, 3) : [];`,
  "context-menu",
);

migrateStateHelpers(
  "js/direction-context-extension.js",
  `  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];\n  state.identities = Array.isArray(state.identities) ? state.identities : [];\n  state.projects = Array.isArray(state.projects) ? state.projects : [];`,
  "direction-context",
);

migrateStateHelpers(
  "js/project-context-extension.js",
  `  state.projects = Array.isArray(state.projects) ? state.projects : [];\n  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];\n  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];`,
  null,
);

// Strengthen the permanent direct-access guard and shrink debt.
{
  const file = "scripts/state-store-direct-access-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  const fixtureAnchor = 'const completedGroups = fs.readFileSync("js/task-completed-groups.js", "utf8");';
  text = replaceOnce(
    text,
    fixtureAnchor,
    `${fixtureAnchor}\nconst contextMenu = fs.readFileSync("js/context-menu.js", "utf8");\nconst directionContext = fs.readFileSync("js/direction-context-extension.js", "utf8");\nconst projectContext = fs.readFileSync("js/project-context-extension.js", "utf8");`,
    "regression fixtures",
  );
  const assertionAnchor = 'assert.doesNotMatch(completedGroups, /supabase\\.(?:auth|from)/);';
  text = replaceOnce(
    text,
    assertionAnchor,
    `${assertionAnchor}\n\nfor (const [name, source] of [["context-menu", contextMenu], ["direction-context", directionContext], ["project-context", projectContext]]) {\n  assert.match(source, /onekanStateStore\\.read\\(/, name + " shared read");\n  assert.match(source, /onekanStateStore\\.mutate\\(/, name + " shared mutate");\n  assert.doesNotMatch(source, /supabase\\.from\\(["']onekan_state["']\\)/, name + " direct state access");\n  assert.doesNotMatch(source, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/, name + " duplicate state event");\n}`,
    "regression assertions",
  );
  for (const name of ["context-menu.js", "direction-context-extension.js", "project-context-extension.js"]) {
    text = replaceOnce(text, `  "${name}",\n`, "", `remove ${name} debt allowlist`);
  }
  fs.writeFileSync(file, text);
}

const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/context-menu.js", "js/direction-context-extension.js", "js/project-context-extension.js"];
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
console.log("context state-store migration applied");
