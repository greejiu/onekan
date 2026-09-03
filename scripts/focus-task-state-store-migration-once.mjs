import fs from "node:fs";
import assert from "node:assert/strict";

const focusPath = "js/focus-task-card.js";
const indexPath = "index.html";
const regressionPath = "scripts/focus-task-state-store-regression.mjs";

let focus = fs.readFileSync(focusPath, "utf8");
const originalFocus = focus;

focus = focus.replace(
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore, supabase } from "./supabase.js";',
);

const oldStateAccess = `async function readState() {
  await resolveUser();
  if (!user) {
    state = null;
    return null;
  }
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

async function writeState(mutator) {
  await readState();
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "focus-task-card" } }));
  scheduleRender(60, false);
  return true;
}`;

const newStateAccess = `async function readState() {
  await resolveUser();
  if (!user) {
    state = null;
    return null;
  }
  const stored = await onekanStateStore.read({ userId: user.id });
  state = normalizeState(stored);
  return state;
}

async function writeState(mutator) {
  await resolveUser();
  if (!user) return false;
  const committed = await onekanStateStore.mutate((current) => {
    const next = normalizeState(current);
    mutator(next);
    return next;
  }, { userId: user.id, source: "focus-task-card" });
  if (!committed) {
    state = null;
    return false;
  }
  state = normalizeState(committed);
  scheduleRender(60, false);
  return true;
}`;

assert.ok(focus.includes(oldStateAccess), "focus-task-card state access block changed; migration refused");
focus = focus.replace(oldStateAccess, newStateAccess);
assert.notEqual(focus, originalFocus, "focus-task-card.js was not changed");
fs.writeFileSync(focusPath, focus);

let index = fs.readFileSync(indexPath, "utf8");
assert.ok(index.includes('./js/focus-task-card.js?v=2'), "focus-task-card cache version is not v=2");
index = index.replace('./js/focus-task-card.js?v=2', './js/focus-task-card.js?v=3');
fs.writeFileSync(indexPath, index);

fs.writeFileSync(regressionPath, `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst source = fs.readFileSync("js/focus-task-card.js", "utf8");\nassert.match(source, /import \\{ onekanStateStore, supabase \\} from "\\.\\/supabase\\.js";/);\nassert.doesNotMatch(source, /supabase\\.from\\(["']onekan_state["']\\)/);\nassert.match(source, /onekanStateStore\\.read\\(\\{ userId: user\\.id \\}\\)/);\nassert.match(source, /onekanStateStore\\.mutate\\(\\(current\\) => \\{/);\nassert.match(source, /source: "focus-task-card"/);\nassert.match(source, /supabase\\.auth\\.onAuthStateChange/);\nconst index = fs.readFileSync("index.html", "utf8");\nassert.match(index, /focus-task-card\\.js\\?v=3/);\nconsole.log("focus task direct state-store regression: ok");\n`);

fs.rmSync("scripts/focus-task-state-store-migration-once.mjs");
fs.rmSync(".github/workflows/focus-task-state-store-migration-once.yml");

console.log("focus-task-card state-store migration applied");
