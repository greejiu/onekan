import fs from "node:fs";

function replaceOrFail(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`replace target missing: ${label}`);
  return source.replace(before, after);
}

const modulePath = "js/project-status-automation.js";
let moduleSource = fs.readFileSync(modulePath, "utf8");
moduleSource = replaceOrFail(
  moduleSource,
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore, supabase } from "./supabase.js";',
  "project status import",
);

const oldReconcile = `async function reconcile() {
  if (syncing) return;
  syncing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const current = data?.data && typeof data.data === "object" ? data.data : {};
    const promotedProjects = promoteProjectsWithTasks(current);
    const changedGoals = reconcileGoalStatuses(current);
    if (!promotedProjects.length && !changedGoals.length) return;
    const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: current }, { onConflict: "user_id" });
    if (saveError) throw saveError;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "project-status-automation" } }));
    document.querySelector("#reloadCloudBtn")?.click();
  } catch (error) {
    console.error("프로젝트 상태 자동 변경 실패", error);
  } finally {
    syncing = false;
  }
}`;

const newReconcile = `async function reconcile() {
  if (syncing) return;
  syncing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const userId = session.user.id;
    const snapshot = await onekanStateStore.read({ userId });
    const probe = snapshot && typeof snapshot === "object" ? JSON.parse(JSON.stringify(snapshot)) : {};
    const promotedProjects = promoteProjectsWithTasks(probe);
    const changedGoals = reconcileGoalStatuses(probe);
    if (!promotedProjects.length && !changedGoals.length) return;
    await onekanStateStore.mutate((current) => {
      promoteProjectsWithTasks(current);
      reconcileGoalStatuses(current);
      return current;
    }, { userId, source: "project-status-automation" });
    document.querySelector("#reloadCloudBtn")?.click();
  } catch (error) {
    console.error("프로젝트 상태 자동 변경 실패", error);
  } finally {
    syncing = false;
  }
}`;

moduleSource = replaceOrFail(moduleSource, oldReconcile, newReconcile, "project status reconcile");
fs.writeFileSync(modulePath, moduleSource);

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
index = replaceOrFail(index, './js/project-status-automation.js?v=2', './js/project-status-automation.js?v=3', "project status cache version");
fs.writeFileSync(indexPath, index);

for (const file of fs.readdirSync("scripts").filter((name) => name.endsWith(".mjs"))) {
  const path = `scripts/${file}`;
  if (path === "scripts/project-status-state-store-migration-once.mjs") continue;
  const before = fs.readFileSync(path, "utf8");
  const after = before
    .replaceAll("project-status-automation\\.js\\?v=2", "project-status-automation\\.js\\?v=3")
    .replaceAll("project-status-automation.js?v=2", "project-status-automation.js?v=3");
  if (after !== before) fs.writeFileSync(path, after);
}

const regression = `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst source = fs.readFileSync("js/project-status-automation.js", "utf8");\nconst index = fs.readFileSync("index.html", "utf8");\n\nassert.match(source, /import \\{ onekanStateStore, supabase \\} from "\\.\\/supabase\\.js";/);\nassert.match(source, /onekanStateStore\\.read\\(\\{ userId \\}\\)/);\nassert.match(source, /onekanStateStore\\.mutate\\(\\(current\\) => \\{/);\nassert.match(source, /\\{ userId, source: "project-status-automation" \\}/);\nassert.doesNotMatch(source, /supabase\\.from\\(["']onekan_state["']\\)/);\nassert.doesNotMatch(source, /document\\.dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/);\nassert.match(source, /if \\(!promotedProjects\\.length && !changedGoals\\.length\\) return;/);\nassert.match(index, /project-status-automation\\.js\\?v=3/);\nconsole.log("project status automation direct state-store regression: ok");\n`;
fs.writeFileSync("scripts/project-status-state-store-regression.mjs", regression);

const specPath = "claude/state-store-spec.md";
let spec = fs.readFileSync(specPath, "utf8");
spec = replaceOrFail(
  spec,
`4. \`unified-workspace.js\`\n   - 일정·할일·습관·타임라인의 고빈도 저장을 \`mutate()\`로 이전\n   - mutator 실행 중에는 최신 store 상태를 임시 전역 state로 연결해 기존 helper의 동작을 유지\n   - store가 상태변경 이벤트를 발행하므로 수동 \`onekan:state-changed\` dispatch는 제거\n\n다음 후보:\n1. habit/project 계열 writer`,
`4. \`unified-workspace.js\`\n   - 일정·할일·습관·타임라인의 고빈도 저장을 \`mutate()\`로 이전\n   - mutator 실행 중에는 최신 store 상태를 임시 전역 state로 연결해 기존 helper의 동작을 유지\n   - store가 상태변경 이벤트를 발행하므로 수동 \`onekan:state-changed\` dispatch는 제거\n5. \`project-status-automation.js\`\n   - 프로젝트·목표 상태 자동 승격/재계산을 \`read() / mutate()\`로 이전\n   - 변경 필요 여부는 읽은 snapshot으로 먼저 확인해 불필요한 자동 저장을 줄임\n   - 실제 커밋 시 최신 remote 상태에서 다시 상태를 계산하고 store 이벤트를 사용\n\n다음 후보:\n1. 나머지 project/habit 계열 writer`,
  "state-store project status migration status",
);
spec = replaceOrFail(
  spec,
  '- `app.js`, `focus-task-card.js`, `project-popup-planning.js`, `unified-workspace.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  '- `app.js`, `focus-task-card.js`, `project-popup-planning.js`, `unified-workspace.js`, `project-status-automation.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  "state-store verification list",
);
fs.writeFileSync(specPath, spec);

fs.rmSync("scripts/project-status-state-store-migration-once.mjs");
fs.rmSync(".github/workflows/project-status-state-store-migration-once.yml");
console.log("project status automation state-store migration applied");
