import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticatedUser,
  corsHeaders,
  fetchGoogleJson,
  json,
  publicCalendars,
  serviceClient,
  usableAccessToken,
} from "../_shared/google-calendar.ts";

const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

function validIso(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function calendarEvents(accessToken: string, calendar: ReturnType<typeof publicCalendars>[number], timeMin: string, timeMax: string, eventColors: Record<string, { background?: string }>) {
  const rows: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await fetchGoogleJson(url.toString(), accessToken);
    for (const event of payload.items ?? []) {
      if (event.status === "cancelled" || (!event.start?.date && !event.start?.dateTime)) continue;
      const color = event.colorId && eventColors[event.colorId]?.background
        ? eventColors[event.colorId].background
        : calendar.backgroundColor;
      rows.push({
        id: `gcal:${calendar.id}:${event.id}`,
        source: "google",
        external: true,
        title: event.summary || "제목 없는 일정",
        description: event.description || "",
        location: event.location || "",
        allDay: Boolean(event.start?.date),
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date || event.start?.dateTime || event.start?.date,
        color,
        htmlLink: event.htmlLink || "",
        calendarId: calendar.id,
        calendarName: calendar.summary,
      });
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const user = await authenticatedUser(req);
    if (!user) return json(req, { error: "로그인이 필요해요." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");
    const db = serviceClient();
    const { data: connection, error } = await db.from("google_calendar_connections").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw error;

    if (action === "status") {
      return json(req, connection ? {
        connected: true,
        email: connection.google_email,
        calendars: publicCalendars(connection.calendars),
      } : { connected: false, email: "", calendars: [] });
    }
    if (!connection) return json(req, { error: "Google 캘린더가 연결되지 않았어요." }, 409);

    if (action === "disconnect") {
      const accessToken = await usableAccessToken(connection).catch(() => "");
      if (accessToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" }).catch(() => null);
      const { error: deleteError } = await db.from("google_calendar_connections").delete().eq("user_id", user.id);
      if (deleteError) throw deleteError;
      return json(req, { connected: false });
    }

    if (action === "set-calendar-visibility") {
      const calendarId = String(body.calendarId ?? "");
      const calendars = publicCalendars(connection.calendars);
      const target = calendars.find((calendar) => calendar.id === calendarId);
      if (!target) return json(req, { error: "캘린더를 찾지 못했어요." }, 404);
      target.visible = Boolean(body.visible);
      const { error: updateError } = await db.from("google_calendar_connections").update({ calendars, updated_at: new Date().toISOString() }).eq("user_id", user.id);
      if (updateError) throw updateError;
      return json(req, { calendars });
    }

    if (action === "events") {
      const minDate = validIso(body.timeMin);
      const maxDate = validIso(body.timeMax);
      if (!minDate || !maxDate || maxDate <= minDate || maxDate.getTime() - minDate.getTime() > MAX_RANGE_MS) {
        return json(req, { error: "조회 기간이 올바르지 않아요." }, 400);
      }
      const accessToken = await usableAccessToken(connection);
      const calendars = publicCalendars(connection.calendars).filter((calendar) => calendar.visible);
      if (!calendars.length) return json(req, { events: [] });
      const colors = await fetchGoogleJson("https://www.googleapis.com/calendar/v3/colors", accessToken).catch(() => ({ event: {} }));
      const groups = await Promise.all(calendars.map((calendar) => calendarEvents(accessToken, calendar, minDate.toISOString(), maxDate.toISOString(), colors.event ?? {})));
      return json(req, { events: groups.flat() });
    }

    return json(req, { error: "지원하지 않는 작업이에요." }, 400);
  } catch (error) {
    console.error("google-calendar", error);
    return json(req, { error: "Google 캘린더를 불러오는 중 오류가 났어요." }, 500);
  }
});
