import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  APP_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  authenticatedUser,
  corsHeaders,
  encryptToken,
  fetchGoogleJson,
  googleRedirectUri,
  json,
  publicCalendars,
  randomState,
  serviceClient,
  sha256,
} from "../_shared/google-calendar.ts";

function redirectResult(result: "connected" | "error", detail = "") {
  const target = new URL(APP_URL);
  target.searchParams.set("google_calendar", result);
  if (detail) target.searchParams.set("google_calendar_message", detail.slice(0, 160));
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (req.method === "GET" && (code || state)) {
      if (!code || !state) return redirectResult("error", "Google 인증 응답이 완전하지 않아요.");
      const stateHash = await sha256(state);
      const db = serviceClient();
      const { data: oauthState, error: stateError } = await db
        .from("google_calendar_oauth_states")
        .delete()
        .eq("state_hash", stateHash)
        .gt("expires_at", new Date().toISOString())
        .select("user_id")
        .maybeSingle();
      if (stateError || !oauthState?.user_id) return redirectResult("error", "연결 요청이 만료됐어요. 다시 시도해 주세요.");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: googleRedirectUri(),
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) return redirectResult("error", "Google 권한을 받아오지 못했어요.");

      const accessToken = String(tokens.access_token);
      const [profile, calendarPayload, existingResult] = await Promise.all([
        fetchGoogleJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken),
        fetchGoogleJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", accessToken),
        db.from("google_calendar_connections").select("refresh_token_ciphertext").eq("user_id", oauthState.user_id).maybeSingle(),
      ]);
      const calendars = publicCalendars((calendarPayload.items ?? []).map((calendar: Record<string, unknown>) => ({
        ...calendar,
        visible: Boolean(calendar.primary),
      })));
      const refreshCiphertext = tokens.refresh_token
        ? await encryptToken(String(tokens.refresh_token))
        : existingResult.data?.refresh_token_ciphertext ?? null;
      if (!refreshCiphertext) return redirectResult("error", "지속 연결 권한을 받지 못했어요. 다시 연결해 주세요.");

      const { error: saveError } = await db.from("google_calendar_connections").upsert({
        user_id: oauthState.user_id,
        google_email: String(profile.email ?? ""),
        access_token_ciphertext: await encryptToken(accessToken),
        refresh_token_ciphertext: refreshCiphertext,
        access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
        calendars,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (saveError) throw saveError;
      return redirectResult("connected");
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const user = await authenticatedUser(req);
    if (!user) return json(req, { error: "로그인이 필요해요." }, 401);
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return json(req, { error: "Google 캘린더 연결 설정이 아직 완료되지 않았어요." }, 503);

    const rawState = randomState();
    const db = serviceClient();
    await db.from("google_calendar_oauth_states").delete().lt("expires_at", new Date().toISOString());
    const { error } = await db.from("google_calendar_oauth_states").insert({
      state_hash: await sha256(rawState),
      user_id: user.id,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw error;

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: rawState,
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ].join(" "),
    }).toString();
    return json(req, { authUrl: authorize.toString() });
  } catch (error) {
    console.error("google-calendar-auth", error);
    if (req.method === "GET") return redirectResult("error", "연결 처리 중 오류가 났어요.");
    return json(req, { error: "Google 캘린더 연결 중 오류가 났어요." }, 500);
  }
});
