import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/bullet-journal.css", import.meta.url), "utf8"),
  readFile(new URL("../js/bullet-journal-navigation.js", import.meta.url), "utf8"),
]);

assert.match(html, /css\/bullet-journal\.css\?v=1/);
assert.match(html, /js\/bullet-journal-navigation\.js\?v=2/);
assert.ok(html.indexOf("bullet-journal.css") > html.indexOf("sidebar-navigation.css"));
assert.ok(html.indexOf("bullet-journal-navigation.js") > html.indexOf("sidebar-navigation.js"));

for (const label of ["집", "캘린더", "프로젝트", "시간추적", "기록", "리포트", "태그"]) {
  assert.match(script, new RegExp(`label: "${label}"`));
}

for (const label of ["목록", "타임라인", "메모", "일정", "할일", "습관", "목표", "정체성", "계획 세우기"]) {
  assert.match(script, new RegExp(`label: "${label}"`));
}

assert.match(script, /document\.body\.classList\.add\("bullet-journal-ui"\)/);
assert.match(script, /"data-uw-home-mode": "list"/);
assert.match(script, /"data-uw-home-mode": "timeline"/);
assert.match(script, /"data-journal-action": "memo"/);
assert.match(script, /const clicked = event\.target\.closest/);
assert.match(script, /if \(targetSelector\) clickOriginal\(targetSelector\)/);
assert.match(css, /#page-home\.active/);
assert.match(css, /background-size:\s*18px 18px/);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.sidebar > \.nav \{ display: flex; \}/);
assert.match(css, /#homeRightColumn \.uw-side-toggle/);

console.log("bullet journal regression: ok");
