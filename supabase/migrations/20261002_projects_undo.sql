-- Undo for 20261002_projects.sql. Restores the previous ds_rollover / ds_report (see supabase/schema.sql),
-- then removes the projects link. Task contexts keep their new top-level names; before the migration they were:
-- Augustova (3 day tasks), PCT (1 day task, now "PCTR"), Daily sheet (2 day tasks, now "Personal").
drop trigger if exists ds_task_project_cascade on public.tasks;
drop trigger if exists ds_task_project on public.tasks;
drop trigger if exists ds_projects_relabel on public.projects;
drop trigger if exists ds_projects_check on public.projects;
drop function if exists public.ds_task_project_cascade();
drop function if exists public.ds_task_project();
drop function if exists public.ds_projects_relabel();
drop function if exists public.ds_projects_check();
alter table public.tasks drop column if exists project_id;
drop function if exists public.ds_project_for_context(uuid, text);
drop function if exists public.ds_project_root_name(uuid);
drop table if exists public.projects;
-- then re-run the ds_rollover and ds_report definitions from supabase/schema.sql
