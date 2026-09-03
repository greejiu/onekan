import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html", "utf8");
const integration = fs.readFileSync("js/google-calendar.js", "utf8");
const workspace = fs.readFileSync("js/unified-workspace.js", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260831045717_create_google_calendar_connection_tables.sql", "utf8");
const authFunction = fs.readFileSync("supabase/functions/google-calendar-auth/index.ts", "utf8");
const apiFunction = fs.readFileSync("supabase/functions/google-calendar/index.ts", "utf8");

assert.match(index, /id="connectGoogleCalendar"/);
assert.match(index, /id="googleCalendarList"/);
assert.match(index, /google-calendar\.css\?v=\d+/, "google calendar css must keep a numeric cache-busting version");
assert.match(index, /unified-workspace\.js\?v=\d+/, "unified workspace must keep a numeric cache-busting version");

assert.match(integration, /data-google-calendar-visible/);
assert.match(integration, /visible: !calendar\.visible/);
assert.match(integration, /calendar\.primary/);
assert.match(integration, /externalColor/);
assert.match(integration, /event\.allDay/);
assert.match(integration, /window\.open\(href/);

assert.match(workspace, /googleCalendarEventsForDate/);
assert.match(workspace, /ensureGoogleCalendarRange/);
assert.match(workspace, /isGoogleCalendarEvent/);
assert.match(workspace, /uw-google-event/);
assert.match(workspace, /onekan:google-calendar-changed/);

assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.google_calendar_connections from anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on table public\.google_calendar_connections to service_role/);

assert.match(authFunction, /calendar\.calendarlist\.readonly/);
assert.match(authFunction, /calendar\.events\.readonly/);
assert.match(authFunction, /prompt: "consent"/);
assert.match(apiFunction, /singleEvents/);
assert.match(apiFunction, /event\.colorId/);
assert.match(apiFunction, /action === "set-calendar-visibility"/);

const publicFiles = [index, integration, workspace].join("\n");
assert.doesNotMatch(publicFiles, /GOOGLE_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|refresh_token_ciphertext/);

console.log("google calendar regression: ok");
