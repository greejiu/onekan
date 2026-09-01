import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/project-status.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const expectedOrder = ["doing", "before", "done", "archived"];
const shelfBlock = source.match(/const SHELF_STATUSES = \[([\s\S]*?)\];/)?.[1] || "";
const actualOrder = [...shelfBlock.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);

if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
  throw new Error(`책장 순서가 달라졌습니다: ${actualOrder.join(", ")}`);
}
for (const label of ["달리는 중", "준비 중", "완주함", "쉬는 중"]) {
  if (!shelfBlock.includes(label)) throw new Error(`책장 이름 누락: ${label}`);
}
for (const token of ["onekan-project-book", "onekan-project-book-progress", "data-project-shelf-toggle", "localStorage", "projectTaskStats"]) {
  if (!source.includes(token)) throw new Error(`서재 기능 누락: ${token}`);
}
if (!source.includes('activeFilter === "all"') || !source.includes("onekan-project-group-view")) {
  throw new Error("전체 서재형과 선택 목록형의 분기가 유지되지 않았습니다.");
}
if (!index.includes("project-status.js?v=13")) throw new Error("프로젝트 서재 스크립트 캐시 버전이 갱신되지 않았습니다.");

console.log("project bookshelf regression: ok");
