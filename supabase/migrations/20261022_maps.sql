-- Maps: break anything down top-down. A map has one root box (its title) and boxes under boxes, as deep as you like.
create table public.maps (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  title text not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint maps_pkey PRIMARY KEY (id),
  constraint maps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint maps_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300)))
);
create index maps_user on public.maps (user_id, position);

create table public.map_nodes (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  map_id uuid not null,
  parent_id uuid,
  title text not null,
  note text,
  due_on date,
  done_at timestamp with time zone,
  collapsed boolean default false not null,
  suggested boolean default false not null,     -- added by Claude: keep it or remove it
  task_id uuid,                                 -- sent to Today / This week
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint map_nodes_pkey PRIMARY KEY (id),
  constraint map_nodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint map_nodes_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.maps(id) ON DELETE CASCADE,
  constraint map_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.map_nodes(id) ON DELETE CASCADE,
  constraint map_nodes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL,
  constraint map_nodes_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300))),
  constraint map_nodes_note_check CHECK (((note IS NULL) OR (length(note) <= 2000)))
);
create index map_nodes_map on public.map_nodes (map_id);
create index map_nodes_parent on public.map_nodes (parent_id);

do $$ declare t text; begin
  foreach t in array array['maps','map_nodes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy owner_with_2fa on public.%I as PERMISSIVE for ALL to authenticated
      using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
      with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))$p$, t);
  end loop;
end $$;
