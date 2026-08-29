import "./auth-guard.js?v=1";
import "./management.js?v=5";
import "./management-section-context.js?v=1";
import "./management-items.js?v=5";
import "./management-checklist.js?v=1";
import "./repeat-hub.js?v=2";
import "./management-section-item-drag.js?v=3";
import "./management-item-schedule.js?v=3";
import "./management-home.js?v=3";
import "./management-history.js?v=4";
import "./habit-area-check-colors.js?v=1";
import "./habit-start-date-fix.js?v=3";
import "./habit-period-direct-save.js?v=1";
import "./home-timeline-dynamic-columns.js?v=2";

// Compatibility + interaction safeguards loaded before app.js initializes.
// Safe to load more than once because cached module URLs may coexist during deployment.

if (!window.__onekanInteractionFixesInstalled) {
  window.__onekanInteractionFixesInstalled = true;

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
        if (item && !item.classList.contains("selected")) {
          item.classList.add("selected", "uw-temp-move-selected");
        }
        return;
      }

      // Titles must reach the unified gesture handler:
      // a click edits, while moving at least 6px starts item movement.
    },
    true,
  );

  document.addEventListener("pointerup", clearTemporaryMoveSelection, true);
  document.addEventListener("pointercancel", clearTemporaryMoveSelection, true);

  const interactionStyle = document.createElement("style");
  interactionStyle.dataset.onekanInteractionFix = "1";
  interactionStyle.textContent = `
  @media (hover:hover) and (pointer:fine) {
    .uw-time-entry .uw-resize-handle {
      height: 4px;
    }

    .uw-item-title,
    .uw-habit-title {
      cursor: text;
    }

    .uw-move-handle {
      cursor: grab;
    }

    .uw-move-handle:active {
      cursor: grabbing;
    }
  }

  /* Month calendar cells are already clickable, so the visual + marker is redundant. */
  .uw-task-month-cell > .uw-list > .uw-task-inline-add {
    display: none !important;
  }

  /* In month view, keep card width for the title instead of repeating the recurrence label. */
  .uw-task-month-cell .uw-repeat-badge {
    display: none !important;
  }
  `;
  document.head.appendChild(interactionStyle);
}
