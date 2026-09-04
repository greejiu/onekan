import { supabase } from "./supabase.js?v=1";

if (!window.__onekanAuthGuardInstalled) {
  window.__onekanAuthGuardInstalled = true;

  const authSection = document.querySelector("#auth-section");
  const appSection = document.querySelector("#app-section");
  const form = document.querySelector("#auth-form");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const loginButton = document.querySelector("#login-button");
  const message = document.querySelector("#auth-message");
  const accountEmail = document.querySelector("#account-email");

  const showApp = (user) => {
    if (!user) return;
    authSection?.classList.add("hidden");
    appSection?.classList.remove("hidden");
    if (accountEmail) accountEmail.textContent = user.email || "로그인됨";
    if (message) message.textContent = "";
  };

  const showLogin = () => {
    authSection?.classList.remove("hidden");
    appSection?.classList.add("hidden");
  };

  const friendlyError = (error) => {
    const code = error?.code || "";
    const text = String(error?.message || "").toLowerCase();
    if (code === "invalid_credentials" || text.includes("invalid login credentials")) return "이메일 또는 비밀번호를 확인해 주세요.";
    if (code === "email_not_confirmed" || text.includes("email not confirmed")) return "이메일 인증이 아직 안 됐어요.";
    return "로그인에 실패했어요. 다시 시도해 주세요.";
  };

  // Own the login submit at capture phase so unrelated app initialization
  // cannot prevent authentication from working.
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";
    if (!email || !password) {
      if (message) message.textContent = "이메일과 비밀번호를 모두 입력해 주세요.";
      return;
    }

    if (loginButton) loginButton.disabled = true;
    if (message) message.textContent = "로그인 중...";
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (message) message.textContent = friendlyError(error);
        return;
      }
      showApp(data.user);
      document.dispatchEvent(new CustomEvent("onekan:auth-guard-login", { detail: { userId: data.user?.id || null } }));
    } catch (error) {
      console.error("독립 로그인 처리 실패", error);
      if (message) message.textContent = "로그인 요청 중 문제가 생겼어요. 다시 시도해 주세요.";
    } finally {
      if (loginButton) loginButton.disabled = false;
    }
  }, true);

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) showApp(session.user);
    else if (event === "SIGNED_OUT") showLogin();
  });

  supabase.auth.getSession().then(({ data, error }) => {
    if (!error && data.session?.user) showApp(data.session.user);
  }).catch((error) => console.error("독립 로그인 상태 확인 실패", error));
}
