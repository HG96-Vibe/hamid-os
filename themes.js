// Themes: Night Circuit (the default), Paper (light), Aurora, Ocean, Forest, Sunset, Space and Focus (plain, no motion).
// The palette button in the top bar opens a grid of swatches; Settings > Themes has the rest: your own accent colour,
// motion (full / calm / off), background strength, a morning and an evening theme (switching at 6am and 6pm, like Home),
// and a theme for while a focus block runs. The choice is saved on this device straight away and synced to your account
// (settings.appearance), so every device matches. Loaded in <head> so the page never flashes the wrong theme.
// Paper keeps html.light (light.css); the others set html[data-theme] (themes.css), and all but Night get html.scene,
// which hides the Chip background so scenes.js can draw theirs.
(function () {
  'use strict';
  var root = document.documentElement, KEY = 'ds_look';
  var THEMES = [
    { id: 'night', name: 'Night Circuit', bg: '#1e1b4b', accent: '#fbbf24', prev: 'radial-gradient(70% 60% at 20% 0%,#4f46e5,transparent 70%),linear-gradient(160deg,#312e81,#1e1b4b)' },
    { id: 'paper', name: 'Paper', light: true, bg: '#f6f4ef', accent: '#b45309', prev: 'radial-gradient(70% 60% at 15% 0%,rgba(99,102,241,.16),transparent 70%),linear-gradient(160deg,#fff,#f1ede3)' },
    { id: 'aurora', name: 'Aurora', scene: true, bg: '#0d1d2e', accent: '#5eead4', prev: 'radial-gradient(80% 35% at 35% 28%,rgba(94,234,212,.6),transparent 70%),radial-gradient(60% 30% at 72% 18%,rgba(167,139,250,.55),transparent 70%),linear-gradient(170deg,#0c2a33,#0d1d2e 55%,#120f2b)' },
    { id: 'ocean', name: 'Ocean', scene: true, bg: '#041226', accent: '#fb7185', prev: 'radial-gradient(130% 45% at 50% 112%,rgba(45,212,191,.6),transparent 62%),linear-gradient(180deg,#041226,#0a3a52)' },
    { id: 'forest', name: 'Forest', scene: true, bg: '#0b1d14', accent: '#facc15', prev: 'radial-gradient(3px 3px at 28% 42%,#fde047,transparent),radial-gradient(3px 3px at 66% 56%,#fde047,transparent),radial-gradient(2px 2px at 50% 28%,#fde68a,transparent),radial-gradient(2px 2px at 80% 36%,#fde68a,transparent),linear-gradient(175deg,#10281b,#06120c)' },
    { id: 'sunset', name: 'Sunset', scene: true, bg: '#24103a', accent: '#fdba74', prev: 'radial-gradient(22% 26% at 72% 84%,#fde68a,#fb923c 45%,transparent 72%),linear-gradient(180deg,#24103a,#4a1a45 45%,#7a2e3a 80%,#a24a2a)' },
    { id: 'space', name: 'Space', scene: true, bg: '#05060d', accent: '#7dd3fc', prev: 'radial-gradient(1.6px 1.6px at 18% 30%,#fff,transparent),radial-gradient(1.2px 1.2px at 70% 18%,#fff,transparent),radial-gradient(1.6px 1.6px at 46% 72%,#fff,transparent),radial-gradient(1.2px 1.2px at 86% 62%,#fff,transparent),radial-gradient(1.2px 1.2px at 30% 85%,#fff,transparent),radial-gradient(60% 50% at 72% 30%,rgba(56,189,248,.2),transparent 70%),linear-gradient(180deg,#05060d,#0a0f1e)' },
    { id: 'mono', name: 'Focus', scene: true, bg: '#18181b', accent: '#f4f4f5', prev: 'linear-gradient(180deg,#232326,#161618)' }
  ];
  var byId = function (id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; };
  var DEF = { theme: 'night', accent: '', motion: 'full', strength: 1, auto: false, morning: 'paper', evening: 'night', focus: '', at: 0 };

  var clean = function (p) {
    var o = {}, k; for (k in DEF) o[k] = DEF[k];
    if (p && typeof p === 'object') for (k in DEF) if (p[k] !== undefined && p[k] !== null) o[k] = p[k];
    ['theme', 'morning', 'evening'].forEach(function (k) { if (!byId(o[k])) o[k] = DEF[k]; });
    if (o.focus && !byId(o.focus)) o.focus = '';
    if (['full', 'calm', 'off'].indexOf(o.motion) < 0) o.motion = 'full';
    if (!/^#[0-9a-f]{6}$/i.test(o.accent || '')) o.accent = '';
    o.strength = Math.max(.2, Math.min(1, +o.strength || 1));
    o.auto = !!o.auto; o.at = +o.at || 0;
    return o;
  };
  var read = function () {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return clean(JSON.parse(raw));
      // carry over the old light / dark switch
      if (localStorage.getItem('ds_theme') === 'light') return clean({ theme: 'paper' });
    } catch (e) {}
    return clean(null);
  };
  var prefs = read();

  var focusing = function () {
    if (document.body) return document.body.classList.contains('has-timer');
    try { return !!localStorage.getItem('ds_timer'); } catch (e) { return false; }
  };
  var slot = function () { var h = new Date().getHours(); return h >= 6 && h < 18 ? 'morning' : 'evening'; };
  function effective() {
    if (prefs.focus && focusing()) return prefs.focus;
    if (prefs.auto) return prefs[slot()];
    return prefs.theme;
  }

  var applied = '';
  function apply() {
    var id = effective(), t = byId(id) || THEMES[0];
    root.setAttribute('data-theme', t.id);
    root.classList.toggle('light', !!t.light);
    root.classList.toggle('scene', !!t.scene);
    root.setAttribute('data-motion', prefs.motion);
    root.style.setProperty('--bg-str', String(prefs.strength));
    if (prefs.accent) {
      root.style.setProperty('--amber', prefs.accent);
      root.style.setProperty('--amber-2', 'color-mix(in srgb,' + prefs.accent + ' 82%,#000)');
      root.style.setProperty('--amber-3', 'color-mix(in srgb,' + prefs.accent + ' 62%,#000)');
      ['--x1', '--x2', '--x3'].forEach(function (n, i) { root.style.setProperty(n, 'var(--amber' + ['', '-2', '-3'][i] + ')'); });
    } else ['--amber', '--amber-2', '--amber-3', '--x1', '--x2', '--x3'].forEach(function (n) { root.style.removeProperty(n); });
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', t.bg);
    var cs = document.querySelector('meta[name="color-scheme"]'); if (cs) cs.setAttribute('content', t.light ? 'light' : 'dark');
    var key = [t.id, prefs.motion, prefs.strength, prefs.accent].join('|');
    if (key !== applied) { applied = key; window.dispatchEvent(new Event('ds-theme')); }
    var pop = document.querySelector('.th-pop'); if (pop) paintPop(pop);
  }
  apply();

  // Much of the app paints its gold accents with fixed colours (#fbbf24, #d97706, #b45309, #f59e0b). Once the stylesheets
  // are in, those are swapped for --x1 / --x2 / --x3, which stay the same gold on Night and Paper (themes.css) and take
  // the theme's own accent (or yours) on the rest.
  var GOLD = { '251, 191, 36': 1, '245, 158, 11': 2, '217, 119, 6': 2, '180, 83, 9': 3 };
  var GOLD_RE = /rgba?\((251, 191, 36|245, 158, 11|217, 119, 6|180, 83, 9)(?:, ([\d.]+))?\)/g;
  function retint(rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.cssRules && r.cssRules.length) retint(r.cssRules);
      var st = r.style; if (!st) continue;
      for (var j = 0; j < st.length; j++) {
        var prop = st[j]; if (prop.slice(0, 2) === '--') continue;
        var v = st.getPropertyValue(prop);
        if (v.indexOf('rgb') < 0) continue;
        GOLD_RE.lastIndex = 0; if (!GOLD_RE.test(v)) continue;
        var nv = v.replace(GOLD_RE, function (m, rgb, a) {
          var x = 'var(--x' + GOLD[rgb] + ')';
          return a === undefined ? x : 'color-mix(in srgb,' + x + ' ' + Math.round(parseFloat(a) * 100) + '%,transparent)';
        });
        st.setProperty(prop, nv, st.getPropertyPriority(prop));
      }
    }
  }
  var tinted = false;
  function retintAll() {
    if (tinted) return; tinted = true;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sh = document.styleSheets[i], rules = null;
      if (sh.href && sh.href.indexOf(location.origin) !== 0) continue;
      try { rules = sh.cssRules; } catch (e) { continue; }
      if (rules) retint(rules);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retintAll); else retintAll();

  /* ---------- saving + account sync ---------- */
  var pushTimer = null;
  function set(patch, quiet) {
    for (var k in patch) prefs[k] = patch[k];
    prefs = clean(prefs); prefs.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); localStorage.setItem('ds_theme', byId(prefs.theme).light ? 'light' : 'dark'); } catch (e) {}
    apply();
    if (!quiet) { clearTimeout(pushTimer); pushTimer = setTimeout(push, 700); }
  }
  function ready() { var DS = window.DS; return DS && DS.sb && DS.state && DS.state.user && DS.uid ? DS : null; }
  function push() {
    var DS = ready(); if (!DS) return;
    DS.sb.from('settings').update({ appearance: prefs }).eq('user_id', DS.uid()).then(function (r) {
      if (!r.error && DS.state.settings) DS.state.settings.appearance = prefs;
    }, function () {});
  }
  // the newer of this device's choice and the account's wins
  function merge(remote) {
    if (remote && typeof remote === 'object' && (+remote.at || 0) > prefs.at) {
      prefs = clean(remote);
      try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
      apply();
    } else if (prefs.at && (!remote || (+remote.at || 0) < prefs.at)) push();
  }
  var synced = false;
  function firstSync() {
    var DS = ready();
    if (synced || !DS || !DS.state.settings) return;
    synced = true; merge(DS.state.settings.appearance);
  }
  function pull() {
    var DS = ready(); if (!DS) return;
    DS.sb.from('settings').select('appearance').limit(1).then(function (r) { if (!r.error && r.data && r.data[0]) merge(r.data[0].appearance); }, function () {});
  }
  var tries = 0, poll = setInterval(function () { firstSync(); if (synced || ++tries > 240) clearInterval(poll); }, 500);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pull(); apply(); } });
  setInterval(apply, 60000); // morning / evening switch-over

  /* ---------- palette button + swatch grid ---------- */
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h2.1A4.4 4.4 0 0 0 21 10.8C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor"/><circle cx="15" cy="7.4" r="1.2" fill="currentColor"/></svg>';
  var h = function (tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.append(c); });
    return e;
  };
  function swatch(t, cls, onpick) {
    var cur = effective() === t.id;
    return h('button', { type: 'button', class: cls + (cur ? ' on' : ''), 'aria-pressed': cur ? 'true' : 'false', 'data-t': t.id, onclick: function () { onpick(t.id); } }, [
      h('span', { class: 'th-prev', style: 'background:' + t.prev, 'aria-hidden': 'true' }, [h('i', { style: 'background:' + t.accent })]),
      h('span', { class: 'th-name', text: t.name })]);
  }
  function note() {
    if (prefs.focus && focusing()) return 'Your focus theme is on while the focus block runs.';
    if (prefs.auto) return 'Switching by time of day (' + byId(prefs.morning).name + ' from 6am, ' + byId(prefs.evening).name + ' from 6pm). Picking one here turns that off.';
    return '';
  }
  function pick(id) {
    var patch = { theme: id };
    if (prefs.auto) patch.auto = false;
    set(patch);
  }
  function paintPop(pop) {
    pop.textContent = '';
    var n = note();
    pop.append.apply(pop, [
      h('div', { class: 'th-poph' }, [h('b', { text: 'Theme' }), h('button', { type: 'button', class: 'th-more', onclick: function () { closePop(); if (window.DS && DS.go) DS.go('settings'); setTimeout(function () { var s = document.getElementById('th-settings'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); } , text: 'More options' })]),
      h('div', { class: 'th-grid', role: 'group', 'aria-label': 'Themes' }, THEMES.map(function (t) { return swatch(t, 'th-sw', pick); })),
      n ? h('p', { class: 'th-note', text: n }) : null].filter(Boolean));
  }
  function outside(e) { var p = document.querySelector('.th-pop'); if (p && !p.contains(e.target) && !e.target.closest('.th-btn')) closePop(); }
  function closePop(focusBtn) {
    var p = document.querySelector('.th-pop'); if (!p) return;
    p.remove(); document.removeEventListener('pointerdown', outside, true);
    var b = document.querySelector('.th-btn'); if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBtn) b.focus(); }
  }
  function place(pop, btn) {
    // the page may be zoomed (display.js), which scales these lengths too
    var z = root.classList.contains('ds-zoomed') ? parseFloat(getComputedStyle(root).getPropertyValue('--ds-zoom')) || 1 : 1;
    var r = btn.getBoundingClientRect(), w = Math.min(340, (window.innerWidth - 16) / z);
    pop.style.width = w + 'px';
    pop.style.top = Math.round((r.bottom + 10) / z) + 'px';
    pop.style.left = Math.round(Math.max(8 / z, Math.min((window.innerWidth - 8) / z - w, r.right / z - w))) + 'px';
  }
  function openPop(btn) {
    if (document.querySelector('.th-pop')) return closePop();
    var pop = h('div', { class: 'th-pop', role: 'dialog', 'aria-label': 'Choose a theme' });
    pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(true); } });
    paintPop(pop); document.body.append(pop); place(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    var on = pop.querySelector('.th-sw.on') || pop.querySelector('.th-sw'); if (on) on.focus();
  }
  window.addEventListener('resize', function () { var p = document.querySelector('.th-pop'), b = document.querySelector('.th-btn'); if (p && b) place(p, b); });

  function inject() {
    var acts = document.querySelector('#app header.bar .baractions');
    if (!acts || acts.querySelector('.th-btn')) return;
    var b = h('button', { type: 'button', class: 'lt-toggle th-btn', 'aria-label': 'Change theme', title: 'Theme', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: function () { openPop(b); } });
    b.innerHTML = ICON;
    acts.insertBefore(b, acts.firstChild);
  }

  /* ---------- Settings > Themes ---------- */
  function seg(name, opts, val, onchange) {
    return h('div', { class: 'th-seg', role: 'radiogroup', 'aria-label': name }, opts.map(function (o) {
      return h('button', { type: 'button', role: 'radio', 'aria-checked': String(o[0] === val), class: o[0] === val ? 'on' : '', onclick: function () { onchange(o[0]); }, text: o[1] });
    }));
  }
  function select(label, val, withNone, onchange) {
    var s = h('select', { class: 'field th-sel', 'aria-label': label, onchange: function () { onchange(s.value); } },
      (withNone ? [h('option', { value: '', text: 'No change' })] : []).concat(THEMES.map(function (t) { return h('option', { value: t.id, text: t.name }); })));
    s.value = val || '';
    return s;
  }
  function settingsBox() {
    var box = h('section', { class: 'section th-set', id: 'th-settings' });
    var draw = function () {
      box.textContent = '';
      var accentIn = h('input', { type: 'color', class: 'th-color', 'aria-label': 'Your accent colour', value: prefs.accent || byId(effective()).accent });
      accentIn.addEventListener('change', function () { set({ accent: accentIn.value }); draw(); });
      var str = h('input', { type: 'range', min: '0.2', max: '1', step: '0.1', value: String(prefs.strength), 'aria-label': 'Background strength', class: 'th-range' });
      str.addEventListener('input', function () { set({ strength: +str.value }); });
      var row = function (label, sub, ctl) { return h('div', { class: 'th-row' }, [h('div', { class: 'th-lab' }, [h('b', { text: label }), sub ? h('small', { text: sub }) : null]), ctl]); };
      box.append.apply(box, [
        h('h2', { text: 'Themes' }),
        h('p', { class: 'meta th-sub', text: 'Saved to your account, so your phone and computer match.' }),
        h('div', { class: 'th-big', role: 'group', 'aria-label': 'Themes' }, THEMES.map(function (t) { return swatch(t, 'th-sw big', function (id) { pick(id); draw(); }); })),
        note() ? h('p', { class: 'th-note', text: note() }) : null,
        row('Accent', 'Buttons, highlights and the focus bar.', h('div', { class: 'th-acc' }, [
          seg('Accent', [['', 'Theme’s own'], ['mine', 'My colour']], prefs.accent ? 'mine' : '', function (v) { set({ accent: v ? accentIn.value : '' }); draw(); }),
          prefs.accent ? accentIn : null])),
        row('Motion', 'Calm slows the background down; Off keeps it still.', seg('Motion', [['full', 'Full'], ['calm', 'Calm'], ['off', 'Off']], prefs.motion, function (v) { set({ motion: v }); draw(); })),
        row('Background strength', 'How much the moving background shows.', str),
        row('Morning and evening', 'Switch theme by time of day: morning from 6am, evening from 6pm.', h('div', { class: 'th-auto' }, [
          h('label', { class: 'th-check' }, [(function () { var c = h('input', { type: 'checkbox' }); c.checked = prefs.auto; c.addEventListener('change', function () { set({ auto: c.checked }); draw(); }); return c; })(), h('span', { text: 'On' })]),
          h('label', { class: 'th-mini' }, [h('span', { text: 'Morning' }), select('Morning theme', prefs.morning, false, function (v) { set({ morning: v }); draw(); })]),
          h('label', { class: 'th-mini' }, [h('span', { text: 'Evening' }), select('Evening theme', prefs.evening, false, function (v) { set({ evening: v }); draw(); })])])),
        row('During a focus block', 'Switches while the timer runs, then back.', select('Focus block theme', prefs.focus, true, function (v) { set({ focus: v }); draw(); }))].filter(Boolean));
    };
    draw();
    window.addEventListener('ds-theme', function () { if (box.isConnected) { var a = document.activeElement; if (!(a && box.contains(a) && a.type === 'range')) draw(); } });
    return box;
  }
  function injectSettings() {
    var DS = window.DS, wrap = document.getElementById('main');
    if (!DS || !DS.state || DS.state.view !== 'settings' || !wrap || wrap.querySelector('#th-settings')) return;
    var hd = wrap.querySelector('h1'); if (!hd || hd.textContent !== 'Settings') return;
    var secs = wrap.querySelectorAll('section');
    var box = settingsBox();
    if (secs[0]) secs[0].after(box); else wrap.append(box);
  }

  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; inject(); injectSettings(); firstSync(); });
  }).observe(root, { childList: true, subtree: true });
  var watchBody = function () { new MutationObserver(apply) /* focus block started / ended */.observe(document.body, { attributes: true, attributeFilter: ['class'] }); apply(); };
  if (document.body) watchBody(); else document.addEventListener('DOMContentLoaded', watchBody);

  window.DS_theme = { THEMES: THEMES, get: function () { return clean(prefs); }, set: set, current: effective };
})();
