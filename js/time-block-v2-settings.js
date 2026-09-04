import { onekanStateStore, supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";
import {
  ensureTimeBlockV2State,
  setTimeBlockTemplatesForDate,
  timeBlockTemplatesForDate,
  validateTimeBlockTemplates,
} from "./time-block-v2.js?v=3";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
let renderTimer = null;
let saving = false;
let initialized = false;

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

function minuteText(minute) {
  const value = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function timeToMinute(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function normalizeState(value) {
  return value && typeof value === "object" ? value : {};
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const stored = await onekanStateStore.read({ userId: session.user.id });
  return { user: session.user, state: normalizeState(stored) };
}

async function mutateState(mutator, source = "time-block-v2") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const committed = await onekanStateStore.mutate((latest) => {
    const state = normalizeState(latest);
    mutator(state);
    return state;
  }, { userId: session.user.id, source });
  $("#reloadCloudBtn")?.click();
  return { user: session.user, state: normalizeState(committed) };
}

function ensureSection() {
  const wrap = $("#page-settings .settings-wrap");
  if (!wrap) return null;
  let section = $("#timeBlockV2SettingsSection");
  if (section) return section;

  section = document.createElement("section");
  section.id = "timeBlockV2SettingsSection";
  section.className = "setting-section";
  section.innerHTML = `
    <h3>기본 타임블럭</h3>
    <div class="setting-desc">매일 재사용하는 시간대 틀입니다. 저장한 변경은 오늘부터 적용되고, 과거 날짜의 블럭 버전은 그대로 유지됩니다.</div>
    <div id="timeBlockV2List"></div>
    <div class="time-block-v2-actions">
      <button class="soft-btn" id="addTimeBlockV2Btn" type="button">+ 타임블럭</button>
      <button class="primary-btn" id="saveTimeBlockV2Btn" type="button">저장</button>
    </div>
    <div class="setting-desc time-block-v2-version-note" id="timeBlockV2VersionNote"></div>`;

  const timelineSection = $("#timelineStart")?.closest(".setting-section");
  if (timelineSection) timelineSection.insertAdjacentElement("afterend", section);
  else wrap.prepend(section);

  $("#addTimeBlockV2Btn", section)?.addEventListener("click", addRow);
  $("#saveTimeBlockV2Btn", section)?.addEventListener("click", saveRows);
  injectStyles();
  return section;
}

function rowMarkup(template) {
  return `
    <div class="time-block-v2-row" data-time-block-v2-row data-template-id="${esc(template.id)}">
      <input data-template-title value="${esc(template.title || "")}" placeholder="이름 (선택)" aria-label="타임블럭 이름" />
      <input type="time" data-template-start value="${minuteText(template.startMinute)}" aria-label="시작 시간" />
      <span aria-hidden="true">–</span>
      <input type="time" data-template-end value="${minuteText(template.endMinute)}" aria-label="종료 시간" />
      <button class="ghost-btn danger-text" type="button" data-template-delete>삭제</button>
    </div>`;
}

function wireDelete(root) {
  $$('[data-template-delete]', root).forEach((button) => {
    if (button.dataset.wired === "1") return;
    button.dataset.wired = "1";
    button.addEventListener("click", () => button.closest("[data-time-block-v2-row]")?.remove());
  });
}

function addRow() {
  const list = $("#timeBlockV2List");
  if (!list) return;
  const rows = $$('[data-time-block-v2-row]', list);
  let startMinute = 360;
  if (rows.length) {
    const lastEnd = timeToMinute($("[data-template-end]", rows[rows.length - 1])?.value);
    if (lastEnd !== null) startMinute = Math.min(1380, lastEnd);
  }
  const endMinute = Math.min(1439, startMinute + 60);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = rowMarkup({ id: crypto.randomUUID(), title: "", startMinute, endMinute });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  wireDelete(row);
  $("[data-template-title]", row)?.focus();
}

function collectRows() {
  return $$("#timeBlockV2List [data-time-block-v2-row]").map((row) => ({
    id: row.dataset.templateId || crypto.randomUUID(),
    title: $("[data-template-title]", row)?.value.trim() || "",
    startMinute: timeToMinute($("[data-template-start]", row)?.value),
    endMinute: timeToMinute($("[data-template-end]", row)?.value),
  }));
}

async function saveRows() {
  if (saving) return;
  const validation = validateTimeBlockTemplates(collectRows());
  if (!validation.ok) {
    showToast(validation.message);
    return;
  }

  saving = true;
  const button = $("#saveTimeBlockV2Btn");
  if (button) button.disabled = true;
  try {
    const effectiveFrom = appDayKey();
    const committed = await mutateState((state) => {
      ensureTimeBlockV2State(state);
      setTimeBlockTemplatesForDate(state, validation.templates, effectiveFrom);
    });
    if (!committed) return;
    showToast("기본 타임블럭을 오늘부터 적용했어요.");
    await renderSettings();
  } catch (error) {
    console.error("타임블럭 V2 저장 실패", error);
    showToast("기본 타임블럭을 저장하지 못했어요.");
  } finally {
    saving = false;
    if (button) button.disabled = false;
  }
}

async function renderSettings() {
  const section = ensureSection();
  if (!section || saving) return;
  try {
    let current = await readState();
    if (!current) return;
    const changed = ensureTimeBlockV2State(current.state);
    if (changed) {
      const committed = await mutateState((state) => { ensureTimeBlockV2State(state); });
      if (committed) current = committed;
    }
    const dateKey = appDayKey();
    const templates = timeBlockTemplatesForDate(current.state, dateKey);
    const list = $("#timeBlockV2List", section);
    list.innerHTML = templates.length
      ? templates.map(rowMarkup).join("")
      : '<div class="time-block-v2-empty">아직 기본 타임블럭이 없어요. 필요한 시간대부터 추가해 보세요.</div>';
    wireDelete(list);
    const note = $("#timeBlockV2VersionNote", section);
    if (note) note.textContent = `현재 설정 기준일: ${dateKey} · 같은 블럭 ID는 기준일 이하 버전 중 가장 최근 버전을 사용합니다.`;
  } catch (error) {
    console.error("타임블럭 V2 설정 표시 실패", error);
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if ($("#page-settings")?.classList.contains("active")) renderSettings();
  }, 100);
}

function injectStyles() {
  if ($("#timeBlockV2SettingsStyles")) return;
  const style = document.createElement("style");
  style.id = "timeBlockV2SettingsStyles";
  style.textContent = `
    .time-block-v2-row{display:grid;grid-template-columns:minmax(120px,1fr) 112px auto 112px auto;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--line,#d2d7df)}
    .time-block-v2-row input{min-width:0}
    .time-block-v2-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}
    .time-block-v2-empty{padding:12px 0;color:var(--muted,#6b7280);font-size:13px}
    .time-block-v2-version-note{margin-top:8px}
    @media(max-width:620px){
      .time-block-v2-row{grid-template-columns:minmax(0,1fr) 1fr auto 1fr}
      .time-block-v2-row [data-template-delete]{grid-column:1/-1;justify-self:end}
    }
  `;
  document.head.appendChild(style);
}

async function init() {
  if (initialized) return;
  initialized = true;
  ensureSection();
  await renderSettings();
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="settings"]')) setTimeout(renderSettings, 80);
  });
  document.addEventListener("onekan:state-changed", scheduleRender);
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
