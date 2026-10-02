-- Hamid OS: public schema for Supabase project xxvsosusnqnrgdigqfyw
-- Dumped from the Postgres catalog on 2026-10-02 (structure only, no data).
-- public.ds_secrets holds vapid_public, vapid_private and cron_secret. Its rows
-- are deliberately NOT included here; they live only in the database.

-- Extensions in use: plpgsql, pg_stat_statements, uuid-ossp, pgcrypto,
-- supabase_vault, pg_cron, pg_net
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- Tables
-- ============================================================

create table public.ds_secrets (
  key text not null,
  value text not null,
  constraint ds_secrets_pkey PRIMARY KEY (key)
);
alter table public.ds_secrets enable row level security;
-- No policies: only the service role (the Edge Function and pg_cron) can read it.

create table public.tasks (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  horizon text not null,
  period_start date not null,
  title text not null,
  context text,
  done_def text,
  status text default 'open'::text not null,
  parent_id uuid,
  carried_from uuid,
  carry_count integer default 0 not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  remind_at timestamp with time zone,
  reminded_at timestamp with time zone,
  progress smallint,
  pinned boolean default false not null,
  constraint tasks_pkey PRIMARY KEY (id),
  constraint tasks_carried_from_fkey FOREIGN KEY (carried_from) REFERENCES tasks(id) ON DELETE SET NULL,
  constraint tasks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
  constraint tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint tasks_horizon_check CHECK ((horizon = ANY (ARRAY['day'::text, 'week'::text, 'month'::text]))),
  constraint tasks_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
  constraint tasks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dropped'::text, 'carried'::text]))),
  constraint tasks_title_check CHECK (((length(title) >= 1) AND (length(title) <= 500)))
);
CREATE INDEX tasks_parent ON public.tasks USING btree (parent_id);
CREATE INDEX tasks_remind ON public.tasks USING btree (remind_at) WHERE (reminded_at IS NULL);
CREATE INDEX tasks_lookup ON public.tasks USING btree (user_id, horizon, period_start);
CREATE INDEX tasks_carried_from ON public.tasks USING btree (carried_from);
alter table public.tasks enable row level security;

create table public.focus_sessions (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  task_id uuid,
  label text,
  started_at timestamp with time zone not null,
  ended_at timestamp with time zone not null,
  minutes integer not null,
  completed boolean default false not null,
  constraint focus_sessions_pkey PRIMARY KEY (id),
  constraint focus_sessions_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  constraint focus_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint focus_sessions_minutes_check CHECK (((minutes >= 0) AND (minutes <= 600)))
);
CREATE INDEX focus_user_started ON public.focus_sessions USING btree (user_id, started_at);
CREATE INDEX focus_task ON public.focus_sessions USING btree (task_id);
alter table public.focus_sessions enable row level security;

create table public.inbox (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  done_at timestamp with time zone,
  constraint inbox_pkey PRIMARY KEY (id),
  constraint inbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint inbox_body_check CHECK (((length(body) >= 1) AND (length(body) <= 5000)))
);
CREATE INDEX inbox_user ON public.inbox USING btree (user_id, done_at);
alter table public.inbox enable row level security;

create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  constraint push_subscriptions_endpoint_key UNIQUE (endpoint),
  constraint push_subscriptions_pkey PRIMARY KEY (id),
  constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX push_user ON public.push_subscriptions USING btree (user_id);
alter table public.push_subscriptions enable row level security;

create table public.quotes (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  body text not null,
  author text,
  slot text default 'any'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint quotes_pkey PRIMARY KEY (id),
  constraint quotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint quotes_author_check CHECK (((author IS NULL) OR (length(author) <= 120))),
  constraint quotes_body_check CHECK (((length(body) >= 1) AND (length(body) <= 600))),
  constraint quotes_slot_check CHECK ((slot = ANY (ARRAY['morning'::text, 'evening'::text, 'any'::text])))
);
CREATE INDEX quotes_user_idx ON public.quotes USING btree (user_id, created_at);
alter table public.quotes enable row level security;

create table public.reports (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  kind text not null,
  period_start date not null,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  emailed_at timestamp with time zone,
  constraint reports_user_id_kind_period_start_key UNIQUE (user_id, kind, period_start),
  constraint reports_pkey PRIMARY KEY (id),
  constraint reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint reports_kind_check CHECK ((kind = ANY (ARRAY['week'::text, 'month'::text])))
);
alter table public.reports enable row level security;

