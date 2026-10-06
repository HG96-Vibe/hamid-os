-- A brief can come with a full page (an HTML page in Create) that opens from Home
alter table public.briefs add column document_id uuid;
alter table public.briefs add constraint briefs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;
