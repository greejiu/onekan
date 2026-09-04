import "./auth-guard.js?v=1";

// 오늘한칸은 오늘 할일 배치와 시간 계획에 집중한다.
// 기존 습관/관리 데이터는 Supabase에 그대로 보존하되 숨긴다.
// 할일·일정의 반복 입력 도구는 계속 사용한다.
window.__ONEKAN_DAILY_FOCUS_MODE__ = true;

const deferredModules = [
  "./task-input-controls.js?v=5",
  "./home-timeline-dynamic-columns.js?v=2",
  "./tracking-context-menu.js?v=2",
  "./habit-area-list.js?v=2",
  "./task-area-list.js?v=2",
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

  // unified-workspace의 타임블럭 계획 레일은 오른쪽 절반 전체를 드롭 영역으로 본다.
  // 그래서 항목이 없는 30분 슬롯 위에서도 '정확한 시간' 대신 타임블럭 정렬로 판정됐다.
  // 드래그 중 실제 최상단 요소가 빈 .uw-time-hit이면 계획 레일 바깥으로 판정되게 해,
  // 항목 위 = 앞/뒤 정렬, 빈 시간칸 = 정확한 시간 이동 규칙을 유지한다.
  if (!window.__onekanEmptyTimelineDropFixInstalled) {
    window.__onekanEmptyTimelineDropFixInstalled = true;
    let pointerX = Number.NaN;
    let pointerY = Number.NaN;
    const nativeGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    document.addEventListener(
      "pointermove",
      (event) => {
        if (!event.isPrimary) return;
        pointerX = event.clientX;
        pointerY = event.clientY;
      },
      { capture: true, passive: true },
    );

    Element.prototype.getBoundingClientRect = function onekanGetBoundingClientRect() {
      const rect = nativeGetBoundingClientRect.call(this);
      if (!(this instanceof HTMLElement) || !this.classList.contains("uw-time-block-plan-rail")) return rect;
      if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return rect;

      const pointed = document.elementFromPoint(pointerX, pointerY);
      const emptyTimeHit = pointed?.closest?.(".uw-time-hit");
      if (!emptyTimeHit) return rect;
      if (emptyTimeHit.closest(".uw-timeline") !== this.closest(".uw-timeline")) return rect;

      return new DOMRect(rect.right + 1, rect.top, 0, rect.height);
    };
  }

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
