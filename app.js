(() => {
'use strict';
const SUPABASE_URL = 'https://xxvsosusnqnrgdigqfyw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2gtV8CTvawIZCMcy8idg6g_T_l_1nvj';
const VAPID_PUBLIC = 'BHCylmF0u_AgxSX8duDUF41EZu7jJMufL1U72Vc_0RBQ9wdqE6Pq3d_KRul8CDLJOfyGNnDrjko3-6PYYtUo4Ck';
if (location.hash.includes('type=recovery')) { try { sessionStorage.setItem('ds_recovery', '1'); } catch (e) {} }
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true } });
const app = document.getElementById('app');
const CONTEXTS = ['Augustova', 'GoRizzume', 'PCT', 'Personal'];

/* ---------- small helpers ---------- */
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const monthStart = s => s.slice(0, 8) + '01';
const addMonths = (s, n) => { const d = parse(s); d.setDate(1); d.setMonth(d.getMonth() + n); return iso(d); };
const fmt = (s, o) => parse(s).toLocaleDateString('en-GB', o);
const dayName = s => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = s => fmt(s, { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = s => fmt(s, { month: 'long', year: 'numeric' });
const timeAgo = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { toast(error.message || 'Something went wrong. Try again.'); throw error; }
  return data;
}
function ctxColor(name) {
  const hues = [222, 160, 28, 280, 345, 190, 95];
  let h = 0; for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hues[h % hues.length]} 55% 45%)`;
}

/* ---------- state ---------- */
const state = {
  user: null,
  view: 'today',
  cursor: today(),
  open: new Set(),
  focusAdd: null,
  lastCtx: store('ds_ctx') || ''
};
const uid = () => state.user.id;

/* ---------- auth flow ---------- */
async function route() {
  // No internet: open straight to the music saved on this Mac (listen.js), since signing in needs a connection.
  if (navigator.onLine === false) {
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    if (window.DS?.offlineView) return window.DS.offlineView();
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  state.user = session.user;
  const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return renderLogin(error.message);
  if (aal.currentLevel === 'aal2') { let rec = null; try { rec = sessionStorage.getItem('ds_recovery'); } catch (e) {} return rec ? renderNewPassword() : renderApp(); }
  if (aal.nextLevel === 'aal2') return renderChallenge();
  return renderEnroll();
}

function authShell(...kids) {
  app.replaceChildren(el('div', { class: 'auth' }, el('div', { class: 'authcard' }, ...kids)));
}

function renderLogin(errMsg, mode = 'signin') {
  const email = el('input', { class: 'field', type: 'email', autocomplete: 'username', required: true, id: 'em' });
  const pw = mode === 'forgot' ? null : el('input', { class: 'field', type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: '10', id: 'pw' });
  const err = el('p', { class: 'err', role: 'alert' }, errMsg || '');
  const label = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode];
  const btn = el('button', { class: 'btn primary', type: 'submit' }, label);
  const form = el('form', { class: 'authcard', onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
        if (error) throw error;
        await route();
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + '/' });
        if (error) throw error;
        err.textContent = '';
        renderLogin('If that email has an account, a reset link is on its way. Open it, enter your authenticator code, then choose a new password.');
      } else {
        if (pw.value.length < 10) throw new Error('Use at least 10 characters for your password.');
        const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pw.value, options: { emailRedirectTo: location.origin } });
        if (error) throw new Error(/database error|not allowed|disabled/i.test(error.message) ? 'Sign-ups are closed. This sheet already has an owner.' : error.message);
        if (data.session) await route();
        else renderLogin('Check your inbox and click the confirmation link, then sign in here.');
      }
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    el('h1', {}, 'Daily Sheet'),
    el('p', {}, { signin: 'Sign in to open your sheet.', signup: 'Create the one account for this sheet. Once it exists, nobody else can sign up.', forgot: 'Enter your email and we\u2019ll send a link to set a new password.' }[mode]),
    el('label', { for: 'em' }, 'Email'), email,
    pw ? [el('label', { for: 'pw' }, 'Password'), pw] : null,
    btn, err,
    mode === 'signin' ? el('button', { type: 'button', class: 'linkish', onclick: () => renderLogin('', 'forgot') }, 'Forgot password?') : null,
    el('button', { type: 'button', class: 'linkish', onclick: () => renderLogin('', mode === 'signin' ? 'signup' : 'signin') },
      mode === 'signin' ? 'First time here? Create your account' : 'Back to sign in')
  );
  app.replaceChildren(el('div', { class: 'auth' }, form));
  email.focus();
}

function renderNewPassword() {
  const p1 = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', required: true, minlength: '10', id: 'np1' });
  const p2 = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', required: true, minlength: '10', id: 'np2' });
  const err = el('p', { class: 'err', role: 'alert' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Save new password');
  app.replaceChildren(el('div', { class: 'auth' }, el('form', { class: 'authcard', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (p1.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'The two passwords don\u2019t match.'; return; }
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) { err.textContent = error.message; btn.disabled = false; return; }
    try { sessionStorage.removeItem('ds_recovery'); } catch (ex) {}
    history.replaceState(null, '', location.pathname);
    renderApp(); toast('Password updated.');
  } },
    el('h1', {}, 'New password'),
    el('p', {}, 'Choose a new password for your sheet. Let your browser save it.'),
    el('label', { for: 'np1' }, 'New password'), p1,
    el('label', { for: 'np2' }, 'Repeat it'), p2,
    btn, err)));
  p1.focus();
}

function codeInput() {
  return el('input', { class: 'field code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', required: true, 'aria-label': '6-digit code' });
}

async function renderEnroll() {
  authShell(el('p', { class: 'loading' }, 'Setting up two-step verification…'));
  try {
    const { data: f } = await sb.auth.mfa.listFactors();
    for (const fac of (f?.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: fac.id });
    const data = await q(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now() }));
    const code = codeInput();
    const err = el('p', { class: 'err', role: 'alert' });
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Verify and continue');
    app.replaceChildren(el('div', { class: 'auth' }, el('form', { class: 'authcard', onsubmit: async e => {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: code.value.trim() });
      if (error) { err.textContent = 'That code didn\u2019t match. Check the app and try the current code.'; btn.disabled = false; return; }
      route();
    } },
      el('h1', {}, 'Protect your sheet'),
      el('p', {}, 'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). Every new device will ask for a code from it.'),
      el('img', { class: 'qr', src: data.totp.qr_code, alt: 'QR code for your authenticator app' }),
      el('p', {}, 'Can\u2019t scan? Enter this key instead:'),
      el('div', { class: 'secret' }, data.totp.secret),
      el('label', {}, 'Enter the 6-digit code it shows'), code, btn, err,
      el('button', { type: 'button', class: 'linkish', onclick: signOut }, 'Sign out')
    )));
    code.focus();
  } catch (e) { authShell(el('p', { class: 'err' }, e.message || 'Could not start setup.'), el('button', { class: 'btn', onclick: route }, 'Try again')); }
}

async function renderChallenge() {
  const { data: f, error } = await sb.auth.mfa.listFactors();
  const factor = f?.totp?.[0];
  if (error || !factor) return renderEnroll();
  const code = codeInput();
  const err = el('p', { class: 'err', role: 'alert' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Verify');
  app.replaceChildren(el('div', { class: 'auth' }, el('form', { class: 'authcard', onsubmit: async e => {
    e.preventDefault(); btn.disabled = true; err.textContent = '';
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.value.trim() });
    if (error) { err.textContent = 'That code didn\u2019t match. Try the current one from your authenticator app.'; btn.disabled = false; code.select(); return; }
    route();
  } },
    el('h1', {}, 'One more step'),
    el('p', {}, 'Enter the 6-digit code from your authenticator app.'),
    code, btn, err,
    el('button', { type: 'button', class: 'linkish', onclick: signOut }, 'Use a different account')
  )));
  code.focus();
}

async function signOut() { await sb.auth.signOut(); state.user = null; renderLogin(); }

/* ---------- app shell ---------- */
const VIEWS = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['inbox', 'Inbox'], ['insights', 'Insights'], ['history', 'History'], ['wins', 'Wins'], ['settings', 'Settings']];
let mainEl;
function renderApp() {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Sections' },
    VIEWS.map(([k, label]) => el('button', { 'aria-current': state.view === k ? 'page' : null, onclick: () => go(k) }, label,
      k === 'inbox' ? el('span', { class: 'count', id: 'inbox-count' }, state.inboxCount ? String(state.inboxCount) : '') : null)));
  mainEl = el('main', { id: 'main' });
  app.replaceChildren(
    el('header', { class: 'bar' }, el('span', { class: 'brand' }, 'Daily Sheet'), nav,
      el('div', { class: 'baractions' },
        el('button', { class: 'btn', onclick: openCapture, title: 'Capture a stray thought (shortcut: C)' }, '+ Capture'),
        el('button', { class: 'btn', onclick: () => startFocus(null), title: 'Start a focus block' }, '\u23f1 Focus'))),
    mainEl);
  renderView();
  if (!state.booted) { state.booted = true; loadSettings().catch(() => {}); swRegister(); }
  updateInboxCount();
  renderTimerBar();
}
function go(view, cursor) {
  state.view = view;
  if (cursor) state.cursor = cursor;
  state.open.clear();
  if (drawerEl) closeDrawer();
  try { history.replaceState(null, '', view === 'today' ? location.pathname : '#' + view); } catch (e) {}
  renderApp();
  window.scrollTo(0, 0);
}
let renderSeq = 0;
async function renderView() {
  const seq = ++renderSeq;
  const views = { today: viewToday, week: viewWeek, month: viewMonth, inbox: viewInbox, insights: viewInsights, history: viewHistory, wins: viewWins, settings: viewSettings };
  try {
    const node = await ((window.DS?.views || {})[state.view] || views[state.view])();
    if (seq !== renderSeq) return;
    const y = window.scrollY;
    mainEl.replaceChildren(node);
    window.scrollTo(0, y);
    if (state.focusAdd) { document.querySelector(`[data-add="${state.focusAdd}"]`)?.focus(); state.focusAdd = null; }
  } catch (e) {
    if (e?.code === 'PGRST301' || /jwt|aal|permission/i.test(e?.message || '')) return route();
    mainEl.replaceChildren(el('p', { class: 'meta' }, 'Couldn\u2019t load this page. Check your connection and reload.'));
  }
}
const refresh = () => renderView();

/* ---------- data ---------- */
const SEL = '*, task_notes(count), task_links(count), focus_sessions(minutes)';
const fetchTasks = (horizon, period) =>
  q(sb.from('tasks').select(SEL).eq('horizon', horizon).eq('period_start', period).order('position').order('created_at'));
const fetchReview = async (horizon, period) =>
  (await q(sb.from('reviews').select('*').eq('horizon', horizon).eq('period_start', period).limit(1)))[0] || null;

function nextPeriod(t) {
  if (t.horizon === 'day') return addDays(t.period_start, 1);
  if (t.horizon === 'week') return addDays(t.period_start, 7);
  return addMonths(t.period_start, 1);
}
async function carry(t, target) {
  const next = target || nextPeriod(t);
  let parent = null;
  if (t.parent_id) {
    if (t.horizon === 'day' && weekStart(next) === weekStart(t.period_start)) parent = t.parent_id;
    if (t.horizon === 'week' && monthStart(next) === monthStart(t.period_start)) parent = t.parent_id;
  }
  await q(sb.from('tasks').insert({ user_id: uid(), horizon: t.horizon, period_start: next, title: t.title, context: t.context,
    done_def: t.done_def, parent_id: parent, carried_from: t.id, carry_count: (t.carry_count || 0) + 1, position: t.position }));
  await q(sb.from('tasks').update({ status: 'carried' }).eq('id', t.id));
}
const setTask = (id, patch) => q(sb.from('tasks').update(patch).eq('id', id));

/* ---------- task list component ---------- */
const HZ = {
  day: { add: 'Write a task and press Enter', next: 'Move to tomorrow', empty: 'Nothing written yet. What has to happen today?' },
  week: { add: 'Add a priority for this week', next: 'Move to next week', empty: 'No priorities for this week yet.' },
  month: { add: 'Add an outcome for this month', next: 'Move to next month', empty: 'No outcomes for this month yet.' }
};

function taskList(tasks, { horizon, period, parents = [], parentLabel, childStats }) {
  const list = el('ul', { class: 'tasks' });
  if (!tasks.length) list.append(el('li', {}, el('p', { class: 'empty' }, HZ[horizon].empty)));
  for (const t of tasks) list.append(taskRow(t, { parents, parentLabel, childStats }));

  const dl = el('datalist', { id: 'ctx-' + horizon }, CONTEXTS.map(c => el('option', { value: c })));
  const ctx = el('input', { class: 'ctx', placeholder: 'context', list: 'ctx-' + horizon, value: state.lastCtx, 'aria-label': 'Context for new task' });
  const input = el('input', { class: 'new', 'data-add': horizon, placeholder: HZ[horizon].add, 'aria-label': HZ[horizon].add, maxlength: '500',
    onkeydown: async e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      const title = input.value.trim(); input.value = '';
      state.lastCtx = ctx.value.trim(); store('ds_ctx', state.lastCtx);
      await q(sb.from('tasks').insert({ user_id: uid(), horizon, period_start: period, title, context: state.lastCtx || null, position: Date.now() / 1000 }));
      state.focusAdd = horizon;
      refresh();
    } });
  return el('div', { class: 'sheet' }, list, el('div', { class: 'add' }, input, ctx, dl));
}

function taskRow(t, { parents, parentLabel, childStats }) {
  const isOpen = state.open.has(t.id);
  const notesCount = t.task_notes?.[0]?.count || 0;
  const li = el('li', { class: `task s-${t.status}` });
  const check = el('button', { class: 'check', disabled: t.status === 'carried',
    'aria-label': t.status === 'done' ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`,
    onclick: async () => {
      const done = t.status !== 'done';
      await setTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null });
      if (done) li.classList.add('just-done');
      refresh();
    } }, t.status === 'done' ? '✓' : t.status === 'carried' ? '→' : t.status === 'dropped' ? '–' : '');
  const parent = parents.find(p => p.id === t.parent_id);
  const stats = childStats?.[t.id];
  const row = el('div', { class: 'trow' },
    check,
    el('button', { class: 'title', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? state.open.delete(t.id) : state.open.add(t.id); refresh(); } }, t.title),
    stats ? el('span', { class: 'badge' }, `${stats.done}/${stats.total} done`) : null,
    t.carry_count >= 1 ? el('span', { class: 'badge' + (t.carry_count >= 3 ? ' warn' : ''), title: 'Times this has been carried over' }, `carried ×${t.carry_count}`) : null,
    t.status === 'carried' ? el('span', { class: 'badge' }, 'moved on') : null,
    notesCount ? el('span', { class: 'badge', title: 'Notes' }, `✎ ${notesCount}`) : null,
    focusMins(t) ? el('span', { class: 'badge', title: 'Focus time logged' }, '⏱ ' + fmtMins(focusMins(t))) : null,
    t.remind_at && !t.reminded_at && t.status === 'open' ? el('span', { class: 'badge', title: 'Reminder set' }, '🔔 ' + fmtWhen(t.remind_at)) : null,
    t.context ? el('span', { class: 'tag', style: `color:${ctxColor(t.context)}` }, t.context) : null,
    parent && !isOpen ? el('span', { class: 'badge', title: parentLabel }, '↑ ' + (parent.title.length > 24 ? parent.title.slice(0, 22) + '…' : parent.title)) : null
  );
  li.append(row);
  if (isOpen) li.append(taskDetail(t, parents, parentLabel));
  return li;
}

