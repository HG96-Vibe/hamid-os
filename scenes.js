// Moving backgrounds for the themes (themes.js): Aurora ribbons, Ocean waves, Forest fireflies, a Sunset sun in haze and a
// Space starfield with the odd shooting star. Focus (mono) has none. Night Circuit and Paper keep the Chip (theme.js).
// One canvas behind the page, about 30 frames a second, paused while the tab is hidden. Motion "calm" slows it,
// "off" (or the system's reduce-motion setting) draws one still frame. Background strength is the canvas opacity (themes.css).
(function () {
  'use strict';
  var root = document.documentElement;
  var cv = document.createElement('canvas');
  cv.className = 'scene-fx'; cv.setAttribute('aria-hidden', 'true');
  var c = cv.getContext('2d'); if (!c) return;
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var W = 0, H = 0, dpr = 1, running = false, last = 0, T = 0, name = '', S = null;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var speed = function () { var m = root.getAttribute('data-motion'); return mq.matches || m === 'off' ? 0 : m === 'calm' ? .4 : 1; };
  var glowSprite = function (rgb, r) {
    var s = document.createElement('canvas'), n = Math.ceil(r * 2 * dpr) + 2; s.width = s.height = n;
    var g = s.getContext('2d'), m = n / 2, gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(.18, 'rgba(' + rgb + ',.65)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n); return s;
  };

  var SCENES = {
    aurora: {
      init: function () {
        this.r = [
          { y: .16, a: .05, h: .26, rgb: '94,234,212', sp: .11, ph: 0 },
          { y: .25, a: .06, h: .2, rgb: '167,139,250', sp: .08, ph: 2 },
          { y: .1, a: .04, h: .18, rgb: '52,211,153', sp: .14, ph: 4 }];
        this.stars = []; for (var i = 0; i < 70; i++) this.stars.push([rnd(0, W), rnd(0, H * .7), rnd(.4, 1.2), rnd(.15, .5)]);
      },
      draw: function (t) {
        var i, x, s;
        c.fillStyle = '#fff';
        for (i = 0; i < this.stars.length; i++) { s = this.stars[i]; c.globalAlpha = s[3]; c.fillRect(s[0], s[1], s[2], s[2]); }
        c.globalAlpha = 1; c.globalCompositeOperation = 'lighter';
        for (i = 0; i < this.r.length; i++) {
          var r = this.r[i], top = [], bot = [], step = Math.max(16, W / 60);
          for (x = -step; x <= W + step; x += step) {
            var u = x / W, y = H * (r.y + r.a * Math.sin(u * 3 + t * r.sp + r.ph) + .025 * Math.sin(u * 8 - t * r.sp * 1.7 + r.ph));
            top.push(x, y); bot.push(x, y + H * r.h * (.55 + .45 * Math.sin(u * 5 + t * r.sp * 1.3 + r.ph * 2)));
          }
          var g = c.createLinearGradient(0, H * (r.y - r.a), 0, H * (r.y + r.a + r.h));
          g.addColorStop(0, 'rgba(' + r.rgb + ',0)'); g.addColorStop(.3, 'rgba(' + r.rgb + ',.26)'); g.addColorStop(.6, 'rgba(' + r.rgb + ',.1)'); g.addColorStop(1, 'rgba(' + r.rgb + ',0)');
          c.fillStyle = g; c.beginPath(); c.moveTo(top[0], top[1]);
          for (var k = 2; k < top.length; k += 2) c.lineTo(top[k], top[k + 1]);
          for (k = bot.length - 2; k >= 0; k -= 2) c.lineTo(bot[k], bot[k + 1]);
          c.closePath(); c.fill();
        }
        c.globalCompositeOperation = 'source-over';
      }
    },
    ocean: {
      init: function () { this.b = []; for (var i = 0; i < 22; i++) this.b.push([rnd(0, W), rnd(0, H), rnd(1, 2.6), rnd(.2, .6)]); },
      draw: function (t, dt) {
        for (var i = 0; i < this.b.length; i++) {
          var b = this.b[i]; b[1] -= b[3] * dt * .03; b[0] += Math.sin(t + i) * .1;
          if (b[1] < -10) { b[1] = H + 10; b[0] = rnd(0, W); }
          c.fillStyle = 'rgba(165,243,252,.16)'; c.beginPath(); c.arc(b[0], b[1], b[2], 0, 6.2832); c.fill();
        }
        for (var l = 0; l < 4; l++) {
          var base = H * (.74 + l * .065), amp = 10 + l * 7, wl = W / (1.3 + l * .45), sp = .5 + l * .18, step = Math.max(12, W / 80);
          c.beginPath(); c.moveTo(0, H);
          for (var x = 0; x <= W + step; x += step) c.lineTo(x, base + amp * Math.sin(x / wl * 6.2832 + t * sp * (l % 2 ? -1 : 1) + l) + amp * .35 * Math.sin(x / wl * 15 + t * sp * 1.6));
          c.lineTo(W, H); c.closePath();
          c.fillStyle = 'rgba(' + ['20,184,166', '14,116,144', '8,72,110', '4,40,72'][l] + ',' + (.2 + l * .14) + ')'; c.fill();
        }
      }
    },
    forest: {
      init: function () {
        this.f = []; for (var i = 0; i < (W < 700 ? 22 : 40); i++) this.f.push({ x: rnd(0, W), y: rnd(H * .2, H * .95), a: rnd(0, 6.28), v: rnd(.1, .3), ph: rnd(0, 6.28), fr: rnd(.6, 1.4) });
        this.dot = glowSprite('253,224,71', 9);
        var tr = document.createElement('canvas'); tr.width = Math.round(W * dpr); tr.height = Math.round(H * dpr);
        var g = tr.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        [['rgba(10,32,20,.75)', .78, 1.1], ['rgba(4,14,9,.95)', .86, .8]].forEach(function (L) {
          g.fillStyle = L[0];
          var x = -40; g.beginPath();
          while (x < W + 40) {
            var w = rnd(36, 70) * L[2], hgt = rnd(.12, .26) * H * L[2], base = H * L[1] + rnd(0, 20);
            g.moveTo(x, H); g.lineTo(x, base);
            for (var k = 0; k < 4; k++) { var yy = base - hgt * (k / 4), ww = w * (1 - k / 5) / 2; g.lineTo(x + w / 2 - ww, yy); g.lineTo(x + w / 2 - ww * .4, yy - hgt / 5); }
            g.lineTo(x + w / 2, base - hgt * 1.05);
            for (k = 3; k >= 0; k--) { yy = base - hgt * (k / 4); ww = w * (1 - k / 5) / 2; g.lineTo(x + w / 2 + ww * .4, yy - hgt / 5); g.lineTo(x + w / 2 + ww, yy); }
            g.lineTo(x + w, base); g.lineTo(x + w, H); x += w * .8;
          }
          g.fill();
        });
        this.trees = tr;
      },
      draw: function (t, dt) {
        c.drawImage(this.trees, 0, 0, W, H);
        var ds = this.dot.width / dpr;
        for (var i = 0; i < this.f.length; i++) {
          var f = this.f[i];
          f.a += (Math.random() - .5) * .08; f.x += Math.cos(f.a) * f.v * dt * .06; f.y += Math.sin(f.a) * f.v * dt * .04;
          if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10; if (f.y < H * .15) f.a = 1.57; if (f.y > H) f.a = -1.57;
          var lit = Math.max(0, Math.sin(t * f.fr + f.ph)); if (lit < .05) continue;
          c.globalAlpha = lit * .9; c.drawImage(this.dot, f.x - ds / 2, f.y - ds / 2, ds, ds);
        }
        c.globalAlpha = 1;
      }
    },
    sunset: {
      init: function () { this.h = []; for (var i = 0; i < 6; i++) this.h.push({ y: rnd(.5, .9), w: rnd(.3, .7), x: rnd(0, 1), v: rnd(.004, .012) * (i % 2 ? 1 : -1), a: rnd(.04, .09) }); },
      draw: function (t) {
        var r = Math.min(W, H) * (W < 700 ? .16 : .11), sx = W * (W < 700 ? .62 : .74), sy = H * .8, p = 1 + .04 * Math.sin(t * .5);
        var g = c.createRadialGradient(sx, sy, r * .5, sx, sy, r * 5 * p);
        g.addColorStop(0, 'rgba(253,186,116,.42)'); g.addColorStop(.35, 'rgba(249,115,22,.16)'); g.addColorStop(1, 'rgba(249,115,22,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        g = c.createLinearGradient(0, sy - r, 0, sy + r); g.addColorStop(0, 'rgba(254,240,138,.95)'); g.addColorStop(1, 'rgba(251,146,60,.9)');
        c.fillStyle = g; c.beginPath(); c.arc(sx, sy, r, 0, 6.2832); c.fill();
        for (var i = 0; i < this.h.length; i++) {
          var b = this.h[i], cx = ((b.x + t * b.v) % 1.6 + 1.6) % 1.6 - .3;
          c.fillStyle = 'rgba(255,214,190,' + b.a + ')'; c.beginPath(); c.ellipse(cx * W, b.y * H, b.w * W / 2, H * .018, 0, 0, 6.2832); c.fill();
        }
        // hills in front of the low sun
        c.fillStyle = 'rgba(36,12,40,.92)'; c.beginPath(); c.moveTo(0, H);
        for (var x = 0; x <= W + 20; x += 20) c.lineTo(x, H * .86 + Math.sin(x / W * 5 + 1) * H * .025 + Math.sin(x / W * 13) * H * .01);
        c.lineTo(W, H); c.closePath(); c.fill();
      }
    },
    space: {
      init: function () {
        this.s = []; var n = Math.round(W * H / 6000); for (var i = 0; i < Math.min(n, 320); i++) this.s.push([rnd(0, W), rnd(0, H), rnd(.4, 1.6), rnd(0, 6.28), rnd(.4, 1.6)]);
        this.shoot = null; this.next = rnd(4, 9);
      },
      draw: function (t, dt) {
        c.fillStyle = '#fff';
        for (var i = 0; i < this.s.length; i++) {
          var s = this.s[i]; s[0] -= s[2] * dt * .002 * (speed() ? 1 : 0); if (s[0] < 0) s[0] += W;
          c.globalAlpha = .35 + .4 * Math.sin(t * s[4] + s[3]) * .5 + .2; c.fillRect(s[0], s[1], s[2], s[2]);
        }
        c.globalAlpha = 1;
        if (!this.shoot && t > this.next && speed()) this.shoot = { x: rnd(W * .2, W), y: rnd(0, H * .4), t: t, a: rnd(2.5, 2.9) };
        var sh = this.shoot;
        if (sh) {
          var k = (t - sh.t) / 1.1, len = Math.min(W, 900);
          if (k > 1) { this.shoot = null; this.next = t + rnd(7, 15); }
          else {
            var hx = sh.x + Math.cos(sh.a) * len * k, hy = sh.y + Math.sin(sh.a) * len * k;
            var tx = hx - Math.cos(sh.a) * 160, ty = hy - Math.sin(sh.a) * 160;
            var g = c.createLinearGradient(hx, hy, tx, ty); g.addColorStop(0, 'rgba(224,242,254,' + (1 - k) + ')'); g.addColorStop(1, 'rgba(224,242,254,0)');
            c.strokeStyle = g; c.lineWidth = 1.6; c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
          }
        }
      }
    }
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (S) S.init(); paint(0);
  }
  function paint(dt) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    if (S) S.draw(T, dt);
  }
  function frame(now) {
    if (!S || document.hidden || !speed()) { running = false; return; }
    if (now - last < 32) { requestAnimationFrame(frame); return; }
    var dt = Math.min(66, now - last); last = now;
    T += dt / 1000 * speed();
    paint(dt * speed());
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || !S || document.hidden) return;
    if (!speed()) { paint(0); return; }
    running = true; last = performance.now(); requestAnimationFrame(frame);
  }
  function pickScene() {
    var id = root.classList.contains('scene') ? root.getAttribute('data-theme') : '';
    var next = SCENES[id] ? id : '';
    if (next !== name) { name = next; S = SCENES[name] || null; T = name === 'space' || name === 'aurora' ? rnd(0, 50) : 0; if (S) S.init(); }
    cv.style.display = S ? '' : 'none';
    paint(0); start();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('ds-theme', pickScene);
  document.addEventListener('visibilitychange', start);
  if (mq.addEventListener) mq.addEventListener('change', pickScene);
  var fx = document.querySelector('canvas.signal-fx');
  if (fx) fx.after(cv); else document.body.insertBefore(cv, document.body.firstChild);
  dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  pickScene();
})();
