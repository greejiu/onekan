import "./auth-guard.js?v=1";

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

      const title = event.target.closest?.(".uw-item-title, .uw-habit-title");
      if (!title) return;
      if (event.target.closest?.("[data-uw-resize]")) return;

      // Keep the title as an edit/click target instead of starting a move gesture.
      event.stopImmediatePropagation();
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
  `;
  document.head.appendChild(interactionStyle);
}
