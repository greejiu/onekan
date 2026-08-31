import { createClient } from "npm:@supabase/supabase-js@2.95.0";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
export const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://greejiu.github.io/onekan/").replace(/\/+$/, "/");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type StoredCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string;
  foregroundColor: string;
  visible: boolean;
};

export function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const token = authorization.slice("Bearer ".length);
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user;
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = origin === new URL(APP_URL).origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : new URL(APP_URL).origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey() {
  const encoded = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";
  let raw: Uint8Array;
  if (encoded) {
    raw = fromBase64Url(encoded);
    if (raw.byteLength !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  } else {
    // Supabase keeps the service-role key server-only. Deriving a purpose-bound
    // AES key gives existing projects encrypted token storage without exposing
    // another secret to the browser. A dedicated key can still override it.
    raw = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(`${SUPABASE_SERVICE_ROLE_KEY}:onekan:google-calendar-token`),
    ));
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), textEncoder.encode(value)));
  const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
  packed.set(iv);
  packed.set(encrypted, iv.byteLength);
  return base64Url(packed);
}

export async function decryptToken(value: string) {
  const packed = fromBase64Url(value);
  const iv = packed.slice(0, 12);
  const encrypted = packed.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted);
  return textDecoder.decode(decrypted);
}

export async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function googleRedirectUri() {
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  return `https://${projectRef}.supabase.co/functions/v1/google-calendar-auth`;
}

export async function fetchGoogleJson(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google API ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.json();
}

export async function usableAccessToken(connection: Record<string, unknown>) {
  const expiresAt = new Date(String(connection.access_token_expires_at ?? 0)).getTime();
  if (expiresAt > Date.now() + 60_000) return decryptToken(String(connection.access_token_ciphertext));
  if (!connection.refresh_token_ciphertext) throw new Error("Google refresh token is missing");

  const refreshToken = await decryptToken(String(connection.refresh_token_ciphertext));
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Google token refresh failed: ${JSON.stringify(payload).slice(0, 500)}`);

  const accessToken = String(payload.access_token);
  const { error } = await serviceClient().from("google_calendar_connections").update({
    access_token_ciphertext: await encryptToken(accessToken),
    access_token_expires_at: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", connection.user_id);
  if (error) throw error;
  return accessToken;
}

export function publicCalendars(value: unknown): StoredCalendar[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: String(item?.id ?? ""),
    summary: String(item?.summary ?? "이름 없는 캘린더"),
    primary: Boolean(item?.primary),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(String(item?.backgroundColor ?? "")) ? String(item.backgroundColor) : "#7986cb",
    foregroundColor: /^#[0-9a-f]{6}$/i.test(String(item?.foregroundColor ?? "")) ? String(item.foregroundColor) : "#ffffff",
    visible: Boolean(item?.visible),
  })).filter((item) => item.id);
}
