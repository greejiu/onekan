const STYLE_ID = "onekanFeedbackStyle";
const TOAST_ROOT_ID = "onekanToastRoot";
const DIALOG_ID = "onekanConfirmDialog";

function installFeedbackUI() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .onekan-toast-root{position:fixed;right:18px;bottom:18px;z-index:1200;display:grid;gap:8px;width:min(360px,calc(100vw - 32px));pointer-events:none}
      .onekan-toast{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--line,#d9dce4) 85%,transparent);border-radius:12px;background:color-mix(in srgb,var(--panel,#fff) 96%,transparent);box-shadow:0 10px 30px rgba(32,38,52,.16);color:var(--text,#262a34);font-size:12px;line-height:1.45;pointer-events:auto;animation:onekan-toast-in .18s ease-out}
      .onekan-toast[data-tone="error"]{border-color:color-mix(in srgb,var(--danger,#c84a4a) 35%,var(--line,#d9dce4))}
      .onekan-toast[data-tone="success"]{border-color:color-mix(in srgb,var(--accent,#8fa9c4) 45%,var(--line,#d9dce4))}
      .onekan-toast-message{flex:1;min-width:0}.onekan-toast-close{flex:none;border:0;background:transparent;color:var(--muted,#777);cursor:pointer;font:inherit;padding:0 2px}
      .onekan-confirm-dialog{width:min(390px,calc(100vw - 32px));padding:0;border:1px solid var(--line,#d9dce4);border-radius:16px;background:var(--panel,#fff);color:var(--text,#262a34);box-shadow:0 24px 70px rgba(24,29,41,.24)}
      .onekan-confirm-dialog::backdrop{background:rgba(23,27,38,.34);backdrop-filter:blur(2px)}
      .onekan-confirm-body{padding:20px}.onekan-confirm-body h3{margin:0 0 8px;font-size:16px}.onekan-confirm-body p{margin:0;color:var(--muted,#707582);font-size:12px;line-height:1.55;white-space:pre-line}
      .onekan-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.onekan-confirm-actions button{min-height:38px;padding:8px 14px;border-radius:10px;font:inherit;cursor:pointer}
      .onekan-confirm-cancel{border:1px solid var(--line,#d9dce4);background:transparent;color:var(--text,#262a34)}.onekan-confirm-submit{border:1px solid var(--danger,#c84a4a);background:var(--danger,#c84a4a);color:#fff}
      @keyframes onekan-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(max-width:700px){.onekan-toast-root{right:16px;bottom:76px}.onekan-confirm-actions button{min-height:44px}}
    `;
    document.head.appendChild(style);
  }
  if (!document.getElementById(TOAST_ROOT_ID)) {
    const root = document.createElement("div");
    root.id = TOAST_ROOT_ID;
    root.className = "onekan-toast-root";
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-atomic", "false");
    document.body.appendChild(root);
  }
  if (!document.getElementById(DIALOG_ID)) {
    const dialog = document.createElement("dialog");
    dialog.id = DIALOG_ID;
    dialog.className = "onekan-confirm-dialog";
    dialog.innerHTML = `<div class="onekan-confirm-body"><h3></h3><p></p><div class="onekan-confirm-actions"><button class="onekan-confirm-cancel" type="button">취소</button><button class="onekan-confirm-submit" type="button">삭제</button></div></div>`;
    document.body.appendChild(dialog);
  }
}

export function showToast(message, { tone = "error", duration = 4200 } = {}) {
  installFeedbackUI();
  const root = document.getElementById(TOAST_ROOT_ID);
  const toast = document.createElement("div");
  toast.className = "onekan-toast";
  toast.dataset.tone = tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.className = "onekan-toast-message";
  text.textContent = String(message || "알림");
  const close = document.createElement("button");
  close.className = "onekan-toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "알림 닫기");
  close.textContent = "×";
  const remove = () => toast.remove();
  close.addEventListener("click", remove);
  toast.append(text, close);
  root.appendChild(toast);
  window.setTimeout(remove, Math.max(1200, duration));
  return toast;
}

export function confirmAction({ title = "삭제할까요?", message = "삭제한 내용은 되돌릴 수 없어요.", confirmLabel = "삭제", cancelLabel = "취소" } = {}) {
  installFeedbackUI();
  const dialog = document.getElementById(DIALOG_ID);
  if (dialog.open) dialog.close("cancel");
  dialog.querySelector("h3").textContent = title;
  dialog.querySelector("p").textContent = message;
  const cancel = dialog.querySelector(".onekan-confirm-cancel");
  const submit = dialog.querySelector(".onekan-confirm-submit");
  cancel.textContent = cancelLabel;
  submit.textContent = confirmLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cancel.removeEventListener("click", onCancel);
      submit.removeEventListener("click", onSubmit);
      dialog.removeEventListener("cancel", onNativeCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close(value ? "confirm" : "cancel");
      resolve(value);
    };
    const onCancel = () => finish(false);
    const onSubmit = () => finish(true);
    const onNativeCancel = (event) => { event.preventDefault(); finish(false); };
    const onClose = () => finish(dialog.returnValue === "confirm");
    cancel.addEventListener("click", onCancel);
    submit.addEventListener("click", onSubmit);
    dialog.addEventListener("cancel", onNativeCancel);
    dialog.addEventListener("close", onClose);
    window.setTimeout(() => cancel.focus(), 0);
  });
}

const SOUND_MUTE_KEY = "onekan:sound-muted";
let audioContext = null;

export function isSoundMuted() {
  try {
    return localStorage.getItem(SOUND_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    if (muted) localStorage.setItem(SOUND_MUTE_KEY, "1");
    else localStorage.removeItem(SOUND_MUTE_KEY);
  } catch {}
}

function ensureAudioContext() {
  if (audioContext && audioContext.state !== "closed") return audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

// 짧은 상승음과 잔향을 겹쳐, 볼륨을 키우지 않아도 손맛이 느껴지도록 구성한다.
// kind: "check" (하위/상위 할일·타임블록 체크) 또는 "complete"(하위 할일을 모두 체크해 상위 할일이 자동완료될 때).
const SOUND_TONES = {
  check: [
    { type: "triangle", freq: 520, endFreq: 760, start: 0, duration: 0.055, gain: 0.11 },
    { type: "sine", freq: 1175, start: 0.025, duration: 0.12, gain: 0.085 },
  ],
  complete: [
    { type: "triangle", freq: 523, endFreq: 587, start: 0, duration: 0.1, gain: 0.1 },
    { type: "triangle", freq: 659, endFreq: 698, start: 0.065, duration: 0.13, gain: 0.095 },
    { type: "sine", freq: 784, start: 0.13, duration: 0.19, gain: 0.11 },
    { type: "sine", freq: 1047, start: 0.2, duration: 0.24, gain: 0.075 },
  ],
};

export function playCheckSound(kind = "check") {
  if (isSoundMuted()) return;
  const tones = SOUND_TONES[kind] || SOUND_TONES.check;
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    for (const tone of tones) {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const startsAt = now + tone.start;
      oscillator.type = tone.type || "sine";
      oscillator.frequency.setValueAtTime(tone.freq, startsAt);
      if (tone.endFreq) oscillator.frequency.exponentialRampToValueAtTime(tone.endFreq, startsAt + tone.duration);
      gainNode.gain.setValueAtTime(0.0001, startsAt);
      gainNode.gain.exponentialRampToValueAtTime(tone.gain, startsAt + 0.008);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startsAt + tone.duration);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + tone.duration + 0.02);
    }
  } catch (error) {
    console.warn("check sound failed", error);
  }
}

function bindSoundToggle() {
  const toggle = document.getElementById("soundEffectsToggle");
  if (!toggle || toggle.dataset.onekanSoundBound) return;
  toggle.dataset.onekanSoundBound = "1";
  toggle.checked = !isSoundMuted();
  toggle.addEventListener("change", () => setSoundMuted(!toggle.checked));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindSoundToggle, { once: true });
} else {
  bindSoundToggle();
}
