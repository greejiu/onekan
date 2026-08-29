import { supabase } from "./supabase.js";

const STATUS_SELECTORS = ["#syncStatus", "#mobileSyncStatus"];
let checking = false;

function setStatus(text, isError = false) {
  STATUS_SELECTORS.forEach((selector) => {
    const element = document.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? "var(--danger)" : "";
  });
}

async function recoverIfNeeded() {
  const status = document.querySelector("#syncStatus");
  const text = status?.textContent?.trim() || "";
  if (checking || !["데이터 불러오기 실패", "불러오기 실패"].includes(text)) return;
  checking = true;
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) return;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) return;
    if (data?.data && typeof data.data === "object") {
      const sharedState = JSON.parse(JSON.stringify(data.data));
      window.__ONEKAN_APP_STATE__ = sharedState;
      document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "load-recovery", state: sharedState } }));
    }
    setStatus("저장됨");
  } catch (error) {
    console.error("데이터 상태 복구 확인 실패", error);
  } finally {
    checking = false;
  }
}

function init() {
  const status = document.querySelector("#syncStatus");
  if (!status) return;
  const observer = new MutationObserver(recoverIfNeeded);
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  recoverIfNeeded();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
