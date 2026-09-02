import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, menu, css, weather] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../js/context-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../css/home-dashboard.css", import.meta.url), "utf8"),
  readFile(new URL("../js/home-dashboard-weather.js", import.meta.url), "utf8"),
]);

for (const id of ["homeProgress", "homeCompletionLabel", "todayLabel", "homeWeather", "homeDdayCount", "homeDdayTitle", "homeDdayList"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} 대시보드 요소가 필요합니다.`);
}
assert.match(app, /homeDashboard:\s*\{\s*heroDday:\s*null\s*\}/, "대표 D-day 기본 상태가 필요합니다.");
assert.match(app, /function renderHomeDdays\(\)/, "D-day 렌더러가 필요합니다.");
assert.match(app, /오늘 \$\{completedTasks\} \/ \$\{tasks\.length\} 완료/, "완료 개수 문구가 실제 할일 데이터와 연결되어야 합니다.");
assert.match(menu, /data-context-action="hero-dday"/, "대표 D-day 우클릭 메뉴가 필요합니다.");
assert.match(menu, /heroDday = selected \? \{ kind: target\.kind, id: target\.id \} : null/, "대표 D-day 선택을 저장해야 합니다.");
assert.match(css, /grid-template-columns:minmax\(0,3fr\) 1px minmax\(260px,2fr\)/, "대시보드는 60:40 구조여야 합니다.");
assert.match(css, /@media\(max-width:760px\)/, "모바일 대시보드 대응이 필요합니다.");
assert.match(weather, /api\.open-meteo\.com/, "날씨 데이터 연결이 필요합니다.");

console.log("home dashboard regression: ok");
