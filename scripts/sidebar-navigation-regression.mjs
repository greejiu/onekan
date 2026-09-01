import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/sidebar-navigation.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../js/sidebar-navigation.js", import.meta.url), "utf8");

const requiredPages = ["home", "calendar", "tasks", "repeat", "projects", "plan", "tracking", "records", "reports", "tags"];
const requiredProjectTabs = ["project", "goal", "identity"];

for (const page of requiredPages) {
  if (!html.includes(`data-page="${page}"`)) throw new Error(`사이드바 메뉴 누락: ${page}`);
}
for (const tab of requiredProjectTabs) {
  if (!html.includes(`data-sidebar-project-tab="${tab}"`)) throw new Error(`프로젝트 하위 메뉴 누락: ${tab}`);
}
for (const page of ["records", "reports", "tags"]) {
  if (!html.includes(`id="page-${page}"`)) throw new Error(`준비 화면 누락: ${page}`);
}
if (!html.includes('data-sidebar-section="calendar"') || !html.includes('data-sidebar-section="projects"')) {
  throw new Error("접이식 사이드바 그룹이 없습니다.");
}
if (!html.match(/id="sidebarProjectItems"[\s\S]*data-page="plan"/)) {
  throw new Error("프로젝트 그룹에 계획 세우기 메뉴가 없습니다.");
}
if (!js.includes("localStorage") || !js.includes('"onekan-sidebar-sections-v1"')) {
  throw new Error("사이드바 접기 상태 저장 로직이 없습니다.");
}
if (!css.includes("@media (max-width: 900px)")) throw new Error("모바일 사이드바 규칙이 없습니다.");
if (!css.includes("#onekanProjectDirectionTabs")) throw new Error("중복 프로젝트 탭 숨김 규칙이 없습니다.");

console.log("sidebar navigation regression: ok");
