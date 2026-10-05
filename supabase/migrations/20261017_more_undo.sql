-- Undo 20261017_more
alter table public.focus_sessions drop column if exists note;
alter table public.focus_sessions drop column if exists project_id;
alter table public.projects drop constraint if exists projects_rate_check;
alter table public.projects drop column if exists hourly_rate_pence;
alter table public.settings drop column if exists alerts_on;
drop table if exists public.notify_log;
drop table if exists public.calendar_feeds;
drop table if exists public.briefs;
drop table if exists public.savings_goals;
drop table if exists public.project_milestones;
drop table if exists public.people_notes;
drop table if exists public.people;
