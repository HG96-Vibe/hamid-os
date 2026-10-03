-- Undo for 20261004_docs_versions_images.sql.
-- Empty the doc-images bucket first (Supabase dashboard → Storage → doc-images → select all → delete);
-- Supabase does not allow deleting storage files with SQL, and a bucket with files in it cannot be dropped.
drop policy if exists doc_images_owner_with_2fa on storage.objects;
delete from storage.buckets where id = 'doc-images';
drop trigger if exists ds_document_versions_thin on public.document_versions;
drop trigger if exists ds_document_versions_check on public.document_versions;
drop function if exists public.ds_document_versions_thin();
drop function if exists public.ds_document_versions_check();
drop table if exists public.document_versions;
