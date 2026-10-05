-- More of Hamid OS: People (contacts with follow-ups), project milestones, savings goals, Claude's briefs,
-- a private calendar feed for your phone, money/deadline alerts, and an hourly rate for time per project.

create table public.people (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  name text not null,
  company text,
  role text,
  project_id uuid,
  email text,
  phone text,
  notes text,
  last_contact_on date,
  follow_up_on date,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint people_pkey PRIMARY KEY (id),
  constraint people_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint people_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
  constraint people_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120))),
  constraint people_small_check CHECK (((company IS NULL) OR (length(company) <= 120)) AND ((role IS NULL) OR (length(role) <= 120)) AND ((email IS NULL) OR (length(email) <= 200)) AND ((phone IS NULL) OR (length(phone) <= 60))),
  constraint people_notes_check CHECK (((notes IS NULL) OR (length(notes) <= 5000)))
);
CREATE INDEX people_user ON public.people USING btree (user_id);
alter table public.people enable row level security;
create policy owner_with_2fa on public.people as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create table public.people_notes (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  person_id uuid not null,
  on_date date default CURRENT_DATE not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  constraint people_notes_pkey PRIMARY KEY (id),
  constraint people_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint people_notes_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE,
  constraint people_notes_body_check CHECK (((length(body) >= 1) AND (length(body) <= 5000)))
);
CREATE INDEX people_notes_person ON public.people_notes USING btree (person_id, on_date);
alter table public.people_notes enable row level security;
create policy owner_with_2fa on public.people_notes as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create table public.project_milestones (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  project_id uuid not null,
  title text not null,
  due_on date not null,
  done_at timestamp with time zone,
  note text,
  created_at timestamp with time zone default now() not null,
  constraint project_milestones_pkey PRIMARY KEY (id),
  constraint project_milestones_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint project_milestones_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint project_milestones_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200))),
  constraint project_milestones_note_check CHECK (((note IS NULL) OR (length(note) <= 1000)))
);
CREATE INDEX project_milestones_user ON public.project_milestones USING btree (user_id, due_on);
alter table public.project_milestones enable row level security;
create policy owner_with_2fa on public.project_milestones as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

create table public.savings_goals (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  name text not null,
  target_pence bigint not null,
  saved_pence bigint default 0 not null,
  due_on date,
  holding_id uuid,
  note text,
  archived boolean default false not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint savings_goals_pkey PRIMARY KEY (id),
  constraint savings_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint savings_goals_holding_id_fkey FOREIGN KEY (holding_id) REFERENCES public.money_holdings(id) ON DELETE SET NULL,
  constraint savings_goals_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint savings_goals_target_check CHECK (((target_pence > 0) AND (target_pence <= '100000000000'::bigint))),
  constraint savings_goals_saved_check CHECK (((saved_pence >= 0) AND (saved_pence <= '100000000000'::bigint))),
  constraint savings_goals_note_check CHECK (((note IS NULL) OR (length(note) <= 300)))
);
alter table public.savings_goals enable row level security;
create policy owner_with_2fa on public.savings_goals as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- Briefs Claude writes for you (morning brief, weekly review), shown on Home
create table public.briefs (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  kind text default 'other'::text not null,
  title text not null,
  body text not null,
  suggestions jsonb,
  created_at timestamp with time zone default now() not null,
  read_at timestamp with time zone,
  constraint briefs_pkey PRIMARY KEY (id),
  constraint briefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint briefs_kind_check CHECK ((kind = ANY (ARRAY['morning'::text, 'weekly'::text, 'other'::text]))),
  constraint briefs_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200))),
  constraint briefs_body_check CHECK ((length(body) <= 50000))
);
CREATE INDEX briefs_user ON public.briefs USING btree (user_id, created_at DESC);
alter table public.briefs enable row level security;
create policy owner_with_2fa on public.briefs as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- A private link your phone's calendar subscribes to (read by the calendar-feed Edge Function)
create table public.calendar_feeds (
  user_id uuid default auth.uid() not null,
  token text not null,
  created_at timestamp with time zone default now() not null,
  constraint calendar_feeds_pkey PRIMARY KEY (user_id),
  constraint calendar_feeds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint calendar_feeds_token_key UNIQUE (token),
  constraint calendar_feeds_token_check CHECK ((length(token) >= 32))
);
alter table public.calendar_feeds enable row level security;
create policy owner_with_2fa on public.calendar_feeds as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- alerts already sent (so each is sent once); written only by the reminders function
create table public.notify_log (
  user_id uuid not null,
  key text not null,
  sent_at timestamp with time zone default now() not null,
  constraint notify_log_pkey PRIMARY KEY (user_id, key),
  constraint notify_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.notify_log enable row level security;

alter table public.settings add column alerts_on boolean default true not null;
alter table public.projects add column hourly_rate_pence bigint;
alter table public.projects add constraint projects_rate_check CHECK (((hourly_rate_pence IS NULL) OR ((hourly_rate_pence >= 0) AND (hourly_rate_pence <= 100000000))));

-- Time per project: time you log by hand on a project page (focus sessions already count through their task)
alter table public.focus_sessions add column project_id uuid;
alter table public.focus_sessions add constraint focus_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
alter table public.focus_sessions add column note text;
alter table public.focus_sessions add constraint focus_sessions_note_check CHECK (((note IS NULL) OR (length(note) <= 500)));
CREATE INDEX IF NOT EXISTS focus_sessions_project ON public.focus_sessions USING btree (project_id) WHERE (project_id IS NOT NULL);
