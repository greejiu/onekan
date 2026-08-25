const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let observer = null;
let timer = null;

function closeForm(form, clear = false) {
  const input = $("input", form);
  if (clear && input) input.value = "";
  form.classList.remove("compact-add-open");
}

function compactForms() {
  const board = $("#dailyBlockBoard");
  if (!board) return;

  $$(".daily-block-empty", board).forEach((empty) => {
    empty.textContent = "할일 없음";
  });

  $$(".daily-block-add", board).forEach((form) => {
    const input = $("input", form);
    const button = $("button", form);
    if (!input || !button) return;

    form.classList.add("compact-add");
    button.textContent = "+";
    button.title = "할일 추가";
    button.setAttribute("aria-label", "할일 추가");

    if (form.dataset.compactAddWired === "1") return;
    form.dataset.compactAddWired = "1";

    button.addEventListener("click", (event) => {
      if (form.classList.contains("compact-add-open")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      form.classList.add("compact-add-open");
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }, true);

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeForm(form, true);
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!form.contains(document.activeElement) && !input.value.trim()) closeForm(form);
      }, 0);
    });
  });
}

function injectStyle() {
  if ($("#timeBlockCompactStyles")) return;
  const style = document.createElement("style");
  style.id = "timeBlockCompactStyles";
  style.textContent = `
    #dailyBlockBoard .daily-block-columns{grid-template-columns:minmax(0,1fr)!important;gap:8px!important}
    #dailyBlockBoard .daily-block-column{gap:8px!important}
    #dailyBlockBoard .daily-block{border-radius:9px}
    #dailyBlockBoard .daily-block-head{padding:8px 10px 7px}
    #dailyBlockBoard .daily-block-drop{min-height:34px;padding:4px 8px 2px}
    #dailyBlockBoard .daily-block-empty{padding:4px 3px 2px;font-size:11px}
    #dailyBlockBoard .daily-block-add.compact-add{display:flex!important;align-items:center;justify-content:flex-end;gap:5px;padding:2px 8px 6px!important;border-top:0!important}
    #dailyBlockBoard .daily-block-add.compact-add input{display:none!important;height:30px;min-width:0;flex:1;padding:4px 7px;font-size:12px}
    #dailyBlockBoard .daily-block-add.compact-add.compact-add-open input{display:block!important}
    #dailyBlockBoard .daily-block-add.compact-add button{width:28px;height:28px;min-height:28px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;font-size:18px;line-height:1;color:var(--muted,#6b7280)}
    #dailyBlockBoard .daily-block-add.compact-add button:hover{color:var(--text,#1f2328);background:var(--hover,#f3f5f7)}
  `;
  document.head.appendChild(style);
}

function scheduleCompact() {
  clearTimeout(timer);
  timer = setTimeout(compactForms, 40);
}

function observeBoard() {
  if (observer) return;
  const home = $("#page-home");
  if (!home) return;
  observer = new MutationObserver(scheduleCompact);
  observer.observe(home, { childList: true, subtree: true });
}

function init() {
  injectStyle();
  observeBoard();
  scheduleCompact();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
