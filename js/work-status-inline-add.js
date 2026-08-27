import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const todayKey = () => {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function installStyle() {
  if ($("#workStatusInlineStyle")) return;
  const style = document.createElement("style");
  style.id = "workStatusInlineStyle";
  style.textContent = `
    .uw-work-status-board{align-items:stretch!important}
    .uw-work-status-section{height:100%}
    .uw-work-status-section>.uw-work-list{min-height:0}
    .uw-work-status-head strong,.uw-work-group-head strong{min-width:0;flex:1}
    .uw-work-status-head small,.uw-work-group-head small{display:none!important}
    .uw-work-inline-add{display:inline-grid;place-items:center;width:28px;height:28px;flex:0 0 28px;padding:0;border:1px solid color-mix(in srgb,var(--uw-status,var(--uw-group,#8fa9c4)) 38%,var(--line));border-radius:8px;background:#fff;color:var(--text);font-size:17px;line-height:1;cursor:pointer;transition:.15s ease}
    .uw-work-inline-add:hover{background:color-mix(in srgb,var(--uw-status,var(--uw-group,#8fa9c4)) 12%,#fff);border-color:color-mix(in srgb,var(--uw-status,var(--uw-group,#8fa9c4)) 58%,var(--line))}
    .uw-work-quick-form{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line);background:#fff}
    .uw-work-quick-form input{min-width:0;flex:1;height:32px;padding:5px 8px;border:1.5px solid var(--accent);border-radius:8px;background:#fff;color:var(--text);outline:0;font:inherit;font-size:11px}
    .uw-work-quick-submit{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
    @media(max-width:600px){.uw-work-inline-add{width:32px;height:32px;flex-basis:32px}.uw-work-quick-form input{height:36px;font-size:14px}}
  `;
  document.head.appendChild(style);
}

function buttonMarkup(kind, status, groupName = "") {
  const label = kind === "goal" ? "목표" : "작업";
  const button = document.createElement("button");
  button.className = "uw-work-inline-add";
  button.type = "button";
  button.textContent = "＋";
  button.dataset.fastWorkAdd = kind;
  button.dataset.fastWorkStatus = status;
  if (groupName) button.dataset.fastWorkGroupName = groupName;
  button.setAttribute("aria-label", `${label} 바로 추가`);
  return button;
}

function decorate() {
  for (const root of [$("#goalSections"), $("#projectSections")]) {
    if (!root) continue;
    $$(".uw-work-status-section", root).forEach((section) => {
      const head = $(".uw-work-status-head", section);
      if (!head || $("[data-fast-work-add]", head)) return;
      $("small", head)?.remove();
      const kind = section.dataset.workKind === "goal" ? "goal" : "project";
      head.appendChild(buttonMarkup(kind, section.dataset.workDropStatus || "before"));
    });
    $$(".uw-work-group", root).forEach((section) => {
      const head = $(".uw-work-group-head", section);
      if (!head || $("[data-fast-work-add]", head)) return;
      $("small", head)?.remove();
      const page = section.closest("#goalSections,#projectSections");
      const kind = page?.id === "goalSections" ? "goal" : "project";
      const drop = section.closest("[data-work-drop-status]");
      const groupName = $("strong", head)?.textContent?.trim() || "";
      head.appendChild(buttonMarkup(kind, drop?.dataset.workDropStatus || "before", groupName));
    });
  }
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const current = data?.data && typeof data.data === "object" ? data.data : {};
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  current.eventGroups = Array.isArray(current.eventGroups) && current.eventGroups.length ? current.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  return { current, userId: session.user.id };
}

async function saveQuickItem({ kind, status, groupName, title }) {
  const loaded = await readState();
  if (!loaded) return;
  const { current, userId } = loaded;
  const group = groupName ? current.eventGroups.find((item) => item.name === groupName) : null;
  const item = {
    id: crypto.randomUUID(),
    kind,
    title,
    status,
    groupId: group?.id || current.eventGroups[0]?.id || "default",
    startDate: todayKey(),
    deadline: "",
    createdAt: new Date().toISOString(),
  };
  if (status === "done") item.completedAt = new Date().toISOString();
  current.projects.push(item);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: userId, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "work-quick-add" } }));
}

function openQuickInput(button) {
  const section = button.closest(".uw-work-group,.uw-work-status-section");
  const list = section ? $(".uw-work-list", section) : null;
  if (!list) return;
  $$(".uw-work-quick-form").forEach((form) => form.remove());

  const kind = button.dataset.fastWorkAdd === "goal" ? "goal" : "project";
  const status = button.dataset.fastWorkStatus || "before";
  const groupName = button.dataset.fastWorkGroupName || "";
  const form = document.createElement("form");
  form.className = "uw-work-quick-form";
  form.innerHTML = `<input type="text" maxlength="120" autocomplete="off" placeholder="${kind === "goal" ? "새 목표" : "새 작업"}" aria-label="${kind === "goal" ? "새 목표" : "새 작업"}" /><button class="uw-work-quick-submit" type="submit" aria-label="추가">↵</button>`;
  list.prepend(form);
  const input = $("input", form);
  input?.focus({ preventScroll: true });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      form.remove();
      button.focus({ preventScroll: true });
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = input?.value.trim() || "";
    if (!title) return;
    const submit = $("button", form);
    if (submit) submit.disabled = true;
    if (input) input.disabled = true;
    try {
      await saveQuickItem({ kind, status, groupName, title });
    } catch (error) {
      console.error("목표·작업 빠른 추가 실패", error);
      if (submit) submit.disabled = false;
      if (input) {
        input.disabled = false;
        input.focus();
      }
    }
  });
}

function init() {
  installStyle();
  $("#addGoalBtn")?.remove();
  $("#addProjectBtn")?.remove();
  decorate();

  const observer = new MutationObserver(() => decorate());
  [$("#goalSections"), $("#projectSections")].filter(Boolean).forEach((root) => observer.observe(root, { childList: true, subtree: true }));

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fast-work-add]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    openQuickInput(button);
  }, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
