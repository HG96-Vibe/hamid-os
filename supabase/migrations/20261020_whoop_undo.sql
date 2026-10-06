select cron.unschedule('whoop-sync');
drop table if exists public.whoop_workouts, public.whoop_sleeps, public.whoop_days, public.whoop_states, public.whoop_tokens, public.whoop_link;
