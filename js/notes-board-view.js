const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

if (!window.__onekanNotesBoardViewInstalled) {
  window.__onekanNotesBoardViewInstalled = true;

  const style = document.createElement("style");
  style.dataset.onekanNotesBoardView = "3";
  style.textContent = `
    .notes-group-mode{display:none!important}
    .notes-page-tools{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.9fr);gap:18px;align-items:start;margin:0 0 18px}
    .notes-global-add-slot{min-width:0}
    .notes-global-add-btn{display:flex;width:100%;min-height:58px;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border:1.5px solid var(--border,#d9d5cf);border-radius:14px;background:var(--surface,#fff);color:var(--text,#272522);font:inherit;font-size:15px;font-weight:800;cursor:pointer}
    .notes-global-add-btn span{font-size:27px;line-height:1;font-weight:400;color:var(--muted,#8d8983)}
    .notes-global-add-slot.open .notes-global-add-btn{display:none}
    .notes-page-tools .notes-composer-card{display:none!important;margin:0;padding:10px;border:1px solid var(--border,#e5e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:none}
    .notes-global-add-slot.open .notes-composer-card{display:block!important}
    .notes-page-tools .notes-composer-hint{display:none!important}
    .notes-page-tools .notes-section-manager{margin:0}
    .notes-page-tools .notes-section-form{width:100%}
    .notes-list.notes-board-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;align-items:start}
    .notes-section-board{min-width:0;border:1px solid var(--border,#e5e2de);border-radius:16px;background:var(--surface,#fff);overflow:hidden;transition:border-color .15s ease,background .15s ease}
    .notes-section-board.notes-drop-target,.notes-area-group.notes-drop-target{border-color:var(--accent,#8fa9c4);background:color-mix(in srgb,var(--accent,#8fa9c4) 7%,var(--surface,#fff))}
    .notes-section-board-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;border-bottom:1px solid var(--border,#e5e2de);background:var(--soft-surface,#f7f6f4)}
    .notes-section-board-head h2{margin:0;font-size:15px;font-weight:800}
    .notes-section-add-toggle{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted,#8d8983);font-size:24px;line-height:1;cursor:pointer}
    .notes-section-add-toggle[aria-expanded="true"]{background:var(--surface,#fff);color:var(--text,#272522)}
    .notes-board-add-form{display:flex;gap:7px;padding:9px 12px;border-bottom:1px solid var(--border,#e5e2de);background:var(--surface,#fff)}
    .notes-board-add-form[hidden]{display:none!important}
    .notes-board-add-form input{min-width:0;flex:1;border:0;background:transparent;color:var(--text,#272522);font:inherit;padding:7px 4px;outline:none}
    .notes-board-add-form input::placeholder{color:var(--muted,#8d8983)}
    .notes-board-add-form button{flex:0 0 auto;border:0;background:transparent;color:var(--muted,#8d8983);font-size:18px;padding:4px 8px;border-radius:8px}
    .notes-section-board-body{display:grid;gap:0;min-height:18px}.notes-area-group{min-width:0;padding:12px;border-bottom:1px solid var(--border,#e5e2de)}
    .notes-area-group:last-child{border-bottom:0}
    .notes-area-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 8px}.notes-area-title{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;font-weight:800;color:var(--text,#272522)}
    .notes-area-color{width:7px;height:7px;flex:0 0 auto;border-radius:999px;background:var(--notes-area-color,#8fa9c4)}.notes-area-count{color:var(--muted,#8d8983);font-size:11px}.notes-area-items{display:grid;gap:7px}
    .notes-section-board .note-item{padding:11px 12px;border-radius:12px;user-select:none;touch-action:pan-y}.notes-section-board .note-item.notes-dragging{opacity:.42}.notes-section-board .note-actions{display:none!important}.notes-section-board .notes-board-redundant-meta{display:none!important}
    .notes-board-empty{padding:16px 14px;color:var(--muted,#8d8983);font-size:12px}.note-title-input{width:100%;min-width:0;border:1px solid var(--accent,#8fa9c4);border-radius:8px;background:var(--surface,#fff);color:var(--text,#272522);font:inherit;padding:5px 7px;outline:none}
    .notes-drag-preview{position:fixed;z-index:9999;pointer-events:none;max-width:280px;padding:10px 12px;border:1px solid var(--border,#e5e2de);border-radius:12px;background:var(--surface,#fff);box-shadow:0 8px 28px #0002;font-size:13px;font-weight:700;opacity:.94}
    @media(hover:hover) and (pointer:fine){.notes-section-board .note-title{cursor:text}.notes-section-board .note-item{cursor:default}.notes-section-add-toggle:hover,.notes-board-add-form button:hover{background:var(--surface,#fff);color:var(--text,#272522)}.notes-global-add-btn:hover{border-color:var(--accent,#8fa9c4)}}
    @media(max-width:820px){.notes-page-tools{grid-template-columns:1fr}.notes-list.notes-board-list{grid-template-columns:1fr}.notes-board-add-form input{font-size:16px}}
  `;
  document.head.appendChild(style);

  let transforming = false;
  let scheduled = false;

  function selectDefinitions(selector) {
    return $$(`${selector} option`).map((option) => ({ id: option.value, name: option.textContent.trim() })).filter((item) => item.id && item.name);
  }

  function ensureTopTools() {
    const page = $("#page-notes");
    const composer = $(".notes-composer-card", page || document);
    const manager = $(".notes-section-manager", page || document);
    const list = $("#notesList");
    if (!page || !composer || !manager || !list) return;

    let tools = $(".notes-page-tools", page);
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "notes-page-tools";
      tools.innerHTML = `<div class="notes-global-add-slot"><button class="notes-global-add-btn" type="button" aria-expanded="false"><strong>메모 추가</strong><span aria-hidden="true">＋</span></button></div>`;
      page.insertBefore(tools, list);
    }
    const slot = $(".notes-global-add-slot", tools);
    if (composer.parentElement !== slot) slot.appendChild(composer);
    if (manager.parentElement !== tools) tools.appendChild(manager);
  }

  function itemContext(item, sectionDefs, groupDefs) {
    const spans = $$(".note-meta > span", item);
    const sectionName = spans[0]?.textContent.trim() || sectionDefs[0]?.name || "메모";
    const groupName = spans[2]?.textContent.trim() || groupDefs[0]?.name || "기본";
    const section = sectionDefs.find((entry) => entry.name === sectionName) || { id: sectionName, name: sectionName };
    const group = groupDefs.find((entry) => entry.name === groupName) || { id: groupName, name: groupName };
    const areaColor = item.style.getPropertyValue("--note-area").trim() || "#8fa9c4";
    item.dataset.noteSectionId = section.id;
    item.dataset.noteGroupId = group.id;
    spans[0]?.classList.add("notes-board-redundant-meta");
    spans[1]?.classList.add("notes-board-redundant-meta");
    spans[2]?.classList.add("notes-board-redundant-meta");
    if (spans[3]?.textContent.trim() === "·") spans[3].classList.add("notes-board-redundant-meta");
    return { section, group, areaColor };
  }

  function transformNotes() {
    ensureTopTools();
    if (transforming) return;
    const root = $("#notesList");
    if (!root || root.querySelector(".notes-section-board")) return;
    const sectionDefs = selectDefinitions("#noteSection");
    const groupDefs = selectDefinitions("#noteGroup");
    if (!sectionDefs.length) return;
    root.classList.add("notes-board-list");

    const legacyItems = $$(".notes-group .note-item", root);
    const sections = new Map(sectionDefs.map((section) => [section.id, { section, areas: new Map() }]));
    for (const item of legacyItems) {
      const context = itemContext(item, sectionDefs, groupDefs);
      if (!sections.has(context.section.id)) sections.set(context.section.id, { section: context.section, areas: new Map() });
      const areaMap = sections.get(context.section.id).areas;
      if (!areaMap.has(context.group.id)) areaMap.set(context.group.id, { group: context.group, color: context.areaColor, items: [] });
      areaMap.get(context.group.id).items.push(item);
    }

    transforming = true;
    const fragment = document.createDocumentFragment();
    for (const { section, areas } of sections.values()) {
      const board = document.createElement("section");
      board.className = "notes-section-board";
      board.dataset.sectionId = section.id;
      board.innerHTML = `<div class="notes-section-board-head"><h2></h2><button class="notes-section-add-toggle" type="button" data-note-section-add-toggle aria-expanded="false" aria-label="${section.name}에 메모 추가">＋</button></div><form class="notes-board-add-form" data-note-board-add data-section-id="${section.id}" autocomplete="off" hidden><input type="text" maxlength="240" placeholder="메모 추가" aria-label="${section.name}에 메모 추가"><button type="submit" aria-label="메모 저장">↵</button></form><div class="notes-section-board-body"></div>`;
      $(".notes-section-board-head h2", board).textContent = section.name;
      const body = $(".notes-section-board-body", board);
      if (!areas.size) body.innerHTML = '<div class="notes-board-empty">아직 메모가 없어요.</div>';
      for (const groupDef of groupDefs) {
        const entry = areas.get(groupDef.id);
        if (!entry?.items.length) continue;
        const group = document.createElement("section");
        group.className = "notes-area-group";
        group.dataset.groupId = groupDef.id;
        group.style.setProperty("--notes-area-color", entry.color);
        group.innerHTML = `<div class="notes-area-head"><div class="notes-area-title"><span class="notes-area-color" aria-hidden="true"></span><span class="notes-area-name"></span></div><span class="notes-area-count">${entry.items.length}</span></div><div class="notes-area-items"></div>`;
        $(".notes-area-name", group).textContent = groupDef.name;
        const host = $(".notes-area-items", group);
        entry.items.forEach((item) => host.appendChild(item));
        body.appendChild(group);
      }
      for (const entry of [...areas.values()].filter((entry) => !groupDefs.some((group) => group.id === entry.group.id))) {
        const group = document.createElement("section");
        group.className = "notes-area-group";
        group.dataset.groupId = entry.group.id;
        group.style.setProperty("--notes-area-color", entry.color);
        group.innerHTML = `<div class="notes-area-head"><div class="notes-area-title"><span class="notes-area-color" aria-hidden="true"></span><span class="notes-area-name"></span></div><span class="notes-area-count">${entry.items.length}</span></div><div class="notes-area-items"></div>`;
        $(".notes-area-name", group).textContent = entry.group.name;
        const host = $(".notes-area-items", group);
        entry.items.forEach((item) => host.appendChild(item));
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
    queueMicrotask(() => { scheduled = false; transformNotes(); });
  }

  document.addEventListener("click", (event) => {
    const globalButton = event.target.closest?.(".notes-global-add-btn");
    if (globalButton) {
      const slot = globalButton.closest(".notes-global-add-slot");
      slot?.classList.add("open");
      globalButton.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => $("#noteTitle")?.focus());
      return;
    }

    const toggle = event.target.closest?.("[data-note-section-add-toggle]");
    if (!toggle) return;
    const board = toggle.closest(".notes-section-board");
    const form = $("[data-note-board-add]", board);
    if (!form) return;
    const willOpen = form.hidden;
    $$("[data-note-board-add]").forEach((other) => { other.hidden = true; });
    $$("[data-note-section-add-toggle]").forEach((other) => other.setAttribute("aria-expanded", "false"));
    form.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) requestAnimationFrame(() => $("input", form)?.focus());
  }, true);

  document.addEventListener("submit", (event) => {
    if (!event.target.matches?.("[data-note-board-add]")) return;
    const form = event.target;
    const toggle = $("[data-note-section-add-toggle]", form.closest(".notes-section-board"));
    setTimeout(() => {
      const input = $("input", form);
      if (input && !input.value.trim()) {
        form.hidden = true;
        toggle?.setAttribute("aria-expanded", "false");
      }
    }, 450);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (event.target.closest?.("#noteComposer")) {
      const slot = event.target.closest(".notes-global-add-slot");
      slot?.classList.remove("open");
      $(".notes-global-add-btn", slot || document)?.setAttribute("aria-expanded", "false");
    }
    const boardForm = event.target.closest?.("[data-note-board-add]");
    if (boardForm) {
      boardForm.hidden = true;
      $("[data-note-section-add-toggle]", boardForm.closest(".notes-section-board"))?.setAttribute("aria-expanded", "false");
    }
  }, true);

  const observer = new MutationObserver((records) => {
    if (transforming || !$("#notesList")) return;
    if (records.some((record) => record.target.id === "notesList" || record.target.closest?.("#notesList") || [...record.addedNodes].some((node) => node.nodeType === 1 && (node.id === "notesList" || node.querySelector?.("#notesList"))))) scheduleTransform();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleTransform();
}
