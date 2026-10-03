-- Listen tab: YouTube videos and playlists saved to play while working (background music, mixes, watch later).
-- last_seconds / last_index remember where a long mix was left, so it resumes there.
create table public.listen_items (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  kind text default 'video'::text not null,
  youtube_id text not null,
  title text,
  channel text,
  thumb text,
  category text default 'Focus'::text not null,
  favourite boolean default false not null,
  focus boolean default false not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  last_seconds double precision default 0 not null,
  last_index integer default 0 not null,
  duration double precision default 0 not null,
  plays integer default 0 not null,
  last_played_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint listen_items_pkey PRIMARY KEY (id),
  constraint listen_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint listen_items_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'playlist'::text]))),
  constraint listen_items_youtube_id_check CHECK ((youtube_id ~ '^[A-Za-z0-9_-]{6,64}$'::text)),
  constraint listen_items_title_check CHECK (((title IS NULL) OR (length(title) <= 300))),
  constraint listen_items_category_check CHECK (((length(category) >= 1) AND (length(category) <= 40))),
  constraint listen_items_thumb_check CHECK (((thumb IS NULL) OR (thumb ~ '^https://'::text)))
);
CREATE INDEX listen_items_user ON public.listen_items USING btree (user_id, category, position);
alter table public.listen_items enable row level security;

create policy owner_with_2fa on public.listen_items as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