function taskDetail(t, parents, parentLabel) {
  const doneDef = el('textarea', { class: 'field', rows: '2', placeholder: 'e.g. Draft sent for review', value: t.done_def || '',
    onchange: () => setTask(t.id, { done_def: doneDef.value.trim() || null }) });
  const title = el('input', { class: 'field', value: t.title, maxlength: '500',
    onchange: async () => { if (title.value.trim()) { await setTask(t.id, { title: title.value.trim() }); refresh(); } } });
  const ctx = el('input', { class: 'field', value: t.context || '', list: 'ctx-' + t.horizon,
    onchange: async () => { await setTask(t.id, { context: ctx.value.trim() || null }); refresh(); } });
  const parentSel = parents.length ? el('label', {}, parentLabel,
    el('select', { class: 'field', onchange: async e => { await setTask(t.id, { parent_id: e.target.value || null }); refresh(); } },
      el('option', { value: '' }, '— none —'),
      parents.map(p => { const o = el('option', { value: p.id }, p.title); if (p.id === t.parent_id) o.selected = true; return o; }))) : null;

  const notesList = el('ul', { class: 'notes' }, el('li', { class: 'meta' }, 'Loading notes…'));
  (async () => {
    const notes = await q(sb.from('task_notes').select('*').eq('task_id', t.id).order('created_at'));
    notesList.replaceChildren(...notes.map(n => el('li', {}, el('time', { datetime: n.created_at }, timeAgo(n.created_at)), n.body)));
    if (!notes.length) notesList.replaceChildren();
  })().catch(() => {});
  const noteIn = el('textarea', { class: 'field', rows: '2', placeholder: 'Add a note or comment, then press Save note' });
  const remind = el('input', { class: 'field', type: 'datetime-local', value: t.remind_at ? toLocalInput(t.remind_at) : '',
    onchange: async () => {
      await setTask(t.id, { remind_at: remind.value ? new Date(remind.value).toISOString() : null, reminded_at: null });
      toast(remind.value ? 'Reminder set. Turn on notifications in Settings if you haven\u2019t.' : 'Reminder cleared.'); refresh();
    } });
  const actions = el('div', { class: 'actions' },
    el('button', { class: 'btn', onclick: async () => {
      if (!noteIn.value.trim()) return;
      await q(sb.from('task_notes').insert({ user_id: uid(), task_id: t.id, body: noteIn.value.trim() }));
      refresh();
    } }, 'Save note'),
    t.status === 'open' ? el('button', { class: 'btn primary', onclick: () => startFocus(t) }, '\u23f1 Start focus') : null,
    t.status === 'open' ? el('button', { class: 'btn', onclick: async () => { await carry(t); toast('Moved.'); refresh(); } }, HZ[t.horizon].next) : null,
    t.status === 'open' ? el('button', { class: 'btn', onclick: async () => { await setTask(t.id, { status: 'dropped' }); refresh(); } }, 'Drop') : null,
    t.status === 'dropped' ? el('button', { class: 'btn', onclick: async () => { await setTask(t.id, { status: 'open' }); refresh(); } }, 'Restore') : null,
    el('button', { class: 'btn danger', onclick: async () => {
      if (!confirm(`Delete "${t.title}" and its notes? This can\u2019t be undone.`)) return;
      await q(sb.from('tasks').delete().eq('id', t.id)); state.open.delete(t.id); refresh();
    } }, 'Delete')
  );
  return el('div', { class: 'detail' },
    el('div', { class: 'row2' }, el('label', {}, 'Task', title), el('label', {}, 'Context', ctx)),
    el('label', {}, 'Done looks like…', doneDef),
    el('div', { class: 'row2' }, parentSel || el('span'), el('label', {}, 'Remind me', remind)),
    el('div', {}, el('div', { class: 'lbl', style: 'font-size:13px;color:var(--muted);font-weight:500;margin-bottom:6px' }, 'Notes'), notesList),
    noteIn, actions);
}