create table public.reviews (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  horizon text not null,
  period_start date not null,
  energy smallint,
  focus smallint,
  reflection text,
  closed_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  notes text,
  constraint reviews_user_id_horizon_period_start_key UNIQUE (user_id, horizon, period_start),
  constraint reviews_pkey PRIMARY KEY (id),
  constraint reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint reviews_energy_check CHECK (((energy >= 1) AND (energy <= 5))),
  constraint reviews_focus_check CHECK (((focus >= 1) AND (focus <= 5))),
  constraint reviews_horizon_check CHECK ((horizon = ANY (ARRAY['day'::text, 'week'::text, 'month'::text]))),
  constraint reviews_notes_check CHECK ((length(notes) <= 20000))
);
alter table public.reviews enable row level security;

create table public.settings (
  user_id uuid default auth.uid() not null,
  tz text default 'Europe/London'::text not null,
  morning_on boolean default true not null,
  morning_time time without time zone default '08:45:00'::time without time zone not null,
  evening_on boolean default true not null,
  evening_time time without time zone default '17:30:00'::time without time zone not null,
  weekdays_only boolean default true not null,
  backup_nudge boolean default true not null,
  focus_minutes integer default 45 not null,
  last_morning date,
  last_evening date,
  last_backup date,
  updated_at timestamp with time zone default now() not null,
  last_rollover date,
  last_week_report date,
  last_month_report date,
  display_name text,
  quotes_seeded boolean default false not null,
  constraint settings_pkey PRIMARY KEY (user_id),
  constraint settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint settings_display_name_check CHECK (((display_name IS NULL) OR (length(display_name) <= 60))),
  constraint settings_focus_minutes_check CHECK (((focus_minutes >= 5) AND (focus_minutes <= 180)))
);
alter table public.settings enable row level security;

create table public.task_links (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  task_id uuid not null,
  url text not null,
  label text,
  created_at timestamp with time zone default now() not null,
  constraint task_links_pkey PRIMARY KEY (id),
  constraint task_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  constraint task_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint task_links_label_check CHECK ((length(label) <= 200)),
  constraint task_links_url_check CHECK (((url ~* '^https?://'::text) AND (length(url) <= 2000)))
);
CREATE INDEX task_links_user ON public.task_links USING btree (user_id);
CREATE INDEX task_links_task ON public.task_links USING btree (task_id);
alter table public.task_links enable row level security;

create table public.task_notes (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  task_id uuid not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  kind text default 'note'::text not null,
  pct smallint,
  constraint task_notes_pkey PRIMARY KEY (id),
  constraint task_notes_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  constraint task_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint task_notes_body_check CHECK (((length(body) >= 1) AND (length(body) <= 5000))),
  constraint task_notes_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'progress'::text]))),
  constraint task_notes_pct_check CHECK (((pct >= 0) AND (pct <= 100)))
);
CREATE INDEX task_notes_task ON public.task_notes USING btree (task_id);
CREATE INDEX task_notes_user ON public.task_notes USING btree (user_id);
alter table public.task_notes enable row level security;

create table public.wins (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  day date not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  constraint wins_pkey PRIMARY KEY (id),
  constraint wins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint wins_body_check CHECK (((length(body) >= 1) AND (length(body) <= 1000)))
);
CREATE INDEX wins_user_day ON public.wins USING btree (user_id, day);
alter table public.wins enable row level security;

-- ============================================================
-- Row-level security: owner only, and only with a 2FA (aal2) session
-- ============================================================

