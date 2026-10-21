-- Direct debits & bills: the last payment of one you've stopped. It stays in the months it went out
-- and nothing after this date is shown or counted.
alter table public.money_planned add column if not exists ends_on date;