/* ---------- review form ---------- */
function scale(name, val, legend) {
  return el('fieldset', { style: 'border:0;padding:0;margin:0' }, el('legend', { class: 'lbl' }, legend),
    el('div', { class: 'scale' }, [1, 2, 3, 4, 5].map(n => el('label', {},
      el('input', { type: 'radio', name, value: String(n), checked: val === n }), el('span', {}, n)))));
}
function reviewForm(horizon, period, rv, prompt) {
  const form = el('form', { class: 'reviewform', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(form);
    await q(sb.from('reviews').upsert({ user_id: uid(), horizon, period_start: period,
      energy: fd.get('energy') ? +fd.get('energy') : null, focus: fd.get('focus') ? +fd.get('focus') : null,
      reflection: (fd.get('reflection') || '').trim() || null, closed_at: rv?.closed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,horizon,period_start' }));
    toast('Review saved.'); refresh();
  } },
    el('div', { class: 'row2' }, scale('energy', rv?.energy, 'Energy'), scale('focus', rv?.focus, 'Focus')),
    el('label', {}, el('span', { class: 'lbl' }, prompt), el('textarea', { class: 'field', name: 'reflection', rows: '4', value: rv?.reflection || '' })),
    el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Save review')));
  return form;
}

/* ---------- views ---------- */
async function viewToday() {
  const d = state.cursor, ws = weekStart(d), ms = monthStart(d);
  const [tasks, weekT, monthT, wins, rv] = await Promise.all([
    fetchTasks('day', d), fetchTasks('week', ws), fetchTasks('month', ms),
    q(sb.from('wins').select('*').eq('day', d).order('created_at')), fetchReview('day', d)]);
  const live = tasks.filter(t => t.status !== 'carried');
  const done = live.filter(t => t.status === 'done').length;
  const isToday = d === today();

  const head = el('div', { class: 'head' },
    el('h1', {}, dayName(d)),
    el('button', { class: 'arrow', 'aria-label': 'Previous day', onclick: () => go('today', addDays(d, -1)) }, '‹'),
    el('button', { class: 'arrow', 'aria-label': 'Next day', onclick: () => go('today', addDays(d, 1)) }, '›'),
    !isToday ? el('button', { class: 'pill', onclick: () => go('today', today()) }, 'Back to today') : null);
  const meta = el('p', { class: 'meta' }, live.length ? `${done} of ${live.length} done` : 'A blank page.',
    rv?.closed_at ? ' · Day closed' : '');

  const openTasks = tasks.filter(t => t.status === 'open');
  const closeout = el('div', { class: 'closeout' },
    el('button', { class: 'btn primary', onclick: () => openCloseout(d, openTasks, rv) }, rv?.closed_at ? 'Edit day review' : 'Close out the day'),
    el('span', { class: 'meta', style: 'margin:0' }, rv?.closed_at ? `Energy ${rv.energy ?? '–'} · Focus ${rv.focus ?? '–'}` : 'Decide what carries over, log wins, rate the day.'));

  const mini = (items, horizon, label, viewKey) => el('section', {},
    el('h2', {}, label, el('button', { class: 'ghost', onclick: () => go(viewKey) }, 'Open')),
    items.length ? el('ul', { class: 'mini' }, items.filter(t => t.status !== 'carried').map(t => el('li', { class: t.status === 'done' ? 'done' : '' },
      el('input', { type: 'checkbox', checked: t.status === 'done', 'aria-label': t.title,
        onchange: async e => { await setTask(t.id, { status: e.target.checked ? 'done' : 'open', completed_at: e.target.checked ? new Date().toISOString() : null }); refresh(); } }),
      el('span', {}, t.title)))) : el('p', { class: 'none' }, `Nothing set for this ${horizon} yet.`));

  const winIn = el('input', { class: 'field', placeholder: 'Log a win and press Enter', maxlength: '1000',
    onkeydown: async e => {
      if (e.key !== 'Enter' || !winIn.value.trim()) return;
      e.preventDefault();
      await q(sb.from('wins').insert({ user_id: uid(), day: d, body: winIn.value.trim() }));
      refresh();
    } });
  const winsSec = el('section', {}, el('h2', {}, isToday ? 'Wins today' : 'Wins'),
    el('ul', { class: 'winlist' }, wins.map(w => el('li', {}, el('span', {}, w.body),
      el('button', { class: 'x', 'aria-label': 'Remove win', onclick: async () => { await q(sb.from('wins').delete().eq('id', w.id)); refresh(); } }, '×')))),
    winIn);

  return el('div', { class: 'cols' },
    el('div', {}, head, meta,
      taskList(tasks, { horizon: 'day', period: d, parents: weekT.filter(t => t.status !== 'carried'), parentLabel: 'Supports this week\u2019s priority' }),
      closeout),
    el('aside', { class: 'side' }, mini(weekT, 'week', 'This week', 'week'), mini(monthT, 'month', 'This month', 'month'), winsSec));
}

function openCloseout(d, openTasks, rv) {
  const next = addDays(d, 1);
  const dlg = el('dialog', { 'aria-labelledby': 'co-h' });
  const form = el('form', { class: 'dlg', onsubmit: async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const fd = new FormData(form);
      for (const t of openTasks) {
        const choice = fd.get('c-' + t.id);
        if (choice === 'carry') await carry(t, next);
        else if (choice === 'drop') await setTask(t.id, { status: 'dropped' });
      }
      const winLines = (fd.get('wins') || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (winLines.length) await q(sb.from('wins').insert(winLines.map(body => ({ user_id: uid(), day: d, body }))));
      await q(sb.from('reviews').upsert({ user_id: uid(), horizon: 'day', period_start: d,
        energy: fd.get('energy') ? +fd.get('energy') : null, focus: fd.get('focus') ? +fd.get('focus') : null,
        reflection: (fd.get('reflection') || '').trim() || null, closed_at: rv?.closed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'user_id,horizon,period_start' }));
      dlg.close(); toast('Day closed.'); refresh();
    } catch (err) { btn.disabled = false; }
  } },
    el('h2', { id: 'co-h' }, rv?.closed_at ? 'Day review' : 'Close out the day'),
    openTasks.length ? el('div', {}, el('span', { class: 'lbl' }, 'Still open'),
      el('ul', { class: 'carrylist' }, openTasks.map(t => el('li', {}, el('span', { class: 't' }, t.title),
        el('div', { class: 'seg', role: 'radiogroup', 'aria-label': t.title },
          [['carry', `Carry to ${fmt(next, { weekday: 'short' })}`], ['drop', 'Drop'], ['keep', 'Leave open']].map(([v, l]) =>
            el('label', {}, el('input', { type: 'radio', name: 'c-' + t.id, value: v, checked: v === 'carry' }), el('span', {}, l)))))))) :
      el('p', { class: 'meta', style: 'margin:0' }, 'Nothing left open. Good day.'),
    el('div', { class: 'row2' }, scale('energy', rv?.energy, 'Energy'), scale('focus', rv?.focus, 'Focus')),
    el('label', {}, el('span', { class: 'lbl' }, 'What helped or got in the way today?'), el('textarea', { class: 'field', name: 'reflection', rows: '3', value: rv?.reflection || '' })),
    el('label', {}, el('span', { class: 'lbl' }, 'Wins to log (one per line)'), el('textarea', { class: 'field', name: 'wins', rows: '3' })),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, rv?.closed_at ? 'Save review' : 'Close out the day'),
      el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

async function viewWeek() {
  const ws = weekStart(state.cursor), we = addDays(ws, 6), ms = monthStart(ws);
  const [weekT, monthT, dayT, rv, sessions, wins, dayRvs] = await Promise.all([
    fetchTasks('week', ws), fetchTasks('month', ms),
    q(sb.from('tasks').select('id,title,period_start,status,parent_id,context,carry_count').eq('horizon', 'day').gte('period_start', ws).lte('period_start', we)),
    fetchReview('week', ws),
    q(sb.from('focus_sessions').select('minutes,started_at').gte('started_at', parse(ws).toISOString()).lt('started_at', parse(addDays(we, 1)).toISOString())),
    q(sb.from('wins').select('day,body').gte('day', ws).lte('day', we).order('day')),
    q(sb.from('reviews').select('energy,focus').eq('horizon', 'day').gte('period_start', ws).lte('period_start', we))]);
  const childStats = {};
  for (const t of dayT) {
    if (!t.parent_id || t.status === 'carried') continue;
    const s = childStats[t.parent_id] ||= { done: 0, total: 0 };
    s.total++; if (t.status === 'done') s.done++;
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const strip = el('div', { class: 'strip' }, days.map(d => {
    const ts = dayT.filter(t => t.period_start === d && t.status !== 'carried');
    const done = ts.filter(t => t.status === 'done').length;
    return el('button', { class: 'daycell', onclick: () => go('today', d) },
      el('b', {}, shortDay(d)), el('div', { class: 'meter' }, el('i', { style: `width:${ts.length ? Math.round(done / ts.length * 100) : 0}%` })),
      el('small', {}, ts.length ? `${done}/${ts.length} done` : '—'));
  }));
  return el('div', {},
    el('div', { class: 'head' }, el('h1', {}, 'Week of ' + fmt(ws, { day: 'numeric', month: 'long' })),
      el('button', { class: 'arrow', 'aria-label': 'Previous week', onclick: () => go('week', addDays(ws, -7)) }, '‹'),
      el('button', { class: 'arrow', 'aria-label': 'Next week', onclick: () => go('week', addDays(ws, 7)) }, '›'),
      ws !== weekStart(today()) ? el('button', { class: 'pill', onclick: () => go('week', today()) }, 'This week') : null),
    el('p', { class: 'meta' }, 'Pick a few priorities. Link daily tasks to them from the Today page to see them fill up.'),
    taskList(weekT, { horizon: 'week', period: ws, parents: monthT.filter(t => t.status !== 'carried'), parentLabel: 'Supports this month\u2019s outcome', childStats }),
    strip,
    weekNumbers(dayT, sessions, wins, dayRvs),
    el('section', { class: 'section' }, el('h2', {}, 'Week review'), reviewForm('week', ws, rv, 'What moved this week, and what kept slipping?')));
}

async function viewMonth() {
  const ms = monthStart(state.cursor), me = addDays(addMonths(ms, 1), -1);
  const [monthT, weekT, rv] = await Promise.all([
    fetchTasks('month', ms),
    q(sb.from('tasks').select('id,status,parent_id').eq('horizon', 'week').gte('period_start', addDays(ms, -6)).lte('period_start', me)),
    fetchReview('month', ms)]);
  const childStats = {};
  for (const t of weekT) {
    if (!t.parent_id || t.status === 'carried') continue;
    const s = childStats[t.parent_id] ||= { done: 0, total: 0 };
    s.total++; if (t.status === 'done') s.done++;
  }
  const live = monthT.filter(t => t.status !== 'carried');
  const moved = monthT.filter(t => t.status === 'carried');
  const active = live.filter(t => t.status !== 'dropped');
  const MAX = 5;

  const grid = el('div', { class: 'outcomes' });
  live.forEach((t, i) => {
    const s = childStats[t.id] || { done: 0, total: 0 };
    const fill = outcomeFill(t, s);
    const links = t.task_links?.[0]?.count || 0, logs = t.task_notes?.[0]?.count || 0;
    const card = el('article', { class: `outcome s-${t.status}${state.drawer === t.id ? ' open' : ''}`, 'data-oid': t.id,
      onclick: e => { if (!e.target.closest('button,a,input')) openDrawer(t.id); } },
      el('div', { class: 'otop' },
        el('span', { class: 'onum', 'aria-hidden': 'true' }, pad(i + 1)),
        el('div', { class: 'otools' },
          el('button', { class: 'oicon', title: 'Edit', 'aria-label': `Edit "${t.title}"`, onclick: () => openDrawer(t.id) }, '\u270e'),
          el('button', { class: 'oicon del', title: 'Delete', 'aria-label': `Delete "${t.title}"`, onclick: () => deleteOutcome(t) }, '\ud83d\uddd1'),
          el('button', { class: 'ocheck', 'aria-label': t.status === 'done' ? `Mark "${t.title}" not done` : `Mark "${t.title}" achieved`,
            onclick: async () => {
              const done = t.status !== 'done';
              await setTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null });
              refresh(); if (state.drawer === t.id) renderDrawer();
            } }, t.status === 'done' ? '\u2713' : t.status === 'dropped' ? '\u2013' : ''))),
      el('button', { class: 'otitle', title: 'Open details', onclick: () => openDrawer(t.id) }, t.title),
      el('div', { class: 'ofoot' },
        el('div', { class: 'obar', role: 'img', 'aria-label': `${fill}% progress` }, el('i', { style: `width:${fill}%` })),
        el('span', { class: 'oprog' }, outcomeLabel(t, s)),
        t.context ? el('span', { class: 'otag' }, t.context) : null),
      links || logs ? el('div', { class: 'ometa' }, links ? `\ud83d\udd17 ${links}` : null, links && logs ? ' \u00b7 ' : null, logs ? `${logs} update${logs === 1 ? '' : 's'}` : null) : null);
    grid.append(card);
  });

  if (active.length < MAX) {
    const ctx = el('input', { class: 'octx', placeholder: 'context', list: 'ctx-month', value: state.lastCtx, 'aria-label': 'Context for new outcome' });
    const input = el('input', { class: 'onew', 'data-add': 'month', placeholder: 'Type an outcome\u2026', 'aria-label': 'Add an outcome for this month', maxlength: '500',
      onkeydown: async e => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        e.preventDefault();
        const title = input.value.trim(); input.value = '';
        state.lastCtx = ctx.value.trim(); store('ds_ctx', state.lastCtx);
        await q(sb.from('tasks').insert({ user_id: uid(), horizon: 'month', period_start: ms, title, context: state.lastCtx || null, position: Date.now() / 1000 }));
        state.focusAdd = 'month';
        refresh();
      } });
    const left = MAX - active.length;
    grid.append(el('div', { class: 'outcome-new' },
      el('span', { class: 'onum plus', 'aria-hidden': 'true' }, '+'),
      input,
      el('div', { class: 'onewfoot' }, ctx, el('small', {}, `Enter to add \u00b7 ${left} ${left === 1 ? 'slot' : 'slots'} left`)),
      el('datalist', { id: 'ctx-month' }, CONTEXTS.map(c => el('option', { value: c })))));
  } else {
    grid.append(el('div', { class: 'ofull' }, 'Five outcomes set. Finish or drop one to add another.'));
  }

  return el('div', {},
    el('div', { class: 'head' }, el('h1', {}, monthName(ms)),
      el('button', { class: 'arrow', 'aria-label': 'Previous month', onclick: () => go('month', addMonths(ms, -1)) }, '\u2039'),
      el('button', { class: 'arrow', 'aria-label': 'Next month', onclick: () => go('month', addMonths(ms, 1)) }, '\u203a'),
      ms !== monthStart(today()) ? el('button', { class: 'pill', onclick: () => go('month', today()) }, 'This month') : null),
    el('p', { class: 'meta' }, live.length
      ? `${live.filter(t => t.status === 'done').length} of ${active.length} achieved. Link weekly priorities to an outcome from the Week page and its bar fills as they get done.`
      : 'Three to five outcomes that would make this month a good one.'),
    grid,
    moved.length ? el('p', { class: 'omoved' }, 'Moved to next month: ' + moved.map(t => `\u201c${t.title}\u201d`).join(', ')) : null,
    el('section', { class: 'section' }, el('h2', {}, 'Month review'), reviewForm('month', ms, rv, 'What did this month teach you?')));
}

async function viewHistory() {
  const from = addDays(today(), -120);
  const [dayT, rvs, wins] = await Promise.all([
    q(sb.from('tasks').select('period_start,status').eq('horizon', 'day').gte('period_start', from).lte('period_start', today()).limit(5000)),
    q(sb.from('reviews').select('period_start,energy,focus').eq('horizon', 'day').gte('period_start', from)),
    q(sb.from('wins').select('day').gte('day', from))]);
  const byDay = {};
  const get = d => byDay[d] ||= { total: 0, done: 0, carried: 0, wins: 0, rv: null };
  for (const t of dayT) { const s = get(t.period_start); if (t.status === 'carried') s.carried++; else { s.total++; if (t.status === 'done') s.done++; } }
  for (const r of rvs) get(r.period_start).rv = r;
  for (const w of wins) get(w.day).wins++;
  const days = Object.keys(byDay).sort().reverse();

  const results = el('ul', { class: 'results' });
  const sIn = el('input', { class: 'field', type: 'search', placeholder: 'Search every task you\u2019ve written', 'aria-label': 'Search tasks' });
  const doSearch = async () => {
    const term = sIn.value.trim().replace(/[%_,()]/g, ' ');
    if (!term) { results.replaceChildren(); return; }
    const rows = await q(sb.from('tasks').select('title,period_start,horizon,status').ilike('title', `%${term}%`).order('period_start', { ascending: false }).limit(50));
    results.replaceChildren(...(rows.length ? rows.map(r => el('li', {}, el('button', { onclick: () => go(r.horizon === 'day' ? 'today' : r.horizon, r.period_start) },
      el('time', {}, shortDay(r.period_start)), el('span', {}, r.title, r.horizon !== 'day' ? ` (${r.horizon})` : '', r.status === 'done' ? ' ✓' : '')))) :
      [el('li', { class: 'meta' }, 'No tasks match that.')]));
  };
  sIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

  const totals = days.reduce((a, d) => (a.total += byDay[d].total, a.done += byDay[d].done, a), { total: 0, done: 0 });
  return el('div', {},
    el('div', { class: 'head' }, el('h1', {}, 'History')),
    el('p', { class: 'meta' }, days.length ? `Last 120 days: ${totals.done} of ${totals.total} tasks done (${totals.total ? Math.round(totals.done / totals.total * 100) : 0}%).` : 'Your days will show up here once you start writing them.'),
    el('div', { class: 'search' }, sIn, el('button', { class: 'btn', onclick: doSearch }, 'Search')),
    results,
    days.length ? el('div', { class: 'histwrap' }, el('table', { class: 'hist' },
      el('thead', {}, el('tr', {}, ['Day', 'Done', 'Carried', 'Energy', 'Focus', 'Wins'].map(h => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, days.map(d => { const s = byDay[d]; return el('tr', { class: 'click', tabindex: '0',
        onclick: () => go('today', d), onkeydown: e => { if (e.key === 'Enter') go('today', d); } },
        el('td', {}, shortDay(d)),
        el('td', {}, el('span', { class: 'meter' }, el('i', { style: `width:${s.total ? Math.round(s.done / s.total * 100) : 0}%` })), `${s.done}/${s.total}`),
        el('td', {}, s.carried || '–'), el('td', {}, s.rv?.energy ?? '–'), el('td', {}, s.rv?.focus ?? '–'), el('td', {}, s.wins || '–')); })))) : null);
}

async function viewWins() {
  const wins = await q(sb.from('wins').select('*').order('day', { ascending: false }).order('created_at').limit(1000));
  const groups = {};
  for (const w of wins) (groups[w.day] ||= []).push(w);
  const winIn = el('input', { class: 'field', placeholder: 'Log a win for today and press Enter', maxlength: '1000',
    onkeydown: async e => {
      if (e.key !== 'Enter' || !winIn.value.trim()) return;
      e.preventDefault();
      await q(sb.from('wins').insert({ user_id: uid(), day: today(), body: winIn.value.trim() }));
      refresh();
    } });
  return el('div', { style: 'max-width:680px' },
    el('div', { class: 'head' }, el('h1', {}, 'Wins')),
    el('p', { class: 'meta' }, wins.length ? `${wins.length} logged so far.` : 'Progress you\u2019d otherwise forget. Start with one from today.'),
    el('div', { style: 'margin-bottom:28px' }, winIn),
    Object.keys(groups).map(d => el('div', { class: 'wingroup' }, el('h3', {}, dayName(d)),
      el('ul', { class: 'winlist' }, groups[d].map(w => el('li', {}, el('span', {}, w.body)))))));
}

/* ---------- v2 helpers ---------- */
const fmtMins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
const focusMins = t => (t.focus_sessions || []).reduce((a, s) => a + (s.minutes || 0), 0);
function toLocalInput(isoStr) { const d = new Date(isoStr); return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtWhen(isoStr) {
  const d = new Date(isoStr), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return iso(d) === today() ? hm : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}
async function fetchAll(make) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const rows = await q(make().range(i, i + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- settings ---------- */
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch (e) { return 'Europe/London'; } })();
async function loadSettings() {
  let s = (await q(sb.from('settings').select('*').limit(1)))[0];
  if (!s) s = (await q(sb.from('settings').insert({ user_id: uid(), tz: TZ }).select()))[0];
  else if (s.tz !== TZ) { await q(sb.from('settings').update({ tz: TZ }).eq('user_id', uid())); s.tz = TZ; }
  state.settings = s;
  return s;
}

/* ---------- notifications ---------- */
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
function swRegister() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }
async function currentSub() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); return (await reg?.pushManager?.getSubscription()) || null; } catch (e) { return null; }
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error(isIOS() && !isStandalone() ? 'On iPhone, add this page to your Home Screen first (Share \u2192 Add to Home Screen), open it from there, then turn notifications on.' : 'This browser doesn\u2019t support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser\u2019s site settings, then try again.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
  const j = sub.toJSON();
  await q(sb.from('push_subscriptions').upsert({ user_id: uid(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' }));
}
async function disablePush() {
  const sub = await currentSub();
  if (sub) { await q(sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)); await sub.unsubscribe(); }
}
async function testPush() {
  const { data, error } = await sb.functions.invoke('reminders', { body: { test: true } });
  if (error) throw error;
  toast(data?.sent ? 'Test sent. It should arrive within a few seconds.' : 'No devices are set up for notifications yet.');
}
async function notifyLocal(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: '/icon-192.png', tag: 'focus' });
    else new Notification(title, { body });
  } catch (e) {}
}
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i]; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
    });
  } catch (e) {}
}

