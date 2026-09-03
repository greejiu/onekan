import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/sidebar-navigation.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../js/sidebar-navigation.js", import.meta.url), "utf8");

const requiredPages = ["home", "calendar", "repeat", "projects", "plan", "tracking", "records", "reports", "tags"];
const requiredProjectTabs = ["project", "goal", "identity"];
const requiredIcons = ["home", "calendar", "repeat", "project", "goal", "identity", "plan", "tracking", "records", "reports", "tags", "settings", "logout"];

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
  throw new Error("사이드바 시각 그룹이 없습니다.");
}
if (!html.match(/id="sidebarProjectItems"[\s\S]*data-page="plan"/)) {
  throw new Error("프로젝트 그룹에 계획 세우기 메뉴가 없습니다.");
}
if (!js.includes("removeTaskNavigation") || !js.includes('.sidebar .nav-item[data-page="tasks"]')) {
  throw new Error("사이드바 할일 메뉴 제거 로직이 없습니다.");
}
if (!js.includes('schedule-task-merge.js?v=1')) {
  throw new Error("일정·할일 통합 모듈 로더가 없습니다.");
}
if (!js.includes("makeStaticSectionHeadings") || !js.includes("nav-section-heading")) {
  throw new Error("정적 그룹 제목 변환 로직이 없습니다.");
}
if (!js.includes("ensureUtilityDivider") || !css.includes(".nav-section-divider")) {
  throw new Error("프로젝트와 도구 메뉴 사이 구분선이 없습니다.");
}
for (const icon of requiredIcons) {
  if (!js.includes(`${icon}: '<svg`) && !js.includes(`${icon}: \"<svg`)) throw new Error(`아웃라인 아이콘 누락: ${icon}`);
}
if (!css.includes("stroke-linecap: round") || !css.includes("stroke-linejoin: round")) {
  throw new Error("둥근 아웃라인 아이콘 스타일이 없습니다.");
}
if (!css.includes("border-radius: 999px")) throw new Error("선택 메뉴 pill 스타일이 없습니다.");
if (!css.includes("@media (max-width: 900px)")) throw new Error("모바일 사이드바 규칙이 없습니다.");
if (!css.includes("#onekanProjectDirectionTabs")) throw new Error("중복 프로젝트 탭 숨김 규칙이 없습니다.");

console.log("sidebar navigation regression: ok");
