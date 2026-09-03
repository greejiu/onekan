# management CSS 정리

상태: 완료 (2026-09-04)

과거 관리 화면용 JavaScript 모듈 9개를 제거한 뒤에도 관련 CSS 6개가 저장소에 남아 있었다. 현재 `index.html`과 활성 JavaScript/CSS 로더 어디에서도 이 파일들을 참조하지 않아 배포에 포함되지 않는 죽은 자산으로 확인했다.

제거한 파일:

- `css/management.css`
- `css/management-checklist.css`
- `css/management-history.css`
- `css/management-home.css`
- `css/management-item-schedule.css`
- `css/management-items.css`

현재 습관/할일/프로젝트 UI를 수정할 때 이 스타일을 기준 구현으로 사용하지 않는다. 필요한 과거 스타일은 Git 히스토리에서 확인한다.

`scripts/dead-code-cleanup-regression.mjs`가 위 파일이 다시 생기거나 `index.html`에서 다시 참조되면 실패하도록 고정했다.
