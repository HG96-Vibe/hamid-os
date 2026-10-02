# Hamid OS

Hamid OS (formerly "Daily Sheet") is a personal planning app for one person. It covers the day, the week and the month:
monthly outcomes, weekly priorities and daily tasks, focus sessions, wins, reviews and reports. Unfinished work rolls
forward on its own. It installs to a phone's home screen as a PWA and sends push notifications.

Live site: https://daily-sheet-six.vercel.app

## How it is hosted

This is a **plain static site**: HTML, CSS, JavaScript and images, with **no build step, no framework and no
`package.json`**. Vercel serves the files in this folder exactly as they are. To deploy, push to `main` and Vercel
publishes it. Leave the Vercel project's Framework Preset as "Other" with the build command and output directory empty.

`vercel.json` adds security headers to every response (no framing, no sniffing, no referrer, `noindex`, no camera,
microphone or location) and makes sure `sw.js` is never cached.

`.gitattributes` (`* -text`) stops Git from changing line endings, so the files in this repo stay byte-identical to
the files served by the live site.

## Files

### JavaScript

`app.js` is the core. It holds the Supabase client, sign-in (including 2FA), data loading and saving, routing, and the
shared helpers. It exposes all of these on a single global, **`window.DS`**. Every other script is an **add-on** that
runs after `app.js`, reads what it needs from `window.DS`, and plugs in its own views or wraps existing ones. That way
features can be added without editing the core file. If `window.DS` is missing, each add-on does nothing.

| File | Role |
| --- | --- |
| `app.js` | Core app. Supabase client, auth and 2FA, data access, routing, helpers, all exported on `window.DS`. |
| `projects.js` | Projects tab: companies (and Personal) with projects inside them, progress from this month's outcomes, a page per project, the project picker used by Today / Week / Month, coloured project chips and a project filter. Loaded straight after `app.js`. |
| `outcomes.js` | Month tab: outcome cards, plus the shared side panel (`DS.openItem`) used by the Week and Today tabs. |
| `week.js` | Week tab: priority cards, day tiles, week in numbers and the week review. |
| `today.js` | Today tab: task strips, the close-out card and side tiles. |
| `reports.js` | Weekly and monthly reports, the reports archive, and deep links from the report emails (`#plan=…`, `#reports`). |
| `home.js` | Home tab: the quote hero, today at a glance, top 3, progress, things needing attention, streaks and quick capture. |
| `account.js` | Adds the sign-out row to Home. |
| `header.js` | The header: a floating capsule on desktop and a bottom dock on phones. |
| `brand.js` | Hamid OS branding: the name and motto, the profile strip on Home, the tab title and sign-in screen. |
| `display.js` | Display size for computers (Auto, 100%, 90%, 80% default, 70%) and the quote banner size on Home (Full, Smaller at 70% default, Compact), set in Settings and saved per device. |
| `theme.js` | The dot-grid background and heading styling. Loads before `app.js` and does not depend on `window.DS`. |
| `intro.js` | Opening animation (desktop only, skippable). Standalone, does not depend on `window.DS`. |
| `sw.js` | Service worker. Shows push notifications and opens the right page when one is tapped. |

### CSS

`styles.css` is the base stylesheet. Each of the others styles the matching feature: `outcomes.css`, `panel.css`
(side panel), `week.css`, `today.css`, `reports.css`, `home.css`, `account.css`, `header.css`, `intro.css`, `brand.css`,
`display.css` and `projects.css`. `mobile.css` holds the phone-layout overrides.

### Other files

| File | Role |
| --- | --- |
| `index.html` | The single page. Loads the fonts, the stylesheets, the Supabase JS library (from jsDelivr) and the scripts, in order. |
| `manifest.webmanifest` | PWA manifest (name, colours, icons). |
| `icon-v2.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `apple-touch-icon-precomposed.png`, `favicon.ico` | App icon. All six are the same image. |
| `intro-bulb.jpg` | Bulb image used by the opening animation. |
| `hero-storm.webp` | Hero image used by the side panel (`panel.css`). |
| `vercel.json` | Vercel headers (see above). |
| `supabase/functions/reminders/index.ts` | Source of the `reminders` Edge Function. |
| `supabase/schema.sql` | The database's public schema as first imported: tables, RLS policies, functions, the sign-up trigger and the cron job. |
| `supabase/migrations/` | Database changes made since, applied in date order on top of `schema.sql` (each with an `_undo` script). |

## Data and backend: Supabase

All data lives in Supabase (project ref `xxvsosusnqnrgdigqfyw`). The browser talks to it directly with the Supabase
JS client.

**Security is row-level security plus 2FA.** Every table has RLS turned on, with one policy, `owner_with_2fa`: a row
can be read or written only by the signed-in user who owns it, **and only when that session has passed two-factor
authentication** (`aal = 'aal2'` in the JWT). A session that has signed in with a password but not completed 2FA can
see nothing. A trigger on `auth.users` (`ds_only_one_user`) closes sign-ups after the first account.

Two database functions do the heavy lifting:

- `ds_rollover(user, today)` moves unfinished month, week and day items into the current period (weekend days roll to
  Monday), and moves their notes and links with them.
- `ds_report(user, kind, start)` builds the weekly or monthly report as JSON.

### The `reminders` Edge Function

`supabase/functions/reminders/index.ts` runs on Supabase Edge Functions. **pg_cron calls it every 5 minutes** (job
`ds-reminders`), and on each run, in the user's own time zone, it:

- sends **push notifications**: the morning "plan your day" nudge, the evening "close out the day" nudge, the Sunday
  backup reminder, and any task reminders that are due;
- runs the **4am roll-forward** (`ds_rollover`), so anything unfinished moves to the new day, week or month;
- builds the **weekly report** (Sunday 6pm) and **monthly report** (last day of the month, 6pm) with `ds_report`, saves
  them to the `reports` table and **emails them through Resend**.

The app also calls it directly (with the user's login token) to send a test notification or to email a report on
demand.

## Secrets

**No secrets are stored in this repo.** They live in Supabase:

- `RESEND_API_KEY` and the service-role key are Edge Function secrets (Supabase dashboard → Edge Functions → Secrets).
- The VAPID private key and the cron secret are rows in the `public.ds_secrets` table, which has RLS on and no
  policies, so only the service role can read it. `schema.sql` contains the table's structure but none of its rows.

The values that do appear in `app.js` are public by design: the Supabase project URL, the **publishable** (anon) key,
and the VAPID **public** key. They are safe in the browser because RLS protects the data.

## Restoring the backend

- Database: run `supabase/schema.sql` against a fresh Supabase project, then add the `ds_secrets` rows
  (`vapid_public`, `vapid_private`, `cron_secret`) by hand.
- Edge Function: `npx supabase functions deploy reminders --no-verify-jwt --project-ref <ref>`, then set
  `RESEND_API_KEY` with `npx supabase secrets set`.

## How this repo was made

The front-end files were downloaded from the live site byte for byte and checked against known SHA-1 hashes. The Edge
Function source and the schema were exported through the Supabase connector (read-only catalog queries), not with the
Supabase CLI, so no Supabase login or database password was needed.
