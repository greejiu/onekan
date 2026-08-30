import { supabase } from "./supabase.js";
import "./home-mini-stats.js?v=1";

const BACKUP_PREFIX = "onekan:home-memo-backup:";
const SAVE_DELAY = 220;
let userId = null;
let saveTimer = null;
let cachedHtml = "";
let restoring = false;

function editor() {
  return document.querySelector("#homeMemoGrid .uw-home-memo-editor");
}

function backupKey() {
  return userId ? `${BACKUP_PREFIX}${userId}` : null;
}

function readBackup() {
  const key = backupKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed || typeof parsed.html !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBackup(html) {
  const key = backupKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ html, savedAt: Date.now() }));
  } catch {}
}

function clearBackupIfMatches(html) {
  const key = backupKey();
  if (!key) return;
  const backup = readBackup();
  if (backup?.html !== html) return;
  try { localStorage.removeItem(key); } catch {}
}

function normalizedBoard(data, html) {
  const raw = data?.homeMemoBoard && typeof data.homeMemoBoard === "object"
    ? structuredClone(data.homeMemoBoard)
    : { columns: 1, cardColor: "#ffffff", notes: [] };
  raw.columns = 1;
  raw.cardColor = typeof raw.cardColor === "string" ? raw.cardColor : "#ffffff";
  raw.notes = Array.isArray(raw.notes) ? raw.notes : [];
  raw.notes[0] = {
    id: typeof raw.notes[0]?.id === "string" && raw.notes[0].id ? raw.notes[0].id : "home-memo-1",
    html,
  };
  return raw;
}

async function resolveUser() {
  if (userId) return userId;
  const { data } = await supabase.auth.getSession();
  userId = data?.session?.user?.id || null;
  return userId;
}

async function fetchCloudMemo() {
  const uid = await resolveUser();
  if (!uid) return "";
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) {
    console.warn("home memo restore failed", error);
    return "";
  }
  return typeof data?.data?.homeMemoBoard?.notes?.[0]?.html === "string"
    ? data.data.homeMemoBoard.notes[0].html
    : "";
}

async function saveCloudMemo(html) {
  const uid = await resolveUser();
  if (!uid) return;
  const { data: row, error: readError } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", uid)
    .maybeSingle();
  if (readError) {
    console.warn("home memo read before save failed", readError);
    return;
  }
  const current = row?.data && typeof row.data === "object" ? row.data : {};
  const next = { ...current, homeMemoBoard: normalizedBoard(current, html) };
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: uid, data: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.warn("home memo save failed", error);
    return;
  }
  clearBackupIfMatches(html);
}

function queueCloudSave(html) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCloudMemo(html);
  }, SAVE_DELAY);
}

function applyHtml(html, force = false) {
  const target = editor();
  if (!target || document.activeElement === target && !force) return false;
  if (!force && target.innerHTML.trim()) return false;
  if (target.innerHTML === html) return true;
  restoring = true;
  target.innerHTML = html;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  restoring = false;
  return true;
}

async function restoreMemo() {
  await resolveUser();
  const backup = readBackup();
  const cloudHtml = await fetchCloudMemo();
  const preferred = backup?.html ?? cloudHtml;
  cachedHtml = preferred || "";
  if (!cachedHtml) return;

  let attempts = 0;
  const tryRestore = () => {
    attempts += 1;
    const target = editor();
    if (!target) {
      if (attempts < 40) setTimeout(tryRestore, 100);
      return;
    }
    const shouldForce = Boolean(backup);
    applyHtml(cachedHtml, shouldForce);
    if (backup) queueCloudSave(cachedHtml);
  };
  tryRestore();
}

document.addEventListener("input", (event) => {
  const target = event.target?.closest?.("#homeMemoGrid .uw-home-memo-editor");
  if (!target) return;
  const html = target.innerHTML;
  cachedHtml = html;
  writeBackup(html);
  if (!restoring) queueCloudSave(html);
}, true);

document.addEventListener("onekan:state-changed", () => {
  if (!cachedHtml) return;
  requestAnimationFrame(() => applyHtml(cachedHtml, false));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  const target = editor();
  if (target) writeBackup(target.innerHTML);
});

window.addEventListener("pagehide", () => {
  const target = editor();
  if (target) writeBackup(target.innerHTML);
});

supabase.auth.onAuthStateChange((_event, session) => {
  const nextId = session?.user?.id || null;
  if (nextId === userId) return;
  userId = nextId;
  cachedHtml = "";
  restoreMemo();
});

restoreMemo();
