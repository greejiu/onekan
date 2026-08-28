const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

if (!window.__onekanNotesBoardViewInstalled) {
  window.__onekanNotesBoardViewInstalled = true;

  const style = document.createElement("style");
  style.dataset.onekanNotesBoardView = "1";
  style.textContent = `
    .notes-group-mode { display:none !important; }
    .notes-list.notes-board-list {
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(310px,1fr));
      gap:14px;
      align-items:start;
    }
    .notes-section-board {
      min-width:0;
      border:1px solid var(--border,#e5e2de);
      border-radius:16px;
      background:var(--surface,#fff);
      overflow:hidden;
    }
    .notes-section-board-head {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding:13px 14px;
      border-bottom:1px solid var(--border,#e5e2de);
      background:var(--soft-surface,#f7f6f4);
    }
    .notes-section-board-head h2 { margin:0; font-size:15px; font-weight:800; }
    .notes-section-board-head span { color:var(--muted,#8d8983); font-size:12px; }
    .notes-section-board-body { display:grid; gap:0; }
    .notes-area-group { min-width:0; padding:12px; border-bottom:1px solid var(--border,#e5e2de); }
    .notes-area-group:last-child { border-bottom:0; }
    .notes-area-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 2px 8px; }
    .notes-area-title { display:flex; align-items:center; gap:7px; min-width:0; font-size:12px; font-weight:800; color:var(--text,#272522); }
    .notes-area-color { width:7px; height:7px; flex:0 0 auto; border-radius:999px; background:var(--notes-area-color,#8fa9c4); }
    .notes-area-count { color:var(--muted,#8d8983); font-size:11px; }
    .notes-area-items { display:grid; gap:7px; }
    .notes-section-board .note-item { padding:11px 12px; border-radius:12px; }
    .notes-section-board .notes-board-redundant-meta { display:none !important; }
    @media (max-width:720px) {
      .notes-list.notes-board-list { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);

  let transforming = false;
  let scheduled = false;

  function orderedLabels(selectId) {
    return $$(`${selectId} option`).map((option) => option.textContent.trim()).filter(Boolean);
  }

  function itemContext(item) {
    const spans = $$(".note-meta > span", item);
    const section = spans[0]?.textContent.trim() || "메모";
    const area = spans[2]?.textContent.trim() || "기본";
    const areaColor = item.style.getPropertyValue("--note-area").trim() || "#8fa9c4";

    spans[0]?.classList.add("notes-board-redundant-meta");
    spans[1]?.classList.add("notes-board-redundant-meta");
    spans[2]?.classList.add("notes-board-redundant-meta");
    if (spans[3]?.textContent.trim() === "·") spans[3].classList.add("notes-board-redundant-meta");

    return { section, area, areaColor };
  }

  function sortKeys(keys, preferred) {
    const index = new Map(preferred.map((label, i) => [label, i]));
    return [...keys].sort((a, b) => {
      const ai = index.has(a) ? index.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b) ? index.get(b) : Number.MAX_SAFE_INTEGER;
      return ai - bi || a.localeCompare(b, "ko");
    });
  }

  function transformNotes() {
    if (transforming) return;
    const root = $("#notesList");
    if (!root) return;
    root.classList.add("notes-board-list");

    const legacyItems = $$(".notes-group .note-item", root);
    if (!legacyItems.length) return;

    const sectionOrder = orderedLabels("#noteSection");
    const areaOrder = orderedLabels("#noteGroup");
    const sections = new Map();

    for (const item of legacyItems) {
      const context = itemContext(item);
      if (!sections.has(context.section)) sections.set(context.section, new Map());
      const areas = sections.get(context.section);
      if (!areas.has(context.area)) areas.set(context.area, { color: context.areaColor, items: [] });
      areas.get(context.area).items.push(item);
    }

    transforming = true;
    const fragment = document.createDocumentFragment();

    for (const sectionName of sortKeys(sections.keys(), sectionOrder)) {
      const areas = sections.get(sectionName);
      const board = document.createElement("section");
      board.className = "notes-section-board";
      const total = [...areas.values()].reduce((sum, entry) => sum + entry.items.length, 0);
      board.innerHTML = `<div class="notes-section-board-head"><h2></h2><span>${total}</span></div><div class="notes-section-board-body"></div>`;
      $("h2", board).textContent = sectionName;
      const body = $(".notes-section-board-body", board);

      for (const areaName of sortKeys(areas.keys(), areaOrder)) {
        const entry = areas.get(areaName);
        const group = document.createElement("section");
        group.className = "notes-area-group";
        group.innerHTML = `<div class="notes-area-head"><div class="notes-area-title"><span class="notes-area-color" aria-hidden="true"></span><span class="notes-area-name"></span></div><span class="notes-area-count">${entry.items.length}</span></div><div class="notes-area-items"></div>`;
        group.style.setProperty("--notes-area-color", entry.color);
        $(".notes-area-name", group).textContent = areaName;
        const itemsHost = $(".notes-area-items", group);
        entry.items.forEach((item) => itemsHost.appendChild(item));
        body.appendChild(group);
      }

      fragment.appendChild(board);
    }

    root.replaceChildren(fragment);
    transforming = false;
  }

  function scheduleTransform() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      transformNotes();
    });
  }

  const observer = new MutationObserver((records) => {
    if (transforming) return;
    if (!$("#notesList")) return;
    if (records.some((record) => record.target.id === "notesList" || record.target.closest?.("#notesList") || [...record.addedNodes].some((node) => node.nodeType === 1 && (node.id === "notesList" || node.querySelector?.("#notesList"))))) {
      scheduleTransform();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  scheduleTransform();
}
