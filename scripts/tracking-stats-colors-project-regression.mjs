import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const statsSource = fs.readFileSync("js/tracking-stats.js", "utf8");
const logicEnd = statsSource.indexOf("function groupButtons");
assert.ok(logicEnd > 0, "통계 집계 로직을 찾을 수 있어야 합니다.");

const logicSource = statsSource
  .slice(0, logicEnd)
  .replace(/^import .*$/m, "")
  .concat("\nglobalThis.__statsTest = { aggregate, stableItemColor };\n");
const context = {};
vm.runInNewContext(logicSource, context);

const now = new Date().toISOString();
const state = {
  sessions: [
    { id: "s1", taskId: "t1", projectId: "p1", groupId: "g2", start: now, durationMs: 60_000 },
    { id: "s2", taskId: "t2", groupId: "g1", start: now, durationMs: 120_000 },
  ],
  tasks: [
    { id: "t1", title: "지원서 쓰기", projectId: "p1", groupId: "g1" },
    { id: "t2", title: "그림 그리기", groupId: "g1" },
  ],
  habitTemplates: [],
  projects: [{ id: "p1", title: "취업 준비", groupId: "g1" }],
  eventGroups: [
    { id: "g1", name: "일", color: "#123456" },
    { id: "g2", name: "건강", color: "#abcdef" },
  ],
};

const projectStats = context.__statsTest.aggregate(state, "project", "today");
assert.equal(projectStats.rows.find((row) => row.name === "취업 준비")?.color, "#123456", "프로젝트 막대는 프로젝트에 설정한 영역 색을 사용해야 합니다.");

const areaStats = context.__statsTest.aggregate(state, "area", "today");
assert.equal(areaStats.rows.find((row) => row.name === "건강")?.color, "#abcdef", "영역 막대는 시간 기록의 영역 색을 사용해야 합니다.");

const itemStats = context.__statsTest.aggregate(state, "item", "today");
assert.match(itemStats.rows[0].color, /^#[0-9a-f]{6}$/i, "할일 막대에는 팔레트 색이 있어야 합니다.");
assert.equal(context.__statsTest.stableItemColor("task:t1"), context.__statsTest.stableItemColor("task:t1"), "할일 색은 새로고침 뒤에도 같아야 합니다.");

const contextMenuSource = fs.readFileSync("js/context-menu.js", "utf8");
assert.match(contextMenuSource, /target\.kind === "task" \|\| target\.kind === "session"/, "시간 기록에도 프로젝트 메뉴가 보여야 합니다.");
assert.match(contextMenuSource, /\["task", "session"\]\.includes\(target\.kind\)/, "시간 기록의 프로젝트 연결을 저장해야 합니다.");

console.log("tracking stats colors and session project regression: ok");
