import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing patch marker: ${label}`);
  if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`ambiguous patch marker: ${label}`);
  return text.replace(before, after);
}

execFileSync("git", ["checkout", "origin/main", "--", "js/state-store.js", "scripts/state-store-regression.mjs"], { stdio: "inherit" });

const appPath = "js/app.js";
let app = fs.readFileSync(appPath, "utf8");
app = replaceOnce(
  app,
  'import { onekanStateStore } from "./supabase.js";\n',
  'import { onekanStateStore } from "./supabase.js";\nimport { threeWayMerge } from "./state-store.js?v=1";\n',
  "app three-way merge import",
);
app = replaceOnce(
  app,
  '    await onekanStateStore.commit(snapshot, { userId, source: "app", baseState });\n    lastSavedState = snapshot;',
  '    await onekanStateStore.mutate((remote) => threeWayMerge(baseState, snapshot, remote), { userId, source: "app" });\n    lastSavedState = snapshot;',
  "app direct mutate save",
);
fs.writeFileSync(appPath, app);

const staticTestPath = "scripts/app-state-store-regression.mjs";
let test = fs.readFileSync(staticTestPath, "utf8");
test = test.replace('const store = fs.readFileSync("js/state-store.js", "utf8");\n\n', '');
test = test.replace('assert.match(app, /onekanStateStore\\.commit\\(snapshot, \\{ userId, source: "app", baseState \\}\\)/);', 'assert.match(app, /onekanStateStore\\.mutate\\(\\(remote\\) => threeWayMerge\\(baseState, snapshot, remote\\), \\{ userId, source: "app" \\}\\)/);');
test = test.replace('assert.match(store, /async function commit\\(localState, \\{ userId = null, source = "state-store-commit", baseState = null \\} = \\{\\}\\)/);\n', 'assert.match(app, /import \\{ threeWayMerge \\} from "\\.\\/state-store\\.js\\?v=1";/);\n');
fs.writeFileSync(staticTestPath, test);

fs.writeFileSync("claude/state-store-app-migration.md", `# app.js state-store 직접 이전\n\n상태: 구현 (2026-09-04)\n\n- app.js의 onekan_state 직접 select/upsert를 제거하고 onekanStateStore.read/mutate API를 사용한다.\n- 저장 시 app이 마지막으로 성공적으로 저장한 로컬 기준(baseState), 현재 로컬 스냅샷, mutate가 받은 최신 원격 상태를 threeWayMerge한다.\n- 저장 성공 뒤 app의 기준은 방금 저장을 요청한 로컬 스냅샷으로 전진한다. 원격에서만 추가된 데이터는 app 메모리에 억지로 덮어쓰지 않으면서 다음 저장에서도 보존된다.\n- 같은 사용자가 빠르게 여러 번 저장해도 app의 기존 saveChain 순서를 유지한다.\n- state-store 자체 API/호환 proxy는 건드리지 않았다. 다음 이전 대상은 focus-task-card.js, project-popup-planning.js 순서다.\n`);

fs.rmSync("scripts/app-state-store-migration-fix-once.mjs");
fs.rmSync(".github/workflows/app-state-store-migration-fix-once.yml");
