import "./interaction-fixes.js";
import { supabase } from "./supabase.js";

const authSection = document.querySelector("#auth-section");
const appSection = document.querySelector("#app-section");
const authForm = document.querySelector("#auth-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const signupButton = document.querySelector("#signup-button");
const logoutButton = document.querySelector("#logout-button");
const message = document.querySelector("#auth-message");
const accountEmail = document.querySelector("#account-email");

function setLoading(value) {
  loginButton.disabled = value;
  signupButton.disabled = value;
  logoutButton.disabled = value;
}

function showMessage(text) {
  message.textContent = text;
}

function setAppStatus(text, isError = false) {
  for (const selector of ["#syncStatus", "#mobileSyncStatus"]) {
    const element = document.querySelector(selector);
    if (!element) continue;
    element.textContent = text;
    element.style.color = isError ? "var(--danger)" : "";
  }
}

async function recoverLoadedState(user) {
  try {
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (data?.data && typeof data.data === "object") {
      const sharedState = JSON.parse(JSON.stringify(data.data));
      window.__ONEKAN_APP_STATE__ = sharedState;
      document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "auth-recovery", state: sharedState } }));
    }
    setAppStatus("저장됨");
    return true;
  } catch (error) {
    console.error("클라우드 상태 복구 확인 실패", error);
    setAppStatus("데이터 불러오기 실패", true);
    return false;
  }
}

function friendlyAuthError(error, action) {
  const code = error?.code ?? "";
  const text = String(error?.message ?? "").toLowerCase();
  if (code === "email_not_confirmed" || text.includes("email not confirmed")) return "이메일 인증이 아직 안 됐어요. 받은 인증 메일의 링크를 먼저 눌러 주세요.";
  if (code === "over_email_send_rate_limit" || text.includes("rate limit")) return "인증 메일 발송 횟수를 초과했어요. 이미 받은 메일을 확인하거나 잠시 후 다시 시도해 주세요.";
  if (code === "invalid_credentials" || text.includes("invalid login credentials")) return "이메일 또는 비밀번호를 확인해 주세요.";
  return `${action}에 실패했어요. 잠시 후 다시 시도해 주세요.`;
}

function showLoggedOut() {
  authSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  accountEmail.textContent = "";
}

function showLoggedIn(user) {
  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  accountEmail.textContent = user?.email ?? "로그인됨";
  showMessage("");
}

export function setupAuth({ onLogin, onLogout }) {
  let activationPromise = null;
  let activatingUserId = null;
  let visibleUserId = null;

  async function activate(user) {
    if (!user) return false;

    visibleUserId = user.id;
    showLoggedIn(user);

    if (activationPromise && activatingUserId === user.id) return activationPromise;

    activatingUserId = user.id;
    activationPromise = (async () => {
      try {
        setAppStatus("불러오는 중...");
        await onLogin(user);
        setAppStatus("저장됨");
        return true;
      } catch (error) {
        console.error("로그인 후 화면 초기화 실패", error);
        return recoverLoadedState(user);
      } finally {
        activationPromise = null;
        activatingUserId = null;
      }
    })();

    return activationPromise;
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return showMessage("이메일과 비밀번호를 모두 입력해 주세요.");

    setLoading(true);
    showMessage("로그인 중...");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return showMessage(friendlyAuthError(error, "로그인"));
      await activate(data.user);
    } catch (error) {
      console.error("로그인 요청 실패", error);
      showMessage("로그인 요청 중 문제가 생겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  });

  signupButton.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return showMessage("이메일과 비밀번호를 모두 입력해 주세요.");
    if (password.length < 6) return showMessage("비밀번호는 6자 이상으로 입력해 주세요.");

    setLoading(true);
    showMessage("계정을 만드는 중...");
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: "https://greejiu.github.io/onekan/" },
      });
      if (error) return showMessage(friendlyAuthError(error, "회원가입"));
      if (data.session?.user) {
        await activate(data.user);
        return;
      }
      showMessage("회원가입 요청 완료! 받은 이메일의 인증 링크를 한 번만 눌러 주세요.");
    } catch (error) {
      console.error("회원가입 요청 실패", error);
      showMessage("회원가입 요청 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  });

  logoutButton.addEventListener("click", async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      visibleUserId = null;
      showLoggedOut();
      await onLogout();
    } finally {
      setLoading(false);
    }
  });

  supabase.auth.onAuthStateChange((authEvent, session) => {
    setTimeout(async () => {
      if (authEvent === "TOKEN_REFRESHED") return;
      if (session?.user) {
        await activate(session.user);
        return;
      }
      if (authEvent === "SIGNED_OUT" || !session) {
        visibleUserId = null;
        showLoggedOut();
        await onLogout();
      }
    }, 0);
  });

  (async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (session?.user) await activate(session.user);
      else showLoggedOut();
    } catch (error) {
      console.error("저장된 로그인 확인 실패", error);
      visibleUserId = null;
      showLoggedOut();
      showMessage("로그인 상태를 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.");
    }
  })();
}
