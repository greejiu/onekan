import fs from "node:fs";

const js = fs.readFileSync(new URL("../js/project-bookmark.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/project-bookmark.css", import.meta.url), "utf8");

const requiredJs = [
  "PROJECT_BOOK_SELECTOR",
  "openProjectLinked",
  "linkedItems",
  "habitTemplates",
  "item?.isHabit",
  "onekan:context-menu-opened",
  "프로젝트 수정",
  "allowProjectEditClick",
  "data-project-linked-drag",
  "delta >= 80",
];

for (const token of requiredJs) {
  if (!js.includes(token)) throw new Error(`프로젝트 연결 보기 로직 누락: ${token}`);
}

if (!css.includes("@media (max-width: 700px)")) throw new Error("700px 모바일 바텀시트 기준이 없습니다.");
if (!css.includes("max-height: calc(65vh - 88px)")) throw new Error("데스크톱 내부 스크롤 높이 제한이 없습니다.");
if (!css.includes("onekan-project-linked-backdrop")) throw new Error("팝업/바텀시트 배경 레이어가 없습니다.");
if (!css.includes("translateY(var(--onekan-sheet-drag")) throw new Error("모바일 스와이프 변형 규칙이 없습니다.");

console.log("project linked items regression: ok");
