-- Create tab: upload documents. Word files become editable documents (no change needed); PDFs, PowerPoints and
-- old .doc files are kept as they are in a private bucket and listed with your documents (folders, pin, trash).
-- documents.file holds { path, name, size, type, ext } for an uploaded file; it is null for written documents.
alter table public.documents add column file jsonb;
alter table public.documents add constraint documents_file_check CHECK ((file IS NULL) OR ((file ? 'path') AND (length(file ->> 'path') <= 300)));

-- Private bucket, 50 MB a file; files sit in a folder named after the owner, readable only with 2FA (like doc-images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-files', 'doc-files', false, 52428800, array[
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy doc_files_owner_with_2fa on storage.objects as PERMISSIVE for ALL to authenticated
  using (((bucket_id = 'doc-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((bucket_id = 'doc-files'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
