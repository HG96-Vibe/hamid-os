-- Themes: the chosen theme, accent, motion, background strength, morning / evening and focus themes,
-- kept on the account so every device matches (themes.js).
alter table public.settings add column if not exists appearance jsonb;
