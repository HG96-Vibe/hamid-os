-- "For later": a task filed under a project with no day, week or month. It is never carried forward by the
-- rollover (which only touches day / week / month); give it a day (scheduled_on) when you're ready.
alter table public.tasks drop constraint tasks_horizon_check;
alter table public.tasks add constraint tasks_horizon_check check (horizon = any (array['day'::text, 'week'::text, 'month'::text, 'later'::text]));
