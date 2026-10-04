-- Capital report email: one row per month once it has been sent (so it goes once), and the hourly job that
-- checks whether it's report day (the 30th, or the last day of a shorter month) after 6pm.
create table public.money_reports (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  period_start date not null,                 -- the 1st of the month the report covers
  sent_at timestamp with time zone,           -- null while it's being sent
  created_at timestamp with time zone default now() not null,
  constraint money_reports_pkey PRIMARY KEY (id),
  constraint money_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_reports_unique UNIQUE (user_id, period_start)
);
alter table public.money_reports enable row level security;
create policy owner_with_2fa on public.money_reports as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- Every hour at :07, call the "capital-report" Edge Function. The x-cron-secret header is read from
-- public.ds_secrets at run time, not stored here (same as ds-reminders).
select cron.schedule('capital-report', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://xxvsosusnqnrgdigqfyw.supabase.co/functions/v1/capital-report',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.ds_secrets where key='cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
