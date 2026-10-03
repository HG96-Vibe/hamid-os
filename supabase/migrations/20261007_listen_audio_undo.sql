-- Undo for 20261007_listen_audio.sql. Removes uploaded music from Listen.
-- First empty the listen-audio bucket in the Supabase dashboard (Storage), then run this.
drop policy if exists listen_audio_owner_with_2fa on storage.objects;
delete from storage.buckets where id = 'listen-audio';
delete from public.listen_items where kind = 'audio';
alter table public.listen_items drop constraint if exists listen_items_audio_check;
alter table public.listen_items drop constraint listen_items_youtube_id_check;
alter table public.listen_items add constraint listen_items_youtube_id_check CHECK ((youtube_id ~ '^[A-Za-z0-9_-]{6,64}$'::text));
alter table public.listen_items alter column youtube_id set not null;
alter table public.listen_items drop column audio_path, drop column audio_size, drop column audio_type;
alter table public.listen_items drop constraint listen_items_kind_check;
alter table public.listen_items add constraint listen_items_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'playlist'::text])));
