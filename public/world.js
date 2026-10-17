// 3D world view: the zone's real terrain (from the client's map files) with its map draped over it,
// plus you, your route, NPCs, exits, your markers and the heatmap. Uses three.js from the CDN.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const KIND_COLOR = { farm: 0x3aa682, boss: 0xd4574b, npc: 0x6aa7e0, danger: 0xd4574b, star: 0xd6a84a };

export function createWorld({ canvas, labels, tip, t = (s) => s, onInfo = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 5, 40000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 40; controls.maxDistance = 12000;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-3000, 5000, 2000); scene.add(sun);

  const layers = { ground: new THREE.Group(), me: new THREE.Group(), npcs: new THREE.Group(), mobs: new THREE.Group(), portals: new THREE.Group(), marks: new THREE.Group(), heat: new THREE.Group(), party: new THREE.Group(), replay: new THREE.Group(), route: new THREE.Group() };
  for (const g of Object.values(layers)) scene.add(g);
  let zone = null, data = null, heightAt = () => 0, toLocal = (x, z) => [x, z];
  const labelEls = []; // { el, pos: Vector3, layer, always }
  const pickables = [];
  let follow = false, running = true, firstFrame = true;

  const clear = (g) => { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); }); } };
  function addLabel(text, pos, layer, cls = '', always = false) {
    const el = document.createElement('div');
    el.className = `wlabel notr ${cls}`; el.textContent = text; // game names: never run through the translator
    labels.appendChild(el);
    labelEls.push({ el, pos, layer, always });
  }
  const pin = (color, r = 14, h = 60) => {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); head.position.y = h;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, h, 6), m); stem.position.y = h / 2;
    g.add(head, stem);
    return g;
  };

  function buildGround(d) {
    clear(layers.ground);
    const ter = d.terrain, size = ter ? ter.size : 5120, n = ter ? ter.n : 2;
    const x0 = ter ? ter.x0 : -2560, z0 = ter ? ter.z0 : 2560, step = size / (n - 1);
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, lx = x0 + c * step, lz = z0 - r * step;
      pos[i * 3] = lx; pos[i * 3 + 1] = ter ? ter.heights[i] : 0; pos[i * 3 + 2] = -lz;
      uv[i * 2] = c / (n - 1); uv[i * 2 + 1] = 1 - r / (n - 1);
      if (ter) for (let k = 0; k < 3; k++) col[i * 3 + k] = ter.colors[i * 3 + k] / 255;
    }
    const idx = [];
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const a = r * n + c, b = a + 1, e = a + n, f = e + 1; idx.push(a, e, b, b, e, f); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (ter && !d.image) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: !!(ter && !d.image), side: THREE.DoubleSide });
    if (d.image) {
      new THREE.TextureLoader().load(d.image, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); mat.map = tex; mat.needsUpdate = true; });
    }
    const mesh = new THREE.Mesh(geo, mat);
    layers.ground.add(mesh);
    // bilinear height lookup in zone-local coordinates
    heightAt = (lx, lz) => {
      if (!ter) return 0;
      const fc = Math.min(n - 1.001, Math.max(0, (lx - x0) / step)), fr = Math.min(n - 1.001, Math.max(0, (z0 - lz) / step));
      const c = Math.floor(fc), r = Math.floor(fr), dx = fc - c, dz = fr - r, H = ter.heights;
      const h00 = H[r * n + c], h01 = H[r * n + c + 1], h10 = H[(r + 1) * n + c], h11 = H[(r + 1) * n + c + 1];
      return (h00 * (1 - dx) + h01 * dx) * (1 - dz) + (h10 * (1 - dx) + h11 * dx) * dz;
    };
  }

  function buildOverlays(d) {
    for (const k of ['npcs', 'mobs', 'portals', 'marks', 'heat', 'party', 'replay', 'route']) clear(layers[k]);
    for (const l of labelEls.splice(0)) l.el.remove();
    partyPins.clear(); rp = null; // their labels went with the others
    pickables.length = 0;
    const at = (x, z, lift = 0) => { const [lx, lz] = toLocal(x, z); return new THREE.Vector3(lx, heightAt(lx, lz) + lift, -lz); };
    for (const s of d.npcs) {
      const p = pin(0x6aa7e0, 9, 45); p.position.copy(at(s.x, s.z)); layers.npcs.add(p);
      p.userData.tip = `${s.name || `NPC #${s.npc}`}`; pickables.push(p);
      addLabel(s.name || `NPC #${s.npc}`, at(s.x, s.z, 62), 'npcs', 'npc');
    }
    // monster spots known from quests: a red ring on the ground and a pin
    for (const m of d.mobs || []) {
      const p = pin(0xd4574b, 10, 50); p.position.copy(at(m.x, m.z)); layers.mobs.add(p);
      const area = new THREE.Mesh(new THREE.RingGeometry(110, 130, 40), new THREE.MeshBasicMaterial({ color: 0xd4574b, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      area.rotation.x = -Math.PI / 2; area.position.copy(at(m.x, m.z, 4)); layers.mobs.add(area);
      const label = `${m.name}${m.level ? ` (Lv ${m.level})` : ''}`;
      p.userData.tip = m.drop ? `${label} · ${t('drops {item}', { item: m.drop })}` : label; pickables.push(p);
      addLabel(label, at(m.x, m.z, 66), 'mobs', 'mob');
    }
    for (const e of d.portals) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 7, 10, 32), new THREE.MeshLambertMaterial({ color: 0xa77fd6, emissive: 0xa77fd6, emissiveIntensity: 0.5 }));
      ring.position.copy(at(e.x, e.z, 50)); layers.portals.add(ring);
      ring.userData.tip = `${t('Exit')} → ${e.toName}`; pickables.push(ring);
      addLabel(`→ ${e.toName}`, at(e.x, e.z, 110), 'portals', 'portal', true);
    }
    for (const w of d.waypoints) {
      const p = pin(KIND_COLOR[w.kind] || KIND_COLOR.star, 12, 70); p.position.copy(at(w.x, w.z)); layers.marks.add(p);
      p.userData.tip = `${w.label}${w.owner ? ` (${w.owner})` : ''}${w.note ? ` · ${w.note}` : ''}`; pickables.push(p);
      addLabel(w.label, at(w.x, w.z, 92), 'marks', 'mark', true);
    }
    // where you died: a crimson cross standing on the ground (with the markers layer)
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xd4574b, emissive: 0x7a1d16, emissiveIntensity: 0.6 });
    for (const x of d.deaths || []) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 8), crossMat); post.position.y = 30;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 8), crossMat); bar.position.y = 44;
      g.add(post, bar); g.position.copy(at(x.x, x.z)); layers.marks.add(g);
      post.userData.tip = `✝ ${new Date(x.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${x.near?.length ? ` · ${x.near.slice(0, 4).join(', ')}` : ''}`;
      pickables.push(post);
    }
    if (d.heat.length) {
      const max = Math.max(...d.heat.map((h) => h[2]));
      const geo = new THREE.BoxGeometry(d.cell, 1, d.cell), mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      const inst = new THREE.InstancedMesh(geo, mat, d.heat.length);
      const m4 = new THREE.Matrix4(), c = new THREE.Color(), lo = new THREE.Color(0xf6d78b), hi = new THREE.Color(0xb3261e);
      d.heat.forEach(([x, z, s], i) => {
        const f = Math.sqrt(s / max), p = at(x, z), h = 6 + 120 * f;
        m4.makeScale(1, h, 1); m4.setPosition(p.x, p.y + h / 2, p.z); inst.setMatrixAt(i, m4);
        inst.setColorAt(i, c.copy(lo).lerp(hi, f));
      });
      layers.heat.add(inst);
    }
  }

  // you: a gold pin, a beam so you can find yourself from far away, and your route
  const meMat = new THREE.MeshLambertMaterial({ color: 0xd6a84a, emissive: 0xd6a84a, emissiveIntensity: 0.6 });
  const me = new THREE.Group();
  const meHead = new THREE.Mesh(new THREE.ConeGeometry(16, 40, 16), meMat); meHead.rotation.x = Math.PI; meHead.position.y = 40;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 600, 6), new THREE.MeshBasicMaterial({ color: 0xd6a84a, transparent: true, opacity: 0.35 })); beam.position.y = 340;
  me.add(meHead, beam); me.visible = false; layers.me.add(me);
  let route = null;
  function updateMe(S) {
    const p = S?.session?.position;
    const here = p && data && String(p.zone) === String(zone);
    me.visible = !!here;
    if (route) { layers.me.remove(route); route.geometry.dispose(); route = null; }
    if (!here) return null;
    const [lx, lz] = toLocal(p.x, p.z);
    me.position.set(lx, heightAt(lx, lz), -lz);
    const tr = (S.session.trail || []).slice(-1500);
    if (tr.length > 1) {
      const pts = tr.map(([x, z]) => { const [a, b] = toLocal(x, z); return new THREE.Vector3(a, heightAt(a, b) + 6, -b); });
      route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xd6a84a }));
      layers.me.add(route);
    }
    if (follow) controls.target.lerp(me.position, 0.25);
    return me.position;
  }

  // friends from friends sync who are in this zone right now
  const partyPins = new Map(); // name -> { pin, label }
  function updateParty(S) {
    const here = (S?.friends?.party || []).filter((f) => f.online && f.live?.running && f.live.zone != null && String(f.live.zone) === String(zone) && f.live.x != null);
    const names = new Set(here.map((f) => f.name));
    for (const [n, e] of partyPins) if (!names.has(n)) { layers.party.remove(e.pin); e.label.el.remove(); labelEls.splice(labelEls.indexOf(e.label), 1); partyPins.delete(n); }
    for (const f of here) {
      let e = partyPins.get(f.name);
      if (!e) {
        const p = pin(0x5ac8fa, 14, 70); layers.party.add(p); pickables.push(p);
        addLabel('', new THREE.Vector3(), 'party', 'friend', true);
        e = { pin: p, label: labelEls[labelEls.length - 1] }; partyPins.set(f.name, e);
      }
      const [lx, lz] = toLocal(f.live.x, f.live.z), y = heightAt(lx, lz);
      e.pin.position.set(lx, y, -lz); e.label.pos.set(lx, y + 92, -lz);
      const text = `${f.name}${f.live.character ? ` · ${f.live.character}` : ''}${f.live.afk ? ' (AFK)' : ''}`;
      e.label.el.textContent = text; e.pin.userData.tip = text;
    }
  }

  // ---- session replay: the route of a past session, a marker that follows it in time, and the players you met
  let rp = null;
  function startReplay({ points, players }) {
    stopReplay();
    const pts = points.map(([, x, z]) => { const [a, b] = toLocal(x, z); return new THREE.Vector3(a, heightAt(a, b) + 8, -b); });
    if (pts.length < 2) return false;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.55 }));
    const done = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pts[0], pts[0]]), new THREE.LineBasicMaterial({ color: 0x5ac8fa }));
    const marker = pin(0x5ac8fa, 16, 60);
    layers.replay.add(line, done, marker);
    const who = players.map((p) => {
      const [a, b] = toLocal(p.x, p.z), pos = new THREE.Vector3(a, heightAt(a, b), -b);
      const m = pin(0xd6a84a, 8, 40); m.position.copy(pos); m.visible = false; m.userData.tip = p.name; layers.replay.add(m); pickables.push(m);
      addLabel(p.name, pos.clone().setY(pos.y + 56), 'replay', 'met');
      return { ...p, m, label: labelEls[labelEls.length - 1] };
    });
    rp = { times: points.map((p) => p[0]), pts, done, marker, who };
    controls.target.copy(pts[0]);
    camera.position.set(pts[0].x, pts[0].y + 1400, pts[0].z + 1600);
    return true;
  }
  function replayAt(t) {
    if (!rp) return;
    let i = 0; while (i < rp.times.length - 1 && rp.times[i + 1] <= t) i++;
    const a = rp.pts[i], b = rp.pts[Math.min(i + 1, rp.pts.length - 1)], span = (rp.times[i + 1] || rp.times[i]) - rp.times[i];
    const f = span > 0 ? Math.min(1, Math.max(0, (t - rp.times[i]) / span)) : 0;
    rp.marker.position.copy(a).lerp(b, f); rp.marker.position.y -= 8; // route points float 8 above the ground
    rp.done.geometry.dispose(); rp.done.geometry = new THREE.BufferGeometry().setFromPoints([...rp.pts.slice(0, i + 1), rp.marker.position.clone().setY(rp.marker.position.y + 8)]);
    for (const w of rp.who) { const on = w.t <= t; w.m.visible = on; w.label.hidden = !on; }
    if (follow) controls.target.lerp(rp.marker.position, 0.2);
  }
  function stopReplay() {
    if (!rp) return;
    for (const w of rp.who) { w.label.el.remove(); labelEls.splice(labelEls.indexOf(w.label), 1); }
    clear(layers.replay); rp = null;
  }

  // ---- a planned route through this zone: from you (or the entrance) to the exit / target
  function showRoute(legs) {
    clear(layers.route);
    for (const l of labelEls.filter((x) => x.layer === 'route')) { l.el.remove(); labelEls.splice(labelEls.indexOf(l), 1); }
    for (const leg of legs || []) {
      const [ax, az] = toLocal(leg.from.x, leg.from.z), [bx, bz] = toLocal(leg.to.x, leg.to.z);
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
      const pts = Array.from({ length: n + 1 }, (_, i) => { const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n; return new THREE.Vector3(x, heightAt(x, z) + 12, -z); });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 7, 6, false), new THREE.MeshBasicMaterial({ color: 0x3aa682 }));
      layers.route.add(tube);
      const end = pin(0x3aa682, 16, 80); end.position.copy(pts[pts.length - 1]).setY(pts[pts.length - 1].y - 12); layers.route.add(end);
      end.userData.tip = leg.label; pickables.push(end);
      addLabel(leg.label, pts[pts.length - 1].clone().setY(pts[pts.length - 1].y + 90), 'route', 'route', true);
    }
  }

  async function load(z, focus) {
    zone = String(z);
    onInfo(t('Loading…'));
    const d = await fetch(`/api/world/${zone}`).then((r) => r.json());
    if (String(z) !== zone) return; // another zone was picked meanwhile
    data = d;
    toLocal = (x, zz) => [x - d.center.cx, zz - d.center.cz];
    buildGround(d);
    buildOverlays(d);
    const tgt = focus ? (() => { const [lx, lz] = toLocal(focus.x, focus.z); return new THREE.Vector3(lx, heightAt(lx, lz), -lz); })() : new THREE.Vector3(0, 0, 0);
    controls.target.copy(tgt);
    camera.position.set(tgt.x, tgt.y + (focus ? 900 : 4200), tgt.z + (focus ? 1100 : 4200));
    controls.update();
    onInfo([d.name, d.terrain ? t('height {a} to {b}', { a: d.terrain.min, b: d.terrain.max }) : t('flat map (this zone stores its terrain in a format the tracker can\'t read yet)'),
      t('{n} NPCs', { n: d.npcs.length }), t('{n} exits', { n: d.portals.length }), d.mobs?.length ? t('{n} monster spots', { n: d.mobs.length }) : null].filter(Boolean).join(' · '));
  }

  function setLayer(name, on) { if (layers[name]) layers[name].visible = on; }
  function setFollow(on) { follow = on; }

  // hover tooltips
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables.filter((p) => p.parent?.visible), true)[0];
    let o = hit?.object; while (o && !o.userData.tip) o = o.parent;
    if (o) { tip.hidden = false; tip.textContent = o.userData.tip; tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`; } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const v = new THREE.Vector3();
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!canvas.clientWidth) return; // tab hidden
    if (firstFrame) { resize(); firstFrame = false; }
    controls.update();
    renderer.render(scene, camera);
    const w = canvas.clientWidth, h = canvas.clientHeight, camDist = camera.position.distanceTo(controls.target);
    for (const l of labelEls) {
      const show = !l.hidden && layers[l.layer].visible && (l.always || camDist < 2600);
      if (!show) { l.el.style.display = 'none'; continue; }
      v.copy(l.pos).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }
  new ResizeObserver(resize).observe(canvas);
  frame();
  const setBackground = (css) => { scene.background = new THREE.Color(css); };
  return {
    load, updateMe: (S) => { updateParty(S); return updateMe(S); }, setLayer, setFollow, resize, setBackground,
    startReplay, replayAt, stopReplay, showRoute, get zone() { return zone; },
  };
}
