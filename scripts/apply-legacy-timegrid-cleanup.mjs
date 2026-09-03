import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "js/app.js");
const htmlPath = path.join(root, "index.html");
const auditPath = path.join(root, "scripts/app-legacy-timeline-audit-regression.mjs");
const notesPath = path.join(root, "claude/cleanup-notes.md");

let app = fs.readFileSync(appPath, "utf8");
let html = fs.readFileSync(htmlPath, "utf8");

function requireIncludes(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`cleanup precondition failed: ${label}`);
}

function removeFunctionUntil(source, name, nextName) {
  const startNeedle = `function ${name}(`;
  const nextNeedle = `function ${nextName}(`;
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`missing function: ${name}`);
  const next = source.indexOf(nextNeedle, start + startNeedle.length);
  if (next < 0) throw new Error(`missing following function ${nextName} after ${name}`);
  return `${source.slice(0, start)}${source.slice(next)}`;
}

requireIncludes(app, "let editingBlockId = null;", "legacy editor state");
requireIncludes(app, "function hasBlockConflict(", "legacy conflict checker");
requireIncludes(app, "function renderTimeGrid()", "legacy time-grid renderer");
requireIncludes(app, "function openBlockEditor(", "legacy block editor");
requireIncludes(html, 'id="blockEditor"', "legacy block editor markup");

app = app.replace("let editingBlockId = null;\n", "");
app = removeFunctionUntil(app, "hasBlockConflict", "addDirectTimeBlock");
app = removeFunctionUntil(app, "addDirectTimeBlock", "renderTimeGrid");
app = removeFunctionUntil(app, "renderTimeGrid", "wireTimelineResize");
app = removeFunctionUntil(app, "wireTimelineResize", "fillBlockStartOptions");
app = removeFunctionUntil(app, "fillBlockStartOptions", "openBlockEditor");
app = removeFunctionUntil(app, "openBlockEditor", "renderHabits");

const legacyCloseLine = '    if (!event.target.closest("#blockEditor") && !event.target.closest(".time-block")) $("#blockEditor").classList.remove("open");\n';
requireIncludes(app, legacyCloseLine, "legacy editor outside-click close handler");
app = app.replace(legacyCloseLine, "");

const editorListenerStart = '  $("#saveBlockBtn").addEventListener("click", () => {';
const calendarFilterStart = '  $$("#calendarTypeFilter [data-calendar-type]").forEach((button) => button.addEventListener("click", () => {';
const editorStart = app.indexOf(editorListenerStart);
const editorEnd = app.indexOf(calendarFilterStart, editorStart);
if (editorStart < 0 || editorEnd < 0) throw new Error("legacy block editor listener range not found");
app = `${app.slice(0, editorStart)}${app.slice(editorEnd)}`;

const legacyRenderHomeLine = "  renderTimeGrid();\n";
requireIncludes(app, legacyRenderHomeLine, "legacy renderHome time-grid call");
app = app.replace(legacyRenderHomeLine, "");

const colorRefreshPair = "      renderTimeGrid();\n      renderCalendar();";
if (app.includes(colorRefreshPair)) app = app.replace(colorRefreshPair, "      renderCalendar();");

if (app.includes("HOME_SLOT_HEIGHT")) {
  const constantLine = "const HOME_SLOT_HEIGHT = 20;\n";
  if (app.split("HOME_SLOT_HEIGHT").length - 1 === 1 && app.includes(constantLine)) app = app.replace(constantLine, "");
}

for (const forbidden of [
  "renderTimeGrid(",
  "openBlockEditor(",
  "hasBlockConflict(",
  "fillBlockStartOptions(",
  "wireTimelineResize(",
  "editingBlockId",
  '#blockEditor',
]) {
  if (app.includes(forbidden)) throw new Error(`legacy app token still remains: ${forbidden}`);
}

const blockEditorStart = html.indexOf('  <div class="inline-pop" id="blockEditor"');
const scriptsStart = html.indexOf('  <script type="module" src="./js/interaction-fixes.js', blockEditorStart);
if (blockEditorStart < 0 || scriptsStart < 0) throw new Error("legacy block editor markup range not found");
html = `${html.slice(0, blockEditorStart)}${html.slice(scriptsStart)}`;
html = html.replace(/\.\/js\/app\.js\?v=(\d+)/, (_, version) => `./js/app.js?v=${Number(version) + 1}`);
if (html.includes('id="blockEditor"')) throw new Error("legacy block editor markup still remains");

const audit = `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst here = path.dirname(fileURLToPath(import.meta.url));\nconst root = path.resolve(here, "..");\nconst read = (file) => fs.readFileSync(path.join(root, file), "utf8");\n\nconst html = read("index.html");\nconst app = read("js/app.js");\nconst unified = read("js/unified-workspace.js");\n\nassert.match(html, /app\\.js\\?v=\\d+[\\s\\S]*unified-workspace\\.js\\?v=\\d+/, "app.js must load before unified workspace");\nassert.doesNotMatch(html, /id="blockEditor"|id="saveBlockBtn"|id="deleteBlockBtn"/, "legacy block editor markup must stay removed");\n\nfor (const token of [\n  /function renderTimeGrid\\(/,\n  /function openBlockEditor\\(/,\n  /function hasBlockConflict\\(/,\n  /function wireTimelineResize\\(/,\n  /function fillBlockStartOptions\\(/,\n  /editingBlockId/,\n  /#blockEditor/,\n]) {\n  assert.doesNotMatch(app, token, \\`legacy app timeline token must stay removed: \\${token}\\`);\n}\n\nassert.match(unified, /function renderPlanner\\(\\)\\{const card=\\$\\("\\.home-timeline-card"\\);[\\s\\S]*?card\\.innerHTML=\\`<div class="uw-home-planner">/, "unified workspace must own the home planner surface");\nassert.match(unified, /const plannerDropAt=\\(/, "unified workspace must own planner drop behavior");\nassert.match(unified, /data-uw-resize=/, "unified workspace must own timeline resize controls");\nassert.doesNotMatch(unified, /#blockEditor|openBlockEditor\\(/, "unified workspace must not depend on the removed editor");\n\nconsole.log("app legacy timeline removal regression: ok");\n`;

let notes = fs.readFileSync(notesPath, "utf8");
if (!notes.includes("### app.js 레거시 타임라인 물리 제거")) {
  notes += `\n### app.js 레거시 타임라인 물리 제거\n\n2026-09-04에 현재 홈 시간계획 UI의 소유권이 \\`unified-workspace.js\\`에 있음을 회귀 검사로 확인한 뒤, \\`app.js\\`에 남아 있던 옛 홈 타임그리드 렌더러·드롭·리사이즈·블럭 편집기 서브시스템을 제거했다. \\`index.html\\`의 \\`#blockEditor\\` 마크업도 함께 제거했다.\n\n앞으로 홈 시간계획 기능은 \\`unified-workspace.js\\` / \\`time-block-v2.js\\` 흐름을 기준으로 수정한다. \\`renderTimeGrid()\\`, \\`openBlockEditor()\\`, \\`hasBlockConflict()\\` 같은 app.js 레거시 API를 다시 만들거나 호출하지 않는다.\n`;
}

fs.writeFileSync(appPath, app);
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(auditPath, audit);
fs.writeFileSync(notesPath, notes);
console.log("legacy timeline cleanup applied");
