// Capital extras (no screen of their own; money.js uses them):
//   readReceipt(file)  → reads a receipt photo on this device (tesseract.js, nothing is uploaded) and finds the total,
//                        the date and the shop's name.
//   parseReceipt(text) → the same, from text (also used by tests).
//   findSubscriptions(tx, planned, today) → payments that repeat (same shop, similar amount, about weekly / monthly /
//                        quarterly / yearly) and aren't already in your direct debits.
(function (root) {
  'use strict';
  const T = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/';
  const pad = n => String(n).padStart(2, '0');
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);

  /* ---------- receipts ---------- */
  function parseReceipt(text, today) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const money = l => [...l.matchAll(/(?:£|GBP\s?)?\s?(\d{1,4}(?:,\d{3})*[.,]\d{2})(?!\d)/g)].map(m => Math.round(parseFloat(m[1].replace(/,(?=\d{3})/g, '').replace(',', '.')) * 100));
    let pence = null, why = '';
    // the total: the last line that says total / amount due / to pay / card (not subtotal, VAT or change)
    const totals = lines.filter(l => /\b(total|amount due|balance due|to pay|amount|card|visa|mastercard|contactless|paid)\b/i.test(l) && !/sub\s?-?total|vat|tax|change|saving|discount|points|tip/i.test(l) && money(l).length);
    const best = totals.find(l => /\btotal\b/i.test(l) && !/sub/i.test(l)) || totals[totals.length - 1];
    if (best) { pence = money(best).pop(); why = 'total'; }
    if (!pence) { const all = lines.flatMap(money).filter(p => p > 0 && p < 1e7); if (all.length) { pence = Math.max(...all); why = 'largest'; } }
    // the date
    let date = null;
    const t0 = today || new Date().toISOString().slice(0, 10);
    for (const l of lines) {
      let m = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(l);
      if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const d = `${y}-${pad(+m[2])}-${pad(+m[1])}`; if (!isNaN(Date.parse(d)) && +m[2] <= 12) { date = d; break; } }
      m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(\d{2,4})\b/i.exec(l);
      if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; date = `${y}-${pad(MON[m[2].toLowerCase()])}-${pad(+m[1])}`; break; }
      m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(l);
      if (m) { date = `${m[1]}-${m[2]}-${m[3]}`; break; }
    }
    if (date && (date > t0 || daysBetween(date, t0) > 400)) date = null; // misread
    // the shop: the first line that reads like a name
    const skip = /receipt|invoice|vat|tel|phone|www\.|http|@|\d{3,}|thank|welcome|customer|copy|store\s*no|till|cashier|date|time/i;
    const nameLine = lines.slice(0, 8).find(l => /[a-z]{3,}/i.test(l) && !skip.test(l) && l.length <= 40);
    const shop = nameLine ? nameLine.replace(/[^\w&' .-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '';
    return { pence, date, shop, why };
  }
  function loadScript(src) {
    return new Promise((ok, bad) => { if (root.Tesseract) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Couldn’t load the receipt reader. Check your connection.')); document.head.append(s); });
  }
  // smaller photos read faster and just as well
  async function shrink(file, max = 1800) {
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.25)'; g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.9));
    } catch (e) { return file; }
  }
  async function readReceipt(file, onProgress) {
    await loadScript(T + 'tesseract.min.js');
    const worker = await root.Tesseract.createWorker('eng', 1, {
      workerPath: T + 'worker.min.js', corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1', langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int',
      logger: m => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.status, m.progress); } });
    try {
      const { data } = await worker.recognize(await shrink(file));
      return { text: data.text || '', ...parseReceipt(data.text || '') };
    } finally { worker.terminate(); }
  }

  /* ---------- subscriptions ---------- */
  // tx: [{ occurred_on, amount_pence, description, category }], planned: [{ name }]; key(desc) → shop key
  function findSubscriptions(tx, planned, today, key) {
    const k = key || (d => String(d || '').toLowerCase().replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '));
    const have = (planned || []).map(p => k(p.name)).filter(Boolean);
    const groups = {};
    (tx || []).filter(t => t.amount_pence < 0).forEach(t => { const g = k(t.description); if (g) (groups[g] ||= []).push(t); });
    const CAD = [['weekly', 7, 2], ['monthly', 30.4, 4], ['quarterly', 91, 10], ['yearly', 365, 20]];
    const out = [];
    for (const [g, list] of Object.entries(groups)) {
      if (have.some(h => h && (h === g || h.includes(g) || g.includes(h)))) continue;
      const ls = list.slice().sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1));
      // one per date at most (two coffees the same day aren't a pattern)
      const byDay = []; ls.forEach(t => { if (!byDay.length || byDay[byDay.length - 1].occurred_on !== t.occurred_on) byDay.push(t); });
      if (byDay.length < 2) continue;
      const gaps = byDay.slice(1).map((t, i) => daysBetween(byDay[i].occurred_on, t.occurred_on));
      const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      const cad = CAD.find(([, d, tol]) => Math.abs(med - d) <= tol);
      if (!cad) continue;
      const need = cad[0] === 'weekly' ? 4 : cad[0] === 'monthly' ? 3 : 2;
      const regular = gaps.filter(x => Math.abs(x - cad[1]) <= cad[2]).length;
      if (byDay.length < need || regular < Math.ceil(gaps.length * 0.7)) continue;
      const amts = byDay.map(t => -t.amount_pence), last = byDay[byDay.length - 1];
      const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
      if (amts.some(a => Math.abs(a - avg) > Math.max(150, avg * 0.15))) continue; // amounts must be steady
      // still going: the last one is no older than two cycles
      if (daysBetween(last.occurred_on, today) > cad[1] * 2 + cad[2]) continue;
      let next = last.occurred_on;
      while (next <= today) next = cad[0] === 'weekly' ? addDays(next, 7) : (() => { const [y, m, d] = next.split('-').map(Number); const add = { monthly: 1, quarterly: 3, yearly: 12 }[cad[0]]; const mm = m - 1 + add, yy = y + Math.floor(mm / 12), mo = (mm % 12) + 1, last2 = new Date(Date.UTC(yy, mo, 0)).getUTCDate(); return `${yy}-${pad(mo)}-${pad(Math.min(d, last2))}`; })();
      out.push({ key: g, name: last.description.replace(/\s+/g, ' ').trim().slice(0, 80), amount_pence: -last.amount_pence, cadence: cad[0], count: byDay.length, last_on: last.occurred_on, next_on: next, category: last.category || null });
    }
    return out.sort((a, b) => b.amount_pence - a.amount_pence);
  }

  const api = { parseReceipt, readReceipt, findSubscriptions };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MoneyX = api;
})(typeof self !== 'undefined' ? self : this);
