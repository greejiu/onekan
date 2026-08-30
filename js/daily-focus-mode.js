// 오늘한칸을 '오늘 할일 배치 + 시간 계획'에 집중시키는 가벼운 UI 정리 모듈.
// 기존 습관/관리 데이터는 삭제하지 않고, 반복 탭은 반복 할일·일정 관리용으로 유지한다.

const HIDDEN_PAGE_IDS = ["page-habits", "page-management"];


function hideLegacyPages() {
  for (const id of HIDDEN_PAGE_IDS) {
    const page = document.getElementById(id);
    if (!page) continue;
    page.hidden = true;
    page.classList.remove("active");
  }
}

function removeLegacyNav() {
  document
    .querySelectorAll('.sidebar .nav [data-page="habits"], .sidebar .nav [data-page="management"]')
    .forEach((button) => button.remove());
}

function removeHabitRows(root = document) {
  const selectors = [
    '[data-context-kind="habit"]',
    '[data-kind="habit"]',
    '[data-item-kind="habit"]',
    '[data-uw-kind="habit"]',
    '[data-management-home-item]',
    '.uw-habit-item',
    '.uw-habit-row',
  ];
  root.querySelectorAll(selectors.join(",")).forEach((node) => {
    if (node.closest("#upcomingList")) return;
    node.remove();
  });
}

function cleanTracking() {
  const select = document.getElementById("timerTaskSelect");
  if (select) {
    [...select.options].forEach((option) => {
      if (String(option.value || "").startsWith("habit:")) option.remove();
    });
  }

  const label = document.getElementById("timerTaskLabel");
  if (label && label.textContent.includes("습관")) {
    label.textContent = label.textContent.replaceAll("할일·습관", "할일").replaceAll("습관", "할일");
  }

  const custom = document.getElementById("timerCustomTitle");
  if (custom && custom.placeholder?.includes("습관")) custom.placeholder = custom.placeholder.replace("습관", "할일");
}

function cleanSettings() {
  const habitColor = document.getElementById("timelineHabitColor");
  habitColor?.closest("label")?.remove();

  document.querySelectorAll(".setting-desc").forEach((node) => {
    const text = node.textContent || "";
    if (text.includes("일정·할일·습관")) node.textContent = text.replace("일정·할일·습관", "일정·할일");
    if (text.includes("할일과 습관")) node.textContent = text.replace("할일과 습관", "할일");
  });
}

function cleanCopy() {
  const authCopy = document.querySelector(".auth-copy");
  if (authCopy) authCopy.textContent = "오늘 할 일과 시간 계획, 집중 기록을 한 곳에서 관리해요.";
}

function applyDailyFocusMode(root = document) {
  removeLegacyNav();
  hideLegacyPages();
  removeHabitRows(root);
  cleanTracking();
  cleanSettings();
  cleanCopy();
}

applyDailyFocusMode();

document.addEventListener("onekan:state-changed", () => requestAnimationFrame(() => applyDailyFocusMode()));

for (const selector of ["#page-home", "#page-calendar", "#page-tasks", "#page-repeat", "#page-tracking", "#page-settings", ".sidebar .nav"]) {
  const root = document.querySelector(selector);
  if (!root) continue;
  const observer = new MutationObserver(() => applyDailyFocusMode(root));
  observer.observe(root, { childList: true, subtree: true });
}
