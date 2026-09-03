import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const [html, app, uw, feedback, focus, tracking] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../js/unified-workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui-feedback.js", import.meta.url), "utf8"),
  readFile(new URL("../js/focus-task-card.js", import.meta.url), "utf8"),
  readFile(new URL("../js/tracking-stats.js", import.meta.url), "utf8"),
]);

async function fileMissing(relativePath) {
  try {
    await access(new URL(relativePath, import.meta.url));
    return false;
  } catch {
    return true;
  }
}

// 홈 메모 카드는 완전히 제거되어야 한다.
assert.doesNotMatch(html, /id="homeMemoCard"/, "홈 메모 카드 마크업이 남아있으면 안 됩니다.");
assert.doesNotMatch(html, /home-memo\.css/, "home-memo.css 링크가 남아있으면 안 됩니다.");
assert.doesNotMatch(html, /home-memo-slash\.js/, "home-memo-slash.js 스크립트 태그가 남아있으면 안 됩니다.");
assert.doesNotMatch(app, /homeMemoBoard\s*:/, "app.js의 상태 정의에 homeMemoBoard가 남아있으면 안 됩니다.");
assert.doesNotMatch(app, /function renderHomeMemo/, "app.js에 옛 메모 렌더 함수가 남아있으면 안 됩니다.");
assert.ok(await fileMissing("../css/home-memo.css"), "css/home-memo.css 파일이 삭제되어야 합니다.");
assert.ok(await fileMissing("../js/home-memo-slash.js"), "js/home-memo-slash.js 파일이 삭제되어야 합니다.");
assert.ok(await fileMissing("../js/home-memo-persistence.js"), "js/home-memo-persistence.js 파일이 삭제되어야 합니다.");

// 지금 집중 카드가 그 자리를 대신해야 한다.
assert.match(html, /id="focusTaskCard"/, "지금 집중 카드 컨테이너가 필요합니다.");
assert.match(html, /id="focusTaskCardTitle">지금 할 일</, "카드 제목은 시간 상태에 따라 바뀔 수 있어야 합니다.");
assert.match(html, /id="focusTaskBody"/, "지금 집중 카드 본문 컨테이너가 필요합니다.");
assert.match(html, /class="card-body focus-task-body" id="focusTaskBody"/, "지금 집중 카드가 공통 본문 여백을 유지해야 합니다.");
assert.match(html, /focus-task-card\.css/, "focus-task-card.css 링크가 필요합니다.");
assert.match(html, /focus-task-card\.js/, "focus-task-card.js 스크립트 태그가 필요합니다.");
assert.match(html, /id="soundEffectsToggle"/, "효과음 켜기/끄기 설정 토글이 필요합니다.");

// focus-task-card.js: 할일 1개 선택 + 하위 할일 CRUD + 전체 체크 시 자동완료.
assert.match(focus, /data-focus-task-pick/, "할일 선택 버튼 마크업이 필요합니다.");
assert.match(focus, /data-focus-task-clear/, "다른 할일로 바꾸기 버튼이 필요합니다.");
assert.match(focus, /data-focus-subtask-toggle/, "하위 할일 체크 버튼이 필요합니다.");
assert.match(focus, /data-focus-subtask-remove/, "하위 할일 삭제 버튼이 필요합니다.");
assert.match(focus, /data-focus-subtask-add-form/, "하위 할일 추가 폼이 필요합니다.");
assert.match(focus, /allDone\s*=\s*steps\.length\s*>\s*0\s*&&\s*steps\.every/, "하위 할일을 모두 체크했는지 판단하는 로직이 필요합니다.");
assert.match(focus, /task\.done\s*=\s*true/, "하위 할일을 모두 체크하면 상위 할일이 완료 처리되어야 합니다.");
assert.match(focus, /current\.focusTaskId\s*=\s*null/, "완료 후에는 다음 할일을 다시 고르도록 focusTaskId를 비워야 합니다.");
assert.match(focus, /function automaticTaskSelection/, "현재 시각에 맞는 할일을 자동 선택해야 합니다.");
assert.match(focus, /function taskTimeWindows/, "할일과 타임블럭의 시간 범위를 계산해야 합니다.");
assert.match(focus, /selection\?\.mode === "next" \? "다음 할 일" : "지금 할 일"/, "현재와 다음 상태에 맞춰 제목이 바뀌어야 합니다.");
assert.match(focus, /focusTaskDate = appDateKey\(\)/, "직접 선택은 오늘 하루 동안만 자동 선택을 덮어써야 합니다.");
assert.match(focus, /placeholder="작은 행동 추가"/, "하위 할일은 작은 행동으로 안내해야 합니다.");
assert.match(focus, /setInterval\(\(\) => scheduleRender\(0, false\), 60000\)/, "남은 시간과 다음 할일은 매분 갱신되어야 합니다.");
assert.match(uw, /아직 끝나지 않았어요 · \$\{tasks\.length\}개/, "지연된 할일은 부담이 적은 문구로 표시해야 합니다.");
assert.match(uw, /data-uw-overdue-keep/, "지연된 할일을 그대로 두는 선택이 필요합니다.");
assert.match(focus, /import\s*\{\s*onekanStateStore\s*,\s*supabase\s*\}\s*from\s*"\.\/supabase\.js"/, "focus-task-card.js는 공용 state-store와 auth용 Supabase를 함께 사용해야 합니다.");
assert.doesNotMatch(focus, /supabase\.from\(["']onekan_state["']\)/, "focus-task-card.js가 oneKan 전체 상태를 직접 읽고 쓰면 안 됩니다.");
assert.match(focus, /tracking-stats-loader\.js/, "옛 메모 카드가 불러오던 시간 통계·백업 모듈 로딩을 이어받아야 합니다.");

// 효과음: 체크음/완료음 구분 + 음소거 설정 + 기존 체크 지점(할일 목록/타임블록) 연결.
assert.match(feedback, /export function playCheckSound/, "재사용 가능한 사운드 함수가 ui-feedback.js에 있어야 합니다.");
assert.match(feedback, /export function isSoundMuted/, "음소거 여부를 읽는 함수가 필요합니다.");
assert.match(feedback, /export function setSoundMuted/, "음소거 여부를 저장하는 함수가 필요합니다.");
assert.match(feedback, /check:\s*\[/, "체크음 톤 정의가 필요합니다.");
assert.match(feedback, /complete:\s*\[/, "완료음 톤 정의가 필요합니다(체크음과 달라야 함).");
assert.match(feedback, /endFreq/, "체크 손맛을 위한 짧은 상승음이 필요합니다.");
assert.match(feedback, /type:\s*"triangle"/, "체크음에 또렷한 어택을 주는 파형이 필요합니다.");
assert.match(feedback, /soundEffectsToggle/, "설정 페이지의 효과음 토글과 연결되어야 합니다.");

assert.match(uw, /playCheckSound/, "unified-workspace.js의 할일 체크 지점(오늘 할일 목록 등)에 효과음이 연결되어야 합니다.");
assert.match(app, /playCheckSound/, "app.js의 타임블록 체크 지점(renderTimeGrid)에 효과음이 연결되어야 합니다.");

// tracking-stats.js는 이제 focusTaskCard를 대상으로 통계 패널을 붙여야 한다.
assert.match(tracking, /getElementById\("focusTaskCard"\)/, "시간 통계 패널이 새 지금 집중 카드를 대상으로 해야 합니다.");
assert.doesNotMatch(tracking, /homeMemoCard/, "시간 통계 모듈에 옛 메모 카드 참조가 남아있으면 안 됩니다.");

console.log("focus task card regression: ok");
