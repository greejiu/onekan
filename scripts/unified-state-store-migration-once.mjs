import fs from "node:fs";

function replaceOrFail(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`replace target missing: ${label}`);
  return source.replace(before, after);
}

const unifiedPath = "js/unified-workspace.js";
let unified = fs.readFileSync(unifiedPath, "utf8");
unified = replaceOrFail(
  unified,
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore, supabase } from "./supabase.js";',
  "unified import",
);
unified = replaceOrFail(
  unified,
  'async function read(){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;const remote=data?.data;if(remote&&typeof remote==="object")state=normalize(remote);else if(!state)state=normalize({});return state}',
  'async function read(){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return null;const remote=await onekanStateStore.read({userId:user.id});if(remote&&typeof remote==="object")state=normalize(remote);else if(!state)state=normalize({});return state}',
  "unified read",
);
unified = replaceOrFail(
  unified,
  'async function write(mutator){await read();if(!state||!user)return;mutator(state);const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});if(error)throw error;document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source:"unified"}}));$("#reloadCloudBtn")?.click();scheduleRender(130)}',
  'async function write(mutator){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return;const committed=await onekanStateStore.mutate(current=>{const next=normalize(current);const previous=state;state=next;try{mutator(next);return next}finally{state=previous}},{userId:user.id,source:"unified"});if(!committed)return;state=normalize(committed);$("#reloadCloudBtn")?.click();scheduleRender(130)}',
  "unified write",
);
fs.writeFileSync(unifiedPath, unified);

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
index = replaceOrFail(index, './js/unified-workspace.js?v=103', './js/unified-workspace.js?v=104', "unified cache version");
fs.writeFileSync(indexPath, index);

for (const file of fs.readdirSync("scripts").filter((name) => name.endsWith(".mjs"))) {
  const path = `scripts/${file}`;
  const before = fs.readFileSync(path, "utf8");
  const after = before
    .replaceAll("unified-workspace\\.js\\?v=103", "unified-workspace\\.js\\?v=104")
    .replaceAll("unified-workspace.js?v=103", "unified-workspace.js?v=104");
  if (after !== before) fs.writeFileSync(path, after);
}

const directRegression = `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst unified = fs.readFileSync("js/unified-workspace.js", "utf8");\nconst index = fs.readFileSync("index.html", "utf8");\n\nassert.match(unified, /import \\{ onekanStateStore, supabase \\} from "\\.\\/supabase\\.js";/);\nassert.match(unified, /onekanStateStore\\.read\\(\\{userId:user\\.id\\}\\)/);\nassert.match(unified, /onekanStateStore\\.mutate\\(current=>\\{/);\nassert.match(unified, /\\{userId:user\\.id,source:"unified"\\}/);\nassert.doesNotMatch(unified, /supabase\\.from\\(["']onekan_state["']\\)/);\nassert.doesNotMatch(unified, /document\\.dispatchEvent\\(new CustomEvent\\("onekan:state-changed",\\{detail:\\{source:"unified"/);\nassert.match(unified, /const previous=state;state=next;try\\{mutator\\(next\\);return next\\}finally\\{state=previous\\}/);\nassert.match(unified, /\\$\\("#reloadCloudBtn"\\)\\?\\.click\\(\\)/);\nassert.match(index, /unified-workspace\\.js\\?v=104/);\nconsole.log("unified workspace direct state-store regression: ok");\n`;
fs.writeFileSync("scripts/unified-state-store-regression.mjs", directRegression);

const specPath = "claude/state-store-spec.md";
let spec = fs.readFileSync(specPath, "utf8");
spec = replaceOrFail(
  spec,
`3. \`project-popup-planning.js\`\n   - 프로젝트 팝업의 할일·습관 추가/완료 저장을 \`mutate()\`로 이전\n   - 팝업 갱신은 store 커밋 상태를 사용하고, 기존 앱 상태 동기화를 위한 서버 새로고침 트리거는 유지\n\n다음 후보:\n1. \`unified-workspace.js\`\n2. habit/project 계열 writer`,
`3. \`project-popup-planning.js\`\n   - 프로젝트 팝업의 할일·습관 추가/완료 저장을 \`mutate()\`로 이전\n   - 팝업 갱신은 store 커밋 상태를 사용하고, 기존 앱 상태 동기화를 위한 서버 새로고침 트리거는 유지\n4. \`unified-workspace.js\`\n   - 일정·할일·습관·타임라인의 고빈도 저장을 \`mutate()\`로 이전\n   - mutator 실행 중에는 최신 store 상태를 임시 전역 state로 연결해 기존 helper의 동작을 유지\n   - store가 상태변경 이벤트를 발행하므로 수동 \`onekan:state-changed\` dispatch는 제거\n\n다음 후보:\n1. habit/project 계열 writer`,
  "state-store migration status",
);
spec = replaceOrFail(
  spec,
  '- `app.js`, `focus-task-card.js`, `project-popup-planning.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  '- `app.js`, `focus-task-card.js`, `project-popup-planning.js`, `unified-workspace.js`가 `onekan_state`를 직접 `select / upsert`하지 않음',
  "state-store verification list",
);
fs.writeFileSync(specPath, spec);

fs.rmSync("scripts/unified-state-store-migration-once.mjs");
fs.rmSync(".github/workflows/unified-state-store-migration-once.yml");
console.log("unified workspace state-store migration applied");