/* ---------- focus timer ---------- */
const timer = {
  get() { try { return JSON.parse(store('ds_timer') || 'null'); } catch (e) { return null; } },
  set(t) { store('ds_timer', t ? JSON.stringify(t) : ''); renderTimerBar(); }
};
const elapsedMs = t => (t.pausedAt || Date.now()) - t.start - (t.pausedTotal || 0);
const remainingMs = t => t.duration * 60000 - elapsedMs(t);
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function startFocus(task) {
  const cur = timer.get();
  if (cur) { if (!confirm('A focus block is already running. Stop it and start a new one?')) return; finishFocus(false); }
  timer.set({ taskId: task?.id || null, title: task?.title || 'Focus block', start: Date.now(), duration: state.settings?.focus_minutes || 45, pausedAt: null, pausedTotal: 0 });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast(`Focus block started: ${state.settings?.focus_minutes || 45} minutes.`);
}
function pauseFocus() {
  const t = timer.get(); if (!t) return;
  if (t.pausedAt) { t.pausedTotal += Date.now() - t.pausedAt; t.pausedAt = null; } else t.pausedAt = Date.now();
  timer.set(t);
}
let finishing = false;
async function finishFocus(completed) {
  const t = timer.get(); if (!t || finishing) return;
  finishing = true;
  timer.set(null);
  const mins = completed ? t.duration : Math.round(elapsedMs(t) / 60000);
  try {
    if (mins >= 1 && state.user) await q(sb.from('focus_sessions').insert({ user_id: uid(), task_id: t.taskId, label: t.title,
      started_at: new Date(t.start).toISOString(), ended_at: new Date().toISOString(), minutes: mins, completed }));
    if (completed) { chime(); notifyLocal('Focus block done', `${mins} minutes on \u201c${t.title}\u201d. Take a short break.`); toast(`Focus block done: ${mins} minutes logged.`); }
    else toast(mins >= 1 ? `Stopped. ${mins} minutes logged.` : 'Stopped. Under a minute, so nothing logged.');
    if (state.user && mainEl?.isConnected) refresh();
  } finally { finishing = false; }
}
function tickTimer() {
  const t = timer.get();
  const bar = document.getElementById('timerbar');
  if (!t) { if (bar) bar.remove(); return; }
  if (!t.pausedAt && remainingMs(t) <= 0) { finishFocus(true); return; }
  if (!bar) return renderTimerBar();
  bar.querySelector('.tclock').textContent = clock(remainingMs(t));
  document.title = (t.pausedAt ? '\u23f8 ' : '') + clock(remainingMs(t)) + ' \u00b7 Daily Sheet';
}
function renderTimerBar() {
  document.getElementById('timerbar')?.remove();
  const t = timer.get();
  document.body.classList.toggle('has-timer', !!t);
  if (!t) { document.title = 'Daily Sheet'; return; }
  if (!state.user) return;
  const pct = Math.min(100, Math.max(0, elapsedMs(t) / (t.duration * 60000) * 100));
  document.body.append(el('div', { id: 'timerbar', class: 'timerbar' + (t.pausedAt ? ' paused' : ''), role: 'timer', 'aria-label': 'Focus timer' },
    el('div', { class: 'tprog' }, el('i', { style: `width:${pct}%` })),
    el('span', { class: 'tclock' }, clock(remainingMs(t))),
    el('span', { class: 'ttitle' }, t.title),
    el('div', { class: 'tbtns' },
      el('button', { class: 'btn', onclick: openCapture, title: 'Park a stray thought without breaking focus' }, '+ Thought'),
      el('button', { class: 'btn', onclick: pauseFocus }, t.pausedAt ? 'Resume' : 'Pause'),
      el('button', { class: 'btn', onclick: () => finishFocus(false) }, 'Stop'))));
  tickTimer();
}

