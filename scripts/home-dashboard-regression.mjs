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
assert.match(app, /homeDashboard:\s*\{\s*heroDday:\s*null,\s*secondaryDdays:\s*\[\],\s*weatherLocation:/, "대표·보조 D-day와 날씨 지역 기본 상태가 필요합니다.");
assert.match(app, /function renderHomeDdays\(\)/, "D-day 렌더러가 필요합니다.");
assert.match(app, /오늘 \$\{completedTasks\} \/ \$\{tasks\.length\} 완료/, "완료 개수 문구가 실제 할일 데이터와 연결되어야 합니다.");
assert.match(menu, /data-context-action="hero-dday"/, "대표 D-day 우클릭 메뉴가 필요합니다.");
assert.match(menu, /heroDday = selected \? \{ kind: target\.kind, id: target\.id \} : null/, "대표 D-day 선택을 저장해야 합니다.");
assert.match(menu, /\.home-dashboard-dday/, "D-day 영역 자체에서 우클릭 메뉴를 열 수 있어야 합니다.");
assert.match(menu, /data-context-action="ddays"/, "D-day 바꾸기 메뉴가 필요합니다.");
assert.match(menu, /data-context-dday-hero-kind/, "대표 D-day 선택 버튼이 필요합니다.");
assert.match(menu, /data-context-dday-secondary-kind/, "보조 D-day 선택 버튼이 필요합니다.");
assert.match(menu, /homeDashboard\.heroDday = \{ kind, id \}/, "선택한 대표 D-day를 계정 상태에 저장해야 합니다.");
assert.match(menu, /secondary\.length >= 3/, "보조 D-day는 최대 3개여야 합니다.");
assert.match(app, /savedSecondary\.map/, "보조 D-day는 자동이 아니라 저장된 선택을 표시해야 합니다.");
assert.match(css, /grid-template-columns:minmax\(0,3fr\) 1px minmax\(260px,2fr\)/, "대시보드는 60:40 구조여야 합니다.");
assert.match(css, /@media\(max-width:760px\)/, "모바일 대시보드 대응이 필요합니다.");
assert.match(weather, /api\.open-meteo\.com/, "날씨 데이터 연결이 필요합니다.");
assert.match(html, /id="homeWeatherLocationQuery"/, "사용자별 날씨 지역 검색 입력이 필요합니다.");
assert.match(app, /weatherLocation:\s*\{ \.\.\.DEFAULT_WEATHER_LOCATION \}/, "양양 기본 날씨 지역이 필요합니다.");
assert.match(app, /geocoding-api\.open-meteo\.com/, "지역명 검색 연결이 필요합니다.");
assert.match(app, /homeDashboard\.weatherLocation = location/, "선택한 지역을 계정 상태에 저장해야 합니다.");
assert.match(weather, /configuredLocation/, "저장된 사용자 지역으로 날씨를 불러와야 합니다.");

console.log("home dashboard regression: ok");
