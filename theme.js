// Hamid OS theme: the "Chip" circuit background, plus the outlined date in headings.
(function () {
  // Background: "Chip". A single chip sits off to one side with traces fanning out from its pins to the edges
  // of the screen. Signals slowly flow out along them, and now and then back in, making the chip glow.
  // Colours follow the theme: light.css sets --bg-ink, --bg-glow, --bg-k and --bg-chip; dark defaults below.
  var canvas = document.createElement('canvas');
  canvas.className = 'signal-bg';
  canvas.setAttribute('aria-hidden', 'true');
  var c = canvas.getContext('2d');
  if (c) {
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
    var glowDot = function (x, y, r, a) {
      var g = c.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, rgba(GLOW, a)); g.addColorStop(.3, rgba(GLOW, a * .35)); g.addColorStop(1, rgba(GLOW, 0));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 5, 0, 6.2832); c.fill();
      c.fillStyle = rgba(GLOW, Math.min(1, a * 1.2)); c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    };
    var layout = function () {
      // Sit in the empty right-hand margin beside the page when it is wide enough; otherwise at 80% across.
      var phone = W < 760, margin = (W - Math.min(1140, W - 40)) / 2, s = Math.min(150, Math.max(96, W * .09));
      if (!phone && margin > 116) s = Math.min(s, margin - 36);
      var cx = phone ? W * .5 : margin > 116 ? W - margin / 2 : W * .8, cy = H * (phone ? .22 : .32);
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
    var resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout();
    };
    var draw = function (t, dt) {
      c.clearRect(0, 0, W, H);
      var s = t / 1000, i, tr;
      if (!reduced && t - lastSpawn > 900 && sigs.length < 8) { lastSpawn = t; sigs.push({ tr: traces[Math.floor(Math.random() * traces.length)], d: 0, inward: Math.random() < .3 }); }
      c.lineWidth = 1.2; c.lineJoin = 'round'; c.strokeStyle = rgba(INK, .12 * K);
      for (i = 0; i < traces.length; i++) { tr = traces[i].pts; c.beginPath(); c.moveTo(tr[0], tr[1]); for (var j = 2; j < tr.length; j += 2) c.lineTo(tr[j], tr[j + 1]); c.stroke(); }
      var v = reduced ? 0 : .055 * dt, keep = [];
      for (i = 0; i < sigs.length; i++) {
        var sg = sigs[i], view = Math.min(sg.tr.len, Math.max(W, H) * .9);
        sg.d += v;
        if (sg.d < view) { var p = pointAt(sg.tr.pts, Math.max(0, sg.inward ? view - sg.d : sg.d)); glowDot(p[0], p[1], 1.8, .85 * K); keep.push(sg); }
        else if (sg.inward) chip.glow = 1;
      }
      sigs = keep;
      chip.glow *= reduced ? 1 : Math.pow(.985, dt / 16);
      var cx = chip.x + chip.s / 2, cy = chip.y + chip.s / 2, dc = Math.hypot(px - cx, py - cy);
      var hover = near > .01 && dc < 260 ? (1 - dc / 260) * near : 0;
      var lit = Math.max(chip.glow, .25 + .15 * Math.sin(s * .6), hover);
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, chip.s);
      g.addColorStop(0, rgba(GLOW, .18 * lit * K)); g.addColorStop(1, rgba(GLOW, 0));
      c.fillStyle = g; c.fillRect(chip.x - chip.s / 2, chip.y - chip.s / 2, chip.s * 2, chip.s * 2);
      c.fillStyle = CHIP_FILL; c.strokeStyle = rgba(INK, (.4 + lit * .3) * K); c.lineWidth = 1.4;
      c.beginPath(); if (c.roundRect) c.roundRect(chip.x, chip.y, chip.s, chip.s, 8); else c.rect(chip.x, chip.y, chip.s, chip.s); c.fill(); c.stroke();
      c.strokeStyle = rgba(INK, .22 * K);
      c.beginPath(); if (c.roundRect) c.roundRect(chip.x + 14, chip.y + 14, chip.s - 28, chip.s - 28, 4); else c.rect(chip.x + 14, chip.y + 14, chip.s - 28, chip.s - 28); c.stroke();
      c.fillStyle = rgba(GLOW, (.5 + lit * .5) * K); c.beginPath(); c.arc(chip.x + 22, chip.y + 22, 2.5, 0, 6.2832); c.fill();
    };
    var frame = function (now) {
      if (document.hidden) { running = false; return; }
      var dt = Math.min(50, now - last); last = now;
      near += (target - near) * .15;
      draw(now - t0, dt);
      requestAnimationFrame(frame);
    };
    var start = function () {
      if (reduced) { draw(0, 16); return; }
      if (!running) { running = true; last = performance.now(); if (!t0) t0 = last; requestAnimationFrame(frame); }
    };
    window.addEventListener('resize', function () { resize(); if (reduced) draw(0, 16); });
    window.addEventListener('ds-theme', function () { colours(); if (reduced) draw(0, 16); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    var follow = function (e) { px = e.clientX; py = e.clientY; target = 1; };
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('pointerdown', follow, { passive: true });
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') target = 0; }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { target = 0; });
    colours();
    resize();
    document.body.insertBefore(canvas, document.body.firstChild);
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
