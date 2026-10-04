// Money tab: the careful parts, kept separate so they can be tested on their own.
// Amounts are whole pence (integers) everywhere: money in is positive, money out negative.
(function (root) {
  'use strict';

  /* ---------- pounds ---------- */
  // "£1,234.56", "-12.50", "(12.50)", "12.5", "12.50 DR", "1234" -> pence (or null)
  function parseAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let sign = 1;
    if (/\b(DR|debit)\b/i.test(s)) { sign = -1; s = s.replace(/\b(DR|debit)\b/ig, ''); }
    if (/\b(CR|credit)\b/i.test(s)) s = s.replace(/\b(CR|credit)\b/ig, '');
    if (/^\(.*\)$/.test(s.trim())) { sign = -sign; s = s.trim().slice(1, -1); }
    s = s.replace(/[£$€\s ]|GBP/gi, '');
    if (/^[+-]?-/.test(s) || /^-/.test(s)) { sign = -sign; s = s.replace(/^[+-]?-/, '').replace(/^-/, ''); }
    else s = s.replace(/^\+/, '');
    if (/-$/.test(s)) { sign = -sign; s = s.slice(0, -1); } // "12.50-"
    // comma for the pence (European statements): "12,50", "1.234,56"
    if (/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    s = s.replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
    const [w, f = ''] = s.split('.');
    const pence = (parseInt(w || '0', 10) * 100) + parseInt((f + '00').slice(0, 2), 10);
    return sign * pence;
  }
  // pence -> "£1,234.56" (or "−£12.50"); whole: drop the pence when they're .00
  function gbp(p, opts) {
    const whole = opts && opts.whole, sign = p < 0 ? '−' : (opts && opts.plus && p > 0 ? '+' : '');
    const v = Math.abs(p) / 100;
    const s = v.toLocaleString('en-GB', whole && Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sign + '£' + s;
  }

  /* ---------- dates ---------- */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  const ok = (y, m, d) => {
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  const year = y => (y < 100 ? 2000 + y : y);
  // order: 'dmy' (UK, the default) or 'mdy'
  function parseDate(raw, order) {
    if (raw == null) return null;
    const s = String(raw).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) return ok(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s.*)?$/))) return ok(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?:[T\s,].*)?$/))) {
      const a = +m[1], b = +m[2], y = year(+m[3]);
      return order === 'mdy' ? ok(y, a, b) : ok(y, b, a);
    }
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]([A-Za-z]{3,9})[\s\-,]*(\d{2}|\d{4})(?:\s.*)?$/))) {
      const mo = MON[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)];
      return mo ? ok(year(+m[3]), mo, +m[1]) : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mo = MON[m[1].toLowerCase().slice(0, 3)];
      return mo ? ok(+m[3], mo, +m[2]) : null;
    }
    return null;
  }
  // which way round a column of dates is: UK day-first unless a value only works month-first
  function dateOrder(values) {
    let dmy = 0, mdy = 0;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]/);
      if (!m) continue;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    }
    return mdy > dmy ? 'mdy' : 'dmy';
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
    return rows;
  }

  // Work out which columns hold the date, the description and the amount (or money out / money in).
  const H = {
    date: /(^|\b)(transaction\s*)?date\b|^completed date|^started date|^posted/i,
    desc: /description|^name$|counter\s*party|merchant|payee|details|narrative|^memo$|reference|^transaction$|^particulars/i,
    amount: /^(amount|value|transaction amount|amount \(gbp\)|amount gbp|net amount)$/i,
    out: /paid out|money out|debit|withdrawal|spent|^\W*out\W*$/i,
    in: /paid in|money in|credit|deposit|received|^in$/i,
    skip: /balance|currency|fee|^type$|category|emoji|notes|address|receipt|^time$|state|product|account|^number$|sort code/i
  };
  function detect(rows) {
    // the header row: the first row (among the first 15) with at least two header-looking cells
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i], hits = r.filter(c => H.date.test(c) || H.desc.test(c) || H.amount.test(c) || H.out.test(c) || H.in.test(c)).length;
      if (hits >= 2 && !r.some(c => parseDate(c) && /\d/.test(c))) { hi = i; break; }
    }
    // a header in words we don't know (e.g. Datum;Omschrijving;Bedrag): a first row of plain words above rows of data
    const plain = r => r.every(c => !parseDate(c) && !parseDate(c, 'mdy') && parseAmount(c) == null);
    if (hi < 0 && rows.length > 1 && plain(rows[0]) && !plain(rows[1])) hi = 0;
    const header = hi >= 0 ? rows[hi] : null;
    const body = rows.slice(hi + 1).filter(r => r.length > 1);
    const width = Math.max(0, ...body.slice(0, 50).map(r => r.length), header ? header.length : 0);
    const sample = body.slice(0, 60);
    const col = i => sample.map(r => r[i] || '');
    const rate = (i, f) => { const v = col(i).filter(x => x !== ''); return v.length ? v.filter(f).length / v.length : 0; };
    const names = Array.from({ length: width }, (_, i) => (header && header[i]) || `Column ${i + 1}`);
    const isSkip = i => header && H.skip.test(header[i] || '') && !H.amount.test(header[i] || '') && !H.out.test(header[i] || '') && !H.in.test(header[i] || '');
    const pick = (re, cond) => { for (let i = 0; i < width; i++) if (header && re.test(header[i] || '') && (!cond || cond(i))) return i; return -1; };
    const anyDate = v => parseDate(v) || parseDate(v, 'mdy'); // UK or US order
    let date = pick(H.date, i => rate(i, anyDate) > .6);
    if (date < 0) { for (let i = 0; i < width; i++) if (rate(i, anyDate) > .8) { date = i; break; } }
    // one signed Amount column wins (Monzo has both); otherwise separate money out / money in columns
    let amount = pick(H.amount, i => rate(i, v => parseAmount(v) != null) > .6);
    let out = amount >= 0 ? -1 : pick(H.out, i => rate(i, v => parseAmount(v) != null) > .3), inn = amount >= 0 ? -1 : pick(H.in, i => rate(i, v => parseAmount(v) != null) > .3);
    if (amount < 0 && !(out >= 0 && inn >= 0)) {
      out = inn = -1;
      // no header help: the most numeric non-date column that isn't a running balance
      let best = -1, score = 0;
      for (let i = 0; i < width; i++) {
        if (i === date || isSkip(i)) continue;
        const r = rate(i, v => parseAmount(v) != null);
        if (r > score + .01) { best = i; score = r; }
      }
      if (score > .6) amount = best;
    }
    let desc = pick(H.desc, i => i !== date && i !== amount);
    if (desc < 0) {
      let best = -1, len = 0;
      for (let i = 0; i < width; i++) {
        if (i === date || i === amount || i === out || i === inn) continue;
        const avg = col(i).reduce((a, v) => a + (parseAmount(v) == null && !parseDate(v) ? v.length : 0), 0) / (sample.length || 1);
        if (avg > len) { len = avg; best = i; }
      }
      desc = best;
    }
    return { header: hi, names, date, desc, amount, out, inn, order: date >= 0 ? dateOrder(col(date)) : 'dmy' };
  }

  // Turn rows into transactions with the chosen columns. flip: the bank shows spending as positive.
  function toTx(rows, map) {
    const out = [], skipped = [];
    const seen = {};
    rows.slice(map.header + 1).forEach((r, i) => {
      const date = parseDate(r[map.date], map.order);
      let p = null;
      if (map.amount >= 0) p = parseAmount(r[map.amount]);
      else {
        const o = parseAmount(r[map.out]), n = parseAmount(r[map.inn]);
        if (o) p = -Math.abs(o); else if (n) p = Math.abs(n);
      }
      if (p != null && map.flip) p = -p;
      const desc = String(r[map.desc] || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!date || !p) { if (r.some(c => c)) skipped.push(i + map.header + 2); return; }
      const base = `${date}|${p}|${desc.toLowerCase()}`;
      seen[base] = (seen[base] || 0) + 1; // the same coffee twice in a day stays two lines
      out.push({ occurred_on: date, amount_pence: p, description: desc || '(no description)', import_key: (base + '|' + seen[base]).slice(0, 400) });
    });
    return { tx: out, skipped };
  }

  /* ---------- quick add: "12.50 lunch", "lunch £12.50", "+2000 salary", "spent 30 on petrol" ---------- */
  const IN_WORDS = /\b(salary|wage|wages|paid me|received|refund|income|invoice paid|payment from|dividend|interest|cashback)\b/i;
  function quick(text) {
    const s = String(text || '').trim();
    const m = s.match(/(^|\s)([+-]?)\s*£?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?:\s*(k))?(?=\s|$)/i);
    if (!m) return { pence: null, desc: s, income: false };
    let pence = parseAmount(m[3]);
    if (m[4]) pence *= 1000;
    const explicit = m[2] === '+' ? 'in' : m[2] === '-' ? 'out' : null;
    let desc = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    desc = desc.replace(/^(spent|paid|bought|for|on)\s+/i, '').replace(/^(on|for)\s+/i, '').replace(/\s+(on|for)$/i, '').trim();
    const income = explicit ? explicit === 'in' : IN_WORDS.test(desc);
    return { pence, desc, income };
  }

  /* ---------- recognising shops ---------- */
  // "CARD PAYMENT TO TESCO STORES 3245 ON 04-10" -> "tesco stores"
  function merchantKey(desc) {
    let s = String(desc || '').toLowerCase();
    s = s.replace(/\b(card payment to|card payment|contactless payment|contactless|payment to|direct debit to|direct debit|standing order to|standing order|faster payment to|faster payment|bill payment to|pos|visa|debit card|purchase|dd|so|bgc|fpo|fpi|tfr|cpt|vis|bp|on \d{1,2}[\/\-]\d{1,2}.*|ref.*$)\b/g, ' ');
    s = s.replace(/https?:\/\/\S+|www\.\S+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.split(' ').filter(w => w.length > 1 || w === '&').slice(0, 3).join(' ').slice(0, 120);
  }
  // a first guess, before you've taught it anything (only used when the category exists in the book)
  const GUESS = [
    [/tesco|sainsbury|asda|aldi|lidl|morrisons|waitrose|co-?op|ocado|iceland|m&s food|marks.*spencer.*food|grocer/, 'Groceries'],
    [/pret|costa|starbucks|caffe nero|greggs|mcdonald|kfc|nando|deliveroo|just eat|uber eats|restaurant|cafe|coffee|pizza|burger|wagamama|lunch|dinner|breakfast/, 'Eating out'],
    [/netflix|spotify|apple\.com|icloud|amazon prime|prime video|disney|youtube premium|now tv|audible|subscription|chatgpt|openai|adobe|microsoft 365/, 'Subscriptions'],
    [/\btfl\b|\buber\b(?! eats)|\bbolt\b|trainline|national rail|\blner\b|avanti|\bgwr\b|petrol|\bshell\b|\besso\b|\bbp\b|texaco|parking|ringgo|\bbus\b|\btrain\b|\btaxi\b|\bfuel\b/, 'Transport'],
    [/amazon|amzn|ebay|argos|asos|zara|h&m|primark|john lewis|ikea|currys|shopping/, 'Shopping'],
    [/rent|mortgage|landlord/, 'Rent & mortgage'],
    [/council tax|british gas|octopus|edf|e\.on|ovo|thames water|water|electric|gas bill|bt |sky |virgin media|vodafone|ee |o2|three|giffgaff|tv licen|insurance|broadband|phone bill|bills?/, 'Bills'],
    [/boots|superdrug|pharmacy|gym|puregym|the gym|nhs|dentist|doctor|optician/, 'Health'],
    [/cinema|odeon|cineworld|vue|ticketmaster|steam|playstation|xbox|nintendo|concert/, 'Entertainment'],
    [/hotel|airbnb|booking\.com|easyjet|ryanair|british airways|jet2|expedia|flight/, 'Travel'],
    [/salary|payroll|wages/, 'Salary'],
    [/google ads|meta ads|facebook ads|linkedin ads|advert|marketing/, 'Marketing'],
    [/github|vercel|supabase|aws|google workspace|notion|figma|slack|zoom|canva|software|hosting|domain|namecheap|godaddy/, 'Software & tools'],
    [/hmrc|vat|corporation tax/, 'Tax'],
    [/stripe|paypal fee|bank fee|charge|commission/, 'Fees'],
    [/invoice|client|sales|stripe payout|payout/, 'Sales']
  ];
  function guess(desc, names) {
    const s = String(desc || '').toLowerCase();
    for (const [re, cat] of GUESS) if (re.test(s) && names.includes(cat)) return cat;
    return null;
  }

  /* ---------- PDF statements ----------
     A PDF has no table, just words placed on the page. pdfRows rebuilds the table from where they sit:
     it finds the heading line (Date, Description, Paid out, Paid in, Balance…), puts each word under the
     heading it lines up with, joins descriptions that run onto a second line, fills in a date left blank
     because it's the same day as the line above, and adds the year to dates printed without one ("4 Oct").
     pages: [[{ str, x, y, w }]] with y measured down the page. Returns rows (the first is the headings)
     for detect / toTx, like a CSV. With no heading line it falls back to reading lines that start with a date. */
  const MONEY = /^[-+(]?[£$€]?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?(?:\s?(?:CR|DR|-))?$|^[-+(]?[£$€]?\s?\d+\.\d{2}\)?(?:\s?(?:CR|DR|-))?$/i;
  const DAYMON = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?$/;
  function pdfLines(items) {
    const its = items.filter(i => String(i.str).trim()).map(i => ({ str: String(i.str).trim(), x: i.x, y: i.y, w: i.w || String(i.str).length * 4.5 }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of its) {
      const L = lines.find(l => Math.abs(l.y - it.y) <= 3);
      if (L) L.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    return lines.sort((a, b) => a.y - b.y);
  }
  // words close together form one cell; a wider gap starts the next
  function cells(items, gap = 7) {
    const out = [];
    for (const it of items) {
      const c = out[out.length - 1];
      if (c && it.x - (c.x1) <= gap) { c.str += ' ' + it.str; c.x1 = Math.max(c.x1, it.x + it.w); }
      else out.push({ str: it.str, x0: it.x, x1: it.x + it.w });
    }
    return out;
  }
  const HEADWORD = /^(date|transaction date|posting date|posted|description|details|transaction|transactions|payee|particulars|narrative|memo|reference|type|paid out|paid in|money out|money in|debit|credit|debits|credits|withdrawals?|deposits?|out|in|amount|balance|value|£out|£in)\b/i;
  function isHeading(line) {
    const cs = cells(line.items), t = cs.map(c => c.str.toLowerCase());
    return t.some(x => /\bdate\b/.test(x)) && cs.filter(c => HEADWORD.test(c.str.replace(/[£()]/g, '').trim())).length >= 3;
  }
  const cleanHead = s => s.replace(/\(?£\)?|\(GBP\)|GBP/gi, ' ').replace(/\s+/g, ' ').trim();
  function pdfRows(pages, opts) {
    const o = opts || {};
    let cols = null; const rows = [];
    let last = null, lastDate = '';
    const allText = [];
    for (const page of pages) {
      const lines = pdfLines(page);
      lines.forEach(l => allText.push(l.items.map(i => i.str).join(' ')));
      for (const line of lines) {
        if (isHeading(line)) { cols = cells(line.items).map(c => ({ name: cleanHead(c.str), x0: c.x0, x1: c.x1 })); last = null; continue; }
        if (!cols) continue;
        // each word goes under the heading it overlaps most, or the nearest one
        const vals = cols.map(() => []);
        for (const it of line.items) {
          let best = 0, bestScore = -Infinity;
          cols.forEach((c, i) => {
            const ov = Math.min(c.x1, it.x + it.w) - Math.max(c.x0, it.x);
            const score = ov > 0 ? ov : -Math.min(Math.abs(c.x0 - it.x), Math.abs(c.x1 - (it.x + it.w)), Math.abs((c.x0 + c.x1) / 2 - (it.x + it.w / 2)));
            if (score > bestScore) { bestScore = score; best = i; }
          });
          vals[best].push(it.str);
        }
        const row = vals.map(v => v.join(' ').trim());
        const di = cols.findIndex(c => /date|posted/i.test(c.name));
        const money = cols.map((c, i) => i !== di && !/desc|detail|transaction|payee|particular|narrative|memo|reference|type/i.test(c.name) && MONEY.test(row[i]));
        const hasMoney = money.some(Boolean), hasDate = di >= 0 && !!row[di];
        if (hasDate || hasMoney) {
          if (di >= 0) { if (hasDate) lastDate = row[di]; else row[di] = lastDate; }
          rows.push(row); last = row;
        } else if (last) {
          // a description running onto the next line (but not page totals or footers)
          const di2 = cols.findIndex(c => /desc|detail|transaction|payee|particular|narrative|memo/i.test(c.name));
          const extra = row.filter(Boolean).join(' ');
          if (di2 >= 0 && extra && !/carried forward|brought forward|total|page \d|continued/i.test(extra) && extra.length < 120) last[di2] = (last[di2] + ' ' + extra).trim();
        }
      }
    }
    let out;
    if (cols && rows.length) out = [cols.map(c => c.name), ...rows];
    else out = pdfFallback(pages);
    return fillYears(out, o.year || mainYear(allText.join(' ')), o.today);
  }
  // no heading line: lines that start with a date and end in money ("04 Oct  Tesco  12.50  1,234.56")
  function pdfFallback(pages) {
    const rows = [];
    for (const page of pages) for (const line of pdfLines(page)) {
      const cs = cells(line.items), words = cs.map(c => c.str);
      if (!words.length) continue;
      const first = words[0];
      if (!(parseDate(first) || parseDate(first, 'mdy') || DAYMON.test(first))) continue;
      const nums = []; let i = words.length - 1;
      while (i > 0 && MONEY.test(words[i]) && nums.length < 2) nums.unshift(words[i--]);
      if (!nums.length) continue;
      rows.push([first, words.slice(1, i + 1).join(' '), nums[0], nums[1] || '']);
    }
    if (!rows.length) return [];
    // a running balance tells us which way each amount went
    const bal = rows.map(r => parseAmount(r[3]));
    for (let k = 1; k < rows.length; k++) {
      const a = Math.abs(parseAmount(rows[k][2]) || 0);
      if (bal[k] != null && bal[k - 1] != null && a && Math.abs(Math.abs(bal[k] - bal[k - 1]) - a) <= 1) rows[k][2] = (bal[k] < bal[k - 1] ? '-' : '') + (a / 100).toFixed(2);
      else if (!/^[-(+]|CR$/i.test(rows[k][2].trim())) rows[k][2] = '-' + rows[k][2].replace(/^-/, '');
    }
    if (!/^[-(+]|CR$/i.test(rows[0][2].trim())) rows[0][2] = '-' + rows[0][2];
    return [['Date', 'Description', 'Amount', 'Balance'], ...rows];
  }
  function mainYear(text) {
    const n = {}; (String(text).match(/\b20\d{2}\b/g) || []).forEach(y => { n[y] = (n[y] || 0) + 1; });
    const best = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    return best ? +best : new Date().getFullYear();
  }
  // "4 Oct" → "4 Oct 2026" (a December line in a statement that runs into January gets the year before)
  function fillYears(rows, year, today) {
    if (!rows.length) return rows;
    const di = rows[0].findIndex(h => /date|posted/i.test(String(h)));
    if (di < 0) return rows;
    const now = today || new Date().toISOString().slice(0, 10);
    const months = rows.slice(1).map(r => { const m = String(r[di] || '').trim().match(DAYMON); return m ? m[2].toLowerCase().slice(0, 3) : null; });
    const hasJan = months.includes('jan');
    rows.slice(1).forEach((r, k) => {
      const m = String(r[di] || '').trim().match(DAYMON); if (!m) return;
      let y = year;
      if (hasJan && months[k] === 'dec') y = year - 1;
      let d = parseDate(`${m[1]} ${m[2]} ${y}`);
      if (d && d > now && parseDate(`${m[1]} ${m[2]} ${y - 1}`)) { y -= 1; d = parseDate(`${m[1]} ${m[2]} ${y}`); }
      if (d) r[di] = `${m[1]} ${m[2]} ${y}`;
    });
    return rows;
  }

  const DEFAULTS = {
    personal: {
      out: ['Groceries', 'Eating out', 'Transport', 'Bills', 'Rent & mortgage', 'Subscriptions', 'Shopping', 'Health', 'Entertainment', 'Travel', 'Gifts', 'Other'],
      in: ['Salary', 'Transfers in', 'Refunds', 'Other income']
    },
    business: {
      out: ['Software & tools', 'Marketing', 'Contractors', 'Equipment', 'Travel', 'Fees', 'Tax', 'Office', 'Other'],
      in: ['Sales', 'Clients', 'Other income']
    }
  };

  const api = { parseAmount, gbp, parseDate, dateOrder, parseCSV, detect, toTx, quick, merchantKey, guess, pdfRows, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoneyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
