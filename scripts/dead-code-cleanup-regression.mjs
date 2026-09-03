import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

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

console.log("dead code cleanup regression: ok");
