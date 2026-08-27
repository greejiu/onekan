// Small interaction safeguards that must register before unified-workspace.js initializes.
// Keep task titles clickable/editable; moving should start from the dedicated move handle.

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
        // unified-workspace intentionally requires a selected item for handle dragging.
        // Mark it only for this mouse gesture so the handle remains the sole drag target.
        item.classList.add("selected", "uw-temp-move-selected");
      }
      return;
    }

    const title = event.target.closest?.(".uw-item-title, .uw-habit-title");
    if (!title) return;
    if (event.target.closest?.("[data-uw-resize]")) return;

    // unified-workspace listens on document in capture mode. Registering this guard first
    // prevents a tiny mouse movement on the title from being interpreted as a move gesture.
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
  /* Short 30-minute blocks used to be almost entirely covered by resize hit areas. */
  .uw-time-entry .uw-resize-handle {
    height: 4px;
  }

  /* The move affordance is the only grab cursor; the title remains an edit target. */
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
