import fs from "node:fs";

const css = fs.readFileSync(new URL("../css/unified-workspace.css", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const rule = ".uw-calendar .uw-item-time,.uw-task-month-grid .uw-item-time,.uw-task-board-grid .uw-item-time{display:none}";
if (!css.includes(rule)) throw new Error("달력 항목의 시간 숨김 규칙이 없습니다.");
if (css.includes(".uw-schedule-list .uw-item-time{display:none}")) throw new Error("목록 보기의 시간까지 숨겨졌습니다.");
if (!index.includes("unified-workspace.css?v=64")) throw new Error("달력 스타일 캐시 버전이 갱신되지 않았습니다.");

console.log("calendar hide time regression: ok");
