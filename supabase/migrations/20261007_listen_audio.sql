-- Listen: your own audio files (kind 'audio'), stored privately and playable offline on each Mac.
-- An audio item has no YouTube id; it points at a file in the private listen-audio bucket under the owner's folder.
alter table public.listen_items drop constraint listen_items_kind_check;
alter table public.listen_items add constraint listen_items_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'playlist'::text, 'audio'::text])));
alter table public.listen_items alter column youtube_id drop not null;
alter table public.listen_items add column audio_path text, add column audio_size bigint, add column audio_type text;
alter table public.listen_items drop constraint listen_items_youtube_id_check;
alter table public.listen_items add constraint listen_items_youtube_id_check CHECK (
  (kind = 'audio'::text AND youtube_id IS NULL) OR (kind <> 'audio'::text AND youtube_id ~ '^[A-Za-z0-9_-]{6,64}$'::text));
alter table public.listen_items add constraint listen_items_audio_check CHECK (
  (kind <> 'audio'::text AND audio_path IS NULL) OR
  (kind = 'audio'::text AND audio_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$'::text
    AND audio_size > 0 AND audio_size <= 52428800 AND audio_type ~ '^audio/[a-z0-9.+-]{1,40}$'::text));

-- Private bucket: 50 MB a file (the free plan's limit), audio only. Files live under <user id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listen-audio', 'listen-audio', false, 52428800,
  array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac', 'audio/webm'])
on conflict (id) do nothing;

create policy listen_audio_owner_with_2fa on storage.objects as PERMISSIVE for ALL to authenticated
  using (((bucket_id = 'listen-audio'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)))
  with check (((bucket_id = 'listen-audio'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (( SELECT (auth.jwt() ->> 'aal'::text)) = 'aal2'::text)));
