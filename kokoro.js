// Kokoro voice for Hamid OS: a natural-sounding voice that runs on this device (free, open source, private).
// window.HKokoro.load(onProgress) downloads it once; gen(text, voice) turns a sentence into a WAV link.
(function () {
  'use strict';
  const STATE_KEY = 'ds_kokoro_ready';
  let worker = null, ready = false, loading = null, seq = 0;
  const waiting = new Map(), progressFns = new Set();
  const VOICES = [
    ['bf_emma', 'Emma', 'British, female'], ['bm_george', 'George', 'British, male'], ['bf_isabella', 'Isabella', 'British, female'],
    ['bm_fable', 'Fable', 'British, male'], ['bm_lewis', 'Lewis', 'British, male'], ['bf_alice', 'Alice', 'British, female'],
    ['bf_lily', 'Lily', 'British, female'], ['bm_daniel', 'Daniel', 'British, male'],
    ['af_heart', 'Heart', 'American, female'], ['af_bella', 'Bella', 'American, female']];

  function boot() {
    if (worker) return worker;
    worker = new Worker(new URL('/kokoro-worker.js?v=1', location.href), { type: 'module' });
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') progressFns.forEach(f => { try { f(m.loaded, m.total); } catch (e) {} });
      if (m.type === 'ready') { ready = true; try { localStorage.setItem(STATE_KEY, '1'); } catch (e) {} waiting.get('load')?.ok(); waiting.delete('load'); }
      if (m.type === 'failed') { waiting.get('load')?.bad(new Error(m.message)); waiting.delete('load'); loading = null; }
      if (m.type === 'audio' || m.type === 'error') {
        const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id);
        if (m.type === 'error') w.bad(new Error(m.message)); else w.ok({ url: URL.createObjectURL(wav(m.pcm, m.sr)), ms: m.ms, seconds: m.pcm.length / m.sr });
      }
    };
    worker.onerror = e => { const err = new Error(e.message || 'The voice stopped working.'); waiting.forEach(w => w.bad(err)); waiting.clear(); loading = null; worker = null; ready = false; };
    return worker;
  }
  function load(onProgress) {
    if (onProgress) progressFns.add(onProgress);
    if (ready) return Promise.resolve();
    if (!loading) loading = new Promise((ok, bad) => { waiting.set('load', { ok, bad }); boot().postMessage({ type: 'load' }); });
    return loading.finally(() => { if (onProgress) progressFns.delete(onProgress); });
  }
  function gen(text, voice) {
    const id = ++seq;
    return load().then(() => new Promise((ok, bad) => { waiting.set(id, { ok, bad }); worker.postMessage({ type: 'gen', id, text, voice }); }));
  }
  // 16-bit mono WAV, so it plays in a normal audio element (which, unlike Web Audio, ignores the iPhone's silent switch).
  function wav(pcm, sr) {
    const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0, o = 44; i < n; i++, o += 2) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  const supported = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  const wasReady = () => { try { return localStorage.getItem(STATE_KEY) === '1'; } catch (e) { return false; } };
  window.HKokoro = { VOICES, load, gen, supported, isReady: () => ready, wasReady, name: id => (VOICES.find(v => v[0] === id) || [id, id])[1] };
})();
