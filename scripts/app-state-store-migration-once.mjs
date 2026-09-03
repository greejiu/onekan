import fs from "node:fs";

function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing patch marker: ${label}`);
  if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`ambiguous patch marker: ${label}`);
  return text.replace(before, after);
}

const appPath = "js/app.js";
let app = fs.readFileSync(appPath, "utf8");
app = replaceOnce(app, 'import { supabase } from "./supabase.js";', 'import { onekanStateStore } from "./supabase.js";', "app state-store import");
app = replaceOnce(app, 'let state = defaultState();\nlet saveChain = Promise.resolve();', 'let state = defaultState();\nlet lastSavedState = defaultState();\nlet saveChain = Promise.resolve();', "app save baseline");
app = replaceOnce(app,
`async function loadStateFromCloud(user) {
  setSyncStatus("불러오는 중...");
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(error);
    setSyncStatus("불러오기 실패", true);
    throw error;
  }

  if (!data) {
    state = defaultState();
    const { error: insertError } = await supabase.from("onekan_state").insert({ user_id: user.id, data: state });
    if (insertError) throw insertError;
  } else {
    state = normalizeState(data.data);
  }

  ensureHabitDay();
  loadedUserId = user.id;
  setSyncStatus("저장됨");
}

function save() {
  if (!currentUser) return Promise.resolve();
  const userId = currentUser.id;
  const snapshot = JSON.parse(JSON.stringify(state));
  setSyncStatus("저장 중...");
  saveChain = saveChain.then(async () => {
    const { error } = await supabase.from("onekan_state").upsert({ user_id: userId, data: snapshot }, { onConflict: "user_id" });
    if (error) throw error;
    setSyncStatus("저장됨");
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "app" } }));
  }).catch((error) => {
    console.error(error);
    setSyncStatus("저장 실패", true);
  });
  return saveChain;
}`,
`async function loadStateFromCloud(user) {
  setSyncStatus("불러오는 중...");
  try {
    const stored = await onekanStateStore.read({ userId: user.id });
    state = normalizeState(stored);
    lastSavedState = JSON.parse(JSON.stringify(state));
  } catch (error) {
    console.error(error);
    setSyncStatus("불러오기 실패", true);
    throw error;
  }

  ensureHabitDay();
  loadedUserId = user.id;
  setSyncStatus("저장됨");
}

