-- Undo 20261016_html_pages: stop accepting HTML pages (pages already kept stay in storage).
update storage.buckets set allowed_mime_types = array_remove(allowed_mime_types, 'text/html') where id = 'doc-files';
