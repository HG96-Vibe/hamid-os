-- Projects: a brief you write yourself (plain text; **double asterisks** mark bold), shown on the project page.
alter table public.projects add column brief text;
alter table public.projects add constraint projects_brief_check CHECK (((brief IS NULL) OR (length(brief) <= 20000)));
