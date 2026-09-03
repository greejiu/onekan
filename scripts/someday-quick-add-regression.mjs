import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, workspace] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/someday-quick-add.css", import.meta.url), "utf8"),
  readFile(new URL("../js/unified-workspace.js", import.meta.url), "utf8"),
]);

assert.match(html, /id="somedayQuickDesktopForm"/, "PC 빠른 추가 폼이 필요합니다.");
assert.match(html, /id="somedayQuickMobileTrigger"/, "모바일 플로팅 버튼이 필요합니다.");
assert.match(html, /id="somedayQuickMobileSheet"[^>]+role="dialog"[^>]+aria-modal="true"/, "모바일 바텀시트는 접근 가능한 대화상자여야 합니다.");
assert.match(html, /id="somedayQuickDate" type="date"/, "선택형 날짜 입력이 필요합니다.");
assert.match(css, /@media \(max-width: 900px\)[\s\S]+\.someday-quick-mobile-trigger/, "모바일 전용 버튼 스타일이 필요합니다.");
assert.match(css, /bottom: calc\(68px \+ env\(safe-area-inset-bottom\)\)/, "바텀시트가 하단 메뉴를 가리지 않아야 합니다.");
assert.match(workspace, /function addSomedayQuickTask\(title,date=null\)/, "빠른 저장 함수가 필요합니다.");
assert.match(workspace, /date:taskDate/, "기본 언젠가 저장과 선택 날짜 저장을 모두 지원해야 합니다.");
assert.match(workspace, /renderSomedayQuickRecents\(\)/, "PC 최근 항목을 다시 그려야 합니다.");
assert.match(workspace, /showToast\(date\?"날짜 할일에 추가했어요\.":"언젠가 할일에 추가했어요\."\)/, "저장 결과를 즉시 알려야 합니다.");

console.log("someday quick add regression: ok");