/* ---------- brain-dump inbox ---------- */
async function updateInboxCount() {
  if (!state.user) return;
  try {
    const { count } = await sb.from('inbox').select('id', { count: 'exact', head: true }).is('done_at', null);
    state.inboxCount = count || 0;
    const c = document.getElementById('inbox-count'); if (c) c.textContent = count ? String(count) : '';
  } catch (e) {}
}
async function saveThought(body) {
  await q(sb.from('inbox').insert({ user_id: uid(), body }));
  updateInboxCount();
}
function openCapture() {
  if (document.querySelector('dialog.capture')) return;
  const dlg = el('dialog', { class: 'capture', 'aria-labelledby': 'cap-h' });
  const ta = el('textarea', { class: 'field', rows: '3', maxlength: '5000', placeholder: 'Whatever\u2019s on your mind. Sort it later.' });
  const form = el('form', { class: 'dlg', onsubmit: async e => {
    e.preventDefault(); if (!ta.value.trim()) return;
    await saveThought(ta.value.trim()); dlg.close(); toast('Saved to inbox.');
    if (state.view === 'inbox') refresh();
  } },
    el('h2', { id: 'cap-h' }, 'Capture a thought'), ta,
    el('p', { class: 'meta', style: 'margin:0' }, 'Ctrl/\u2318 + Enter to save. It goes to your Inbox.'),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save to inbox'),
      el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  dlg.append(form); dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); ta.focus();
}
async function viewInbox() {
  const [items, cleared] = await Promise.all([
    q(sb.from('inbox').select('*').is('done_at', null).order('created_at', { ascending: false })),
    q(sb.from('inbox').select('*').not('done_at', 'is', null).order('done_at', { ascending: false }).limit(20))]);
  const clear = async it => { await q(sb.from('inbox').update({ done_at: new Date().toISOString() }).eq('id', it.id)); updateInboxCount(); };
  const toTask = async (it, horizon) => {
    await q(sb.from('tasks').insert({ user_id: uid(), horizon, period_start: horizon === 'day' ? today() : weekStart(today()), title: it.body.slice(0, 500), position: Date.now() / 1000 }));
    await clear(it); toast(horizon === 'day' ? 'Added to today.' : 'Added to this week.'); refresh();
  };
  const input = el('input', { class: 'field', placeholder: 'Type a thought and press Enter', maxlength: '5000', 'data-add': 'inbox',
    onkeydown: async e => { if (e.key !== 'Enter' || !input.value.trim()) return; e.preventDefault(); await saveThought(input.value.trim()); state.focusAdd = 'inbox'; refresh(); } });
  return el('div', { style: 'max-width:760px' },
    el('div', { class: 'head' }, el('h1', {}, 'Inbox')),
    el('p', { class: 'meta' }, items.length ? `${items.length} to sort. Turn each into a task, or clear it.` : 'Empty. Press C anywhere to capture a thought without leaving what you\u2019re doing.'),
    el('div', { style: 'margin-bottom:20px' }, input),
    el('ul', { class: 'inbox' }, items.map(it => el('li', {},
      el('p', {}, it.body), el('time', { datetime: it.created_at }, timeAgo(it.created_at)),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => toTask(it, 'day') }, 'To today'),
        el('button', { class: 'btn', onclick: () => toTask(it, 'week') }, 'To this week'),
        el('button', { class: 'btn', onclick: async () => { await clear(it); refresh(); } }, 'Clear'),
        el('button', { class: 'btn danger', onclick: async () => { await q(sb.from('inbox').delete().eq('id', it.id)); updateInboxCount(); refresh(); } }, 'Delete'))))),
    cleared.length ? el('details', { class: 'section' }, el('summary', {}, 'Recently cleared'),
      el('ul', { class: 'inbox done' }, cleared.map(it => el('li', {}, el('p', {}, it.body), el('time', {}, timeAgo(it.done_at)))))) : null);
}