create policy owner_with_2fa on public.focus_sessions as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.inbox as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.push_subscriptions as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.quotes as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.reports as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.reviews as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.settings as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.task_links as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.task_notes as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.tasks as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create policy owner_with_2fa on public.wins as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.ds_only_one_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select count(*) from auth.users) >= 1 then
    raise exception 'Sign-ups are closed';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.ds_report(p_user uuid, p_kind text, p_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_end date := case when p_kind = 'week' then p_start + 6 else (p_start + interval '1 month' - interval '1 day')::date end;
  v_prev_start date := case when p_kind = 'week' then p_start - 7 else (p_start - interval '1 month')::date end;
  v_tz text := coalesce((select tz from settings where user_id = p_user), 'Europe/London');
  r jsonb;
begin
  with d as (select * from tasks where user_id = p_user and horizon = 'day' and period_start between p_start and v_end),
  pd as (select * from tasks where user_id = p_user and horizon = 'day' and period_start between v_prev_start and p_start - 1 and status <> 'carried'),
  it as (select t.title, t.status, t.context, t.progress, t.position,
           (select count(*) from tasks c where c.parent_id = t.id and c.status <> 'carried') as kids,
           (select count(*) from tasks c where c.parent_id = t.id and c.status = 'done') as kids_done
         from tasks t where t.user_id = p_user and t.horizon = p_kind and t.period_start = p_start and t.status <> 'carried'),
  fs as (select f.minutes, coalesce(t.context, 'No context') as ctx from focus_sessions f left join tasks t on t.id = f.task_id
         where f.user_id = p_user and (f.started_at at time zone v_tz)::date between p_start and v_end),
  rv as (select energy, focus, notes, period_start from reviews where user_id = p_user and horizon = 'day' and period_start between p_start and v_end),
  w as (select day, body, created_at from wins where user_id = p_user and day between p_start and v_end),
  st as (select title, carry_count from tasks where user_id = p_user and horizon = 'day' and status = 'open' and carry_count >= 3)
  select jsonb_build_object(
    'kind', p_kind, 'start', p_start, 'end', v_end,
    'tasks', jsonb_build_object(
      'total', (select count(*) from d where status <> 'carried'),
      'done', (select count(*) from d where status = 'done'),
      'dropped', (select count(*) from d where status = 'dropped'),
      'carried', (select count(*) from d where status = 'carried')),
    'prev', jsonb_build_object('total', (select count(*) from pd), 'done', (select count(*) from pd where status = 'done')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'status', status, 'context', context, 'progress', progress, 'kids', kids, 'kids_done', kids_done) order by position) from it), '[]'::jsonb),
    'focus_total', coalesce((select sum(minutes) from fs), 0),
    'focus_by_context', coalesce((select jsonb_object_agg(ctx, m) from (select ctx, sum(minutes) as m from fs group by ctx) x), '{}'::jsonb),
    'energy', (select round(avg(energy), 1) from rv where energy is not null),
    'focus', (select round(avg(focus), 1) from rv where focus is not null),
    'review', (select jsonb_build_object('energy', energy, 'focus', focus, 'reflection', reflection) from reviews where user_id = p_user and horizon = p_kind and period_start = p_start),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('day', period_start, 'notes', notes) order by period_start) from rv where coalesce(notes, '') <> ''), '[]'::jsonb),
    'wins', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'body', body) order by day, created_at) from w), '[]'::jsonb),
    'stuck', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'carry_count', carry_count) order by carry_count desc) from st), '[]'::jsonb)
  ) into r;
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.ds_rollover(p_user uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date := p_today + case extract(isodow from p_today)::int when 6 then 2 when 7 then 1 else 0 end;
  v_week date := date_trunc('week', p_today)::date;
  v_month date := date_trunc('month', p_today)::date;
  n_month int; n_week int; n_day int;
begin
  with old as (select * from tasks where user_id = p_user and horizon = 'month' and status = 'open' and period_start < v_month),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, done_def, carried_from, carry_count, position, progress)
          select user_id, 'month', v_month, title, context, done_def, id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_month from upd;

  with old as (select * from tasks where user_id = p_user and horizon = 'week' and status = 'open' and period_start < v_week),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, done_def, parent_id, carried_from, carry_count, position, progress)
          select user_id, 'week', v_week, title, context, done_def,
                 case when date_trunc('month', v_week + 3) = date_trunc('month', period_start + 3) then parent_id end,
                 id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_week from upd;

  with old as (select * from tasks where user_id = p_user and horizon = 'day' and status = 'open' and period_start < p_today),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, done_def, parent_id, carried_from, carry_count, position, progress)
          select user_id, 'day', v_day, title, context, done_def,
                 case when date_trunc('week', v_day) = date_trunc('week', period_start) then parent_id end,
                 id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_day from upd;

  return jsonb_build_object('day', n_day, 'week', n_week, 'month', n_month, 'target_day', v_day);
end $function$
;

-- ============================================================
-- Triggers
-- ============================================================

-- Single-user app: block any further sign-ups.
CREATE TRIGGER ds_only_one_user BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION ds_only_one_user();

-- ============================================================
-- Cron jobs (pg_cron)
-- ============================================================

-- Every 5 minutes, call the "reminders" Edge Function. The x-cron-secret
-- header is read from public.ds_secrets at run time, not stored here.
select cron.schedule('ds-reminders', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://xxvsosusnqnrgdigqfyw.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.ds_secrets where key='cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$cron$);
