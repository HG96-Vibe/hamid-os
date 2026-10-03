-- Create tab, step 2: version history for documents, and a private place for the images in them.

-- ============================================================
-- Versions
-- ============================================================
-- kind: 'auto' (every 10 minutes while writing, and when you leave a document), 'named' (Save version),
-- 'restore' (taken just before an older version is restored).
create table public.document_versions (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid() not null,
  document_id uuid not null,
  kind text default 'auto'::text not null,
  name text,
  title text,
  content jsonb,
  html text,
  word_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint document_versions_pkey PRIMARY KEY (id),
  constraint document_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  constraint document_versions_kind_check CHECK ((kind = ANY (ARRAY['auto'::text, 'named'::text, 'restore'::text]))),
  constraint document_versions_name_check CHECK (((name IS NULL) OR (length(name) <= 120)))
);
CREATE INDEX document_versions_doc ON public.document_versions USING btree (document_id, created_at DESC);
alter table public.document_versions enable row level security;

create policy owner_with_2fa on public.document_versions as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));

-- A version must belong to one of the user's own documents. After each new version, automatic ones older than
-- 90 days are thinned to the last one of each day. Named versions are kept for as long as the document is.
CREATE OR REPLACE FUNCTION public.ds_document_versions_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from documents where id = new.document_id and user_id = new.user_id) then
    raise exception 'Document not found';
  end if;
  return new;
end $function$;
CREATE TRIGGER ds_document_versions_check BEFORE INSERT OR UPDATE ON public.document_versions FOR EACH ROW EXECUTE FUNCTION ds_document_versions_check();

CREATE OR REPLACE FUNCTION public.ds_document_versions_thin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  delete from document_versions v
   where v.document_id = new.document_id and v.kind = 'auto' and v.created_at < now() - interval '90 days'
     and exists (select 1 from document_versions w
                  where w.document_id = v.document_id and w.kind = 'auto'
                    and w.created_at::date = v.created_at::date and w.created_at > v.created_at);
  return null;
end $function$;
CREATE TRIGGER ds_document_versions_thin AFTER INSERT ON public.document_versions FOR EACH ROW EXECUTE FUNCTION ds_document_versions_thin();

-- ============================================================
-- Images: a private storage bucket. Files sit under <user id>/<document id>/, and only their owner,
-- signed in with 2FA, can read or write them. The app shows them through short-lived signed links.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-images', 'doc-images', false, 10485760, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

create policy doc_images_owner_with_2fa on storage.objects as PERMISSIVE for ALL to authenticated
  using (((bucket_id = 'doc-images'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((bucket_id = 'doc-images'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
