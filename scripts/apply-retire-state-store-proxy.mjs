import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// Audit: the runtime compatibility client must only be wired from supabase.js.
const proxyRefs = git("grep", "-n", "createStateStoreClient", "--", "js", "scripts").split(/\r?\n/).filter(Boolean);
const unexpectedRuntime = proxyRefs.filter((line) => line.startsWith("js/") && !line.startsWith("js/supabase.js:") && !line.startsWith("js/state-store.js:"));
if (unexpectedRuntime.length) throw new Error(`unexpected runtime createStateStoreClient usage:\n${unexpectedRuntime.join("\n")}`);

// supabase.js: export the real Supabase client; keep oneKan state access as a separate direct store.
{
  const file = "js/supabase.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(text, 'import { createStateStoreClient } from "./state-store.js?v=1";', 'import { createOnekanStateStore } from "./state-store.js?v=1";', "supabase state-store import");
  text = replaceOnce(
    text,
    `const rawSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);\nconst stateStoreClient = createStateStoreClient(rawSupabase);\n\nexport const supabase = stateStoreClient.client;\nexport const onekanStateStore = stateStoreClient.store;`,
    `const rawSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);\n\nexport const supabase = rawSupabase;\nexport const onekanStateStore = createOnekanStateStore(rawSupabase);`,
    "supabase raw client export",
  );
  fs.writeFileSync(file, text);
}

// State-store regression: stop exercising the retired proxy and cover the direct store instead.
{
  const file = "scripts/state-store-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(text, "  createStateStoreClient,", "  createOnekanStateStore,", "regression import");
  const marker = "const raw = new FakeClient(base);";
  const index = text.indexOf(marker);
  if (index < 0) throw new Error("state-store regression proxy section not found");
  const directTests = `const raw = new FakeClient(base);\nconst store = createOnekanStateStore(raw);\nconst first = await store.read({ userId: "u1" });\nconst repeated = await store.read({ userId: "u1" });\nassert.ok(first[STATE_STORE_META_KEY]);\nassert.equal(first[STATE_STORE_META_KEY], repeated[STATE_STORE_META_KEY]);\n\nawait store.mutate((current) => {\n  current.tasks[0].subtaskProgress.s1 = true;\n  return current;\n}, { userId: "u1", source: "test-external" });\nawait store.mutate((current) => {\n  current.habitDays["2026-09-03"].h1 = true;\n  return current;\n}, { userId: "u1", source: "test-app" });\nassert.equal(raw.db.data.tasks[0].subtaskProgress.s1, true);\nassert.equal(raw.db.data.habitDays["2026-09-03"].h1, true);\nassert.equal(raw.db.data[STATE_STORE_META_KEY], undefined);\n\nconst concurrentRaw = new FakeClient(base);\nconst concurrentStore = createOnekanStateStore(concurrentRaw);\nawait Promise.all([\n  concurrentStore.mutate((current) => {\n    current.tasks[0].subtaskProgress.s2 = true;\n    return current;\n  }, { userId: "u1", source: "test-one" }),\n  concurrentStore.mutate((current) => {\n    current.ui.sidebarCollapsed = true;\n    return current;\n  }, { userId: "u1", source: "test-two" }),\n]);\nassert.equal(concurrentRaw.db.data.tasks[0].subtaskProgress.s2, true);\nassert.equal(concurrentRaw.db.data.ui.sidebarCollapsed, true);\n\nconsole.log("state store regression: ok");\n`;
  text = text.slice(0, index) + directTests;
  fs.writeFileSync(file, text);
}

// Targeted guard: Supabase itself must remain raw; oneKan gets its own direct store.
{
  const file = "scripts/supabase-raw-client-regression.mjs";
  const text = `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst source = fs.readFileSync("js/supabase.js", "utf8");\nassert.match(source, /import \\{ createOnekanStateStore \\} from "\\.\\/state-store\\.js\\?v=1";/);\nassert.match(source, /export const supabase = rawSupabase;/);\nassert.match(source, /export const onekanStateStore = createOnekanStateStore\\(rawSupabase\\);/);\nassert.doesNotMatch(source, /createStateStoreClient/);\nassert.doesNotMatch(source, /stateStoreClient\\.client/);\nconsole.log("supabase raw client regression: ok");\n`;
  fs.writeFileSync(file, text);
}

// Architecture memo: direct migration is complete, so the runtime proxy is no longer needed.
{
  const file = "claude/state-store-spec.md";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    "**상태: 1단계 구현 완료 + 런타임 `onekan_state` 직접 접근 이전 완료 (2026-09-04).**",
    "**상태: 런타임 `onekan_state` 직접 접근 이전 완료 + Supabase 호환 Proxy 런타임 제거 (2026-09-04).**",
    "spec status",
  );
  text = replaceOnce(
    text,
    `- \`js/supabase.js\`\n  - 기존 모듈이 코드를 당장 전부 바꾸지 않아도 보호를 받을 수 있도록 \`onekan_state\`의 \`select / insert / upsert\`를 공용 store를 거치게 한다.\n  - 다른 Supabase 테이블은 기존과 동일하게 동작한다.\n- 새 코드에서는 가능하면 \`onekanStateStore.read()\` / \`onekanStateStore.mutate()\` / \`onekanStateStore.subscribe()\`를 직접 사용한다.`,
    `- \`js/supabase.js\`\n  - 일반 Supabase 접근은 더 이상 Proxy를 거치지 않고 원본 client를 그대로 export한다.\n  - \`onekan_state\`만 별도 \`onekanStateStore\` 인스턴스로 접근한다.\n- 런타임의 \`onekan_state\` 접근은 \`onekanStateStore.read()\` / \`onekanStateStore.mutate()\` / \`onekanStateStore.subscribe()\`를 사용한다.`,
    "spec current structure",
  );
  text = replaceOnce(
    text,
    `   - \`scripts/state-store-direct-access-regression.mjs\`가 이제 \`state-store.js\` 외 직접 \`onekan_state\` 접근을 허용하지 않음\n\n다음 후보:\n1. 직접 접근 이전 완료. 새 런타임 코드는 공용 state-store API만 사용`,
    `   - \`scripts/state-store-direct-access-regression.mjs\`가 이제 \`state-store.js\` 외 직접 \`onekan_state\` 접근을 허용하지 않음\n7. Supabase 호환 Proxy 런타임 제거\n   - \`supabase.js\`가 원본 Supabase client를 그대로 export하도록 전환\n   - \`onekanStateStore\`는 원본 client 위에 별도 생성해 상태 접근 책임을 분리\n   - 기존 Proxy 생성 함수는 런타임에서 더 이상 사용하지 않으며 후속 단계에서 dead helper로 정리 가능\n\n다음 후보:\n1. \`state-store.js\`의 사용 종료된 Proxy helper/deferred writer 코드 물리 삭제`,
    "spec completion",
  );
  fs.writeFileSync(file, text);
}

// Bump supabase.js and recursively bump any importer that changes because of the new version.
const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/supabase.js"];
const queued = new Set(queue);
const processed = new Set();
function changedAssets() {
  return git("diff", "--name-only", base).split(/\r?\n/).map((value) => value.trim()).filter((value) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(value));
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
console.log(`retired state-store proxy; cache cascade touched ${changedAssets().length} JS/CSS assets`);
