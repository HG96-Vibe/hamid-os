-- Undo for 20261010_money.sql. Removes the Money tab's data: transactions, categories, rules, investments.
drop table if exists public.money_values;
drop table if exists public.money_holdings;
drop table if exists public.money_rules;
drop table if exists public.money_categories;
drop table if exists public.money_tx;
