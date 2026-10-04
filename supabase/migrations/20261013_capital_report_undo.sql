-- Undo for 20261013_capital_report.sql. Stops the monthly Capital email.
select cron.unschedule('capital-report');
drop table if exists public.money_reports;
