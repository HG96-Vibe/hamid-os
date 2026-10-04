-- Undo for 20261008_project_brief.sql. Removes project briefs.
alter table public.projects drop constraint if exists projects_brief_check;
alter table public.projects drop column if exists brief;
