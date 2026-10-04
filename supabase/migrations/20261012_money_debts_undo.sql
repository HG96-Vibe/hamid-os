-- Undo for 20261012_money_debts.sql. Removes loans, lending and their repayments.
drop table if exists public.money_debt_payments;
drop table if exists public.money_debts;
