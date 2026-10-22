-- put any "for later" tasks back on today's sheet first
update public.tasks set horizon = 'day', period_start = current_date where horizon = 'later';
alter table public.tasks drop constraint tasks_horizon_check;
alter table public.tasks add constraint tasks_horizon_check check (horizon = any (array['day'::text, 'week'::text, 'month'::text]));
