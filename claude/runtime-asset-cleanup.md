# 런타임 자산 2차 정리 — 2026-09-04

`index.html`을 진입점으로 JS/CSS 참조 그래프를 따라가 실제 배포에서 도달 가능한 자산을 감사했다.

## 제거한 죽은 JS

- `calendar-day-home.js`
- `goal-board-v2.js`
- `goal-group-board.js`
- `goal-quick-add.js`
- `goal-status-drag.js`
- `habit-area-check-colors.js`
- `habit-period-direct-save.js`
- `habit-start-date-fix.js`
- `repeat-hub.js`
- `time-block-click-add.js`
- `time-block-planner.js`
- `time-block-table-style.js`
- `work-management.js`
- `work-status-inline-add.js`

이 파일들은 `index.html`에서 시작한 현재 런타임 그래프에서 도달하지 않았고, 파일명을 직접 참조하는 활성 로더도 없었다. `work-management.js`는 `app.js`의 과거 fallback 감지 문자열에만 이름이 남아 있었고 실제로 로드되지는 않았다.

## 제거한 죽은 CSS

- `goal-board-v2.css`
- `goal-quick-add.css`
- `goal-status-drag.css`
- `repeat-hub.css`

반대로 아래 CSS는 `index.html` 직접 링크는 아니지만 활성 JS가 `link.href`로 런타임 삽입하므로 유지한다.

- `backup-manager.css`
- `project-popup-planning.css`
- `tracking-stats.css`

## 회귀 기준

`scripts/runtime-asset-regression.mjs`는 `index.html`에서 시작해 정적 import, 동적 import, script/link 참조, 런타임 `href/src` 삽입을 따라간다. `js/` 또는 `css/` 아래 파일 중 현재 런타임 그래프에 도달하지 않는 자산이 생기면 CI를 실패시킨다.

새 파일을 추가할 때는 실제 진입점에서 연결하거나, 실험/보관 코드라면 저장소의 런타임 디렉터리에 방치하지 않는다.
