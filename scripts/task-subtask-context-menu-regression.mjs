import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, contextMenu, focusCard] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/context-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../js/focus-task-card.js", import.meta.url), "utf8"),
]);

const contextMenuVersion = Number(html.match(/context-menu\.js\?v=(\d+)/)?.[1] || 0);
assert.ok(contextMenuVersion >= 37, "새 하위 할일 메뉴가 바로 배포되도록 캐시 버전을 유지해야 합니다.");
assert.match(contextMenu, /data-context-action="subtasks"/, "할일 우클릭 메뉴에 하위 할일 액션이 필요합니다.");
assert.match(contextMenu, /target\.kind === "task" && item && !item\.done/, "미완료 할일에서만 하위 할일 메뉴를 보여야 합니다.");
assert.match(contextMenu, /하위 할일 관리 \(\$\{subtaskCount\}\)/, "기존 항목 수가 메뉴에 표시되어야 합니다.");
assert.match(contextMenu, /subtaskDialog\.id = "contextSubtaskDialog"/, "하위 할일 추가·수정 대화상자가 필요합니다.");
assert.match(contextMenu, /data-context-subtask-add/, "대화상자에서 여러 하위 할일을 추가할 수 있어야 합니다.");
assert.match(contextMenu, /data-context-subtask-remove/, "대화상자에서 기존 하위 할일을 삭제할 수 있어야 합니다.");
assert.match(contextMenu, /task\.subtasks = rows\.map/, "하위 할일은 상위 할일 객체에 저장되어야 합니다.");
assert.match(contextMenu, /focus-subtask-\$\{newId\(\)\}/, "홈 카드와 같은 하위 할일 ID 규칙을 사용해야 합니다.");
assert.match(contextMenu, /task\.subtaskProgress = Object\.fromEntries/, "삭제한 하위 할일의 완료 기록도 정리해야 합니다.");
assert.match(contextMenu, /pointerType === "mouse"/, "기존 모바일 길게 누르기 진입점을 유지해야 합니다.");

assert.match(focusCard, /normalizeSubtasks\(task\.subtasks\)/, "홈 카드가 상위 할일에 저장된 같은 하위 할일을 읽어야 합니다.");
assert.match(focusCard, /allDone\s*=\s*steps\.length\s*>\s*0\s*&&\s*steps\.every/, "전체 하위 할일 완료 시 상위 할일 자동완료를 유지해야 합니다.");

console.log("task subtask context menu regression: ok");
