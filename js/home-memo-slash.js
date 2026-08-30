import "./home-memo-persistence.js?v=1";

const COMMANDS = [
  { id: "bold", label: "굵게", icon: "B", description: "입력할 글자를 굵게" },
  { id: "strikeThrough", label: "취소선", icon: "S", description: "입력할 글자에 취소선" },
  { id: "insertUnorderedList", label: "글머리 목록", icon: "•", description: "글머리 기호 목록 시작" },
  { id: "checklist", label: "체크리스트", icon: "☑", description: "체크할 수 있는 목록 시작" },
];

let menu = null;
let activeEditor = null;
let selectedIndex = 0;
let pendingSlashEditor = null;

function injectStyles() {
  if (document.getElementById("homeMemoSlashStyles")) return;
  const style = document.createElement("style");
  style.id = "homeMemoSlashStyles";
  style.textContent = `
    .uw-home-memo-slash-menu{
      position:fixed;
      z-index:5000;
      width:min(270px,calc(100vw - 24px));
      padding:6px;
      box-sizing:border-box;
      border:1px solid var(--line,#e6e2ea);
      border-radius:12px;
      background:var(--panel,#fff);
      color:var(--text,#2f2f33);
      box-shadow:0 12px 30px rgba(45,38,55,.14);
    }
    .uw-home-memo-slash-menu[hidden]{display:none!important}
    .uw-home-memo-slash-title{
      padding:5px 8px 6px;
      color:var(--muted,#8b8590);
      font-size:11px;
      line-height:1.3;
    }
    .uw-home-memo-slash-option{
      display:grid;
      grid-template-columns:30px 1fr;
      gap:8px;
      align-items:center;
      width:100%;
      padding:7px 8px;
      border:0;
      border-radius:8px;
      background:transparent;
      color:inherit;
      text-align:left;
      font:inherit;
      cursor:pointer;
    }
    .uw-home-memo-slash-option:hover,
    .uw-home-memo-slash-option.is-selected{
      background:var(--panel-soft,#f5f2f7);
    }
    .uw-home-memo-slash-icon{
      display:grid;
      place-items:center;
      width:28px;
      height:28px;
      border:1px solid var(--line,#e6e2ea);
      border-radius:7px;
      background:var(--panel,#fff);
      font-size:13px;
      font-weight:600;
    }
    .uw-home-memo-slash-copy{min-width:0}
    .uw-home-memo-slash-label{
      display:block;
      font-size:12px;
      font-weight:650;
      line-height:1.25;
    }
    .uw-home-memo-slash-description{
      display:block;
      margin-top:2px;
      color:var(--muted,#8b8590);
      font-size:10px;
      line-height:1.25;
    }
    @media(max-width:600px){
      .uw-home-memo-slash-menu{width:min(290px,calc(100vw - 20px))}
      .uw-home-memo-slash-option{padding:9px 8px}
      .uw-home-memo-slash-label{font-size:13px}
      .uw-home-memo-slash-description{font-size:11px}
    }
  `;
  document.head.appendChild(style);
}

function ensureMenu() {
  if (menu) return menu;
  injectStyles();
  menu = document.createElement("div");
  menu.className = "uw-home-memo-slash-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "메모 서식 선택");
  menu.innerHTML = `
    <div class="uw-home-memo-slash-title">↑↓ 선택 · Enter 적용 · Esc 닫기</div>
    ${COMMANDS.map((command, index) => `
      <button class="uw-home-memo-slash-option" type="button" role="option" data-slash-index="${index}">
        <span class="uw-home-memo-slash-icon" aria-hidden="true">${command.icon}</span>
        <span class="uw-home-memo-slash-copy">
          <span class="uw-home-memo-slash-label">${command.label}</span>
          <span class="uw-home-memo-slash-description">${command.description}</span>
        </span>
      </button>
    `).join("")}
  `;
  document.body.appendChild(menu);

  menu.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-slash-index]")) event.preventDefault();
  });
  menu.addEventListener("mousemove", (event) => {
    const button = event.target.closest("[data-slash-index]");
    if (!button) return;
    selectedIndex = Number(button.dataset.slashIndex || 0);
    renderSelection();
  });
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slash-index]");
    if (!button) return;
    selectedIndex = Number(button.dataset.slashIndex || 0);
    executeSelectedCommand();
  });
  return menu;
}

function renderSelection() {
  if (!menu) return;
  menu.querySelectorAll("[data-slash-index]").forEach((button, index) => {
    const selected = index === selectedIndex;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function caretRect(editor) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height || rect.top || rect.left)) return rect;
  }
  return editor.getBoundingClientRect();
}

function positionMenu() {
  if (!menu || menu.hidden || !activeEditor) return;
  const rect = caretRect(activeEditor);
  const gap = 7;
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + gap;
  const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
  left = Math.min(Math.max(8, left), maxLeft);
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuRect.height - gap);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openMenu(editor) {
  if (!editor?.isConnected) return;
  activeEditor = editor;
  selectedIndex = 0;
  const slashMenu = ensureMenu();
  slashMenu.hidden = false;
  renderSelection();
  requestAnimationFrame(positionMenu);
}

function closeMenu() {
  if (menu) menu.hidden = true;
  activeEditor = null;
  pendingSlashEditor = null;
}

function nearestList(editor) {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorElement = anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
  const list = anchorElement?.closest?.("ul");
  return list && editor.contains(list) ? list : null;
}

function dispatchMemoInput(editor) {
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function executeSelectedCommand() {
  const editor = activeEditor;
  const command = COMMANDS[selectedIndex];
  if (!editor || !command) return closeMenu();

  editor.focus({ preventScroll: true });

  document.execCommand("delete", false);

  if (command.id === "checklist") {
    document.execCommand("insertUnorderedList", false);
    nearestList(editor)?.classList.add("uw-memo-checklist");
  } else {
    document.execCommand(command.id, false);
  }

  dispatchMemoInput(editor);
  closeMenu();
}

function menuIsOpen() {
  return Boolean(menu && !menu.hidden && activeEditor);
}

function currentEditor(target) {
  return target?.closest?.(".uw-home-memo-editor") || null;
}

document.addEventListener("keydown", (event) => {
  const editor = currentEditor(event.target);

  if (menuIsOpen() && editor === activeEditor) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex + 1) % COMMANDS.length;
      renderSelection();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex - 1 + COMMANDS.length) % COMMANDS.length;
      renderSelection();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      executeSelectedCommand();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    closeMenu();
  }

  if (!editor || event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  pendingSlashEditor = editor;
  setTimeout(() => {
    if (pendingSlashEditor !== editor || document.activeElement !== editor) return;
    openMenu(editor);
    pendingSlashEditor = null;
  }, 0);
}, true);

document.addEventListener("pointerdown", (event) => {
  if (!menuIsOpen()) return;
  if (event.target.closest(".uw-home-memo-slash-menu")) return;
  if (event.target.closest(".uw-home-memo-editor") === activeEditor) return;
  closeMenu();
}, true);

window.addEventListener("resize", () => {
  if (menuIsOpen()) positionMenu();
});
window.addEventListener("scroll", () => {
  if (menuIsOpen()) positionMenu();
}, true);
