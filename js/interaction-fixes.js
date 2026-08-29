import "./auth-guard.js?v=1";

// 오늘한칸은 오늘 할일 배치와 시간 계획에 집중한다.
// 기존 습관/관리 데이터는 Supabase에 그대로 보존하되 숨긴다.
// 할일·일정의 반복 입력 도구는 계속 사용한다.
window.__ONEKAN_DAILY_FOCUS_MODE__ = true;

const deferredModules = [
  "./task-input-controls.js?v=5",
  "./home-timeline-dynamic-columns.js?v=2",
];

if (!window.__onekanInteractionFixesInstalled) {
  window.__onekanInteractionFixesInstalled = true;
  let deferredLoadStarted = false;

  function coreDataReady() {
    const app = document.querySelector("#app-section");
    const sync = document.querySelector("#syncStatus");
    if (!app || app.classList.contains("hidden")) return false;
    const text = sync?.textContent?.trim() || "";
    if (!text || text.includes("불러오는 중") || text.includes("실패")) return false;
    return text === "저장됨" || text === "저장 중...";
  }

  async function loadDeferredModules() {
    if (deferredLoadStarted || !coreDataReady()) return;
    deferredLoadStarted = true;
    try {
      for (const modulePath of deferredModules) await import(modulePath);
    } catch (error) {
      deferredLoadStarted = false;
      console.error("deferred feature module load failed", error);
    }
  }

  const appSection = document.querySelector("#app-section");
  const syncStatus = document.querySelector("#syncStatus");
  const readinessObserver = new MutationObserver(() => loadDeferredModules());
  if (appSection) readinessObserver.observe(appSection, { attributes: true, attributeFilter: ["class"] });
  if (syncStatus) readinessObserver.observe(syncStatus, { childList: true, characterData: true, subtree: true });
  window.addEventListener("load", () => setTimeout(loadDeferredModules, 250), { once: true });

  function ensureLegacyCompatibilityNodes() {
    const host = document.createElement("div");
    host.id = "onekanLegacyCompatibility";
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");

    const missing = [];
    if (!document.querySelector("#blockEditor")) missing.push(`
      <div id="blockEditor">
        <input id="blockSource" />
        <input id="blockDetail" />
        <select id="blockStart"></select>
        <select id="blockDuration"><option value="30">30</option></select>
        <button id="saveBlockBtn" type="button"></button>
        <button id="deleteBlockBtn" type="button"></button>
      </div>`);
    if (!document.querySelector("#addEventGroupBtn")) missing.push('<button id="addEventGroupBtn" type="button"></button>');
    if (!document.querySelector("#reloadCloudBtn")) missing.push('<button id="reloadCloudBtn" type="button"></button>');

    if (!missing.length) return;
    host.innerHTML = missing.join("");
    document.body.appendChild(host);
  }

  ensureLegacyCompatibilityNodes();

  function isFinePointer() {
    return !matchMedia("(hover:none),(pointer:coarse)").matches;
  }

  function clearTemporaryMoveSelection() {
    document.querySelectorAll(".uw-temp-move-selected").forEach((item) => {
      item.classList.remove("selected", "uw-temp-move-selected");
    });
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button > 0) return;
      const moveHandle = event.target.closest?.(".uw-move-handle");
      if (moveHandle && isFinePointer()) {
        const item = moveHandle.closest(".uw-item");
        if (item && !item.classList.contains("selected")) item.classList.add("selected", "uw-temp-move-selected");
      }
    },
    true,
  );

  document.addEventListener("pointerup", clearTemporaryMoveSelection, true);
  document.addEventListener("pointercancel", clearTemporaryMoveSelection, true);

  const interactionStyle = document.createElement("style");
  interactionStyle.dataset.onekanInteractionFix = "1";
  interactionStyle.textContent = `
  @media (hover:hover) and (pointer:fine) {
    .uw-time-entry .uw-resize-handle { height: 4px; }
    .uw-item-title { cursor: text; }
    .uw-move-handle { cursor: grab; }
    .uw-move-handle:active { cursor: grabbing; }
  }

  .uw-task-month-cell > .uw-list > .uw-task-inline-add { display: none !important; }
  `;
  document.head.appendChild(interactionStyle);
}
