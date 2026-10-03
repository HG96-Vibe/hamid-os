// Hamid OS theme: the "Chip" circuit background, plus the outlined date in headings.
(function () {
  // Background: "Chip". A single chip sits off to one side with traces fanning out from its pins to the edges
  // of the screen. Signals slowly flow out along them, and now and then back in, making the chip glow.
  // Colours follow the theme: light.css sets --bg-ink, --bg-glow, --bg-k and --bg-chip; dark defaults below.
  // Two layers: canvas.signal-bg holds the still traces (drawn only on resize or theme change) and the
  // see-through canvas.signal-fx on top holds what moves (signals and the chip), so each frame stays cheap.
  var canvas = document.createElement('canvas');
  canvas.className = 'signal-bg';
  canvas.setAttribute('aria-hidden', 'true');
  var fx = document.createElement('canvas');
  fx.className = 'signal-fx';
  fx.setAttribute('aria-hidden', 'true');
  var bgc = canvas.getContext('2d'), c = fx.getContext('2d');
  if (c && bgc) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1, px = 0, py = 0, target = 0, near = 0, running = false, last = 0, t0 = 0, lastSpawn = 0;
    var INK = '165,180,252', GLOW = '251,191,36', K = 1, CHIP_FILL = 'rgba(30,27,75,.85)';
    var chip = null, traces = [], sigs = [];
    var DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    var rgba = function (rgb, a) { return 'rgba(' + rgb + ',' + Math.max(0, Math.min(1, a)) + ')'; };
    var colours = function () {
      var st = getComputedStyle(document.documentElement), v = function (n) { return st.getPropertyValue(n).trim(); };
      INK = v('--bg-ink') || '165,180,252'; GLOW = v('--bg-glow') || '251,191,36';
      K = parseFloat(v('--bg-k')) || 1; CHIP_FILL = v('--bg-chip') || 'rgba(30,27,75,.85)';
    };
    var polyLen = function (p) { var L = 0; for (var i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
    var pointAt = function (p, d) {
      for (var i = 2; i < p.length; i += 2) {
        var sl = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        if (d <= sl) { var k = sl ? d / sl : 0; return [p[i - 2] + (p[i] - p[i - 2]) * k, p[i - 1] + (p[i + 1] - p[i - 1]) * k]; }
        d -= sl;
      }
      return [p[p.length - 2], p[p.length - 1]];
    };
    var layout = function () {
      // Sit in the empty right-hand margin beside the page when it is wide enough; otherwise at 80% across.
      // the page is 1140px wide, or about 94% of the window on wide screens (wide.css)
      var page = W >= 1320 ? Math.min(W * .94, 2000) - 100 : Math.min(1140, W - 40);
      var phone = W < 760, margin = (W - page) / 2, s = Math.min(150, Math.max(96, W * .09)), fits = margin > 96;
      if (!phone && fits) s = Math.max(64, Math.min(s, margin - 32));
      var cx = phone ? W * .5 : fits ? W - margin / 2 : W * .8, cy = H * (phone ? .22 : .32);
      chip = { x: cx - s / 2, y: cy - s / 2, s: s, glow: 0 }; traces = []; sigs = [];
      var pins = 7, gap = s / (pins + 1);
      for (var side = 0; side < 4; side++) for (var i = 1; i <= pins; i++) {
        var x, y, d, o = i * gap;
        if (side === 0) { x = chip.x + o; y = chip.y; d = 6; } else if (side === 1) { x = chip.x + s; y = chip.y + o; d = 0; }
        else if (side === 2) { x = chip.x + o; y = chip.y + s; d = 2; } else { x = chip.x; y = chip.y + o; d = 4; }
        var pts = [x, y], r = 16 + (i % 3) * 14; x += DIRS[d][0] * r; y += DIRS[d][1] * r; pts.push(x, y);
        var bend = (d + (i <= pins / 2 ? 7 : 1)) % 8; r = 18 + Math.abs(i - (pins + 1) / 2) * 16; x += DIRS[bend][0] * r; y += DIRS[bend][1] * r; pts.push(x, y);
        var far = Math.max(W, H) * 1.2; x += DIRS[d][0] * far; y += DIRS[d][1] * far; pts.push(x, y);
        traces.push({ pts: pts, len: polyLen(pts) });
      }
    };
    // The traces never move, so they are drawn once on the bottom layer; the glowing signal dot is
    // drawn once too and stamped where each signal is. Only the moving parts are drawn every frame.
    var lc = bgc;
    var dot = document.createElement('canvas'), DOT_R = 1.8, DOT_S = 0;
    var paintStatic = function () {
      lc.setTransform(dpr, 0, 0, dpr, 0, 0); lc.clearRect(0, 0, W, H);
      lc.lineWidth = 1.2; lc.lineJoin = 'round'; lc.strokeStyle = rgba(INK, .12 * K);
      for (var i = 0; i < traces.length; i++) { var tr = traces[i].pts; lc.beginPath(); lc.moveTo(tr[0], tr[1]); for (var j = 2; j < tr.length; j += 2) lc.lineTo(tr[j], tr[j + 1]); lc.stroke(); }
      DOT_S = Math.ceil(DOT_R * 5 * 2 * dpr) + 2;
      dot.width = dot.height = DOT_S;
      var dc = dot.getContext('2d'), m = DOT_S / 2, r = DOT_R * dpr;
      var g = dc.createRadialGradient(m, m, 0, m, m, r * 5);
      g.addColorStop(0, rgba(GLOW, .85 * K)); g.addColorStop(.3, rgba(GLOW, .85 * K * .35)); g.addColorStop(1, rgba(GLOW, 0));
      dc.fillStyle = g; dc.beginPath(); dc.arc(m, m, r * 5, 0, 6.2832); dc.fill();
      dc.fillStyle = rgba(GLOW, Math.min(1, .85 * K * 1.2)); dc.beginPath(); dc.arc(m, m, r, 0, 6.2832); dc.fill();
    };
    var resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
      canvas.width = fx.width = Math.round(W * dpr); canvas.height = fx.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout(); paintStatic(); dirty = [];
    };
    // Only the small patches that changed are cleared and redrawn (the chip and each signal), not the whole screen.
    var dirty = [];
    var draw = function (t, dt) {
      for (var k = 0; k < dirty.length; k++) c.clearRect(dirty[k][0] - 1, dirty[k][1] - 1, dirty[k][2] + 2, dirty[k][3] + 2);
      dirty = [];
      var s = t / 1000, i;
      if (!reduced && t - lastSpawn > 900 && sigs.length < 8) { lastSpawn = t; sigs.push({ tr: traces[Math.floor(Math.random() * traces.length)], d: 0, inward: Math.random() < .3 }); }
      var v = reduced ? 0 : .055 * dt, keep = [];
      for (i = 0; i < sigs.length; i++) {
        var sg = sigs[i], view = Math.min(sg.tr.len, Math.max(W, H) * .9);
        sg.d += v;
        if (sg.d < view) { var p = pointAt(sg.tr.pts, Math.max(0, sg.inward ? view - sg.d : sg.d)), ds = DOT_S / dpr, dx = p[0] - ds / 2, dy = p[1] - ds / 2; c.drawImage(dot, dx, dy, ds, ds); dirty.push([dx, dy, ds, ds]); keep.push(sg); }
        else if (sg.inward) chip.glow = 1;
      }
      sigs = keep;
      chip.glow *= reduced ? 1 : Math.pow(.985, dt / 16);
      var cx = chip.x + chip.s / 2, cy = chip.y + chip.s / 2, dc = Math.hypot(px - cx, py - cy);
      var hover = near > .01 && dc < 260 ? (1 - dc / 260) * near : 0;
      var lit = Math.max(chip.glow, .25 + .15 * Math.sin(s * .6), hover);
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, chip.s);
      g.addColorStop(0, rgba(GLOW, .18 * lit * K)); g.addColorStop(1, rgba(GLOW, 0));
      c.clearRect(chip.x - chip.s / 2 - 1, chip.y - chip.s / 2 - 1, chip.s * 2 + 2, chip.s * 2 + 2); // the dots may have crossed it
      c.fillStyle = g; c.fillRect(chip.x - chip.s / 2, chip.y - chip.s / 2, chip.s * 2, chip.s * 2);
      dirty.push([chip.x - chip.s / 2, chip.y - chip.s / 2, chip.s * 2, chip.s * 2]);
      c.fillStyle = CHIP_FILL; c.strokeStyle = rgba(INK, (.4 + lit * .3) * K); c.lineWidth = 1.4;
      c.beginPath(); if (c.roundRect) c.roundRect(chip.x, chip.y, chip.s, chip.s, 8); else c.rect(chip.x, chip.y, chip.s, chip.s); c.fill(); c.stroke();
      c.strokeStyle = rgba(INK, .22 * K);
      c.beginPath(); if (c.roundRect) c.roundRect(chip.x + 14, chip.y + 14, chip.s - 28, chip.s - 28, 4); else c.rect(chip.x + 14, chip.y + 14, chip.s - 28, chip.s - 28); c.stroke();
      c.fillStyle = rgba(GLOW, (.5 + lit * .5) * K); c.beginPath(); c.arc(chip.x + 22, chip.y + 22, 2.5, 0, 6.2832); c.fill();
    };
    var frame = function (now) {
      if (document.hidden) { running = false; return; }
      if (now - last < 32) { requestAnimationFrame(frame); return; } // about 30 frames a second
      var dt = Math.min(66, now - last); last = now;
      near += (target - near) * .15;
      draw(now - t0, dt);
      requestAnimationFrame(frame);
    };
    var start = function () {
      if (reduced) { draw(0, 16); return; }
      if (!running) { running = true; last = performance.now(); if (!t0) t0 = last; requestAnimationFrame(frame); }
    };
    window.addEventListener('resize', function () { resize(); if (reduced) draw(0, 16); });
    window.addEventListener('ds-theme', function () { colours(); paintStatic(); if (reduced) draw(0, 16); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    // Clicking the chip (on empty background, not on a card or button) fires two signals outwards.
    var CONTENT = 'button,a,input,textarea,select,label,dialog,section,article,header,nav,.card,.sheet,.outcome,.td-row,.td-tile,.mr-box,.hm-hero,.pf,.bar,.dock,.drawer-wrap,.timerbar,.toast';
    var onChip = function (e) {
      if (!chip || (e.target && e.target.closest && e.target.closest(CONTENT))) return false;
      return e.clientX >= chip.x && e.clientX <= chip.x + chip.s && e.clientY >= chip.y && e.clientY <= chip.y + chip.s;
    };
    var fire = function () {
      var picks = traces.slice().sort(function () { return Math.random() - .5; }).slice(0, 2);
      for (var i = 0; i < picks.length; i++) sigs.push({ tr: picks[i], d: 0, inward: false });
      chip.glow = 1;
      if (reduced) draw(0, 16);
    };
    window.addEventListener('click', function (e) { if (onChip(e)) fire(); });
    var hovering = false;
    var follow = function (e) {
      px = e.clientX; py = e.clientY; target = 1;
      var h = e.pointerType === 'mouse' && onChip(e);
      if (h !== hovering) { hovering = h; document.documentElement.style.cursor = h ? 'pointer' : ''; }
    };
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('pointerdown', follow, { passive: true });
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') target = 0; }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { target = 0; });
    colours();
    resize();
    document.body.insertBefore(fx, document.body.firstChild);
    document.body.insertBefore(canvas, fx);
    start();
  }

  // Headings: "Friday 2 October" becomes "Friday" + outlined "2 October.", "Week of 28 September" outlines the date.
  var DAY = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (.+)$/;
  var WEEK = /^(Week of) (.+)$/;
  var styleHeadings = function () {
    var hs = document.querySelectorAll('.head h1');
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.querySelector('em') || h.children.length) continue;
      var t = h.textContent, m = t.match(DAY) || t.match(WEEK);
      if (!m) continue;
      var em = document.createElement('em');
      em.textContent = m[2] + '.';
      h.textContent = m[1] + ' ';
      h.appendChild(em);
      h.setAttribute('aria-label', t);
    }
  };
  var app = document.getElementById('app');
  if (app) new MutationObserver(styleHeadings).observe(app, { childList: true, subtree: true });
})();
