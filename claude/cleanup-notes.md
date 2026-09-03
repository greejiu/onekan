# 코드 정리 메모 — 2026-09-03

## 이번 정리에서 확정한 것

### 관리(management) 모듈 제거

아래 9개 파일은 `index.html`에서 로드되지 않고 다른 현재 코드에서도 직접 참조되지 않는 죽은 코드라 삭제했다.

- `js/management.js`
- `js/management-checklist.js`
- `js/management-history.js`
- `js/management-home.js`
- `js/management-item-drag-fix.js`
- `js/management-item-schedule.js`
- `js/management-items.js`
- `js/management-section-context.js`
- `js/management-section-item-drag.js`

필요하면 Git 히스토리에서 다시 확인할 수 있다. 새 기능 구현 시 이 파일들을 기존 구현으로 간주하거나 재사용하지 않는다.

## 아직 남겨둔 정리 후보

### 계획 세우기 레거시

사용자 결정으로 사이드바의 `계획 세우기` 진입은 폐기되었고, 프로젝트 책 팝업 안에서 할일·습관을 추가하는 방향으로 대체되었다.

현재는 안전한 단계적 정리를 위해 `index.html`의 `#page-plan`, `js/project-plan.js`, 관련 마크업을 아직 물리적으로 삭제하지 않았다. 사이드바에서는 `sidebar-navigation.js`가 진입 버튼을 제거한다.

이 코드는 별도 정리 PR에서 `index.html`의 스크립트 참조와 페이지 마크업까지 함께 제거한 뒤 삭제한다. `project-plan.js`만 먼저 지우면 현재 `index.html`의 module script가 404가 되므로 단독 삭제하지 않는다.

### app.js 레거시 타임그리드

`unified-workspace.js`가 활성화된 현재 흐름에서 사용되지 않는 것으로 보이는 `renderTimeGrid()` / `hasBlockConflict()` 계열은 `app.js` 자체가 큰 파일이라 이번 정리에서는 건드리지 않았다. 실제 호출 그래프와 회귀 범위를 따로 확인한 뒤 제거한다.

## 회귀 기준

`scripts/dead-code-cleanup-regression.mjs`는 제거된 management 파일이 다시 생기거나 `index.html`에서 다시 참조되는 경우 실패한다.
