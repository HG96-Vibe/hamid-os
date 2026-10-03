-- Create tab: documents, filed in folders (two levels: a folder can hold subfolders, a subfolder cannot).
-- A document can also be linked to a project. Deleting a document moves it to the Trash (deleted_at);
-- the app empties anything that has been in the Trash for 30 days.

-- ============================================================
-- Folders
-- ============================================================
create table public.doc_folders (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  parent_id uuid,
  name text not null,
  "position" double precision default EXTRACT(epoch FROM now()) not null,
  created_at timestamp with time zone default now() not null,
  constraint doc_folders_pkey PRIMARY KEY (id),
  constraint doc_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint doc_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES doc_folders(id) ON DELETE CASCADE,
  constraint doc_folders_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80)))
);
CREATE INDEX doc_folders_user ON public.doc_folders USING btree (user_id, position);
CREATE INDEX doc_folders_parent ON public.doc_folders USING btree (parent_id);
alter table public.doc_folders enable row level security;

create policy owner_with_2fa on public.doc_folders as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- Only two levels, and a subfolder's parent must belong to the same user.
CREATE OR REPLACE FUNCTION public.ds_doc_folders_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare p doc_folders;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A folder cannot sit inside itself'; end if;
    select * into p from doc_folders where id = new.parent_id;
    if p.id is null or p.user_id <> new.user_id then raise exception 'Folder not found'; end if;
    if p.parent_id is not null then raise exception 'Subfolders cannot hold more folders'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from doc_folders where parent_id = new.id) then raise exception 'A folder with subfolders cannot move inside another'; end if;
  end if;
  return new;
end $function$;
CREATE TRIGGER ds_doc_folders_check BEFORE INSERT OR UPDATE ON public.doc_folders FOR EACH ROW EXECUTE FUNCTION ds_doc_folders_check();

-- ============================================================
-- Documents
-- ============================================================
create table public.documents (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  folder_id uuid,
  project_id uuid,
  title text default 'Untitled'::text not null,
  content jsonb,
  html text,
  plain text,
  word_count integer default 0 not null,
  page jsonb default '{"size": "A4", "margins": "normal"}'::jsonb not null,
  pinned boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  constraint documents_pkey PRIMARY KEY (id),
  constraint documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES doc_folders(id) ON DELETE SET NULL,
  constraint documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  constraint documents_title_check CHECK ((length(title) <= 200))
);
CREATE INDEX documents_user ON public.documents USING btree (user_id, updated_at DESC);
CREATE INDEX documents_folder ON public.documents USING btree (folder_id);
CREATE INDEX documents_project ON public.documents USING btree (project_id);
alter table public.documents enable row level security;

create policy owner_with_2fa on public.documents as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- "Last edited" only moves when the writing or page set-up changes (not when a document is pinned or moved),
-- and the folder must belong to the same user.
CREATE OR REPLACE FUNCTION public.ds_documents_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.folder_id is not null and not exists (select 1 from doc_folders where id = new.folder_id and user_id = new.user_id) then
    raise exception 'Folder not found';
  end if;
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content or new.title is distinct from old.title or new.page is distinct from old.page then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end $function$;
CREATE TRIGGER ds_documents_touch BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION ds_documents_touch();
