-- Schedule a weekly priority or monthly outcome on a particular day: it then shows on that day in the Week tab
-- and at the top of Today on that date.
alter table public.tasks add column scheduled_on date;
create index tasks_scheduled on public.tasks using btree (user_id, scheduled_on) where scheduled_on is not null;
