-- Capital tab: your own list of direct debits, standing orders and bills you know are coming.
-- A record only: it never counts towards money in / money out.
create table public.money_planned (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  book_id uuid not null,
  name text not null,
  amount_pence bigint not null,
  cadence text default 'monthly'::text not null,   -- weekly, monthly, quarterly, yearly, or once
  next_on date not null,                           -- the (first) date it goes out
  note text,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint money_planned_pkey PRIMARY KEY (id),
  constraint money_planned_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint money_planned_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.projects(id) ON DELETE RESTRICT,
  constraint money_planned_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint money_planned_amount_check CHECK (((amount_pence > 0) AND (amount_pence <= '100000000000'::bigint))),
  constraint money_planned_cadence_check CHECK ((cadence = ANY (ARRAY['weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text, 'once'::text]))),
  constraint money_planned_note_check CHECK (((note IS NULL) OR (length(note) <= 300)))
);
CREATE INDEX money_planned_user ON public.money_planned USING btree (user_id, book_id);
alter table public.money_planned enable row level security;
create policy owner_with_2fa on public.money_planned as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
