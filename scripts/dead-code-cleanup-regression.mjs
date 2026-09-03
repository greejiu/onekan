import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sidebarNavigation = fs.readFileSync(path.join(root, "js", "sidebar-navigation.js"), "utf8");

const removedManagementModules = [
  "management.js",
  "management-checklist.js",
  "management-history.js",
  "management-home.js",
  "management-item-drag-fix.js",
  "management-item-schedule.js",
  "management-items.js",
  "management-section-context.js",
  "management-section-item-drag.js",
];

for (const file of removedManagementModules) {
  assert.equal(
    fs.existsSync(path.join(root, "js", file)),
    false,
    `죽은 관리 모듈이 다시 생겼습니다: ${file}`,
  );
  assert.equal(
    indexHtml.includes(file),
    false,
    `index.html이 제거된 관리 모듈을 참조합니다: ${file}`,
  );
}

const removedProjectModules = ["project-planning.js", "project-plan.js"];
for (const file of removedProjectModules) {
  assert.equal(
    fs.existsSync(path.join(root, "js", file)),
    false,
    `폐기된 프로젝트 계획 모듈이 다시 생겼습니다: ${file}`,
  );
  assert.equal(
    indexHtml.includes(file),
    false,
    `index.html이 폐기된 프로젝트 계획 모듈을 참조합니다: ${file}`,
  );
}

assert.equal(indexHtml.includes('data-page="plan"'), false, "계획 세우기 사이드바 진입이 다시 생겼습니다.");
assert.equal(indexHtml.includes('id="page-plan"'), false, "폐기된 계획 세우기 페이지가 다시 생겼습니다.");
assert.equal(indexHtml.includes('id="projectPlanRoot"'), false, "폐기된 계획 세우기 루트가 다시 생겼습니다.");
assert.equal(sidebarNavigation.includes("removePlanNavigation"), false, "계획 세우기 런타임 제거 보정 코드가 다시 생겼습니다.");
assert.equal(sidebarNavigation.includes('plan: "plan"'), false, "계획 세우기 사이드바 아이콘 라우팅이 다시 생겼습니다.");

assert.equal(
  fs.existsSync(path.join(root, "js", "project-popup-planning.js")),
  true,
  "현재 프로젝트 실행 항목 관리 모듈이 사라졌습니다.",
);
assert.equal(
  sidebarNavigation.includes("project-popup-planning.js"),
  true,
  "현재 프로젝트 실행 항목 관리 모듈 로더가 사라졌습니다.",
);

console.log("dead code cleanup regression: ok");
