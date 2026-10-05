-- Repeating tasks: a task you set once (every day, weekdays, or chosen days) that appears on Today by itself.
-- ds_make_repeats(user, day) adds the day's copies; it runs in the 4am rollover and when the app opens, and each
-- repeat is made at most once per day (last_made), so a copy you delete or move doesn't come back that day.
-- An unfinished copy isn't carried to the next day (it repeats anyway).

create table public.task_repeats (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  title text not null,
  project_id uuid,
  days smallint[] default '{1,2,3,4,5,6,7}'::smallint[] not null,   -- ISO weekdays: 1 = Monday … 7 = Sunday
  starts_on date default current_date not null,
  paused boolean default false not null,
  last_made date,                                                     -- the last day a copy was added
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint task_repeats_pkey PRIMARY KEY (id),
  constraint task_repeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint task_repeats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
  constraint task_repeats_title_check CHECK (((length(title) >= 1) AND (length(title) <= 500))),
  constraint task_repeats_days_check CHECK (((cardinality(days) >= 1) AND (cardinality(days) <= 7) AND (days <@ '{1,2,3,4,5,6,7}'::smallint[])))
);
CREATE INDEX task_repeats_user ON public.task_repeats USING btree (user_id);
alter table public.task_repeats enable row level security;
create policy owner_with_2fa on public.task_repeats as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

alter table public.tasks add column repeat_id uuid;
alter table public.tasks add constraint tasks_repeat_id_fkey FOREIGN KEY (repeat_id) REFERENCES public.task_repeats(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tasks_repeat_day ON public.tasks USING btree (repeat_id, period_start) WHERE (repeat_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.ds_make_repeats(p_user uuid, p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  -- the server (rollover) can make anyone's; a signed-in person (2FA) only their own
  if coalesce(auth.role(), '') <> 'service_role'
     and (p_user is distinct from auth.uid() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2') then
    raise exception 'not allowed';
  end if;
  with due as (
    update task_repeats r set last_made = p_day
    where r.user_id = p_user and not r.paused and r.starts_on <= p_day
      and (r.last_made is null or r.last_made < p_day)
      and extract(isodow from p_day)::smallint = any (r.days)
    returning r.*),
  ins as (
    insert into tasks (user_id, horizon, period_start, title, project_id, repeat_id, position)
    select user_id, 'day', p_day, title, project_id, id, position from due
    on conflict (repeat_id, period_start) where repeat_id is not null do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $function$;
revoke all on function public.ds_make_repeats(uuid, date) from public, anon;
grant execute on function public.ds_make_repeats(uuid, date) to authenticated, service_role;

-- The 4am rollover: repeating copies aren't carried, and today's repeats are added.
CREATE OR REPLACE FUNCTION public.ds_rollover(p_user uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_day date := p_today; -- every day counts, weekends included: leftovers move to the very next day
  v_week date := date_trunc('week', p_today)::date;
  v_month date := date_trunc('month', p_today)::date;
  n_month int; n_week int; n_day int; n_rep int;
begin
  with old as (select * from tasks where user_id = p_user and horizon = 'month' and status = 'open' and period_start < v_month),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, project_id, done_def, carried_from, carry_count, position, progress)
          select user_id, 'month', v_month, title, context, project_id, done_def, id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_month from upd;

  with old as (select * from tasks where user_id = p_user and horizon = 'week' and status = 'open' and period_start < v_week),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, project_id, done_def, parent_id, carried_from, carry_count, position, progress)
          select user_id, 'week', v_week, title, context, project_id, done_def,
                 case when date_trunc('month', v_week + 3) = date_trunc('month', period_start + 3) then parent_id end,
                 id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_week from upd;

  with old as (select * from tasks where user_id = p_user and horizon = 'day' and status = 'open' and period_start < p_today and repeat_id is null),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, project_id, done_def, parent_id, carried_from, carry_count, position, progress)
          select user_id, 'day', v_day, title, context, project_id, done_def,
                 case when date_trunc('week', v_day) = date_trunc('week', period_start) then parent_id end,
                 id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_day from upd;

  -- today's repeating tasks (a missed one from yesterday isn't carried: it simply comes back)
  n_rep := ds_make_repeats(p_user, p_today);

  return jsonb_build_object('day', n_day, 'week', n_week, 'month', n_month, 'repeats', n_rep, 'target_day', v_day);
end $function$;
