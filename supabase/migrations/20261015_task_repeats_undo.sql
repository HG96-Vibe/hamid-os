-- Undo 20261015_task_repeats: the rollover as before, then remove repeats.
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

drop function if exists public.ds_make_repeats(uuid, date);
drop index if exists public.tasks_repeat_day;
alter table public.tasks drop constraint if exists tasks_repeat_id_fkey;
alter table public.tasks drop column if exists repeat_id;
drop table if exists public.task_repeats;
