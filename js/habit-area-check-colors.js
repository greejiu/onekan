const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

if (!window.__onekanHabitAreaCheckColorsInstalled) {
  window.__onekanHabitAreaCheckColorsInstalled = true;

  const style = document.createElement("style");
  style.dataset.onekanHabitAreaCheckColors = "1";
  style.textContent = `
    #page-habits .uw-habit-week-row .uw-habit-day-check {
      border-color: var(--uw-habit-check-color, var(--timeline-habit-color, #b9d9c3));
    }
    #page-habits .uw-habit-week-row .uw-habit-day-check.checked {
      border-color: var(--uw-habit-check-color, var(--timeline-habit-color, #b9d9c3));
      background: var(--uw-habit-check-color, var(--timeline-habit-color, #b9d9c3));
    }
  `;
  document.head.appendChild(style);

  let scheduled = false;

  function applyHabitAreaColors() {
    const grid = $("#page-habits .uw-habit-week-grid");
    if (!grid) return;

    let currentColor = "";
    [...grid.children].forEach((element) => {
      if (element.classList.contains("uw-habit-group-title")) {
        currentColor = element.style.getPropertyValue("--uw-group").trim();
        return;
      }
      if (element.classList.contains("uw-habit-week-row")) {
        if (currentColor) element.style.setProperty("--uw-habit-check-color", currentColor);
        else element.style.removeProperty("--uw-habit-check-color");
      }
    });
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyHabitAreaColors();
    });
  }

  const observer = new MutationObserver((records) => {
    if (records.some((record) =>
      record.target.closest?.("#page-habits") ||
      [...record.addedNodes].some((node) => node.nodeType === 1 && (node.id === "page-habits" || node.closest?.("#page-habits") || node.querySelector?.("#page-habits")))
    )) scheduleApply();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("onekan:state-changed", scheduleApply);
  scheduleApply();
}
