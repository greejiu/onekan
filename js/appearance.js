import { onekanStateStore, supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector) => document.querySelector(selector);
const BUCKET = "onekan-user-assets";
const DEFAULT_THEME = "#8fa9c4";

let user = null;
let state = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : DEFAULT_THEME;
const timeValue = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minuteValue = (value) => {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? clamp(Math.round((hour * 60 + minute) / 30) * 30, 0, 1440) : null;
};

function normalizeState(value) {
  const next = value && typeof value === "object" ? value : {};
  next.ui = next.ui && typeof next.ui === "object" ? next.ui : {};
  next.ui.homeAppearance = { position: "center", overlay: 28, ...(next.ui.homeAppearance || {}) };
  next.ui.themeColor = validColor(next.ui.themeColor);
  const range = next.ui.timelineRange && typeof next.ui.timelineRange === "object" ? next.ui.timelineRange : {};
  const start = clamp(Math.round((Number(range.start) || 360) / 30) * 30, 0, 1350);
  const end = clamp(Math.round((Number(range.end) || 1320) / 30) * 30, start + 30, 1440);
  next.ui.timelineRange = { start, end };
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return state = null;
  const stored = await onekanStateStore.read({ userId: user.id });
  state = normalizeState(stored);
  return state;
}

async function writeAppearance(appearanceChanges = {}, uiChanges = {}) {
  const current = await readState();
  if (!current || !user) return;
  const committed = await onekanStateStore.mutate((latest) => {
    const next = normalizeState(latest);
    next.ui.homeAppearance = { ...next.ui.homeAppearance, ...appearanceChanges };
    next.ui = { ...next.ui, ...uiChanges, homeAppearance: next.ui.homeAppearance };
    return next;
  }, { userId: user.id, source: "appearance" });
  if (!committed) return;
  state = normalizeState(committed);
  await applyAppearance();
  $("#reloadCloudBtn")?.click();
}

