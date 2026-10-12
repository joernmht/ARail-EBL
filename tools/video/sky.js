// Video only (tools/video/render.mjs, "inject"): a sky with clouds above the horizon of the layout
// plane, a ridge of hills, a distant city and belts of woods, and hazy land on the ground beyond
// the table and its modules. Painted over the picture before the virtual objects (View.render is
// wrapped), so the town stands in front of it. Not part of the app.
// Set before it, in the plan's "eval": window.__skyFront (y in mm in front of which no land is
// painted; default -560) and window.__skyCentre ([x, y], the middle of the woods; default
// [-900, 400]), both for Bf Neustadt.
(async () => {
  const ARail = await import("/arail/index.js");
  const V = ARail.View, orig = V.prototype.render;
  const FRONT = Number(window.__skyFront ?? -560); // no land in front of this line (the floor stays)
  const CENTRE = window.__skyCentre || [-900, 400];
  // a fixed random sky
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clouds = Array.from({ length: 70 }, () => ({
    az: rnd() * 2 * Math.PI, el: (1.8 + 16 * rnd() ** 2) * Math.PI / 180, size: (1.6 + 3.4 * rnd()) * Math.PI / 180,
    puffs: Array.from({ length: 7 + Math.floor(rnd() * 6) }, () => [rnd() * 2 - 1, rnd() * 0.5 - 0.15, 0.35 + 0.5 * rnd()]),
  }));
  // far away: a ridge of wooded hills all round, and towers of a city in front of it
  const ridge = Array.from({ length: 181 }, (_, i) => {
    const a = (i / 180) * 2 * Math.PI;
    return { a, h: 0.012 + 0.008 * Math.sin(3 * a + 1) + 0.006 * Math.sin(7 * a + 2) + 0.003 * Math.sin(17 * a) };
  });
  const skyline = [];
  // (the camera is only some 40 cm above the table: far blocks must be tall to rise above the horizon)
  for (let a = 0; a < 2 * Math.PI; a += 0.025 + 0.05 * rnd()) {
    if (rnd() < 0.35) continue;
    const r = 15000 + 10000 * rnd(), w = 500 + 900 * rnd(), h = rnd() < 0.25 ? 1500 + 900 * rnd() : 750 + 600 * rnd();
    skyline.push({ a, r, w, h, tone: rnd() });
  }
  skyline.sort((p, q) => q.r - p.r);
  // belts of woods between the town and the horizon (clusters of crowns, 3.5 to 9 m away)
  const woods = [];
  for (let k = 0; k < 46; k++) {
    const a = rnd() * 2 * Math.PI, r = 3500 + 5500 * rnd(), n = 6 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const aa = a + (rnd() - 0.5) * (900 / r), rr = r + (rnd() - 0.5) * 260;
      woods.push({ x: CENTRE[0] + rr * Math.cos(aa), y: CENTRE[1] + rr * Math.sin(aa), h: 140 + 120 * rnd(), tone: rnd() });
    }
  }

  function paint(view) {
    const { ctx, camera } = view, W = camera.width, H = camera.height;
    const { fx, fy, cx, cy } = camera.intrinsics;
    const { a1, a2, n } = view.pose;
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const r1 = a1.map((v) => v / len(a1)), r2 = a2.map((v) => v / len(a2));
    // direction (layout frame) -> image point, null behind the camera
    const dirPx = (d) => {
      const v = [0, 1, 2].map((i) => r1[i] * d[0] + r2[i] * d[1] + n[i] * d[2]);
      return v[2] > 1e-6 ? [fx * v[0] / v[2] + cx, fy * v[1] / v[2] + cy] : null;
    };
    // s(u, v) > 0: the ray through the pixel goes up (sky); linear in u, v
    const s = (u, v) => n[0] * (u - cx) / fx + n[1] * (v - cy) / fy + n[2];
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    const sky = clip(corners, (p) => s(p[0], p[1]));
    const grad = [n[0] / fx, n[1] / fy], gl = Math.hypot(...grad) || 1;
    // the horizon point nearest to the image centre, and the "up" direction in the image
    const k0 = s(W / 2, H / 2) / (gl * gl);
    const hz = [W / 2 - grad[0] * k0, H / 2 - grad[1] * k0], up = [grad[0] / gl, grad[1] / gl];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (sky.length >= 3) {
      ctx.save();
      path(ctx, sky);
      ctx.clip();
      const g = ctx.createLinearGradient(hz[0], hz[1], hz[0] + up[0] * 1.2 * H, hz[1] + up[1] * 1.2 * H);
      g.addColorStop(0, "#e4edf3");
      g.addColorStop(0.08, "#c9def0");
      g.addColorStop(0.35, "#8fbbe6");
      g.addColorStop(1, "#4f8fd4");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // clouds: soft white puffs, flat at the bottom, at fixed directions (they stay put when the camera turns)
      ctx.filter = `blur(${Math.max(2, 0.004 * W).toFixed(1)}px)`;
      const t = (view.time || 0) * 0.0004;
      for (const c of clouds) {
        const az = c.az + t;
        const centre = dirPx([Math.cos(c.el) * Math.cos(az), Math.cos(c.el) * Math.sin(az), Math.sin(c.el)]);
        if (!centre) continue;
        const R = fx * c.size, side = [-up[1], up[0]];
        if (centre[0] < -3 * R || centre[0] > W + 3 * R || centre[1] < -3 * R || centre[1] > H + 3 * R) continue;
        const fade = Math.min(1, (c.el * 180 / Math.PI - 1.5) / 4);
        for (const [dx, dy, pr] of c.puffs) {
          const px = centre[0] + side[0] * dx * R * 1.6 + up[0] * dy * R, py = centre[1] + side[1] * dx * R * 1.6 + up[1] * dy * R;
          const rr = pr * R;
          const rg = ctx.createRadialGradient(px, py, 0, px, py, rr);
          rg.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
          rg.addColorStop(0.6, `rgba(250,252,255,${0.65 * fade})`);
          rg.addColorStop(1, "rgba(245,249,255,0)");
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, 2 * Math.PI);
          ctx.fill();
        }
        // a slightly grey, flat base
        ctx.fillStyle = `rgba(214,224,236,${0.35 * fade})`;
        ctx.beginPath();
        ctx.ellipse(centre[0] - up[0] * 0.15 * R, centre[1] - up[1] * 0.15 * R, 1.5 * R, 0.22 * R, Math.atan2(side[1], side[0]), 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.filter = "none";
      ctx.restore();
    }
    // land: the ground beyond FRONT outside every tabletop, in an offscreen canvas
    const off = (window.__skyOff ||= document.createElement("canvas"));
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    const o = off.getContext("2d");
    o.clearRect(0, 0, W, H);
    const big = view._projectClipped([[-3e6, FRONT], [3e6, FRONT], [3e6, 3e6], [-3e6, 3e6]], 0, true)[0];
    if (big && big.length >= 3) {
      const lg = o.createLinearGradient(hz[0], hz[1], hz[0] - up[0] * 0.5 * H, hz[1] - up[1] * 0.5 * H);
      lg.addColorStop(0, "#c6d3d6");
      lg.addColorStop(0.05, "#aebfae");
      lg.addColorStop(0.3, "#93a98f");
      lg.addColorStop(1, "#7f977c");
      o.fillStyle = lg;
      path(o, big);
      o.fill();
      // the ridge: hills at the horizon (directions only), bluish in the haze
      const ridgePts = [];
      for (const q of ridge) {
        const p = dirPx([Math.cos(q.a), Math.sin(q.a), q.h]);
        if (p) ridgePts.push(p);
        else if (ridgePts.length) break;
      }
      const base = ridge.map((q) => dirPx([Math.cos(q.a), Math.sin(q.a), -0.002])).filter(Boolean);
      if (ridgePts.length > 2 && base.length > 2) {
        o.fillStyle = "#9db2b4";
        o.beginPath();
        // sweep the visible directions: the ridge line, then back along the horizon just below it
        const vis = ridge.map((q) => [dirPx([Math.cos(q.a), Math.sin(q.a), q.h]), dirPx([Math.cos(q.a), Math.sin(q.a), -0.002])]);
        let run = [];
        const flush = () => {
          if (run.length > 1) {
            o.moveTo(...run[0][0]);
            for (const [top] of run) o.lineTo(...top);
            for (let i = run.length - 1; i >= 0; i--) o.lineTo(...run[i][1]);
            o.closePath();
          }
          run = [];
        };
        for (const v of vis) (v[0] && v[1] ? run.push(v) : flush());
        flush();
        o.fill();
      }
      // the skyline: blocks standing on the far ground, hazy
      for (const b of skyline) {
        const c = [CENTRE[0] + b.r * Math.cos(b.a), CENTRE[1] + b.r * Math.sin(b.a)];
        const t = [-Math.sin(b.a), Math.cos(b.a)];
        const p0 = [c[0] - t[0] * b.w / 2, c[1] - t[1] * b.w / 2], p1 = [c[0] + t[0] * b.w / 2, c[1] + t[1] * b.w / 2];
        const q = [view.project(p0[0], p0[1], 0), view.project(p1[0], p1[1], 0), view.project(p1[0], p1[1], b.h), view.project(p0[0], p0[1], b.h)];
        if (q.some((p) => !p)) continue;
        const v = 176 + 22 * b.tone;
        o.fillStyle = `rgb(${v - 6},${v + 2},${v + 10})`;
        path(o, q);
        o.fill();
        // window bands, one per floor (3 m), faint in the haze
        o.fillStyle = `rgba(120,140,160,0.18)`;
        const floor = 3000 / 87;
        for (let z = floor * 0.6; z < b.h - floor * 0.5; z += floor) {
          const w = [view.project(p0[0], p0[1], z), view.project(p1[0], p1[1], z), view.project(p1[0], p1[1], z + floor * 0.35), view.project(p0[0], p0[1], z + floor * 0.35)];
          if (w.every(Boolean)) { path(o, w); o.fill(); }
        }
      }
      // the woods, far ones first, lighter in the haze
      const trees = woods.map((t) => ({ t, d: view.depth(t.x, t.y, 0) })).filter((e) => e.d > 50).sort((a, b) => b.d - a.d);
      for (const { t, d } of trees) {
        const c = view.project(t.x, t.y, 0.62 * t.h);
        if (!c || c[0] < -200 || c[0] > W + 200 || c[1] < -200 || c[1] > H + 200) continue;
        const R = (fx * 0.36 * t.h) / d, haze = Math.min(1, (d - 2500) / 9000);
        const g = [74 + 70 * haze + 14 * t.tone, 112 + 60 * haze + 10 * t.tone, 78 + 90 * haze];
        o.fillStyle = `rgb(${g.map(Math.round).join(",")})`;
        o.beginPath();
        o.ellipse(c[0], c[1], R, 1.15 * R, 0, 0, 2 * Math.PI);
        o.fill();
      }
      o.globalCompositeOperation = "destination-out";
      o.fillStyle = "#000";
      for (const obj of view.__tables || []) {
        const pts = view._projectClipped(obj, 0, true)[0];
        if (pts && pts.length >= 3) { path(o, pts); o.fill(); }
      }
      o.globalCompositeOperation = "source-over";
      ctx.drawImage(off, 0, 0);
    }
    ctx.restore();
  }

  function path(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
  }
  // Sutherland-Hodgman: the part of a polygon where f > 0
  function clip(poly, f) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
      if (fa > 0) out.push(a);
      if ((fa > 0) !== (fb > 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    return out;
  }

  const app = window.__arail;
  V.prototype.render = function () {
    if (!this.virtual && this.ctx === app.ctx) {
      // the footprints of the table and its modules: the ground there stays as it is
      this.__tables = app.world.objects.filter((o) => o.spec?.type === "tabletop").map((o) => {
        const sp = o.spec, [x, y] = sp.position, w = sp.width_mm / 2, d = sp.depth_mm / 2, r = ((sp.rotation_deg || 0) * Math.PI) / 180;
        const c = Math.cos(r), s = Math.sin(r);
        return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
      });
      paint(this);
    }
    return orig.call(this);
  };
})();
