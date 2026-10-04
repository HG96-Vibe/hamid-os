// Capital report: one month so far (1st to a given day) across every book (Personal, Augustova, PCTR).
// Used in two places, so they always match:
//   - the app's "Export report" button (money.js): preview, save as PDF, spreadsheet;
//   - the monthly email on the 30th (supabase/functions/capital-report, which carries a copy of this file).
// build(data, period) works out the figures; html(report) lays them out as an email-safe page (tables, inline styles).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneyReport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- small helpers (no dependencies) ---------- */
  const gbp = (p, o) => {
    const whole = o && o.whole, sign = p < 0 ? '−' : (o && o.plus && p > 0 ? '+' : '');
    const v = Math.abs(p) / 100;
    return sign + '£' + v.toLocaleString('en-GB', whole && Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = s => new Date(s + 'T12:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const monthStart = s => s.slice(0, 8) + '01';
  const addMonths = (s, n) => { const d = D(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
  const monthEnd = s => addDays(addMonths(s, 1), -1);
  const nice = (s, o) => D(s).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o));
  const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
  // the day the monthly email goes: the 30th, or the last day of a shorter month (February)
  const reportDay = ms => { const end = monthEnd(ms); return end.slice(8) < '30' ? end : ms.slice(0, 8) + '30'; };

  // direct debits: the same day n months on (31 Jan + 1 month = 28/29 Feb), and each payment between two dates
  function plusMonths(d, n) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  const nth = (p, k) => p.cadence === 'weekly' ? addDays(p.next_on, 7 * k) : plusMonths(p.next_on, k * ({ monthly: 1, quarterly: 3, yearly: 12 }[p.cadence] || 0));
  function datesIn(p, from, to) {
    if (p.cadence === 'once') return p.next_on >= from && p.next_on <= to ? [p.next_on] : [];
    const out = [];
    for (let k = 0, d = nth(p, 0); d <= to && k < 3000; d = nth(p, ++k)) if (d >= from) out.push(d);
    return out;
  }

  /* ---------- the figures ---------- */
  // data: { books:[{id,name,kind}], cats, tx (from the start of last month), planned, debts, debtPays, holdings, values }
  // period: { start: 'YYYY-MM-01', end: 'YYYY-MM-DD' (inclusive), made: ISO time }
  function build(data, period) {
    const { start, end } = period;
    const prevStart = addMonths(start, -1), prevEnd = addDays(start, -1);
    const books = data.books.map(b => {
      const tx = data.tx.filter(t => t.book_id === b.id);
      const cur = tx.filter(t => t.occurred_on >= start && t.occurred_on <= end);
      const prev = tx.filter(t => t.occurred_on >= prevStart && t.occurred_on <= prevEnd);
      const cats = data.cats.filter(c => c.book_id === b.id);
      const kindOf = name => (cats.find(c => c.name === name) || {}).kind || null;
      const inn = sum(cur.filter(t => t.amount_pence > 0), t => t.amount_pence), out = -sum(cur.filter(t => t.amount_pence < 0), t => t.amount_pence);
      // spending by category, against monthly budgets
      const spent = {};
      cur.filter(t => t.amount_pence < 0).forEach(t => { const k = t.category && kindOf(t.category) === 'out' ? t.category : 'Uncategorised'; spent[k] = (spent[k] || 0) - t.amount_pence; });
      const spend = Object.keys(spent).map(name => {
        const c = cats.find(x => x.name === name && x.kind === 'out');
        return { name, spent: spent[name], budget: c && c.budget_pence != null ? c.budget_pence : null };
      });
      cats.filter(c => c.kind === 'out' && c.budget_pence != null && !spent[c.name]).forEach(c => spend.push({ name: c.name, spent: 0, budget: c.budget_pence }));
      spend.sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
      const got = {};
      cur.filter(t => t.amount_pence > 0).forEach(t => { const k = t.category && kindOf(t.category) === 'in' ? t.category : 'Uncategorised'; got[k] = (got[k] || 0) + t.amount_pence; });
      const income = Object.keys(got).map(name => ({ name, amount: got[name] })).sort((a, b) => b.amount - a.amount);
      const budgeted = spend.filter(s => s.budget != null);
      return {
        id: b.id, name: b.name, personal: b.kind === 'personal',
        in: inn, out, net: inn - out, rate: inn ? Math.round((inn - out) / inn * 100) : null, count: cur.length,
        prev: { in: sum(prev.filter(t => t.amount_pence > 0), t => t.amount_pence), out: -sum(prev.filter(t => t.amount_pence < 0), t => t.amount_pence) },
        spend, income,
        budget: budgeted.length ? { total: sum(budgeted, s => s.budget), spent: sum(budgeted, s => s.spent), over: budgeted.filter(s => s.spent > s.budget).map(s => s.name) } : null,
        biggest: cur.filter(t => t.amount_pence < 0).sort((a, b) => a.amount_pence - b.amount_pence).slice(0, 5)
          .map(t => ({ date: t.occurred_on, description: t.description, category: t.category, amount: t.amount_pence })),
        uncategorised: cur.filter(t => !t.category).length
      };
    });

    // Personal extras: direct debits this month, loans, lending, net worth
    const personal = data.books.find(b => b.kind === 'personal');
    let extras = null;
    if (personal) {
      const paidKeys = new Set(data.tx.filter(t => t.import_key && t.import_key.startsWith('dd|')).map(t => t.import_key));
      const dds = [];
      (data.planned || []).filter(p => p.book_id === personal.id).forEach(p => datesIn(p, start, monthEnd(start)).forEach(d =>
        dds.push({ name: p.name, amount: p.amount_pence, date: d, paid: paidKeys.has(`dd|${p.id}|${d}`) })));
      dds.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
      const debts = (data.debts || []).filter(d => d.book_id === personal.id).map(d => {
        const paid = sum((data.debtPays || []).filter(x => x.debt_id === d.id && x.paid_on <= end), x => x.amount_pence);
        const paidMonth = sum((data.debtPays || []).filter(x => x.debt_id === d.id && x.paid_on >= start && x.paid_on <= end), x => x.amount_pence);
        return { name: d.name, direction: d.direction, amount: d.amount_pence, left: Math.max(0, d.amount_pence - paid), paidMonth, due: d.due_on };
      }).filter(d => d.left > 0 || d.paidMonth > 0);
      const valueAt = (h, day) => { let v = null; for (const x of (data.values || []).filter(x => x.holding_id === h.id)) if (x.valued_on <= day && (!v || x.valued_on >= v.valued_on)) v = x; return v ? v.value_pence : 0; };
      const holdings = (data.holdings || []).filter(h => !h.archived);
      const worthNow = sum(holdings, h => valueAt(h, end)), worthStart = sum(holdings, h => valueAt(h, addDays(start, -1)));
      extras = {
        dds, ddTotal: sum(dds, d => d.amount), ddPaid: sum(dds.filter(d => d.paid), d => d.amount),
        loans: debts.filter(d => d.direction === 'borrowed'), lending: debts.filter(d => d.direction === 'lent'),
        worth: holdings.length ? { now: worthNow, change: worthNow - worthStart, count: holdings.length } : null
      };
    }
    const all = { in: sum(books, b => b.in), out: sum(books, b => b.out) };
    all.net = all.in - all.out;
    return { start, end, made: period.made || new Date().toISOString(), books, all, extras, full: end >= reportDay(start) };
  }

  /* ---------- the page (email-safe: tables and inline styles only) ---------- */
  const INK = '#1e1b4b', MUTED = '#5b5f86', LINE = '#e6e6ef', IN = '#047857', OUT = '#4338ca', OVER = '#b91c1c', WARN = '#b45309';
  const F = 'Arial,Helvetica,sans-serif';
  const td = (v, s) => `<td style="padding:7px 6px;border-bottom:1px solid ${LINE};font:14px ${F};color:${INK};${s || ''}">${v}</td>`;
  const th = (v, s) => `<th style="padding:6px 6px;border-bottom:2px solid ${LINE};font:700 11px ${F};letter-spacing:.06em;text-transform:uppercase;color:${MUTED};text-align:left;${s || ''}">${v}</th>`;
  const R = 'text-align:right;white-space:nowrap';
  const RH = 'text-align:right'; // headings may wrap on a phone
  const table = (head, rows) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:4px 0 0">${head ? `<tr>${head}</tr>` : ''}${rows.join('')}</table>`;
  const h3 = t => `<div style="font:800 15px ${F};color:${INK};margin:18px 0 4px">${t}</div>`;
  const note = t => `<div style="font:13px ${F};color:${MUTED};margin:6px 0 0">${t}</div>`;
  const tile = (label, value, sub, edge) => `<td style="padding:5px;width:50%;vertical-align:top"><div style="background:#fff;border-radius:12px;padding:11px 13px;border-top:4px solid ${edge}"><div style="font:700 10.5px ${F};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${label}</div><div style="font:800 21px ${F};color:${INK};margin-top:3px;white-space:nowrap">${value}</div><div style="font:12px ${F};color:${MUTED};margin-top:2px">${sub}</div></div></td>`;
  const change = (now, before) => {
    if (!before) return '';
    const d = now - before, pct = Math.round(Math.abs(d) / before * 100);
    if (!d) return 'same as last month';
    return `${d > 0 ? '▲' : '▼'} ${pct}% vs last month`;
  };

  function bookSection(b, extras, r) {
    const out = [];
    const net = `${b.personal ? 'Left over' : 'Profit'}`;
    // two rows of two, so the boxes fit a phone screen in any email app
    out.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${tile('Money in', gbp(b.in), change(b.in, b.prev.in), IN)}
      ${tile('Money out', gbp(b.out), change(b.out, b.prev.out), OUT)}
    </tr><tr>
      ${tile(net, gbp(b.net, { plus: true }), b.net < 0 ? 'more out than in' : 'in minus out', b.net < 0 ? OVER : '#d97706')}
      ${tile(b.personal ? 'Saved' : 'Margin', b.rate == null ? '–' : b.rate + '%', b.personal ? 'of what came in' : 'of money in', '#a5b4fc')}
    </tr></table>`);
    if (!b.count) { out.push(note('No money in or out recorded yet this month.')); }
    if (b.spend.length) {
      out.push(h3('Where it went'));
      if (b.budget) out.push(note(`${gbp(b.budget.spent)} spent of ${gbp(b.budget.total, { whole: true })} budgeted${b.budget.over.length ? ` · <b style="color:${OVER}">over budget: ${b.budget.over.map(esc).join(', ')}</b>` : ' · all within budget'}`));
      out.push(table(th('Category') + th('Spent', RH) + th('Budget', RH) + th('Status', RH), b.spend.map(s => {
        let st = '<span style="color:' + MUTED + '">no budget</span>';
        if (s.budget != null) st = s.spent > s.budget ? `<b style="color:${OVER}">⚠ ${gbp(s.spent - s.budget)} over</b>`
          : s.budget && s.spent >= s.budget * .85 ? `<span style="color:${WARN}">${gbp(s.budget - s.spent)} left · nearly there</span>` : `${gbp(s.budget - s.spent)} left`;
        if (s.name === 'Uncategorised') st = `<span style="color:${MUTED}">not sorted yet</span>`;
        return `<tr>${td(esc(s.name))}${td(gbp(s.spent), R + ';font-weight:700')}${td(s.budget != null ? gbp(s.budget, { whole: true }) : '–', R)}${td(st, RH)}</tr>`;
      })));
    }
    if (b.income.length) {
      out.push(h3('Money in'));
      out.push(table(th('From') + th('Amount', RH), b.income.map(i => `<tr>${td(esc(i.name))}${td(gbp(i.amount), R + `;font-weight:700;color:${IN}`)}</tr>`)));
    }
    if (b.biggest.length) {
      out.push(h3('Biggest payments out'));
      out.push(table(th('Date') + th('Payment') + th('Category') + th('Amount', RH), b.biggest.map(t =>
        `<tr>${td(nice(t.date, { day: 'numeric', month: 'short' }), 'white-space:nowrap')}${td(esc(t.description))}${td(esc(t.category || '–'), 'color:' + MUTED)}${td(gbp(t.amount), R + ';font-weight:700')}</tr>`)));
    }
    if (b.uncategorised) out.push(note(`${b.uncategorised} payment${b.uncategorised === 1 ? '' : 's'} not sorted into a category yet.`));
    if (b.personal && extras) {
      if (extras.dds.length) {
        out.push(h3('Direct debits &amp; bills this month'));
        out.push(note(`${gbp(extras.ddPaid)} of ${gbp(extras.ddTotal)} ticked as paid.`));
        out.push(table(th('Due') + th('Bill') + th('Amount', RH) + th('Status', RH), extras.dds.map(d =>
          `<tr>${td(nice(d.date, { day: 'numeric', month: 'short' }), 'white-space:nowrap')}${td(esc(d.name))}${td(gbp(d.amount), R)}${td(d.paid ? `<b style="color:${IN}">✓ Paid</b>` : d.date <= r.end ? `<span style="color:${WARN}">Not ticked</span>` : `<span style="color:${MUTED}">Coming up</span>`, RH)}</tr>`)));
      }
      const debtTable = (list, title, leftWord) => {
        if (!list.length) return;
        out.push(h3(`${title}: ${gbp(sum(list, d => d.left))} ${leftWord}`));
        out.push(table(th('Who') + th('Left', RH) + th('Paid this month', RH) + th('Due', RH), list.map(d =>
          `<tr>${td(esc(d.name))}${td(d.left ? gbp(d.left) : `<b style="color:${IN}">Paid off</b>`, R + ';font-weight:700')}${td(d.paidMonth ? gbp(d.paidMonth) : '–', R)}${td(d.due ? (d.due < r.end && d.left ? `<b style="color:${OVER}">⚠ ${nice(d.due, { day: 'numeric', month: 'short', year: 'numeric' })}</b>` : nice(d.due, { day: 'numeric', month: 'short', year: 'numeric' })) : '–', R)}</tr>`)));
      };
      debtTable(extras.loans, 'Loans', 'left to pay');
      debtTable(extras.lending, 'Lending', 'to come back');
      if (extras.worth) {
        out.push(h3('Net worth'));
        out.push(note(`<b style="color:${INK};font-size:16px">${gbp(extras.worth.now)}</b> across ${extras.worth.count} investment${extras.worth.count === 1 ? '' : 's'} and account${extras.worth.count === 1 ? '' : 's'} · ${gbp(extras.worth.change, { plus: true })} since the start of the month`));
      }
    }
    return out.join('\n');
  }

  function html(r, opts) {
    const o = opts || {};
    const range = `${nice(r.start, { day: 'numeric' })}–${nice(r.end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const title = `Capital report · ${nice(r.start, { month: 'long', year: 'numeric' })}`;
    const overview = table(th('Book') + th('Money in', RH) + th('Money out', RH) + th('Left over', RH),
      r.books.map(b => `<tr>${td(`<b>${esc(b.name)}</b>`)}${td(gbp(b.in), R + `;color:${IN}`)}${td(gbp(b.out), R)}${td(gbp(b.net, { plus: true }), R + ';font-weight:700' + (b.net < 0 ? `;color:${OVER}` : ''))}</tr>`)
        .concat(r.books.length > 1 ? [`<tr>${td('<b>All books</b>', 'border-bottom:0')}${td(`<b>${gbp(r.all.in)}</b>`, R + `;border-bottom:0;color:${IN}`)}${td(`<b>${gbp(r.all.out)}</b>`, R + ';border-bottom:0')}${td(`<b>${gbp(r.all.net, { plus: true })}</b>`, R + ';border-bottom:0' + (r.all.net < 0 ? `;color:${OVER}` : ''))}</tr>`] : []));
    const sections = r.books.map(b => `<tr><td style="padding:20px 16px 4px"><div style="font:800 20px ${F};color:${INK};border-bottom:3px solid #d97706;padding-bottom:6px">${esc(b.name)}</div>${bookSection(b, r.extras, r)}</td></tr>`).join('\n');
    const footer = o.app ? `<tr><td style="padding:18px 22px 24px" align="center"><a href="${o.app}/#capital" style="display:inline-block;background:#d97706;color:#fff;font:700 15px ${F};text-decoration:none;padding:12px 24px;border-radius:999px">Open Capital →</a>
      <div style="margin-top:10px;font:12px ${F};color:${MUTED}">Sent on the 30th of each month (the last day in February). Figures are what you’ve logged and imported, from the 1st to ${nice(r.end, { day: 'numeric', month: 'long' })}.</div></td></tr>` :
      `<tr><td style="padding:16px 22px 22px;font:12px ${F};color:${MUTED}">Figures are what you’ve logged and imported, from the 1st to ${nice(r.end, { day: 'numeric', month: 'long' })}. Made ${new Date(r.made).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.</td></tr>`;
    return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>@media print{body{background:#fff!important;padding:0!important}.wrap{max-width:none!important;border-radius:0!important}tr,table{page-break-inside:avoid}@page{margin:14mm}}</style></head>
<body style="margin:0;background:#1e1b4b;padding:20px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table class="wrap" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#f6f6f2;border-radius:18px;overflow:hidden">
<tr><td style="background:#312e81;padding:20px 16px 16px;border-bottom:4px solid #d97706">
  <div style="font:700 12px ${F};letter-spacing:.14em;text-transform:uppercase;color:#fde68a">Hamid OS · Capital</div>
  <div style="font:800 27px/1.15 ${F};color:#fff;margin-top:6px">${esc(nice(r.start, { month: 'long', year: 'numeric' }))}${r.full ? '' : ' so far'}</div>
  <div style="font:15px ${F};color:#c7d2fe;margin-top:4px">${range} · Personal, ${r.books.filter(b => !b.personal).map(b => esc(b.name)).join(' and ') || 'all books'}</div>
</td></tr>
<tr><td style="padding:16px 16px 0">${h3('All books at a glance')}${overview}</td></tr>
${sections}
${footer}
</table></td></tr></table></body></html>`;
  }

  // the subject line for the email
  const subject = r => `Capital · ${nice(r.start, { month: 'long' })}${r.full ? '' : ' so far'}: ${gbp(r.all.in)} in, ${gbp(r.all.out)} out`;

  // every payment from the period as a spreadsheet (CSV, opens in Excel / Numbers)
  function csv(data, period) {
    const name = id => (data.books.find(b => b.id === id) || {}).name || '';
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = data.tx.filter(t => t.occurred_on >= period.start && t.occurred_on <= period.end)
      .sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : name(a.book_id).localeCompare(name(b.book_id))))
      .map(t => [name(t.book_id), t.occurred_on, t.description, t.category || 'Uncategorised', (t.amount_pence / 100).toFixed(2), t.amount_pence > 0 ? 'In' : 'Out', t.note || '', t.source === 'import' ? 'Imported' : 'Added by hand'].map(cell).join(','));
    return '\ufeff' + ['Book,Date,Description,Category,Amount (£),In / out,Note,Source', ...rows].join('\r\n') + '\r\n';
  }

  return { build, html, csv, subject, reportDay, datesIn, gbp };
});