function save() {
  if (!currentUser) return Promise.resolve();
  const userId = currentUser.id;
  const snapshot = JSON.parse(JSON.stringify(state));
  setSyncStatus("저장 중...");
  saveChain = saveChain.then(async () => {
    const baseState = JSON.parse(JSON.stringify(lastSavedState));
    await onekanStateStore.commit(snapshot, { userId, source: "app", baseState });
    lastSavedState = snapshot;
    setSyncStatus("저장됨");
  }).catch((error) => {
    console.error(error);
    setSyncStatus("저장 실패", true);
  });
  return saveChain;
}`,
"app cloud load/save");
app = replaceOnce(app, '  state = defaultState();\n  clearInterval(tickHandle);', '  state = defaultState();\n  lastSavedState = defaultState();\n  clearInterval(tickHandle);', "app logout baseline reset");
fs.writeFileSync(appPath, app);

const storePath = "js/state-store.js";
let store = fs.readFileSync(storePath, "utf8");
store = replaceOnce(store,
`  async function mutate(mutator, { userId = null, source = "state-store" } = {}) {
`,
`  async function commit(localState, { userId = null, source = "state-store-commit", baseState = null } = {}) {
    const resolved = await resolveUserId(userId);
    if (!resolved || !isPlainObject(localState)) return null;
    return enqueue(async () => {
      const remote = await fetchRemote(resolved);
      const local = stripStateStoreMeta(localState);
      const explicitBase = isPlainObject(baseState) ? stripStateStoreMeta(baseState) : null;
      const base = explicitBase || baseFor(localState) || remote;
      const merged = threeWayMerge(base, local, remote);
      const { error } = await rawClient.from("onekan_state").upsert({ user_id: resolved, data: merged }, { onConflict: "user_id" });
      if (error) throw error;
      const tagged = rememberBase(cloneValue(merged));
      const detail = { source, userId: resolved, state: cloneValue(merged) };
      notify(detail);
      browserDispatch("onekan:state-changed", { source, state: cloneValue(merged) });
      return tagged;
    });
  }

  async function mutate(mutator, { userId = null, source = "state-store" } = {}) {
`,
"state-store commit API");
store = replaceOnce(store, `  return {
    read,
    mutate,
`, `  return {
    read,
    commit,
    mutate,
`, "state-store return commit");
fs.writeFileSync(storePath, store);

const regressionPath = "scripts/state-store-regression.mjs";
let regression = fs.readFileSync(regressionPath, "utf8");
regression = replaceOnce(regression,
`const legacyRaw = new FakeClient(base);
const { client: legacyClient } = createStateStoreClient(legacyRaw);
const untagged = structuredClone(base);
untagged.ui.sidebarCollapsed = true;
await legacyClient.from("onekan_state").upsert({ user_id: "u1", data: untagged }, { onConflict: "user_id" });
assert.equal(legacyRaw.db.data.ui.sidebarCollapsed, true);

console.log("state store regression: ok");`,
`const legacyRaw = new FakeClient(base);
const { client: legacyClient } = createStateStoreClient(legacyRaw);
const untagged = structuredClone(base);
untagged.ui.sidebarCollapsed = true;
await legacyClient.from("onekan_state").upsert({ user_id: "u1", data: untagged }, { onConflict: "user_id" });
assert.equal(legacyRaw.db.data.ui.sidebarCollapsed, true);

const directRaw = new FakeClient(base);
const { store: directStore } = createStateStoreClient(directRaw);
const appBase = stripStateStoreMeta(await directStore.read({ userId: "u1" }));
const appFirst = structuredClone(appBase);
appFirst.habitDays["2026-09-03"].h1 = true;
directRaw.db.data.tasks[0].subtaskProgress.external = true;
await directStore.commit(appFirst, { userId: "u1", source: "app-test", baseState: appBase });
assert.equal(directRaw.db.data.habitDays["2026-09-03"].h1, true);
assert.equal(directRaw.db.data.tasks[0].subtaskProgress.external, true);

const appSecond = structuredClone(appFirst);
appSecond.habitDays["2026-09-03"].h1 = false;
await directStore.commit(appSecond, { userId: "u1", source: "app-test", baseState: appFirst });
assert.equal(directRaw.db.data.habitDays["2026-09-03"].h1, false);
assert.equal(directRaw.db.data.tasks[0].subtaskProgress.external, true);

console.log("state store regression: ok");`,
"state-store direct commit regression");
fs.writeFileSync(regressionPath, regression);

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
index = replaceOnce(index, './js/app.js?v=53', './js/app.js?v=54', "app cache version");
fs.writeFileSync(indexPath, index);

fs.writeFileSync("scripts/app-state-store-regression.mjs", `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst app = fs.readFileSync("js/app.js", "utf8");\nconst store = fs.readFileSync("js/state-store.js", "utf8");\n\nassert.match(app, /import \\{ onekanStateStore \\} from "\\.\\/supabase\\.js";/);\nassert.doesNotMatch(app, /supabase\\.from\\(["']onekan_state["']\\)/);\nassert.match(app, /onekanStateStore\\.read\\(\\{ userId: user\\.id \\}\\)/);\nassert.match(app, /onekanStateStore\\.commit\\(snapshot, \\{ userId, source: "app", baseState \\}\\)/);\nassert.match(app, /lastSavedState = snapshot;/);\nassert.match(store, /async function commit\\(localState, \\{ userId = null, source = "state-store-commit", baseState = null \\} = \\{\\}\\)/);\nconsole.log("app direct state-store regression: ok");\n`);

fs.writeFileSync("claude/state-store-app-migration.md", `# app.js state-store 직접 이전\n\n상태: 구현 (2026-09-04)\n\n- app.js의 onekan_state 직접 select/upsert를 제거하고 onekanStateStore.read/commit API를 사용한다.\n- commit은 app이 마지막으로 저장한 로컬 기준(baseState)과 현재 로컬 스냅샷, 최신 원격 상태를 3-way merge한다.\n- 저장 성공 뒤 app의 기준은 방금 저장을 요청한 로컬 스냅샷으로 전진한다. 원격에서만 추가된 데이터는 app 메모리에 억지로 덮어쓰지 않으면서 다음 저장에서도 보존된다.\n- 같은 사용자가 빠르게 여러 번 저장해도 app의 기존 saveChain 순서를 유지한다.\n- 기존 Supabase proxy 호환층은 아직 다른 모듈을 위해 유지한다. 다음 이전 대상은 focus-task-card.js, project-popup-planning.js 순서다.\n`);

fs.rmSync("scripts/app-state-store-migration-once.mjs");
fs.rmSync(".github/workflows/app-state-store-migration-once.yml");
