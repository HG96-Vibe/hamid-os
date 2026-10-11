-- Goals: your own overall goals (not tied to projects, money or tasks), each with a timeline of steps you set yourself.
create table public.life_goals (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  title text not null,
  why text,
  achieved_at timestamp with time zone,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint life_goals_pkey PRIMARY KEY (id),
  constraint life_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint life_goals_title_check CHECK (((length(title) >= 1) AND (length(title) <= 200))),
  constraint life_goals_why_check CHECK (((why IS NULL) OR (length(why) <= 2000)))
);
create index life_goals_user on public.life_goals (user_id, position);

create table public.life_goal_steps (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  goal_id uuid not null,
  title text not null,
  due_on date,
  done_at timestamp with time zone,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint life_goal_steps_pkey PRIMARY KEY (id),
  constraint life_goal_steps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint life_goal_steps_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.life_goals(id) ON DELETE CASCADE,
  constraint life_goal_steps_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300)))
);
create index life_goal_steps_goal on public.life_goal_steps (goal_id);

do $$ declare t text; begin
  foreach t in array array['life_goals','life_goal_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy owner_with_2fa on public.%I as PERMISSIVE for ALL to authenticated
      using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
      with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))$p$, t);
  end loop;
end $$;
