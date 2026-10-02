-- Projects: companies (and a Personal group) at the top level, projects inside them.
-- Tasks get an optional project_id. The old free-text "context" column stays and is kept in step:
-- it always holds the top-level name (company or Personal), so anything still reading context keeps working.

-- ============================================================
-- Table
-- ============================================================
create table public.projects (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  parent_id uuid,
  kind text not null,
  name text not null,
  color text,
  status text default 'active'::text not null,
  goal text,
  legacy_context text,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint projects_pkey PRIMARY KEY (id),
  constraint projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint projects_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE RESTRICT,
  constraint projects_kind_check CHECK ((kind = ANY (ARRAY['company'::text, 'personal'::text, 'project'::text]))),
  constraint projects_level_check CHECK (((kind = 'project'::text) = (parent_id IS NOT NULL))),
  constraint projects_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint projects_color_check CHECK (((color IS NULL) OR (color ~ '^#[0-9a-fA-F]{6}$'::text))),
  constraint projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'done'::text]))),
  constraint projects_goal_check CHECK (((goal IS NULL) OR (length(goal) <= 300)))
);
CREATE INDEX projects_user ON public.projects USING btree (user_id, position);
CREATE INDEX projects_parent ON public.projects USING btree (parent_id);
alter table public.projects enable row level security;

create policy owner_with_2fa on public.projects as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- Only two levels, and a project's parent must belong to the same user.
CREATE OR REPLACE FUNCTION public.ds_projects_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare p projects;
begin
  if new.parent_id is not null then
    select * into p from projects where id = new.parent_id;
    if p.id is null or p.user_id <> new.user_id then raise exception 'Parent not found'; end if;
    if p.parent_id is not null then raise exception 'Projects can only sit inside a company or Personal'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from projects where parent_id = new.id) then raise exception 'A company with projects cannot move inside another'; end if;
  end if;
  return new;
end $function$;
CREATE TRIGGER ds_projects_check BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION ds_projects_check();

-- ============================================================
-- Tasks link
-- ============================================================
alter table public.tasks add column project_id uuid;
alter table public.tasks add constraint tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX tasks_project ON public.tasks USING btree (project_id);

