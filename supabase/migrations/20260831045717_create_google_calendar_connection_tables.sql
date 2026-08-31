create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text not null default '',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz not null,
  calendars jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_calendars_array
    check (jsonb_typeof(calendars) = 'array')
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_calendar_oauth_states_user_id_idx
  on public.google_calendar_oauth_states(user_id);
create index if not exists google_calendar_oauth_states_expires_at_idx
  on public.google_calendar_oauth_states(expires_at);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

revoke all on table public.google_calendar_connections from anon, authenticated;
revoke all on table public.google_calendar_oauth_states from anon, authenticated;
grant select, insert, update, delete on table public.google_calendar_connections to service_role;
grant select, insert, update, delete on table public.google_calendar_oauth_states to service_role;

comment on table public.google_calendar_connections is
  'Server-only encrypted Google Calendar OAuth credentials and per-calendar visibility.';
comment on table public.google_calendar_oauth_states is
  'Short-lived, single-use OAuth state hashes for Google Calendar connection CSRF protection.';
