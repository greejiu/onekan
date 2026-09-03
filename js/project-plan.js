// 계획 세우기 탭은 2026-09-03에 프로젝트 책 팝업의 할일·습관 관리로 대체되었습니다.
// index.html의 기존 script 참조가 남아 있는 배포 캐시와의 호환을 위해 이 파일은 잠시 유지하며,
// 레거시 메뉴/페이지 DOM만 제거합니다. 데이터 읽기·쓰기는 하지 않습니다.

function removeLegacyPlanDom() {
  document.querySelector('.sidebar .nav-item[data-page="plan"]')?.remove();
  document.querySelector('#page-plan')?.remove();
  try {
    sessionStorage.removeItem('onekan-plan-project');
  } catch {
    // Storage가 막혀 있어도 레거시 화면 제거에는 영향이 없습니다.
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', removeLegacyPlanDom, { once: true });
} else {
  removeLegacyPlanDom();
}
