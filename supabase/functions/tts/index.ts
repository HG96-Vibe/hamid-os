// tts: reads text aloud with a Microsoft Azure natural voice (the free F0 plan) for Hamid OS's Voice feature.
// Only the signed-in owner, after 2FA, can use it. The Azure key lives in the Edge Function secrets
// AZURE_SPEECH_KEY and AZURE_SPEECH_REGION and never reaches the browser.
// Each piece of speech is saved in the private voice-cache bucket, so hearing the same words again is free.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const VOICES = new Set(['en-GB-OllieMultilingualNeural', 'en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-GB-LibbyNeural',
  'en-GB-MaisieNeural', 'en-GB-ThomasNeural', 'en-GB-AbbiNeural']);
const DEFAULT_VOICE = 'en-GB-OllieMultilingualNeural';
const BUCKET = 'voice-cache';
const MAX_CHARS = 1500;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function claims(token: string): Record<string, unknown> {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // the signed-in owner, after 2FA (getUser checks the token is genuine and current)
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json({ error: 'auth' }, 401);
  if (claims(token).aal !== 'aal2') return json({ error: 'auth' }, 403);

  const key = Deno.env.get('AZURE_SPEECH_KEY'), region = Deno.env.get('AZURE_SPEECH_REGION');
  if (!key || !region) return json({ error: 'not_set_up' }, 503);

  let body: { text?: string; voice?: string; check?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }

  // Settings asks whether the voice is ready (this costs nothing from the free allowance)
  if (body.check) {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    if (!r.ok) return json({ error: r.status === 401 || r.status === 403 ? 'key' : 'azure', status: r.status }, 502);
    const list = await r.json() as { ShortName: string }[];
    const have = new Set(list.map(v => v.ShortName));
    return json({ ok: true, region, voices: [...VOICES].filter(v => have.has(v)) });
  }

  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) return json({ error: 'no_text' }, 400);
  const voice = VOICES.has(String(body.voice)) ? String(body.voice) : DEFAULT_VOICE;

  const path = `${user.id}/${await sha256(voice + '\n' + text)}.mp3`;
  const hit = await admin.storage.from(BUCKET).download(path);
  if (hit.data) return new Response(hit.data, { headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'X-Cache': 'hit' } });

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}">${esc(text)}</voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'hamid-os' },
    body: ssml
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    console.error('azure tts', r.status, detail);
    // 429: too many requests this minute. 403 with "quota": the free monthly allowance is used up.
    const code = r.status === 429 ? 'busy' : /quota/i.test(detail) ? 'quota' : r.status === 401 || r.status === 403 ? 'key' : 'azure';
    return json({ error: code, status: r.status }, code === 'busy' ? 429 : 502);
  }
  const audio = new Uint8Array(await r.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
  if (upErr) console.error('cache upload', upErr.message);
  return new Response(audio, { headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'X-Cache': 'miss' } });
});
