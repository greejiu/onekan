import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '\"': "&quot;" }[char]));

let user = null;
let state = null;
let activeTab = "notes";
let editing = null;
let deleteTarget = null;
let longPressTimer = null;
let suppressClickUntil = 0;

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function recordDate(item) {
  const value = item.date || item.updatedAt || item.createdAt;
  if (!value) return "날짜 없음";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.notes = Array.isArray(state.notes) ? state.notes : [];
  state.dailyNotes = Array.isArray(state.dailyNotes) ? state.dailyNotes : [];
  return state;
}

async function writeState(mutator) {
  const current = await readState();
  if (!current || !user) return;
  mutator(current);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  render();
  $("#reloadCloudBtn")?.click();
}

function sortedRecords() {
  return [...(state?.[activeTab] || [])].sort((a, b) => {
    const aTime = new Date(a.date || a.updatedAt || a.createdAt || 0).getTime() || 0;
    const bTime = new Date(b.date || b.updatedAt || b.createdAt || 0).getTime() || 0;
    return bTime - aTime;
  });
}

function render() {
  const list = $("#recordsList");
  if (!list || !state) return;
  $$("[data-record-tab]").forEach((button) => button.classList.toggle("active", button.dataset.recordTab === activeTab));
  const items = sortedRecords();
  list.innerHTML = items.length ? items.map((item) => `<article class="record-card" data-record-kind="${activeTab}" data-record-id="${esc(item.id)}">
    <div><div class="record-title">${esc(item.title || (activeTab === "dailyNotes" ? item.date : "제목 없는 메모"))}</div>${item.content ? `<div class="record-content">${esc(item.content)}</div>` : ""}${item.recordType === "expense" ? `<span class="record-kind">지출${item.category ? ` · ${esc(item.category)}` : ""}</span>` : ""}</div>
    <time class="record-date">${esc(recordDate(item))}</time>
  </article>`).join("") : `<div class="empty">${activeTab === "notes" ? "메모" : "일일수첩"}가 아직 없어요.</div>`;
}

function openEditor(kind = activeTab, item = null) {
  editing = item ? { kind, id: item.id } : null;
  $("#recordDialogTitle").textContent = item ? "기록 수정" : "기록 추가";
  $("#recordKind").value = kind;
  $("#recordKind").disabled = !!item;
  $("#recordTitle").value = item?.title || "";
  $("#recordDate").value = item?.date || dateKey(item?.updatedAt ? new Date(item.updatedAt) : new Date());
  $("#recordContent").value = item?.content || "";
  $("#recordDialog").showModal();
  requestAnimationFrame(() => $("#recordTitle").focus());
}

function ensureContextMenu() {
  if ($("#recordContextMenu")) return;
  const menu = document.createElement("div");
  menu.id = "recordContextMenu";
  menu.className = "record-context-menu";
  menu.innerHTML = '<button type="button">삭제하기</button>';
  document.body.appendChild(menu);
  menu.querySelector("button").addEventListener("click", async () => {
    const target = deleteTarget;
    hideContextMenu();
    if (!target) return;
    try {
      await writeState((current) => { current[target.kind] = current[target.kind].filter((item) => item.id !== target.id); });
    } catch (error) {
      console.error("기록 삭제 실패", error);
      window.alert("기록을 삭제하지 못했어요.");
    }
  });
}

function showContextMenu(x, y, card) {
  ensureContextMenu();
  deleteTarget = { kind: card.dataset.recordKind, id: card.dataset.recordId };
  const menu = $("#recordContextMenu");
  menu.classList.add("open");
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - 150))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - 50))}px`;
}

function hideContextMenu() {
  $("#recordContextMenu")?.classList.remove("open");
  deleteTarget = null;
}

function wireUI() {
  if (document.documentElement.dataset.recordsWired) return;
  document.documentElement.dataset.recordsWired = "1";
  ensureContextMenu();

  $$("[data-record-tab]").forEach((button) => button.addEventListener("click", () => {
    activeTab = button.dataset.recordTab;
    render();
  }));
  $("#addRecordBtn").addEventListener("click", () => openEditor(activeTab));
  $("#cancelRecordBtn").addEventListener("click", () => $("#recordDialog").close());
  $("#recordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = editing?.kind || $("#recordKind").value;
    const title = $("#recordTitle").value.trim();
    const date = $("#recordDate").value;
    const content = $("#recordContent").value.trim();
    if (!title || !date) return;
    try {
      await writeState((current) => {
        if (editing) {
          const item = current[kind].find((record) => record.id === editing.id);
          if (item) Object.assign(item, { title, date, content, updatedAt: new Date().toISOString() });
        } else {
          current[kind].push({ id: crypto.randomUUID(), title, date, content, source: "onekan", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        }
      });
      $("#recordDialog").close();
      editing = null;
    } catch (error) {
      console.error("기록 저장 실패", error);
      window.alert("기록을 저장하지 못했어요.");
    }
  });

  $("#recordsList").addEventListener("click", (event) => {
    const card = event.target.closest(".record-card");
    if (!card) return;
    if (Date.now() < suppressClickUntil) { event.preventDefault(); return; }
    const item = state?.[card.dataset.recordKind]?.find((record) => record.id === card.dataset.recordId);
    if (item) openEditor(card.dataset.recordKind, item);
  });
  $("#recordsList").addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".record-card");
    if (!card) return;
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, card);
  });
  $("#recordsList").addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const card = event.target.closest(".record-card");
    if (!card) return;
    const point = { x: event.clientX, y: event.clientY };
    longPressTimer = setTimeout(() => {
      suppressClickUntil = Date.now() + 800;
      showContextMenu(point.x, point.y, card);
      navigator.vibrate?.(12);
    }, 550);
  });
  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; };
  $("#recordsList").addEventListener("pointerup", cancelLongPress);
  $("#recordsList").addEventListener("pointercancel", cancelLongPress);
  $("#recordsList").addEventListener("pointermove", cancelLongPress);
  document.addEventListener("pointerdown", (event) => { if (!event.target.closest("#recordContextMenu")) hideContextMenu(); });
  document.querySelector('[data-page="records"]')?.addEventListener("click", async () => { await readState(); render(); });
  $("#reloadCloudBtn")?.addEventListener("click", async () => { await readState(); render(); });
}

async function init(session) {
  if (!session?.user) return;
  wireUI();
  await readState();
  render();
}

supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) setTimeout(() => init(session), 0); });
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init(session);
