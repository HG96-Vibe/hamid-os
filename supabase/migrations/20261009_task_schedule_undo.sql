-- Undo for 20261009_task_schedule.sql. Removes the dates tasks were scheduled on.
drop index if exists public.tasks_scheduled;
alter table public.tasks drop column if exists scheduled_on;
