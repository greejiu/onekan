import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`pattern not found: ${label}`);
  return next;
}

// backup-manager: state history remains a dedicated Supabase table, while the live state
// goes through the shared store. Strip the store base token before archiving/restoring.
{
  const file = "js/backup-manager.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";\nimport { stripStateStoreMeta } from "./state-store.js?v=1";',
    "backup import",
  );
  text = replaceOnce(
    text,
    /async function readCurrentState\(\) \{[\s\S]*?\n\}/,
    `async function readCurrentState() {\n  const user = await resolveUser();\n  if (!user) return null;\n  const stored = await onekanStateStore.read({ userId: user.id });\n  return stripStateStoreMeta(stored);\n}`,
    "backup readCurrentState",
  );
  text = replaceOnce(
    text,
    /  const \{ error: restoreError \} = await supabase\n    \.from\("onekan_state"\)\n    \.update\(\{ data: backup\.data, updated_at: new Date\(\)\.toISOString\(\) \}\)\n    \.eq\("user_id", user\.id\);\n  if \(restoreError\) throw restoreError;/,
    `  await onekanStateStore.mutate(\n    () => stripStateStoreMeta(backup.data),\n    { userId: user.id, source: "backup-restore" },\n  );`,
    "backup restore",
  );
  fs.writeFileSync(file, text);
}

// time-block-v2 settings: writes must mutate the latest remote state instead of saving a
// previously-read whole-state snapshot.
{
  const file = "js/time-block-v2-settings.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    "time block import",
  );
  text = replaceOnce(
    text,
    /async function readState\(\) \{[\s\S]*?\n\}\n\nasync function saveState\(user, state\) \{[\s\S]*?\n\}/,
    `function normalizeState(value) {\n  return value && typeof value === "object" ? value : {};\n}\n\nasync function readState() {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session?.user) return null;\n  const stored = await onekanStateStore.read({ userId: session.user.id });\n  return { user: session.user, state: normalizeState(stored) };\n}\n\nasync function mutateState(mutator, source = "time-block-v2") {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session?.user) return null;\n  const committed = await onekanStateStore.mutate((latest) => {\n    const state = normalizeState(latest);\n    mutator(state);\n    return state;\n  }, { userId: session.user.id, source });\n  $("#reloadCloudBtn")?.click();\n  return { user: session.user, state: normalizeState(committed) };\n}`,
    "time block state helpers",
  );
  text = replaceOnce(
    text,
    `    const current = await readState();\n    if (!current) return;\n    ensureTimeBlockV2State(current.state);\n    const effectiveFrom = appDayKey();\n    setTimeBlockTemplatesForDate(current.state, validation.templates, effectiveFrom);\n    await saveState(current.user, current.state);`,
    `    const effectiveFrom = appDayKey();\n    const committed = await mutateState((state) => {\n      ensureTimeBlockV2State(state);\n      setTimeBlockTemplatesForDate(state, validation.templates, effectiveFrom);\n    });\n    if (!committed) return;`,
    "time block saveRows",
  );
  text = replaceOnce(
    text,
    `    const current = await readState();\n    if (!current) return;\n    const changed = ensureTimeBlockV2State(current.state);\n    if (changed) await saveState(current.user, current.state);\n    const dateKey = appDayKey();\n    const templates = timeBlockTemplatesForDate(current.state, dateKey);`,
    `    let current = await readState();\n    if (!current) return;\n    const changed = ensureTimeBlockV2State(current.state);\n    if (changed) {\n      const committed = await mutateState((state) => { ensureTimeBlockV2State(state); });\n      if (committed) current = committed;\n    }\n    const dateKey = appDayKey();\n    const templates = timeBlockTemplatesForDate(current.state, dateKey);`,
    "time block renderSettings",
  );
  fs.writeFileSync(file, text);
}

// tracking-stats is read-only: use the shared store for the current state snapshot.
{
  const file = "js/tracking-stats.js";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    'import { supabase } from "./supabase.js";',
    'import { onekanStateStore, supabase } from "./supabase.js";',
    "tracking stats import",
  );
  text = replaceOnce(
    text,
    `    const { data, error } = await supabase\n      .from("onekan_state")\n      .select("data")\n      .eq("user_id", user.id)\n      .maybeSingle();\n    if (error) throw error;\n    renderAll(data?.data || {});`,
    `    const stored = await onekanStateStore.read({ userId: user.id });\n    renderAll(stored || {});`,
    "tracking stats refresh",
  );
  fs.writeFileSync(file, text);
}

// Direct-access debt is now zero: only state-store.js may own the table transport.
{
  const file = "scripts/state-store-direct-access-regression.mjs";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    `const debtAllowlist = new Set([\n  "backup-manager.js",\n  "time-block-v2-settings.js",\n  "tracking-stats.js",\n]);`,
    `const debtAllowlist = new Set([]);`,
    "clear direct access debt",
  );
  fs.writeFileSync(file, text);
}