async function applyAppearance() {
  if (!state) return;
  const root = document.documentElement;
  const theme = validColor(state.ui.themeColor);
  root.style.setProperty("--uw-theme", theme);
  root.style.setProperty("--accent", theme);
  root.style.setProperty("--accent-dark", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme);
  if ($("#themeColor")) $("#themeColor").value = theme;
  if ($("#homeThemeColor")) $("#homeThemeColor").value = theme;
  if ($("#timelineStart")) $("#timelineStart").value = timeValue(state.ui.timelineRange.start);
  if ($("#timelineEnd")) $("#timelineEnd").value = timeValue(state.ui.timelineRange.end);

  const head = $("#page-home .page-head");
  if (!head) return;
  const appearance = state.ui.homeAppearance || {};
  if ($("#homeBackgroundPosition")) $("#homeBackgroundPosition").value = appearance.position || "center";
  if ($("#homeBackgroundOverlay")) $("#homeBackgroundOverlay").value = String(Number(appearance.overlay ?? 28));
  head.style.setProperty("--home-background-position", appearance.position || "center");
  head.style.setProperty("--home-overlay", String(clamp(Number(appearance.overlay ?? 28), 0, 80) / 100));
  if (!appearance.backgroundPath) {
    head.classList.remove("has-custom-background");
    head.style.removeProperty("--home-background-image");
    if ($("#homeBackgroundStatus")) $("#homeBackgroundStatus").textContent = "사진을 선택하면 자동으로 저장됩니다.";
    return;
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(appearance.backgroundPath, 3600);
  if (error) throw error;
  const safeUrl = String(data.signedUrl).replace(/["\\]/g, "\\$&");
  head.style.setProperty("--home-background-image", `url("${safeUrl}")`);
  head.classList.add("has-custom-background");
  if ($("#homeBackgroundStatus")) $("#homeBackgroundStatus").textContent = "집 배경 사진이 적용되어 있어요.";
}

async function extractThemeColor(file) {
  const bitmap = await createImageBitmap(file);
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close?.();
  const pixels = context.getImageData(0, 0, size, size).data;
  let r = 0, g = 0, b = 0, weight = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 180) continue;
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    const light = (red + green + blue) / 3;
    if (light < 35 || light > 230) continue;
    const amount = 1 + spread / 48;
    r += red * amount; g += green * amount; b += blue * amount; weight += amount;
  }
  if (!weight) return DEFAULT_THEME;
  const hex = (value) => clamp(Math.round(value / weight), 0, 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function uploadBackground(file) {
  if (!file || !user) return;
  if (!file.type.startsWith("image/")) return showToast("이미지 파일만 선택할 수 있어요.");
  if (file.size > 5 * 1024 * 1024) return showToast("사진은 5MB 이하로 골라 주세요.");
  const status = $("#homeBackgroundStatus");
  if (status) status.textContent = "사진 저장 중...";
  const autoTheme = !!$("#homeAutoTheme")?.checked;
  const themeColor = autoTheme ? await extractThemeColor(file).catch(() => null) : null;
  const path = `${user.id}/home-background`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (error) throw error;
  await writeAppearance({ backgroundPath: path }, themeColor ? { themeColor } : {});
  if (status) status.textContent = themeColor ? "사진과 테마 색상이 함께 적용되었어요." : "집 배경 사진이 저장되었어요.";
}

async function saveTimelineRange() {
  const start = minuteValue($("#timelineStart")?.value);
  const end = minuteValue($("#timelineEnd")?.value);
  if (start === null || end === null || end - start < 60) {
    showToast("종료 시간은 시작 시간보다 최소 1시간 뒤여야 해요.");
    await applyAppearance();
    return;
  }
  await writeAppearance({}, { timelineRange: { start, end } });
}

function wireUI() {
  if (document.documentElement.dataset.appearanceWired) return;
  document.documentElement.dataset.appearanceWired = "1";
  if (!$("#homeBackgroundMenu")) {
    document.body.insertAdjacentHTML("beforeend", '<div class="uw-context uw-home-background-menu" id="homeBackgroundMenu" role="menu"><button data-home-background-change type="button">배경 바꾸기</button></div>');
  }
  $("#homeBackgroundFile")?.addEventListener("change", async (event) => {
    try { await uploadBackground(event.target.files?.[0]); }
    catch (error) {
      console.error("배경 업로드 실패", error);
      if ($("#homeBackgroundStatus")) $("#homeBackgroundStatus").textContent = "사진을 저장하지 못했어요.";
    }
    event.target.value = "";
  });
  $("#homeBackgroundPosition")?.addEventListener("change", (event) => writeAppearance({ position: event.target.value }).catch(console.error));
  $("#homeBackgroundOverlay")?.addEventListener("change", (event) => writeAppearance({ overlay: Number(event.target.value) }).catch(console.error));
  ["#themeColor", "#homeThemeColor"].forEach(selector => $(selector)?.addEventListener("change", event => writeAppearance({}, { themeColor: validColor(event.target.value) }).catch(console.error)));
  $("#timelineStart")?.addEventListener("change", () => saveTimelineRange().catch(console.error));
  $("#timelineEnd")?.addEventListener("change", () => saveTimelineRange().catch(console.error));
  $("#page-home .page-head")?.addEventListener("contextmenu", event => {
    if (event.target.closest(".uw-item,button,input,select,textarea")) return;
    event.preventDefault();
    const menu = $("#homeBackgroundMenu");
    if (!menu) return;
    menu.style.left = `${Math.min(window.innerWidth - 170, Math.max(8, event.clientX))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 54, Math.max(8, event.clientY))}px`;
    menu.classList.add("open");
  });
  $("#homeBackgroundMenu")?.addEventListener("click", event => {
    if (!event.target.closest("[data-home-background-change]")) return;
    $("#homeBackgroundMenu")?.classList.remove("open");
    $("#homeBackgroundFile")?.click();
  });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#homeBackgroundMenu")) $("#homeBackgroundMenu")?.classList.remove("open");
  });
  $("#removeHomeBackground")?.addEventListener("click", async () => {
    try {
      const path = state?.ui?.homeAppearance?.backgroundPath;
      if (path) {
        const { error } = await supabase.storage.from(BUCKET).remove([path]);
        if (error) throw error;
      }
      await writeAppearance({ backgroundPath: null });
    } catch (error) {
      console.error("배경 제거 실패", error);
      showToast("배경 사진을 제거하지 못했어요.");
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