/* ---------- charts ---------- */
function vbars(items, fmtVal, max) {
  const top = max || Math.max(1, ...items.map(i => i.value));
  return el('div', { class: 'vbars', role: 'img', 'aria-label': items.map(i => `${i.label}: ${fmtVal(i.value)}`).join(', ') },
    items.map(i => el('div', { class: 'vbar', title: `${i.label}: ${fmtVal(i.value)}${i.sub ? ' (' + i.sub + ')' : ''}` },
      el('span', { class: 'vval' }, i.value ? fmtVal(i.value) : ''),
      el('i', { style: `height:${Math.round(i.value / top * 100)}%` }),
      el('small', {}, i.label))));
}
function hbars(items, fmtVal) {
  const top = Math.max(1, ...items.map(i => i.value));
  return el('div', { class: 'hbars' }, items.map(i => el('div', { class: 'hbar' },
    el('span', {}, i.label), el('div', { class: 'meter' }, el('i', { style: `width:${Math.round(i.value / top * 100)}%;background:${i.color || 'var(--ink)'}` })), el('b', {}, fmtVal(i.value)))));
}
const kpi = (value, label, note) => el('div', { class: 'kpi' }, el('b', {}, value), el('span', {}, label), note ? el('small', {}, note) : null);
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;

/* ---------- insights ---------- */
async function viewInsights() {
  const t0 = today(), from = addDays(weekStart(t0), -77);
  const [dayT, sessions, rvs, wins, stuck] = await Promise.all([
    fetchAll(() => sb.from('tasks').select('period_start,status,context').eq('horizon', 'day').gte('period_start', from).lte('period_start', t0).order('period_start')),
    fetchAll(() => sb.from('focus_sessions').select('started_at,minutes,tasks(context)').gte('started_at', parse(from).toISOString()).order('started_at')),
    q(sb.from('reviews').select('period_start,energy,focus').eq('horizon', 'day').gte('period_start', from)),
    q(sb.from('wins').select('day').gte('day', from).limit(5000)),
    q(sb.from('tasks').select('id,title,period_start,horizon,carry_count,context').eq('status', 'open').gte('carry_count', 3).order('carry_count', { ascending: false }).limit(10))]);
  const live = dayT.filter(t => t.status !== 'carried');
  const d30 = addDays(t0, -29), d7 = addDays(t0, -6);
  const last30 = live.filter(t => t.period_start >= d30);
  const done30 = last30.filter(t => t.status === 'done').length;
  const sDay = s => iso(new Date(s.started_at));
  const focus7 = sessions.filter(s => sDay(s) >= d7).reduce((a, s) => a + s.minutes, 0);
  const rv30 = rvs.filter(r => r.period_start >= d30);
  const e30 = avg(rv30.map(r => r.energy).filter(Boolean)), f30 = avg(rv30.map(r => r.focus).filter(Boolean));

  const weeks = Array.from({ length: 12 }, (_, i) => addDays(from, i * 7));
  const weekly = weeks.map(w => { const ts = live.filter(t => t.period_start >= w && t.period_start <= addDays(w, 6)); const d = ts.filter(t => t.status === 'done').length;
    return { label: fmt(w, { day: 'numeric', month: 'short' }), value: pct(d, ts.length), sub: `${d}/${ts.length} done` }; });
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(t0, i - 13));
  const focusDaily = days14.map(d => ({ label: fmt(d, { weekday: 'narrow' }), value: sessions.filter(s => sDay(s) === d).reduce((a, s) => a + s.minutes, 0), sub: shortDay(d) }));

  const ctxMap = {};
  for (const t of last30) { const k = t.context || 'No context'; (ctxMap[k] ||= { done: 0, total: 0, focus: 0 }).total++; if (t.status === 'done') ctxMap[k].done++; }
  for (const s of sessions.filter(s => sDay(s) >= d30)) { const k = s.tasks?.context || 'No context'; (ctxMap[k] ||= { done: 0, total: 0, focus: 0 }).focus += s.minutes; }
  const ctxs = Object.entries(ctxMap).sort((a, b) => b[1].total - a[1].total);

  const wdNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wd = wdNames.map((n, i) => { const ts = live.filter(t => (parse(t.period_start).getDay() + 6) % 7 === i); const d = ts.filter(t => t.status === 'done').length; return { label: n, value: pct(d, ts.length), sub: `${d}/${ts.length} done` }; });

  // energy vs completion
  const byDay = {};
  for (const t of live) { const s = byDay[t.period_start] ||= { d: 0, n: 0 }; s.n++; if (t.status === 'done') s.d++; }
  const hi = rvs.filter(r => r.energy >= 4 && byDay[r.period_start]?.n).map(r => byDay[r.period_start].d / byDay[r.period_start].n);
  const lo = rvs.filter(r => r.energy && r.energy <= 2 && byDay[r.period_start]?.n).map(r => byDay[r.period_start].d / byDay[r.period_start].n);
  const energyLine = hi.length >= 3 && lo.length >= 3
    ? `On high-energy days (4\u20135) you finish ${Math.round(avg(hi) * 100)}% of your list; on low-energy days (1\u20132), ${Math.round(avg(lo) * 100)}%.`
    : 'Rate your energy when you close out each day. After a few high and low days, this shows how energy affects what you get done.';
  const bestWd = wd.filter(w => w.sub.split('/')[1].startsWith('0') === false).sort((a, b) => b.value - a.value)[0];

  return el('div', {},
    el('div', { class: 'head' }, el('h1', {}, 'Insights')),
    el('p', { class: 'meta' }, live.length ? 'Based on the last 12 weeks of your sheet.' : 'Patterns appear here once you\u2019ve used the sheet for a few days.'),
    el('div', { class: 'kpis' },
      kpi(`${pct(done30, last30.length)}%`, 'Tasks done', `${done30} of ${last30.length}, last 30 days`),
      kpi(fmtMins(focus7), 'Focus time', 'last 7 days'),
      kpi(String(wins.filter(w => w.day >= d30).length), 'Wins logged', 'last 30 days'),
      kpi(e30 ? e30.toFixed(1) : '\u2013', 'Avg energy', f30 ? `focus ${f30.toFixed(1)}, last 30 days` : 'last 30 days')),
    el('div', { class: 'grid2' },
      el('section', { class: 'card' }, el('h2', {}, 'Completion by week'), vbars(weekly, v => v + '%', 100)),
      el('section', { class: 'card' }, el('h2', {}, 'Focus time, last 14 days'), vbars(focusDaily, fmtMins)),
      el('section', { class: 'card' }, el('h2', {}, 'Where your tasks go (30 days)'),
        ctxs.length ? hbars(ctxs.map(([k, v]) => ({ label: k, value: v.total, color: k === 'No context' ? 'var(--done)' : ctxColor(k) })), v => String(v)) : el('p', { class: 'meta' }, 'No tasks yet.'),
        ctxs.length ? el('p', { class: 'meta', style: 'margin:10px 0 0' }, ctxs.map(([k, v]) => `${k}: ${pct(v.done, v.total)}% done${v.focus ? ', ' + fmtMins(v.focus) + ' focus' : ''}`).join(' \u00b7 ')) : null),
      el('section', { class: 'card' }, el('h2', {}, 'Completion by weekday'), vbars(wd, v => v + '%', 100),
        bestWd && bestWd.value ? el('p', { class: 'meta', style: 'margin:10px 0 0' }, `${bestWd.label} is your strongest day so far.`) : null)),
    el('section', { class: 'card', style: 'margin-top:20px' }, el('h2', {}, 'Energy and output'), el('p', { style: 'margin:0' }, energyLine)),
    el('section', { class: 'card', style: 'margin-top:20px' }, el('h2', {}, 'Stuck tasks'),
      stuck.length ? el('ul', { class: 'stuck' }, stuck.map(t => el('li', {}, el('button', { class: 'linkish', onclick: () => go(t.horizon === 'day' ? 'today' : t.horizon, t.period_start) }, t.title),
        el('span', { class: 'badge warn' }, `carried \u00d7${t.carry_count}`), t.context ? el('span', { class: 'tag', style: `color:${ctxColor(t.context)}` }, t.context) : null))) :
        el('p', { class: 'meta', style: 'margin:0' }, 'Nothing carried over three or more times. Good.'),
      stuck.length ? el('p', { class: 'meta', style: 'margin:10px 0 0' }, 'Each of these has slipped at least three times. Break it into a smaller first step, schedule it, or drop it.') : null));
}

