// Runs the Kokoro voice (open source, Apache 2.0) in the background so the page stays smooth.
// The model (~86 MB) and the voices download from Hugging Face the first time and are then kept by the browser.
import { KokoroTTS } from './vendor/kokoro-1.2.1.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null, loading = null;

async function load() {
  if (tts) return tts;
  if (!loading) {
    const files = {};
    loading = KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: p => {
      if (p.status === 'progress' && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        self.postMessage({ type: 'progress', loaded, total });
      }
    } }).then(t => { tts = t; return t; }, e => { loading = null; throw e; });
  }
  return loading;
}

self.onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    try { await load(); self.postMessage({ type: 'ready' }); }
    catch (e) { self.postMessage({ type: 'failed', message: String((e && e.message) || e) }); }
  }
  if (m.type === 'gen') {
    try {
      const t = await load(), t0 = performance.now();
      const a = await t.generate(m.text, { voice: m.voice, speed: 1 });
      const pcm = a.audio instanceof Float32Array ? a.audio : new Float32Array(a.audio);
      self.postMessage({ type: 'audio', id: m.id, pcm, sr: a.sampling_rate || 24000, ms: performance.now() - t0 }, [pcm.buffer]);
    } catch (e) { self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) }); }
  }
};