// Targeted regression for backup semantics and the final two runtime consumers.
{
  const file = "scripts/final-state-store-regression.mjs";
  const text = `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst backup = fs.readFileSync("js/backup-manager.js", "utf8");\nconst timeBlocks = fs.readFileSync("js/time-block-v2-settings.js", "utf8");\nconst tracking = fs.readFileSync("js/tracking-stats.js", "utf8");\n\nassert.match(backup, /onekanStateStore\\.read\\(\\{ userId: user\\.id \\}\\)/, "backup shared read");\nassert.match(backup, /stripStateStoreMeta\\(stored\\)/, "backup strips state-store metadata before history snapshot");\nassert.match(backup, /onekanStateStore\\.mutate\\(/, "backup restore uses shared mutate");\nassert.match(backup, /source: "backup-restore"/, "backup restore source");\nassert.doesNotMatch(backup, /supabase\\.from\\(["']onekan_state["']\\)/, "backup direct live-state access");\nassert.match(backup, /supabase\\.from\\(["']onekan_state_history["']\\)/, "backup history table remains independent");\n\nassert.match(timeBlocks, /onekanStateStore\\.read\\(/, "time-block settings shared read");\nassert.match(timeBlocks, /onekanStateStore\\.mutate\\(/, "time-block settings shared mutate");\nassert.doesNotMatch(timeBlocks, /supabase\\.from\\(["']onekan_state["']\\)/, "time-block direct state access");\nassert.doesNotMatch(timeBlocks, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/, "time-block duplicate event");\n\nassert.match(tracking, /onekanStateStore\\.read\\(/, "tracking stats shared read");\nassert.doesNotMatch(tracking, /onekanStateStore\\.mutate\\(/, "tracking stats stays read-only");\nassert.doesNotMatch(tracking, /supabase\\.from\\(["']onekan_state["']\\)/, "tracking stats direct state access");\n\nconsole.log("final state-store migration regression: ok");\n`;
  fs.writeFileSync(file, text);
}

// Mark the migration milestone complete in the architecture memo.
{
  const file = "claude/state-store-spec.md";
  let text = fs.readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    "**상태: 1단계 구현 완료 + 고빈도 writer 직접 이전 진행 중 (2026-09-04).**",
    "**상태: 1단계 구현 완료 + 런타임 `onekan_state` 직접 접근 이전 완료 (2026-09-04).**",
    "spec status",
  );
  text = replaceOnce(
    text,
    `5. \`project-status-automation.js\`\n   - 프로젝트·목표 상태 자동 승격/재계산을 \`read() / mutate()\`로 이전\n   - 변경 필요 여부는 읽은 snapshot으로 먼저 확인해 불필요한 자동 저장을 줄임\n   - 실제 커밋 시 최신 remote 상태에서 다시 상태를 계산하고 store 이벤트를 사용\n\n다음 후보:\n1. 나머지 project/habit 계열 writer`,
    `5. \`project-status-automation.js\`\n   - 프로젝트·목표 상태 자동 승격/재계산을 \`read() / mutate()\`로 이전\n   - 변경 필요 여부는 읽은 snapshot으로 먼저 확인해 불필요한 자동 저장을 줄임\n   - 실제 커밋 시 최신 remote 상태에서 다시 상태를 계산하고 store 이벤트를 사용\n6. 나머지 런타임 상태 모듈\n   - 프로젝트·습관·컨텍스트·인증·설정·통계 모듈을 순차적으로 직접 store API로 이전\n   - \`backup-manager.js\`의 현재 상태 백업/복원도 store를 거치며, history 테이블은 별도 보관소로 유지\n   - \`time-block-v2-settings.js\` 저장은 최신 remote 상태에서 mutate하고 \`tracking-stats.js\`는 read-only store 조회 사용\n   - \`scripts/state-store-direct-access-regression.mjs\`가 이제 \`state-store.js\` 외 직접 \`onekan_state\` 접근을 허용하지 않음\n\n다음 후보:\n1. 직접 접근 이전 완료. 새 런타임 코드는 공용 state-store API만 사용`,
    "spec completion list",
  );
  text = replaceOnce(
    text,
    "- `onekan_state.update()` / `delete()`를 통한 전체 상태 변경은 아직 3-way merge 대상이 아니다. 현재 주된 전체 상태 writer는 `upsert` 패턴이다.",
    "- 공용 store 밖의 `onekan_state.update()` / `delete()`는 3-way merge 대상이 아니다. 현재 런타임 모듈은 더 이상 이 직접 경로를 사용하지 않는다.",
    "spec limitation",
  );
  text = replaceOnce(
    text,
    "- `app.js`, `focus-task-card.js`, `project-popup-planning.js`, `unified-workspace.js`, `project-status-automation.js`가 `onekan_state`를 직접 `select / upsert`하지 않음",
    "- `state-store.js` 외 런타임 JS가 `onekan_state`를 직접 `select / insert / update / upsert`하지 않음",
    "spec validation",
  );
  fs.writeFileSync(file, text);
}

const base = process.env.CACHE_BASE || "origin/main";
const queue = ["js/backup-manager.js", "js/time-block-v2-settings.js", "js/tracking-stats.js"];
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
console.log("final state-store migration applied");
