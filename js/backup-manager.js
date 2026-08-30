import { supabase } from "./supabase.js";

const CSS_ID = "onekanBackupManagerCss";
const VISIBLE_REASONS = [
  "daily_snapshot",
  "pre_change_auto",
  "manual_snapshot",
  "pre_restore",
  "post_incident_surviving_state",
  "before_gallery_recovery",
];
const REASON_LABELS = {
  daily_snapshot: "매일 자동",
  pre_change_auto: "변경 전 자동",
  manual_snapshot: "수동 백업",
  pre_restore: "복원 직전",
  post_incident_surviving_state: "사고 후 보존",
  before_gallery_recovery: "복구 전 보존",
};

let currentUser = null;
let backups = [];

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement("link");
  link.id = CSS_ID;
  link.rel = "stylesheet";
  link.href = "./css/backup-manager.css?v=1";
  document.head.appendChild(link);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}

function stateSummary(data) {
  const state = data && typeof data === "object" ? data : {};
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const legacyHabits = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const events = Array.isArray(state.events) ? state.events : [];
  return {
    items: tasks.length + legacyHabits.length,
    projects: projects.length,
    sessions: sessions.length,
    events: events.length,
  };
}

function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function resolveUser() {
  if (currentUser) return currentUser;
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user || null;
  return currentUser;
}

async function readCurrentState() {
  const user = await resolveUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.data && typeof data.data === "object" ? data.data : {};
}

async function loadBackups() {
  const user = await resolveUser();
  if (!user) {
    backups = [];
    render();
    return;
  }
  const { data, error } = await supabase
    .from("onekan_state_history")
    .select("id,archived_at,reason,data")
    .eq("user_id", user.id)
    .in("reason", VISIBLE_REASONS)
    .order("archived_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  backups = Array.isArray(data) ? data : [];
  render();
}

async function createManualBackup() {
  const user = await resolveUser();
  const state = await readCurrentState();
  if (!user || !state) return;
  const { error } = await supabase.from("onekan_state_history").insert({
    user_id: user.id,
    data: state,
    reason: "manual_snapshot",
  });
  if (error) throw error;
  await loadBackups();
}

async function restoreBackup(id) {
  const user = await resolveUser();
  if (!user) return;
  const { data: backup, error: backupError } = await supabase
    .from("onekan_state_history")
    .select("id,archived_at,reason,data")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (backupError) throw backupError;
  if (!backup?.data) throw new Error("선택한 백업을 찾을 수 없습니다.");

  const label = `${REASON_LABELS[backup.reason] || "백업"} · ${formatStamp(backup.archived_at)}`;
  const ok = window.confirm(`${label} 상태로 복원할까요?\n\n현재 상태는 먼저 '복원 직전' 백업으로 보관됩니다.`);
  if (!ok) return;

  const current = await readCurrentState();
  if (current) {
    const { error: preserveError } = await supabase.from("onekan_state_history").insert({
      user_id: user.id,
      data: current,
      reason: "pre_restore",
    });
    if (preserveError) throw preserveError;
  }

  const { error: restoreError } = await supabase
    .from("onekan_state")
    .update({ data: backup.data, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (restoreError) throw restoreError;

  window.alert("백업을 복원했습니다. 화면을 다시 불러옵니다.");
  window.location.reload();
}

function ensureSection() {
  const settings = document.querySelector("#page-settings .settings-wrap");
  if (!settings) return null;
  let section = document.getElementById("onekanBackupSection");
  if (section) return section;

  section = document.createElement("section");
  section.className = "setting-section uw-backup-section";
  section.id = "onekanBackupSection";
  section.innerHTML = `
    <div class="uw-backup-title-row">
      <div>
        <h3>백업 &amp; 복원</h3>
        <div class="setting-desc">매일 03:05 자동 백업 · 변경 전 자동 백업 · 수동 백업</div>
      </div>
      <button class="soft-btn" id="onekanManualBackupBtn" type="button">지금 백업</button>
    </div>
    <div class="uw-backup-note">복원하면 현재 상태도 먼저 별도 백업으로 남겨집니다.</div>
    <div class="uw-backup-list" id="onekanBackupList"><div class="empty">백업을 불러오는 중...</div></div>
  `;

  const syncSection = [...settings.querySelectorAll(".setting-section")].find((node) => node.querySelector("h3")?.textContent?.trim() === "동기화");
  if (syncSection) settings.insertBefore(section, syncSection);
  else settings.appendChild(section);

  section.querySelector("#onekanManualBackupBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "백업 중...";
    try {
      await createManualBackup();
      button.textContent = "백업 완료";
      window.setTimeout(() => { button.textContent = original; }, 1000);
    } catch (error) {
      console.error("manual backup failed", error);
      window.alert("백업을 만들지 못했습니다.");
      button.textContent = original;
    } finally {
      button.disabled = false;
    }
  });

  section.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-restore-backup]");
    if (!button) return;
    button.disabled = true;
    try {
      await restoreBackup(Number(button.dataset.restoreBackup));
    } catch (error) {
      console.error("backup restore failed", error);
      window.alert(error?.message || "백업을 복원하지 못했습니다.");
      button.disabled = false;
    }
  });

  return section;
}

function render() {
  const section = ensureSection();
  const list = section?.querySelector("#onekanBackupList");
  if (!list) return;
  if (!backups.length) {
    list.innerHTML = '<div class="empty">아직 저장된 백업이 없어요.</div>';
    return;
  }

  list.innerHTML = backups.map((backup) => {
    const summary = stateSummary(backup.data);
    const reason = REASON_LABELS[backup.reason] || backup.reason || "백업";
    return `
      <div class="uw-backup-row">
        <div class="uw-backup-main">
          <div class="uw-backup-meta"><strong>${esc(reason)}</strong><span>${esc(formatStamp(backup.archived_at))}</span></div>
          <div class="uw-backup-summary">항목 ${summary.items} · 프로젝트 ${summary.projects} · 시간기록 ${summary.sessions} · 일정 ${summary.events}</div>
        </div>
        <button class="soft-btn uw-backup-restore" type="button" data-restore-backup="${backup.id}">복원</button>
      </div>`;
  }).join("");
}

async function init() {
  ensureCss();
  ensureSection();
  try {
    await loadBackups();
  } catch (error) {
    console.warn("backup list load failed", error);
    const list = document.getElementById("onekanBackupList");
    if (list) list.innerHTML = '<div class="empty">백업 목록을 불러오지 못했어요.</div>';
  }
}

document.addEventListener("onekan:state-changed", () => {
  if (document.getElementById("page-settings")?.classList.contains("active")) loadBackups().catch(() => {});
});

document.addEventListener("click", (event) => {
  const nav = event.target.closest('[data-page="settings"]');
  if (nav) window.setTimeout(() => loadBackups().catch(() => {}), 80);
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  window.setTimeout(() => loadBackups().catch(() => {}), 0);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
