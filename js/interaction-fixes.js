// Small interaction safeguards that must register before unified-workspace.js initializes.
// Keep task titles clickable/editable; moving should start from the dedicated move handle.

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const title = event.target.closest?.(".uw-item-title, .uw-habit-title");
    if (!title) return;
    if (event.target.closest?.(".uw-move-handle, [data-uw-resize]")) return;

    // unified-workspace listens on document in capture mode. Registering this guard first
    // prevents a tiny mouse movement on the title from being interpreted as a move gesture.
    event.stopImmediatePropagation();
  },
  true,
);

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
