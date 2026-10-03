-- Undo for 20261005_voice_cache.sql. Empty the voice-cache bucket in the dashboard first
-- (Storage → voice-cache → select all → delete); Supabase does not allow deleting storage files with SQL.
delete from storage.buckets where id = 'voice-cache';
