-- Notifications you were sent (heads-ups, reminders, reports, briefs), for the bell in the top bar.
-- Written by the reminders function; you can read them and mark them read.
create table public.notifications (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  title text not null,
  body text,
  url text,
  tag text,
  created_at timestamp with time zone default now() not null,
  read_at timestamp with time zone,
  constraint notifications_pkey PRIMARY KEY (id),
  constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint notifications_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300))),
  constraint notifications_body_check CHECK (((body IS NULL) OR (length(body) <= 2000))),
  constraint notifications_url_check CHECK (((url IS NULL) OR (length(url) <= 300))),
  constraint notifications_tag_check CHECK (((tag IS NULL) OR (length(tag) <= 120)))
);
CREATE INDEX notifications_user ON public.notifications USING btree (user_id, created_at DESC);
alter table public.notifications enable row level security;
create policy owner_with_2fa on public.notifications as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
