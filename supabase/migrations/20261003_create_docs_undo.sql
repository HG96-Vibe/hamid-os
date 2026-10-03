-- Undo for 20261003_create_docs.sql. Removes the Create tab's tables and everything written in them.
drop trigger if exists ds_documents_touch on public.documents;
drop function if exists public.ds_documents_touch();
drop table if exists public.documents;
drop trigger if exists ds_doc_folders_check on public.doc_folders;
drop function if exists public.ds_doc_folders_check();
drop table if exists public.doc_folders;
