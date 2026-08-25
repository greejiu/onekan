import { supabase } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const BUCKET = "onekan-user-assets";

let user = null;
let state = null;

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};
  state.ui.homeAppearance = { position: "center", overlay: 28, ...(state.ui.homeAppearance || {}) };
  return state;
}

async function writeAppearance(changes) {
  const current = await readState();
  if (!current || !user) return;
  current.ui.homeAppearance = { ...current.ui.homeAppearance, ...changes };
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  await applyAppearance();
  $("#reloadCloudBtn")?.click();
}

async function applyAppearance() {
  const head = $("#page-home .page-head");
  if (!head || !state) return;
  const appearance = state.ui.homeAppearance || {};
  $("#homeBackgroundPosition").value = appearance.position || "center";
  $("#homeBackgroundOverlay").value = String(Number(appearance.overlay ?? 28));
  head.style.setProperty("--home-background-position", appearance.position || "center");
  head.style.setProperty("--home-overlay", String(Math.max(0, Math.min(80, Number(appearance.overlay ?? 28))) / 100));
  if (!appearance.backgroundPath) {
    head.classList.remove("has-custom-background");
    head.style.removeProperty("--home-background-image");
    $("#homeBackgroundStatus").textContent = "사진을 선택하면 자동으로 저장됩니다.";
    return;
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(appearance.backgroundPath, 3600);
  if (error) throw error;
  const safeUrl = String(data.signedUrl).replace(/["\\]/g, "\\$&");
  head.style.setProperty("--home-background-image", `url("${safeUrl}")`);
  head.classList.add("has-custom-background");
  $("#homeBackgroundStatus").textContent = "집 배경 사진이 적용되어 있어요.";
}

async function uploadBackground(file) {
  if (!file || !user) return;
  if (!file.type.startsWith("image/")) return window.alert("이미지 파일만 선택할 수 있어요.");
  if (file.size > 5 * 1024 * 1024) return window.alert("사진은 5MB 이하로 골라 주세요.");
  const status = $("#homeBackgroundStatus");
  status.textContent = "사진 저장 중...";
  const path = `${user.id}/home-background`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (error) throw error;
  await writeAppearance({ backgroundPath: path });
  status.textContent = "집 배경 사진이 저장되었어요.";
}

function wireUI() {
  if (document.documentElement.dataset.appearanceWired) return;
  document.documentElement.dataset.appearanceWired = "1";
  $("#homeBackgroundFile").addEventListener("change", async (event) => {
    try { await uploadBackground(event.target.files?.[0]); }
    catch (error) { console.error("배경 업로드 실패", error); $("#homeBackgroundStatus").textContent = "사진을 저장하지 못했어요."; }
    event.target.value = "";
  });
  $("#homeBackgroundPosition").addEventListener("change", (event) => writeAppearance({ position: event.target.value }).catch(console.error));
  $("#homeBackgroundOverlay").addEventListener("change", (event) => writeAppearance({ overlay: Number(event.target.value) }).catch(console.error));
  $("#removeHomeBackground").addEventListener("click", async () => {
    try {
      const path = state?.ui?.homeAppearance?.backgroundPath;
      if (path) {
        const { error } = await supabase.storage.from(BUCKET).remove([path]);
        if (error) throw error;
      }
      await writeAppearance({ backgroundPath: null });
    } catch (error) {
      console.error("배경 제거 실패", error);
      window.alert("배경 사진을 제거하지 못했어요.");
    }
  });
  $("#reloadCloudBtn")?.addEventListener("click", async () => { await readState(); await applyAppearance(); });
}

async function init(session) {
  if (!session?.user) return;
  wireUI();
  await readState();
  await applyAppearance();
}

supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) setTimeout(() => init(session), 0); });
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init(session);
