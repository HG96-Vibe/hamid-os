-- Undo for 20261014_doc_files.sql. Empty the doc-files bucket first (Supabase dashboard → Storage → doc-files →
-- select all → delete), and move any uploaded-file rows out of documents (delete from documents where file is not null).
drop policy if exists doc_files_owner_with_2fa on storage.objects;
delete from storage.buckets where id = 'doc-files';
alter table public.documents drop constraint if exists documents_file_check;
alter table public.documents drop column if exists file;
