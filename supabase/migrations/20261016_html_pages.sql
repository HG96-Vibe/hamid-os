-- Create: HTML pages. An uploaded page (or a folder / .zip, put together into one page in the browser) is kept as
-- one .html file in the private doc-files bucket. documents.file can also hold "versions" (earlier copies) and "at".
update storage.buckets set allowed_mime_types = array_append(allowed_mime_types, 'text/html')
where id = 'doc-files' and not ('text/html' = any (allowed_mime_types));