function weekNumbers(dayT, sessions, wins, dayRvs) {
  const live = dayT.filter(t => t.status !== 'carried');
  const done = live.filter(t => t.status === 'done').length;
  const carried = dayT.filter(t => t.status === 'carried').length;
  const dropped = live.filter(t => t.status === 'dropped').length;
  const focus = sessions.reduce((a, s) => a + s.minutes, 0);
  const e = avg(dayRvs.map(r => r.energy).filter(Boolean)), f = avg(dayRvs.map(r => r.focus).filter(Boolean));
  const ctx = {};
  for (const t of live.filter(t => t.status === 'done')) ctx[t.context || 'No context'] = (ctx[t.context || 'No context'] || 0) + 1;
  const stuck = dayT.filter(t => t.status === 'open' && t.carry_count >= 3);
  return el('section', { class: 'section' }, el('h2', {}, 'Week in numbers'),
    el('div', { class: 'kpis' },
      kpi(`${done}/${live.length}`, 'Tasks done', live.length ? pct(done, live.length) + '%' : ''),
      kpi(String(carried), 'Carried over', dropped ? `${dropped} dropped` : ''),
      kpi(fmtMins(focus), 'Focus time', `${sessions.length} block${sessions.length === 1 ? '' : 's'}`),
      kpi(e ? e.toFixed(1) : '\u2013', 'Avg energy', f ? `focus ${f.toFixed(1)}` : '')),
    Object.keys(ctx).length ? el('p', { class: 'meta' }, 'Done by context: ' + Object.entries(ctx).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')) : null,
    stuck.length ? el('p', { class: 'meta' }, 'Still stuck: ' + stuck.map(t => `\u201c${t.title}\u201d (\u00d7${t.carry_count})`).join(', ')) : null,
    wins.length ? el('div', {}, el('span', { class: 'lbl' }, `Wins this week (${wins.length})`), el('ul', { class: 'winlist' }, wins.map(w => el('li', {}, el('span', {}, w.body))))) : null);
}

/* ---------- settings ---------- */
async function viewSettings() {
  const s = await loadSettings();
  const [subs, sub] = await Promise.all([q(sb.from('push_subscriptions').select('id,user_agent,created_at')), currentSub()]);
  const here = sub && subs.length ? true : false;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const status = el('p', { class: 'meta' },
    here ? `Notifications are on for this device. ${subs.length} device${subs.length === 1 ? '' : 's'} set up in total.`
      : perm === 'denied' ? 'Notifications are blocked for this site in your browser settings.'
      : `Notifications are off on this device.${subs.length ? ` ${subs.length} other device${subs.length === 1 ? ' is' : 's are'} set up.` : ''}`);
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message || 'Something went wrong.'); } btn.disabled = false; };
  const pushBtns = el('div', { class: 'actions' },
    here ? el('button', { class: 'btn', onclick: e => busy(e.target, async () => { await disablePush(); toast('Notifications turned off on this device.'); refresh(); }) }, 'Turn off on this device')
      : el('button', { class: 'btn primary', onclick: e => busy(e.target, async () => { await enablePush(); toast('Notifications on.'); refresh(); }) }, 'Turn on notifications for this device'),
    subs.length ? el('button', { class: 'btn', onclick: e => busy(e.target, testPush) }, 'Send a test notification') : null);

  const chk = (name, val) => el('input', { type: 'checkbox', name, checked: !!val });
  const tim = (name, val) => el('input', { class: 'field', type: 'time', name, value: (val || '').slice(0, 5), style: 'width:auto' });
  const form = el('form', { class: 'settingsform', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const fm = Math.min(180, Math.max(5, parseInt(fd.get('focus_minutes'), 10) || 45));
    await q(sb.from('settings').update({ morning_on: fd.has('morning_on'), morning_time: fd.get('morning_time') || '08:45', evening_on: fd.has('evening_on'), evening_time: fd.get('evening_time') || '17:30',
      weekdays_only: fd.has('weekdays_only'), backup_nudge: fd.has('backup_nudge'), focus_minutes: fm, tz: TZ, updated_at: new Date().toISOString() }).eq('user_id', uid()));
    await loadSettings(); toast('Settings saved.');
  } },
    el('label', { class: 'line' }, chk('morning_on', s.morning_on), el('span', {}, 'Morning nudge to plan the day at'), tim('morning_time', s.morning_time)),
    el('label', { class: 'line' }, chk('evening_on', s.evening_on), el('span', {}, 'Evening nudge to close out the day at'), tim('evening_time', s.evening_time)),
    el('label', { class: 'line' }, chk('weekdays_only', s.weekdays_only), el('span', {}, 'Weekdays only')),
    el('label', { class: 'line' }, chk('backup_nudge', s.backup_nudge), el('span', {}, 'Sunday morning reminder to download a backup')),
    el('label', { class: 'line' }, el('span', {}, 'Focus block length'), el('input', { class: 'field', type: 'number', name: 'focus_minutes', min: '5', max: '180', step: '5', value: String(s.focus_minutes), style: 'width:90px' }), el('span', {}, 'minutes')),
    el('p', { class: 'meta', style: 'margin:0' }, `Times use your time zone (${TZ}). The evening nudge is skipped if you\u2019ve already closed out the day. Task reminders are set from inside each task.`),
    el('div', {}, el('button', { class: 'btn primary', type: 'submit' }, 'Save settings')));

  const np1 = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', minlength: '10', placeholder: 'New password' });
  const np2 = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', minlength: '10', placeholder: 'Repeat new password' });
  const pwForm = el('form', { class: 'settingsform', onsubmit: async e => {
    e.preventDefault();
    if (np1.value.length < 10) return toast('Use at least 10 characters.');
    if (np1.value !== np2.value) return toast('The two passwords don\u2019t match.');
    const { error } = await sb.auth.updateUser({ password: np1.value });
    if (error) return toast(error.message);
    np1.value = np2.value = ''; toast('Password updated.');
  } }, np1, np2, el('div', {}, el('button', { class: 'btn', type: 'submit' }, 'Change password')));

  return el('div', { style: 'max-width:680px' },
    el('div', { class: 'head' }, el('h1', {}, 'Settings')),
    el('section', { class: 'section', style: 'margin-top:12px' }, el('h2', {}, 'Notifications'), status, pushBtns,
      isIOS() && !isStandalone() ? el('p', { class: 'meta' }, 'On iPhone: tap Share \u2192 Add to Home Screen, open Daily Sheet from your Home Screen, then turn notifications on there.') : null),
    el('section', { class: 'section' }, el('h2', {}, 'Reminders and focus'), form),
    el('section', { class: 'section' }, el('h2', {}, 'Backup and export'),
      el('p', { class: 'meta' }, 'Download everything as a file you keep. JSON holds every table; CSV opens in Excel or Sheets.'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', onclick: e => busy(e.target, exportJson) }, 'Download full backup (JSON)'),
        el('button', { class: 'btn', onclick: e => busy(e.target, exportCsv) }, 'Download tasks (CSV)'))),
    el('section', { class: 'section' }, el('h2', {}, 'Password'), pwForm),
    el('section', { class: 'section' }, el('h2', {}, 'Session'),
      el('p', { class: 'meta' }, `Signed in as ${state.user.email}. This device stays signed in until you sign out.`),
      el('button', { class: 'btn danger', onclick: signOut }, 'Sign out')));
}

