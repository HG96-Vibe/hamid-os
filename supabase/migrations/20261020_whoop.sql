-- WHOOP: your recovery, sleep, strain and workouts, synced from WHOOP's API (read-only).
-- whoop_link is what the app sees about the connection; the tokens and sign-in states are kept where only the
-- whoop Edge Function (service role) can read them.

create table public.whoop_link (
  user_id uuid default auth.uid() not null,
  whoop_user_id bigint,
  first_name text,
  connected_at timestamp with time zone default now() not null,
  last_sync_at timestamp with time zone,
  last_error text,
  constraint whoop_link_pkey PRIMARY KEY (user_id),
  constraint whoop_link_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create unique index whoop_link_whoop_user on public.whoop_link (whoop_user_id);

create table public.whoop_tokens (
  user_id uuid not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamp with time zone not null,
  scope text,
  updated_at timestamp with time zone default now() not null,
  constraint whoop_tokens_pkey PRIMARY KEY (user_id),
  constraint whoop_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create table public.whoop_states (
  state text not null,
  user_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint whoop_states_pkey PRIMARY KEY (state),
  constraint whoop_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.whoop_tokens enable row level security;  -- no policy: service role only
alter table public.whoop_states enable row level security;  -- no policy: service role only

-- one row per WHOOP cycle (a "day": from falling asleep to falling asleep), with that day's recovery
create table public.whoop_days (
  user_id uuid not null,
  cycle_id bigint not null,
  day date not null,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone,
  strain numeric,
  kilojoule numeric,
  avg_hr integer,
  max_hr integer,
  recovery integer,
  hrv numeric,
  rhr integer,
  spo2 numeric,
  skin_temp numeric,
  sleep_id text,
  steps integer,
  updated_at timestamp with time zone default now() not null,
  constraint whoop_days_pkey PRIMARY KEY (user_id, cycle_id),
  constraint whoop_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create index whoop_days_day on public.whoop_days (user_id, day desc);

create table public.whoop_sleeps (
  user_id uuid not null,
  id text not null,
  day date not null,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone not null,
  nap boolean default false not null,
  performance integer,
  efficiency numeric,
  consistency integer,
  in_bed_min integer,
  asleep_min integer,
  light_min integer,
  deep_min integer,
  rem_min integer,
  awake_min integer,
  need_min integer,
  disturbances integer,
  respiratory_rate numeric,
  updated_at timestamp with time zone default now() not null,
  constraint whoop_sleeps_pkey PRIMARY KEY (user_id, id),
  constraint whoop_sleeps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create index whoop_sleeps_day on public.whoop_sleeps (user_id, day desc);

create table public.whoop_workouts (
  user_id uuid not null,
  id text not null,
  day date not null,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone not null,
  sport text,
  strain numeric,
  avg_hr integer,
  max_hr integer,
  kilojoule numeric,
  distance_m numeric,
  zones jsonb,
  updated_at timestamp with time zone default now() not null,
  constraint whoop_workouts_pkey PRIMARY KEY (user_id, id),
  constraint whoop_workouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create index whoop_workouts_day on public.whoop_workouts (user_id, day desc);

do $$ declare t text; begin
  foreach t in array array['whoop_link','whoop_days','whoop_sleeps','whoop_workouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy owner_with_2fa on public.%I as PERMISSIVE for ALL to authenticated
      using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
      with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))$p$, t);
  end loop;
end $$;

alter table public.whoop_days add column if not exists steps integer;

-- sync everyone connected twice an hour (the whoop function checks the cron secret)
select cron.schedule('whoop-sync', '17,47 * * * *', $c$
  select net.http_post(
    url := 'https://xxvsosusnqnrgdigqfyw.supabase.co/functions/v1/whoop',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.ds_secrets where key='cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$c$);
