-- Voice: a private bucket where the tts Edge Function keeps the speech it has made, so the same words are
-- never sent to Azure twice. No policies: only the Edge Function (service role) reads and writes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-cache', 'voice-cache', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;
