import fs from "node:fs";

function replaceOrFail(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`replace target missing: ${label}`);
  return source.replace(before, after);
}

const popupPath = "js/project-popup-planning.js";
let popup = fs.readFileSync(popupPath, "utf8");
popup = replaceOrFail(
  popup,
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore, supabase } from "./supabase.js";',
  "popup import",
);
popup = replaceOrFail(
  popup,
`  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalize(data?.data);`,
`  const stored = await onekanStateStore.read({ userId: user.id });
  state = normalize(stored);`,
  "popup readState",
);
popup = replaceOrFail(
  popup,
`async function writeState(mutator, source) {
  const current = await readState();
  if (!user) return false;
  mutator(current);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  document.querySelector("#reloadCloudBtn")?.click();
  scheduleRender(20);
  return true;
}`,
`async function writeState(mutator, source) {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return false;
  const committed = await onekanStateStore.mutate((current) => {
    const next = normalize(current);
    mutator(next);
    return next;
  }, { userId: user.id, source });
  if (!committed) return false;
  state = normalize(committed);
  document.querySelector("#reloadCloudBtn")?.click();
  scheduleRender(20);
  return true;
}`,
  "popup writeState",
);
fs.writeFileSync(popupPath, popup);

const sidebarPath = "js/sidebar-navigation.js";
let sidebar = fs.readFileSync(sidebarPath, "utf8");
sidebar = replaceOrFail(sidebar, 'import("./project-popup-planning.js?v=1")', 'import("./project-popup-planning.js?v=2")', "popup cache version");
fs.writeFileSync(sidebarPath, sidebar);

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
index = replaceOrFail(index, './js/sidebar-navigation.js?v=1', './js/sidebar-navigation.js?v=2', "sidebar cache version");
fs.writeFileSync(indexPath, index);

const popupRegressionPath = "scripts/project-popup-planning-regression.mjs";
let popupRegression = fs.readFileSync(popupRegressionPath, "utf8");
popupRegression = replaceOrFail(popupRegression, /project-popup-planning\\.js\\?v=1/.source, /project-popup-planning\\.js\\?v=2/.source, "popup regression cache version");
popupRegression = replaceOrFail(
  popupRegression,
  'assert.match(popup, /undoRepeatingTaskCompletion/);',
  'assert.match(popup, /undoRepeatingTaskCompletion/);\nassert.match(popup, /onekanStateStore\\.read/);\nassert.match(popup, /onekanStateStore\\.mutate/);\nassert.doesNotMatch(popup, /supabase\\.from\\(["\']onekan_state["\']\\)/);',
  "popup state-store assertions",
);
fs.writeFileSync(popupRegressionPath, popupRegression);

const sidebarRegressionPath = "scripts/sidebar-navigation-regression.mjs";
let sidebarRegression = fs.readFileSync(sidebarRegressionPath, "utf8");
sidebarRegression = replaceOrFail(sidebarRegression, 'project-popup-planning.js?v=1', 'project-popup-planning.js?v=2', "sidebar regression popup cache version");
fs.writeFileSync(sidebarRegressionPath, sidebarRegression);

const directRegression = `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst popup = fs.readFileSync("js/project-popup-planning.js", "utf8");\nconst sidebar = fs.readFileSync("js/sidebar-navigation.js", "utf8");\nconst index = fs.readFileSync("index.html", "utf8");\n\nassert.match(popup, /import \\{ onekanStateStore, supabase \\} from "\\.\\/supabase\\.js";/);\nassert.match(popup, /onekanStateStore\\.read\\(\\{ userId: user\\.id \\}\\)/);\nassert.match(popup, /onekanStateStore\\.mutate\\(\\(current\\) => \\{/);\nassert.doesNotMatch(popup, /supabase\\.from\\(["']onekan_state["']\\)/);\nassert.doesNotMatch(popup, /document\\.dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/);\nassert.match(popup, /document\\.querySelector\\("#reloadCloudBtn"\\)\\?\\.click\\(\\)/);\nassert.match(sidebar, /project-popup-planning\\.js\\?v=2/);\nassert.match(index, /sidebar-navigation\\.js\\?v=2/);\nconsole.log("project popup direct state-store regression: ok");\n`;
fs.writeFileSync("scripts/project-popup-state-store-regression.mjs", directRegression);

const specPath = "claude/state-store-spec.md";
let spec = fs.readFileSync(specPath, "utf8");
spec = replaceOrFail(
  spec,
`2. \`focus-task-card.js\`
   - \`onekan_state\` 직접 \`select / upsert\` 제거
   - 하위할일 추가·삭제·체크, 집중 할일 선택을 \`mutate()\` 한 트랜잭션 흐름에서 처리

다음 후보:
1. \`project-popup-planning.js\`
2. \`unified-workspace.js\`
3. habit/project 계열 writer`,
`2. \`focus-task-card.js\`
   - \`onekan_state\` 직접 \`select / upsert\` 제거
   - 하위할일 추가·삭제·체크, 집중 할일 선택을 \`mutate()\` 한 트랜잭션 흐름에서 처리
3. \`project-popup-planning.js\`
   - 프로젝트 팝업의 할일·습관 추가/완료 저장을 \`mutate()\`로 이전
   - 팝업 갱신은 store 커밋 상태를 사용하고, 기존 앱 상태 동기화를 위한 서버 새로고침 트리거는 유지

다음 후보:
1. \`unified-workspace.js\`
2. habit/project 계열 writer`,
  "state-store migration status",
);
spec = replaceOrFail(
  spec,
  '- `app.js`와 `focus-task-card.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  '- `app.js`, `focus-task-card.js`, `project-popup-planning.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  "state-store verification list",
);
fs.writeFileSync(specPath, spec);

fs.rmSync("scripts/project-popup-state-store-migration-once.mjs");
fs.rmSync(".github/workflows/project-popup-state-store-migration-once.yml");
console.log("project popup state-store migration applied");
