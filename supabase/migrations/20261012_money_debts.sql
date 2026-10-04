-- Capital tab: loans (money you owe) and lending (money owed to you), added by hand, with repayments.
-- A record only: it never counts towards money in / money out.
create table public.money_debts (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  book_id uuid not null,
  direction text not null,                         -- 'borrowed' (you owe) or 'lent' (owed to you)
  name text not null,                              -- who: a person, bank or company
  amount_pence bigint not null,                    -- the full amount borrowed / lent
  started_on date not null,
  due_on date,                                     -- when it should be paid back (optional)
  note text,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint money_debts_pkey PRIMARY KEY (id),
  constraint money_debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_debts_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  constraint money_debts_direction_check CHECK ((direction = ANY (ARRAY['borrowed'::text, 'lent'::text]))),
  constraint money_debts_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint money_debts_amount_check CHECK (((amount_pence > 0) AND (amount_pence <= '100000000000'::bigint))),
  constraint money_debts_note_check CHECK (((note IS NULL) OR (length(note) <= 300)))
);
CREATE INDEX money_debts_user ON public.money_debts USING btree (user_id, book_id);

create table public.money_debt_payments (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  debt_id uuid not null,
  paid_on date not null,
  amount_pence bigint not null,
  note text,
  created_at timestamp with time zone default now() not null,
  constraint money_debt_payments_pkey PRIMARY KEY (id),
  constraint money_debt_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_debt_payments_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.money_debts(id) ON DELETE CASCADE,
  constraint money_debt_payments_amount_check CHECK (((amount_pence > 0) AND (amount_pence <= '100000000000'::bigint))),
  constraint money_debt_payments_note_check CHECK (((note IS NULL) OR (length(note) <= 300)))
);
CREATE INDEX money_debt_payments_debt ON public.money_debt_payments USING btree (debt_id, paid_on);
CREATE INDEX money_debt_payments_user ON public.money_debt_payments USING btree (user_id);

alter table public.money_debts enable row level security;
alter table public.money_debt_payments enable row level security;
create policy owner_with_2fa on public.money_debts as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
create policy owner_with_2fa on public.money_debt_payments as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
