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

### 사용하지 않는 `project-planning.js` 제거

`js/project-planning.js`도 현재 `index.html`에서 로드되지 않고 코드 검색에서도 직접 참조가 없어 제거했다. 이 파일은 프로젝트 다이얼로그 안에서 별도 계획 항목(`projectPlan`)을 관리하던 과거 구현이다.

현재 프로젝트 계획 흐름은 프로젝트 책 팝업에서 연결된 할일·습관을 관리하는 방향으로 바뀌었으므로 새 기능에서 이 파일을 기준 구현으로 삼지 않는다.

### 계획 세우기 페이지 레거시 제거

사용자 결정으로 사이드바의 `계획 세우기` 진입은 폐기되었고, 프로젝트 책 팝업 안에서 할일·습관을 추가하는 방향으로 대체되었다.

2026-09-03 정리에서 아래 레거시를 물리적으로 제거했다.

- `index.html`의 `data-page="plan"` 사이드바 버튼
- `index.html`의 `#page-plan` 페이지 마크업
- `index.html`의 `js/project-plan.js` script 참조
- `js/project-plan.js`
- `sidebar-navigation.js`의 plan 아이콘/라우팅/런타임 제거 보정 코드

따라서 새 기능 구현 시 `project-plan.js` 또는 `#page-plan`을 기준 구현으로 삼지 않는다. 프로젝트 실행 항목 관리는 `project-popup-planning.js` 흐름을 사용한다.

### app.js 타임그리드 감사 결과

`renderHome()`은 `unified-workspace.js`가 로드된 현재 배포에서 `renderTimeGrid()`를 직접 호출하지 않고 조기 반환한다. 다만 `renderTimeGrid()` / `hasBlockConflict()` 계열은 아직 완전한 죽은 코드가 아니다.

`app.js` 안의 시간블록 추가·드래그·리사이즈·완료 처리, `#blockEditor` 저장/삭제, 타임라인 색상 설정 이벤트 핸들러가 여전히 이 함수들을 직접 호출한다. 따라서 함수 정의만 지우면 사용자 조작 시 런타임 오류가 날 수 있다.

정리할 때는 다음 순서로 진행한다.

1. 현재 `unified-workspace.js`가 소유하는 시간계획 편집 흐름과 겹치는 이벤트 핸들러를 먼저 식별한다.
2. 더 이상 필요한 fallback이 아니면 관련 핸들러와 `#blockEditor` 마크업을 함께 제거한다.
3. 마지막에 `renderTimeGrid()` / `hasBlockConflict()` / 리사이즈·드롭 헬퍼를 묶어서 제거한다.

즉 이 영역은 "죽은 함수 몇 개"가 아니라 "부분적으로 남은 레거시 타임라인 서브시스템"으로 취급한다.

### 회귀 테스트 CI

회귀 스크립트가 수동 실행에만 머물지 않도록 `.github/workflows/regression.yml`을 추가한다. PR과 `main` push에서 JS 문법 검사, 모든 `*-regression.mjs`, `unified-render-smoke.mjs`를 실행한다.

기존 회귀 스크립트의 `?v=정확한 숫자` 검사는 기능이 그대로여도 캐시 버전만 올라가면 실패하므로, 해당 자산이 숫자 버전을 유지하는지만 검사하도록 바꾼다.

## 아직 남겨둔 정리 후보

### app.js 레거시 타임라인 서브시스템

위 감사 결과에 따라 단독 함수 삭제는 보류한다. `unified-workspace.js`로 완전히 이관됐는지 이벤트 흐름까지 확인한 뒤 한 묶음으로 제거한다.

### 수동 캐시버스팅

`index.html`의 CSS/JS 자산 버전이 `?v=숫자` 방식으로 파일마다 수동 관리된다. 기능 변경 파일의 버전 번호를 올리지 않으면 브라우저 캐시에 예전 코드가 남을 수 있으므로, 당분간 배포 체크리스트에서 변경 자산의 버전 확인을 계속한다.

## 회귀 기준

`scripts/dead-code-cleanup-regression.mjs`는 제거된 management 파일, `project-planning.js`, 계획 세우기 페이지/모듈/사이드바 훅이 다시 생기거나 `index.html`에서 다시 참조되는 경우 실패한다.
