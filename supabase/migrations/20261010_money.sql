-- Money tab: spending and income in separate books (Personal, Augustova, PCTR: the top-level companies in
-- Projects), categories with monthly budgets, rules learned from your category choices, and investments you
-- add yourself with their value over time (net worth). Amounts are whole pence (no rounding errors).
-- Every table: only you, signed in with two-factor, can read or change your rows.

create table public.money_tx (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  book_id uuid not null,
  occurred_on date not null,
  amount_pence bigint not null,          -- money in is positive, money out negative
  description text not null,
  category text,
  note text,
  source text default 'manual'::text not null,
  import_key text,                       -- identifies a statement line, so importing twice adds nothing twice
  created_at timestamp with time zone default now() not null,
  constraint money_tx_pkey PRIMARY KEY (id),
  constraint money_tx_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_tx_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  constraint money_tx_amount_check CHECK (((amount_pence <> 0) AND (abs(amount_pence) <= '100000000000'::bigint))),
  constraint money_tx_description_check CHECK (((length(description) >= 1) AND (length(description) <= 300))),
  constraint money_tx_category_check CHECK (((category IS NULL) OR ((length(category) >= 1) AND (length(category) <= 60)))),
  constraint money_tx_note_check CHECK (((note IS NULL) OR (length(note) <= 1000))),
  constraint money_tx_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text]))),
  constraint money_tx_import_key_check CHECK (((import_key IS NULL) OR (length(import_key) <= 400))),
  constraint money_tx_import_unique UNIQUE (user_id, book_id, import_key)
);
CREATE INDEX money_tx_book_date ON public.money_tx USING btree (user_id, book_id, occurred_on);

create table public.money_categories (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  book_id uuid not null,
  name text not null,
  kind text not null,                    -- 'out' (spending) or 'in' (income)
  budget_pence bigint,                   -- monthly budget for spending categories
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint money_categories_pkey PRIMARY KEY (id),
  constraint money_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_categories_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  constraint money_categories_name_check CHECK (((length(name) >= 1) AND (length(name) <= 60))),
  constraint money_categories_kind_check CHECK ((kind = ANY (ARRAY['in'::text, 'out'::text]))),
  constraint money_categories_budget_check CHECK (((budget_pence IS NULL) OR ((budget_pence >= 0) AND (budget_pence <= '10000000000'::bigint)))),
  constraint money_categories_unique UNIQUE (user_id, book_id, kind, name)
);

create table public.money_rules (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  book_id uuid not null,
  pattern text not null,                 -- a simplified shop / payee name, e.g. "tesco stores"
  category text not null,
  created_at timestamp with time zone default now() not null,
  constraint money_rules_pkey PRIMARY KEY (id),
  constraint money_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_rules_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  constraint money_rules_pattern_check CHECK (((length(pattern) >= 1) AND (length(pattern) <= 120))),
  constraint money_rules_category_check CHECK (((length(category) >= 1) AND (length(category) <= 60))),
  constraint money_rules_unique UNIQUE (user_id, book_id, pattern)
);

create table public.money_holdings (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  name text not null,
  kind text default 'Other'::text not null,
  note text,
  archived boolean default false not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint money_holdings_pkey PRIMARY KEY (id),
  constraint money_holdings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_holdings_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint money_holdings_kind_check CHECK (((length(kind) >= 1) AND (length(kind) <= 40))),
  constraint money_holdings_note_check CHECK (((note IS NULL) OR (length(note) <= 500)))
);

create table public.money_values (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  holding_id uuid not null,
  valued_on date not null,
  value_pence bigint not null,           -- negative for something you owe (a loan, a card balance)
  created_at timestamp with time zone default now() not null,
  constraint money_values_pkey PRIMARY KEY (id),
  constraint money_values_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_values_holding_id_fkey FOREIGN KEY (holding_id) REFERENCES public.money_holdings(id) ON DELETE CASCADE,
  constraint money_values_value_check CHECK ((abs(value_pence) <= '1000000000000'::bigint)),
  constraint money_values_unique UNIQUE (holding_id, valued_on)
);
CREATE INDEX money_values_user ON public.money_values USING btree (user_id, valued_on);

alter table public.money_tx enable row level security;
alter table public.money_categories enable row level security;
alter table public.money_rules enable row level security;
alter table public.money_holdings enable row level security;
alter table public.money_values enable row level security;

create policy owner_with_2fa on public.money_tx as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
create policy owner_with_2fa on public.money_categories as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
create policy owner_with_2fa on public.money_rules as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
create policy owner_with_2fa on public.money_holdings as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
create policy owner_with_2fa on public.money_values as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