-- Find the project an old-style context text points at (top level wins over a project with the same name).
CREATE OR REPLACE FUNCTION public.ds_project_for_context(p_user uuid, p_context text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select id from projects
  where user_id = p_user and (lower(name) = lower(trim(p_context)) or lower(legacy_context) = lower(trim(p_context)))
  order by (parent_id is null) desc, position
  limit 1
$function$;

-- The top-level name (company or Personal) for a project.
CREATE OR REPLACE FUNCTION public.ds_project_root_name(p_project uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(r.name, p.name) from projects p left join projects r on r.id = p.parent_id where p.id = p_project
$function$;

-- Keeps project_id and context in step, and lets new work inherit its parent's project.
CREATE OR REPLACE FUNCTION public.ds_task_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.project_id is null and new.context is null and new.parent_id is not null then
      select project_id into new.project_id from tasks where id = new.parent_id and user_id = new.user_id;
    end if;
    if new.project_id is null and new.context is not null then
      new.project_id := ds_project_for_context(new.user_id, new.context);
    end if;
  elsif new.project_id is not distinct from old.project_id then
    if new.context is distinct from old.context and new.context is distinct from ds_project_root_name(new.project_id) then
      -- context edited the old way: point the task at the matching company / project (or none)
      new.project_id := case when new.context is null then null else ds_project_for_context(new.user_id, new.context) end;
    elsif new.parent_id is distinct from old.parent_id and new.parent_id is not null and new.project_id is null then
      select project_id into new.project_id from tasks where id = new.parent_id and user_id = new.user_id;
    end if;
  end if;

  if new.project_id is not null then
    new.context := ds_project_root_name(new.project_id);
  elsif tg_op = 'UPDATE' and old.project_id is not null and new.context is not distinct from old.context then
    new.context := null;
  end if;
  return new;
end $function$;
CREATE TRIGGER ds_task_project BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION ds_task_project();

-- When an outcome or priority changes project, linked work underneath that was on the old project follows it.
CREATE OR REPLACE FUNCTION public.ds_task_project_cascade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update tasks set project_id = new.project_id
  where parent_id = new.id and user_id = new.user_id and project_id is not distinct from old.project_id;
  return null;
end $function$;
CREATE TRIGGER ds_task_project_cascade AFTER UPDATE OF project_id ON public.tasks FOR EACH ROW
  WHEN (old.project_id IS DISTINCT FROM new.project_id) EXECUTE FUNCTION ds_task_project_cascade();

-- Renaming or moving a project refreshes the context label on its tasks.
CREATE OR REPLACE FUNCTION public.ds_projects_relabel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update tasks t set context = ds_project_root_name(t.project_id)
  where t.user_id = new.user_id and (t.project_id = new.id or t.project_id in (select id from projects where parent_id = new.id));
  return null;
end $function$;
CREATE TRIGGER ds_projects_relabel AFTER UPDATE OF name, parent_id ON public.projects FOR EACH ROW
  WHEN (old.name IS DISTINCT FROM new.name OR old.parent_id IS DISTINCT FROM new.parent_id) EXECUTE FUNCTION ds_projects_relabel();

-- ============================================================
-- Roll-forward keeps the project; reports add focus by project
-- ============================================================
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

  with old as (select * from tasks where user_id = p_user and horizon = 'day' and status = 'open' and period_start < p_today),
  ins as (insert into tasks (user_id, horizon, period_start, title, context, project_id, done_def, parent_id, carried_from, carry_count, position, progress)
          select user_id, 'day', v_day, title, context, project_id, done_def,
                 case when date_trunc('week', v_day) = date_trunc('week', period_start) then parent_id end,
                 id, carry_count + 1, position, progress from old
          returning id, carried_from),
  mv1 as (update task_notes n set task_id = ins.id from ins where n.task_id = ins.carried_from),
  mv2 as (update task_links l set task_id = ins.id from ins where l.task_id = ins.carried_from),
  upd as (update tasks t set status = 'carried' from ins where t.id = ins.carried_from returning 1)
  select count(*) into n_day from upd;

  return jsonb_build_object('day', n_day, 'week', n_week, 'month', n_month, 'target_day', v_day);
end $function$;

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
  fs as (select f.minutes, coalesce(t.context, 'No context') as ctx,
                coalesce(case when pr.parent_id is null then pr.name else rt.name || ' › ' || pr.name end, 'No project') as proj
         from focus_sessions f left join tasks t on t.id = f.task_id
         left join projects pr on pr.id = t.project_id left join projects rt on rt.id = pr.parent_id
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
    'focus_by_project', coalesce((select jsonb_object_agg(proj, m) from (select proj, sum(minutes) as m from fs group by proj) x), '{}'::jsonb),
    'energy', (select round(avg(energy), 1) from rv where energy is not null),
    'focus', (select round(avg(focus), 1) from rv where focus is not null),
    'review', (select jsonb_build_object('energy', energy, 'focus', focus, 'reflection', reflection) from reviews where user_id = p_user and horizon = p_kind and period_start = p_start),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('day', period_start, 'notes', notes) order by period_start) from rv where coalesce(notes, '') <> ''), '[]'::jsonb),
    'wins', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'body', body) order by day, created_at) from w), '[]'::jsonb),
    'stuck', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'carry_count', carry_count) order by carry_count desc) from st), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

-- ============================================================
-- Starting data: the old contexts become companies / projects
-- ============================================================
do $$
declare u uuid; aug uuid; pers uuid;
begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then return; end if;
  insert into projects (user_id, kind, name, color, legacy_context, position) values (u, 'company', 'Augustova', '#d97706', 'Augustova', 1) returning id into aug;
  insert into projects (user_id, kind, name, color, legacy_context, position) values (u, 'company', 'PCTR', '#0ea5e9', 'PCT', 2);
  insert into projects (user_id, kind, name, color, legacy_context, position) values (u, 'personal', 'Personal', '#10b981', 'Personal', 3) returning id into pers;
  insert into projects (user_id, parent_id, kind, name, color, legacy_context, position) values (u, aug, 'project', 'GoRizzume', '#f59e0b', 'GoRizzume', 1);
  insert into projects (user_id, parent_id, kind, name, color, legacy_context, position) values (u, pers, 'project', 'Hamid OS', '#8b5cf6', 'Daily sheet', 1);
  update tasks set project_id = ds_project_for_context(user_id, context) where user_id = u and context is not null;
end $$;