/* ---------- export ---------- */
function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function exportJson() {
  const out = { app: 'Daily Sheet', exported_at: new Date().toISOString() };
  for (const t of ['tasks', 'task_notes', 'task_links', 'reviews', 'wins', 'focus_sessions', 'inbox', 'settings', 'projects', 'doc_folders', 'documents', 'document_versions'])
    out[t] = await fetchAll(() => sb.from(t).select('*').order(t === 'settings' ? 'user_id' : 'id'));
  download(`daily-sheet-backup-${today()}.json`, JSON.stringify(out, null, 2), 'application/json');
  toast('Backup downloaded.');
}
async function exportCsv() {
  const cols = ['period_start', 'horizon', 'title', 'context', 'status', 'done_def', 'carry_count', 'created_at', 'completed_at'];
  const rows = await fetchAll(() => sb.from('tasks').select(cols.join(',')).order('period_start').order('id'));
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  download(`daily-sheet-tasks-${today()}.csv`, '\ufeff' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'), 'text/csv');
  toast('CSV downloaded.');
}

/* ---------- outcome drawer ---------- */
const outcomeFill = (t, s) => t.status === 'done' ? 100 : t.progress != null ? t.progress : (s.total ? Math.round(s.done / s.total * 100) : 0);
const outcomeLabel = (t, s) => t.status === 'done' ? 'Achieved'
  : t.progress != null ? `${t.progress}%${s.total ? ` \u00b7 ${s.done}/${s.total} weekly` : ''}`
  : s.total ? `${s.done}/${s.total} weekly done` : 'No progress yet';
function normaliseUrl(v) {
  let u = v.trim(); if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
}
async function deleteOutcome(t) {
  if (!confirm(`Delete "${t.title}"? Its progress log and links go too. Weekly priorities linked to it stay, just unlinked.`)) return;
  await q(sb.from('tasks').delete().eq('id', t.id));
  if (state.drawer === t.id) closeDrawer();
  toast('Outcome deleted.'); refresh();
}
let drawerEl = null, drawerReturn = null;
function closeDrawer() {
  if (!drawerEl) return;
  drawerEl.remove(); drawerEl = null; state.drawer = null;
  document.body.classList.remove('drawer-open');
  document.querySelectorAll('.outcome.open').forEach(c => c.classList.remove('open'));
  if (drawerReturn?.isConnected) drawerReturn.focus();
}
async function openDrawer(id) {
  drawerReturn = document.activeElement;
  state.drawer = id;
  document.querySelectorAll('.outcome').forEach(c => c.classList.toggle('open', c.dataset.oid === id));
  if (!drawerEl) {
    drawerEl = el('div', { class: 'drawer-wrap' },
      el('div', { class: 'drawer-scrim', onclick: closeDrawer }),
      el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Outcome details', tabindex: '-1' }, el('p', { class: 'dmuted' }, 'Loading\u2026')));
    document.body.append(drawerEl); document.body.classList.add('drawer-open');
  }
  try { await renderDrawer(); }
  catch (e) { drawerEl?.querySelector('.drawer').replaceChildren(el('p', { class: 'dmuted' }, 'Couldn\u2019t load this outcome. Close and try again.'), el('button', { class: 'dbtn', onclick: closeDrawer }, 'Close')); }
  drawerEl?.querySelector('.dclose, .dbtn')?.focus();
}
async function renderDrawer() {
  if (!drawerEl || !state.drawer) return;
  const id = state.drawer;
  const [rows, log, links, weeks] = await Promise.all([
    q(sb.from('tasks').select('*').eq('id', id).limit(1)),
    q(sb.from('task_notes').select('*').eq('task_id', id).order('created_at', { ascending: false })),
    q(sb.from('task_links').select('*').eq('task_id', id).order('created_at')),
    q(sb.from('tasks').select('id,title,status,period_start').eq('parent_id', id).eq('horizon', 'week').neq('status', 'carried').order('period_start'))]);
  const t = rows[0];
  if (!t || !drawerEl || state.drawer !== id) { if (!t) closeDrawer(); return; }
  const s = { done: weeks.filter(w => w.status === 'done').length, total: weeks.length };
  const fill = outcomeFill(t, s);
  const save = async patch => { await setTask(t.id, patch); refresh(); renderDrawer(); };
  const keepScroll = fn => async (...a) => { const y = drawerEl?.querySelector('.drawer')?.scrollTop || 0; await fn(...a); const d = drawerEl?.querySelector('.drawer'); if (d) d.scrollTop = y; };

  const title = el('textarea', { class: 'dtitle', rows: '2', maxlength: '500', value: t.title, 'aria-label': 'Outcome title',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } },
    onchange: keepScroll(() => title.value.trim() ? save({ title: title.value.trim() }) : (title.value = t.title)) });

  const statusBtn = t.status === 'open'
    ? el('button', { class: 'btn primary', onclick: keepScroll(() => save({ status: 'done', completed_at: new Date().toISOString() })) }, '\u2713 Mark achieved')
    : el('button', { class: 'dbtn', onclick: keepScroll(() => save({ status: 'open', completed_at: null })) }, t.status === 'dropped' ? 'Restore' : 'Reopen');

  const range = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(t.progress ?? fill), class: 'drange', 'aria-label': 'Progress percentage',
    oninput: () => { pctOut.textContent = range.value + '%'; drawerEl.querySelector('.dbar i').style.width = range.value + '%'; },
    onchange: keepScroll(() => save({ progress: +range.value })) });
  const pctOut = el('b', { class: 'dpct' }, fill + '%');

  const ctx = el('input', { class: 'dfield', value: t.context || '', list: 'ctx-drawer', placeholder: 'e.g. Augustova',
    onchange: keepScroll(() => save({ context: ctx.value.trim() || null })) });
  const doneDef = el('textarea', { class: 'dfield', rows: '2', value: t.done_def || '', placeholder: 'What will be true when this is achieved?',
    onchange: keepScroll(() => save({ done_def: doneDef.value.trim() || null })) });
  const remind = el('input', { class: 'dfield', type: 'datetime-local', value: t.remind_at ? toLocalInput(t.remind_at) : '',
    onchange: keepScroll(() => save({ remind_at: remind.value ? new Date(remind.value).toISOString() : null, reminded_at: null })) });

  const logBody = el('textarea', { class: 'dfield', rows: '2', maxlength: '5000', placeholder: 'What moved forward? e.g. 120 waitlist sign-ups after the LinkedIn post' });
  const logPct = el('input', { class: 'dfield dsmall', type: 'number', min: '0', max: '100', step: '5', placeholder: '%', 'aria-label': 'Progress now (optional %)' });
  const addLog = keepScroll(async () => {
    const body = logBody.value.trim(); if (!body) return logBody.focus();
    const pctv = logPct.value === '' ? null : Math.max(0, Math.min(100, Math.round(+logPct.value)));
    await q(sb.from('task_notes').insert({ user_id: uid(), task_id: t.id, body, kind: 'progress', pct: pctv }));
    if (pctv != null) await setTask(t.id, { progress: pctv });
    toast('Progress logged.'); refresh(); await renderDrawer();
  });

  const linkUrl = el('input', { class: 'dfield', type: 'url', placeholder: 'Paste a link', inputmode: 'url' });
  const linkLabel = el('input', { class: 'dfield', placeholder: 'Label (optional)', maxlength: '200' });
  const addLink = keepScroll(async () => {
    const url = normaliseUrl(linkUrl.value);
    if (!url) { toast('That doesn\u2019t look like a web link.'); return linkUrl.focus(); }
    await q(sb.from('task_links').insert({ user_id: uid(), task_id: t.id, url, label: linkLabel.value.trim() || null }));
    refresh(); await renderDrawer();
  });
  linkUrl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
  linkLabel.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });

  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  drawerEl.querySelector('.drawer').replaceChildren(
    el('div', { class: 'dhead' },
      el('span', { class: 'dkicker' }, `${monthName(t.period_start)} \u00b7 outcome`),
      el('span', { class: `dstatus s-${t.status}` }, { open: 'In progress', done: 'Achieved', dropped: 'Dropped', carried: 'Moved on' }[t.status]),
      el('button', { class: 'dclose', 'aria-label': 'Close details', onclick: closeDrawer }, '\u00d7')),
    title,
    el('div', { class: 'dactions' }, statusBtn,
      t.status === 'open' ? el('button', { class: 'dbtn', onclick: () => { startFocus(t); } }, '\u23f1 Focus on this') : null),

    el('section', { class: 'dsec' }, el('h3', {}, 'Progress'),
      el('div', { class: 'dprog' }, el('div', { class: 'dbar' }, el('i', { style: `width:${fill}%` })), pctOut),
      t.status === 'done' ? el('p', { class: 'dmuted' }, 'Achieved. Reopen it to keep tracking.') : el('div', { class: 'dslider' }, range,
        el('p', { class: 'dmuted' }, t.progress != null
          ? ['Set by hand. ', el('button', { class: 'dlink', onclick: keepScroll(() => save({ progress: null })) }, s.total ? 'Use weekly progress instead' : 'Clear')]
          : s.total ? 'Following your linked weekly priorities. Drag to set it by hand.' : 'Drag to set progress, or link weekly priorities from the Week page.'))),

    el('section', { class: 'dsec' }, el('h3', {}, 'Details'),
      el('label', { class: 'dlabel' }, 'Context', ctx, el('datalist', { id: 'ctx-drawer' }, CONTEXTS.map(c => el('option', { value: c })))),
      el('label', { class: 'dlabel' }, 'Done looks like', doneDef),
      el('label', { class: 'dlabel' }, 'Reminder', remind)),

    el('section', { class: 'dsec' }, el('h3', {}, 'Progress log', log.length ? el('small', {}, String(log.length)) : null),
      el('div', { class: 'dform' }, logBody, el('div', { class: 'drow' }, logPct, el('span', { class: 'dmuted' }, 'progress now (optional)'),
        el('button', { class: 'btn primary', onclick: addLog }, 'Log progress'))),
      log.length ? el('ol', { class: 'dlog' }, log.map(n => el('li', {},
        el('div', { class: 'dlogtop' }, el('time', { datetime: n.created_at }, timeAgo(n.created_at)),
          n.pct != null ? el('span', { class: 'dpill' }, n.pct + '%') : null,
          n.kind === 'note' ? el('span', { class: 'dpill note' }, 'note') : null,
          el('button', { class: 'dx', 'aria-label': 'Delete entry', onclick: keepScroll(async () => { if (!confirm('Delete this entry?')) return; await q(sb.from('task_notes').delete().eq('id', n.id)); refresh(); await renderDrawer(); }) }, '\u00d7')),
        el('p', {}, n.body)))) : el('p', { class: 'dmuted' }, 'No entries yet. Log small wins as they happen; they add up.')),

    el('section', { class: 'dsec' }, el('h3', {}, 'Links', links.length ? el('small', {}, String(links.length)) : null),
      links.length ? el('ul', { class: 'dlinks' }, links.map(l => el('li', {},
        el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, el('b', {}, l.label || host(l.url)), el('span', {}, host(l.url))),
        el('button', { class: 'dx', 'aria-label': `Remove link ${l.label || host(l.url)}`, onclick: keepScroll(async () => { await q(sb.from('task_links').delete().eq('id', l.id)); refresh(); await renderDrawer(); }) }, '\u00d7')))) : null,
      el('div', { class: 'dform' }, linkUrl, el('div', { class: 'drow' }, linkLabel, el('button', { class: 'dbtn', onclick: addLink }, 'Add link')))),

    el('section', { class: 'dsec' }, el('h3', {}, 'Weekly priorities feeding this', weeks.length ? el('small', {}, `${s.done}/${s.total}`) : null),
      weeks.length ? el('ul', { class: 'dweeks' }, weeks.map(w => el('li', { class: w.status === 'done' ? 'done' : '' },
        el('span', { class: 'dtick' }, w.status === 'done' ? '\u2713' : ''), el('span', { class: 'dwt' }, w.title),
        el('button', { class: 'dlink', onclick: () => go('week', w.period_start) }, fmt(w.period_start, { day: 'numeric', month: 'short' })))))
        : el('p', { class: 'dmuted' }, 'None yet. On the Week page, open a priority and choose this outcome under \u201cSupports this month\u2019s outcome\u201d.')),

    el('div', { class: 'dfoot' },
      t.status === 'open' ? el('button', { class: 'dbtn', onclick: async () => { await carry(t); toast('Moved to next month.'); closeDrawer(); refresh(); } }, 'Move to next month') : null,
      t.status === 'open' ? el('button', { class: 'dbtn', onclick: keepScroll(() => save({ status: 'dropped' })) }, 'Drop') : null,
      el('button', { class: 'dbtn danger', onclick: () => deleteOutcome(t) }, 'Delete outcome'))
  );
}

/* ---------- boot ---------- */
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') setTimeout(() => renderLogin(), 0);
  if (event === 'PASSWORD_RECOVERY') { try { sessionStorage.setItem('ds_recovery', '1'); } catch (e) {} setTimeout(route, 0); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Roll the Today page over to the new date if the tab was left open overnight.
  if (state.user && state.view === 'today' && state.cursor < today() && store('ds_seen') !== today()) {
    store('ds_seen', today()); go('today', today());
  }
  tickTimer();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drawerEl && !document.querySelector('dialog[open]')) { closeDrawer(); return; }
  if (drawerEl) return;
  if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || !mainEl?.isConnected) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault(); openCapture();
});
setInterval(tickTimer, 1000);
// Small extension hook so later features can live in their own files.
window.DS = { sb, q, el, state, uid, toast, refresh, go, setTask, carry, fetchTasks, fetchReview, reviewForm, taskList, taskDetail,
  startFocus, openDrawer, closeDrawer, renderDrawer, pad, iso, parse, today, addDays, weekStart, monthStart, addMonths, fmt,
  dayName, shortDay, monthName, timeAgo, ctxColor, CONTEXTS, views: {} };
{ const h = location.hash.slice(1); if (VIEWS.some(([k]) => k === h)) state.view = h; }
store('ds_seen', today());
window.addEventListener('online', () => { if (document.querySelector('.ls-offline')) route(); });
route();
})();
