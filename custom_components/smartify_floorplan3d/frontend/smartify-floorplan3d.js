/* smartify-floorplan3d – drehbarer 3D-Grundriss mit Home-Assistant-Elementen (eine Datei für alles).
 * Geschosse und Bereiche kommen als Plan-Dateien (JSON) aus /local/smartify-floorplan3d/ (Option plans_path).
 *   floors: [eg, og, {id: wohnen, name: Wohnen, files: [eg.json], region: wohnen}]
 *   files: mehrere Plan-Dateien zu einer Ansicht zusammensetzen; region: Raum-Schlüssel oder [x0, y0, x1, y1] als Ausschnitt.
 * Elemente wie bei picture-elements (state-icon, state-label, custom:...) mit pos: [x, y] bzw. [x, y, h] in Plan-Metern;
 * am einfachsten im Karten-Editor per Drag & Drop in der Draufsicht platzieren. */
(() => {
const VERSION = '1.4.3';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
const CTRL_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

function loadScript(url) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.onload = res; s.onerror = () => rej(new Error('Nicht ladbar: ' + url));
    document.head.appendChild(s);
  });
}
let libPromise;
const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
let gltfPromise;
function loadGltf(cfg) {
  if (window.THREE && window.THREE.GLTFLoader) return Promise.resolve();
  if (!gltfPromise) { gltfPromise = loadScript(cfg.gltf_url || GLTF_URL); gltfPromise.catch(() => { gltfPromise = null; }); }
  return gltfPromise;
}
// Farbtemperatur (Kelvin) in RGB, Näherung nach Tanner Helland
function kelvinRgb(k) {
  const t = Math.max(1000, Math.min(40000, k)) / 100, c = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [c(r), c(g), c(b)];
}
function loadLib(cfg) {
  if (!libPromise) {
    libPromise = (async () => {
      if (!window.THREE) await loadScript(cfg.three_url || THREE_URL);
      if (!window.THREE.OrbitControls) await loadScript(cfg.controls_url || CTRL_URL);
      return window.THREE;
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}
// Zahlen auch mit Dezimalkomma (9,6) annehmen
const num = (v, def) => {
  if (v === undefined || v === null || v === '') return def;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return isNaN(n) ? def : n;
};
/* ===== Szenen-Engine: baut aus einer oder mehreren Plan-Dateien (JSON) die 3D-Szene ===== */
const MAT_DEFS = {
  wall: [0xf0f0ec], cap: [0x474e56, { roughness: 0.7 }], slab: [0x9aa1a8],
  tile: [0xc9c4ba, { roughness: 0.6 }], parquet: [0xc8ad84, { roughness: 0.75 }],
  coating: [0x8f979c, { roughness: 0.5 }], screed: [0xb3aea4, { roughness: 0.95 }], paving: [0xa7a197, { roughness: 0.95 }],
  glass: [0x9fcdf0, { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.1 }],
  frame: [0x6d747b], door: [0xc6a686, { roughness: 0.6 }], entry: [0x5b5f63, { roughness: 0.5 }],
  gate: [0xd5d8da, { roughness: 0.5, metalness: 0.2 }],
  glassOpen: [0xff7043, { transparent: true, opacity: 0.8, roughness: 0.3 }], doorOpen: [0xff7043, { roughness: 0.5 }],
  alert: [0xe5482d, { roughness: 0.6 }], shutter: [0xd9cbb0, { roughness: 0.6 }],
  stair: [0xa87a45, { roughness: 0.7 }], stairSide: [0x8a6238, { roughness: 0.7 }],
  white: [0xf5f5f2], cream: [0xe9ddb8, { roughness: 0.6 }], stone: [0x857e72, { roughness: 0.55 }], oak: [0xa87a45, { roughness: 0.7 }],
  oakTable: [0x966a3f, { roughness: 0.7 }], legDark: [0x3a302a, { roughness: 0.6 }], uphol: [0x6c655b, { roughness: 1 }],
  sofa: [0x54534e, { roughness: 1 }], sofaBack: [0x4a4945, { roughness: 1 }], sofaBase: [0x675f56, { roughness: 0.7 }],
  tv: [0x15171a, { roughness: 0.35 }], hob: [0x17181a, { roughness: 0.2 }], steel: [0x9da1a4, { roughness: 0.35, metalness: 0.5 }],
  black: [0x1d1f21, { roughness: 0.5 }], sanitary: [0xf7f7f5, { roughness: 0.25 }], tank: [0xdfe2e4, { roughness: 0.4, metalness: 0.2 }],
  car: [0x51606b, { roughness: 0.3, metalness: 0.5 }], carGlass: [0x23292e, { roughness: 0.1 }], unit: [0xb9bec2, { roughness: 0.5 }],
  larch: [0xb58a5c, { roughness: 0.8 }], gravel: [0x9e9a92, { roughness: 1 }], attika: [0xe3dcd6, { roughness: 0.9 }],
  railGlass: [0xbfd9e6, { transparent: true, opacity: 0.4, roughness: 0.1 }], wood: [0x8a6a4a, { roughness: 0.7 }],
  plinth: [0x3b3f43, { roughness: 0.8 }], handle: [0xb9bcbe, { roughness: 0.3, metalness: 0.7 }],
  linen: [0xf4f2ec, { roughness: 1 }], duvet: [0xd9d3c6, { roughness: 1 }], pillow: [0xfbfaf6, { roughness: 1 }],
  cushion: [0x605e58, { roughness: 1 }], dune: [0x8ea7b8, { roughness: 1 }], glassDark: [0x1b2024, { roughness: 0.1, metalness: 0.2 }],
  basinIn: [0xdfe4e6, { roughness: 0.2 }], mesh: [0x2a2d30, { roughness: 0.7 }], tileWhite: [0xf1efe9, { roughness: 0.4 }],
  rugGrey: [0x9b958b, { roughness: 1 }], rugSand: [0xcdbb9a, { roughness: 1 }], rugBlue: [0x7d93a6, { roughness: 1 }],
  leaf: [0x5f8a46, { roughness: 0.9 }], leafDark: [0x3f6b35, { roughness: 0.9 }], pot: [0x6b6560, { roughness: 0.8 }], potTerra: [0xb06b45, { roughness: 0.9 }],
  art1: [0xc9a66b, { roughness: 0.9 }], art2: [0x6f8fa0, { roughness: 0.9 }], art3: [0xb5715a, { roughness: 0.9 }], artFrame: [0x2b2b2b, { roughness: 0.5 }],
  shade: [0xf3ead8, { roughness: 0.9, emissive: 0x30281a }], towel: [0xe8e1d4, { roughness: 1 }], towel2: [0x8fa3a8, { roughness: 1 }],
  accent: [0x9b5d45, { roughness: 1 }], book1: [0x7a4b3a], book2: [0x3f5a6b], book3: [0xcfc6b0], box: [0xb7a07c, { roughness: 0.9 }],
  canvas: [0xe7e2d8, { roughness: 0.9 }], red: [0xb3392f, { roughness: 0.5 }], mirror: [0xb8c6cc, { roughness: 0.08, metalness: 0.7 }]
};
const MAT_BASIC = { fire: 0xff6a2a };

// opts: { assets(part, pfad) -> Promise<url>, dirty(), record, lampShadows }
function createScene(THREE, parts, shadows, opts) {
  opts = opts || {};
  const P0 = parts[0];
  const SX = Math.max(...parts.map(p => (p.size || [20, 15])[0])), SZ = Math.max(...parts.map(p => (p.size || [20, 15])[1]));
  const CX = SX / 2, CZ = SZ / 2, FULL = (P0.heights || {}).full || 2.6, HALF = (P0.heights || {}).half || 1.2;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
  const R = Math.max(SX, SZ) * 0.65;
  sun.position.set(-R * 0.8, R * 1.4, -R * 0.6);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 4;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);

  const M = (color, o) => {
    o = Object.assign({}, o || {});
    if (o.emissive !== undefined) o.emissive = new THREE.Color(o.emissive);
    return new THREE.MeshStandardMaterial(Object.assign({ color: new THREE.Color(color).convertSRGBToLinear(), roughness: 0.85, metalness: 0 }, o));
  };
  const G = color => new THREE.MeshBasicMaterial({ color: color });
  const mat = { hit: new THREE.MeshBasicMaterial({ visible: false }) };
  Object.keys(MAT_DEFS).forEach(k => { mat[k] = M(MAT_DEFS[k][0], MAT_DEFS[k][1]); });
  Object.keys(MAT_BASIC).forEach(k => { mat[k] = G(MAT_BASIC[k]); });
  // Materialien der Plan-Datei: '#rrggbb', [farbe, {roughness...}] oder
  // { color, roughness, metalness, opacity, emissive, texture: 'textures/x.jpg', repeat: [u, v], basic: true }
  const hex = c => typeof c === 'string' ? new THREE.Color(c).getHex() : c;
  const texLoader = new THREE.TextureLoader();
  parts.forEach(p => Object.keys(p.materials || {}).forEach(k => {
    const v = p.materials[k];
    if (Array.isArray(v) || typeof v !== 'object' || v === null) {
      const d = Array.isArray(v) ? v : [v];
      mat[k] = M(hex(d[0]), d[1]);
      return;
    }
    const o = {};
    ['roughness', 'metalness', 'opacity'].forEach(n => { if (v[n] !== undefined) o[n] = v[n]; });
    if (v.opacity !== undefined && v.opacity < 1) o.transparent = true;
    if (v.emissive !== undefined) o.emissive = hex(v.emissive);
    const m = mat[k] = v.basic ? G(hex(v.color || '#ffffff')) : M(hex(v.color || '#ffffff'), o);
    if (v.texture && opts.assets) {
      opts.assets(p, v.texture).then(url => texLoader.load(url, tex => {
        tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        if (Array.isArray(v.repeat)) tex.repeat.set(v.repeat[0], v.repeat[1]);
        if (v.color === undefined) m.color.set(0xffffff);
        m.map = tex; m.needsUpdate = true;
        if (opts.dirty) opts.dirty();
      })).catch(e => console.warn('smartify-floorplan3d: Textur', v.texture, e));
    }
  }));
  const wallMats = [mat.wall, mat.wall, mat.cap, mat.wall, mat.wall, mat.wall];
  const shade = (m, material) => {
    const one = Array.isArray(material) ? material[0] : material;
    m.castShadow = !one.transparent && !one.isMeshBasicMaterial;
    m.receiveShadow = true;
    return m;
  };
  // Quader in Plan-Metern
  function mb(group, x0, y0, x1, y1, h0, h1, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(x1 - x0, 0.001), Math.max(h1 - h0, 0.001), Math.max(y1 - y0, 0.001)), material);
    m.position.set((x0 + x1) / 2 - CX, (h0 + h1) / 2, (y0 + y1) / 2 - CZ);
    group.add(shade(m, material));
    return m;
  }
  // gedrehter Quader: Mitte in Plan-Metern, Länge entlang Winkel a (Grad, gegen den Uhrzeigersinn von Ost)
  function rb(group, cx, cy, len, dep, h0, h1, a, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, h1 - h0, dep), material);
    m.position.set(cx - CX, (h0 + h1) / 2, cy - CZ);
    m.rotation.y = a * Math.PI / 180;
    group.add(shade(m, material));
    return m;
  }
  const shapeOf = (pts, holes) => {
    const mk = (s, p) => p.forEach((q, i) => { const X = q[0] - CX, Y = -(q[1] - CZ); if (i) s.lineTo(X, Y); else s.moveTo(X, Y); });
    const sh = new THREE.Shape(); mk(sh, pts);
    (holes || []).forEach(h => { const p = new THREE.Path(); mk(p, h); sh.holes.push(p); });
    return sh;
  };
  function prismM(group, pts, h0, h1, material, holes) {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth: h1 - h0, bevelEnabled: false }), material);
    m.rotation.x = -Math.PI / 2; m.position.y = h0;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function flat(group, pts, h, material, holes) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(pts, holes)), material);
    m.rotation.x = -Math.PI / 2; m.position.y = h; m.receiveShadow = true;
    group.add(m);
    return m;
  }
  const walls = new THREE.Group(), base = new THREE.Group(), furn = new THREE.Group();
  let high = new THREE.Group();
  scene.add(walls, base, furn);
  high.visible = false;   // Wandhängendes, nur bei voller Wandhöhe
  furn.add(high);
  const api = { openings: {} };

  // ----- Bausteine: Koordinaten in Plan-Metern (die Zeichnungs-Pixel der alten Modelle sind hier 1:1 Meter)
  const S = 1, PX = v => v, PY = v => v, pb = mb;
  // ----- Möbel-Bausteine. side = Seite, zu der die Fronten zeigen ('n', 's', 'e', 'w')
  const PXM = S;   // px je Meter
  // lokales Rahmenwerk: u entlang der Front, d = Abstand von der Frontebene nach innen (px)
  function frame(x0, y0, x1, y1, side) {
    const ns = side === 'n' || side === 's';
    const F = { n: y0, s: y1, e: x1, w: x0 }[side], sg = side === 'n' || side === 'w' ? 1 : -1;
    return {
      U0: ns ? x0 : y0, U1: ns ? x1 : y1, D: ns ? y1 - y0 : x1 - x0,
      box(g, uA, uB, dA, dB, h0, h1, m) {
        const a = F + sg * dA, b = F + sg * dB, lo = Math.min(a, b), hi = Math.max(a, b);
        return ns ? pb(g, uA, lo, uB, hi, h0, h1, m) : pb(g, lo, uA, hi, uB, h0, h1, m);
      }
    };
  }
  // Schrank: Sockel, Korpus, Fronten mit Fugen, Griffe. opt: doors, rows (Anteile von unten), front, plinth, handles
  function cabinet(g, x0, y0, x1, y1, h0, h1, body, side, opt) {
    opt = opt || {};
    const f = frame(x0, y0, x1, y1, side), gap = 0.012 * PXM, th = 0.018 * PXM;
    const plinth = opt.plinth !== undefined ? opt.plinth : h0 < 0.01 ? 0.08 : 0;
    if (plinth) f.box(g, f.U0 + gap, f.U1 - gap, 0.05 * PXM, f.D, h0, h0 + plinth, mat.plinth);
    f.box(g, f.U0, f.U1, th, f.D, h0 + plinth, h1, body);
    const lenM = (f.U1 - f.U0) / PXM, tall = h1 - h0 > 1.3;
    const n = opt.doors || Math.max(1, Math.round(lenM / (tall ? 0.5 : 0.6)));
    const rows = opt.rows || [1];
    const fh0 = h0 + plinth, H = h1 - fh0;
    let z = fh0;
    rows.forEach((rf, ri) => {
      const z0 = z, z1 = z + rf * H; z = z1;
      const drawer = rows.length > 1;
      for (let i = 0; i < n; i++) {
        const u0 = f.U0 + (f.U1 - f.U0) * i / n, u1 = f.U0 + (f.U1 - f.U0) * (i + 1) / n;
        f.box(g, u0 + gap / 2, u1 - gap / 2, 0, th, z0 + 0.004, z1 - 0.004, opt.front || body);
        if (opt.handles === false) continue;
        if (drawer || !tall) {
          const uc = (u0 + u1) / 2, hw = Math.min(0.12 * PXM, (u1 - u0) / 4);
          f.box(g, uc - hw, uc + hw, -0.02 * PXM, 0, z1 - 0.06, z1 - 0.045, mat.handle);
        } else {
          const ue = i % 2 ? u0 + 0.04 * PXM : u1 - 0.04 * PXM;
          f.box(g, ue - 0.006 * PXM, ue + 0.006 * PXM, -0.02 * PXM, 0, 0.95, 1.25, mat.handle);
        }
      }
    });
    return f;
  }
  // Arbeitsplatte mit Überstand nach vorne
  function worktop(g, x0, y0, x1, y1, h, side, material) {
    const f = frame(x0, y0, x1, y1, side);
    f.box(g, f.U0, f.U1, -0.02 * PXM, f.D, h, h + 0.04, material || mat.stone);
    return f;
  }
  // Bett: Rahmen, Matratze, Decke, Kissen, Kopfteil an der Seite head
  function bed(g, x0, y0, x1, y1, head, opt) {
    opt = opt || {};
    const f = frame(x0, y0, x1, y1, head), w = (f.U1 - f.U0) / PXM, e = 0.04 * PXM;
    f.box(g, f.U0, f.U1, 0, f.D, 0.08, 0.32, opt.frame || mat.oak);
    [[f.U0 + e, f.D - 2 * e], [f.U1 - 2 * e, f.D - 2 * e], [f.U0 + e, 2 * e], [f.U1 - 2 * e, 2 * e]]
      .forEach(p => f.box(g, p[0], p[0] + e, p[1], p[1] + e, 0, 0.08, mat.legDark));
    f.box(g, f.U0 + e / 2, f.U1 - e / 2, e / 2, f.D - e / 2, 0.32, 0.52, mat.linen);
    f.box(g, f.U0 + e / 4, f.U1 - e / 4, 0.62 * PXM, f.D - e / 4, 0.40, 0.58, opt.duvet || mat.duvet);
    const np = w > 1.2 ? 2 : 1, pw = (f.U1 - f.U0 - 3 * e) / np;
    for (let i = 0; i < np; i++) {
      const u = f.U0 + 1.5 * e + i * pw;
      f.box(g, u + e / 3, u + pw - e / 3, 0.08 * PXM, 0.5 * PXM, 0.52, 0.64, mat.pillow);
    }
    f.box(g, f.U0, f.U1, -0.02 * PXM, 0.04 * PXM, 0.08, opt.headH || 1.0, opt.head || opt.frame || mat.oak);
  }
  function nightstand(g, x0, y0, x1, y1, side) { cabinet(g, x0, y0, x1, y1, 0.12, 0.5, mat.oak, side, { rows: [0.5, 0.5], plinth: 0 }); }
  // Sofateil: Sockel, Sitzkissen, Rückenkissen an der Seite back, Armlehnen optional (arms: ['s'] usw.)
  function sofa(g, x0, y0, x1, y1, back, n, arms) {
    const f = frame(x0, y0, x1, y1, back === 'n' ? 's' : back === 's' ? 'n' : back === 'e' ? 'w' : 'e');
    const bd = 0.22 * PXM, e = 0.01 * PXM;
    f.box(g, f.U0, f.U1, 0, f.D, 0.05, 0.25, mat.sofaBase);
    f.box(g, f.U0, f.U1, f.D - bd, f.D, 0.25, 0.82, mat.sofaBack);
    for (let i = 0; i < n; i++) {
      const u0 = f.U0 + (f.U1 - f.U0) * i / n, u1 = f.U0 + (f.U1 - f.U0) * (i + 1) / n;
      f.box(g, u0 + e, u1 - e, 0.02 * PXM, f.D - bd, 0.25, 0.44, mat.sofa);
      f.box(g, u0 + e, u1 - e, f.D - bd - 0.14 * PXM, f.D - bd, 0.44, 0.78, mat.cushion);
    }
    (arms || []).forEach(a => {
      const at0 = a === 'start';
      f.box(g, at0 ? f.U0 : f.U1 - 0.14 * PXM, at0 ? f.U0 + 0.14 * PXM : f.U1, 0, f.D, 0.25, 0.6, mat.sofaBack);
    });
  }
  // Tisch / Schreibtisch: Platte und vier Beine
  function table(g, x0, y0, x1, y1, h, top, leg) {
    pb(g, x0, y0, x1, y1, h - 0.035, h, top || mat.oakTable);
    const e = 0.05 * PXM, l = 0.04 * PXM;
    [[x0 + e, y0 + e], [x1 - e - l, y0 + e], [x0 + e, y1 - e - l], [x1 - e - l, y1 - e - l]]
      .forEach(p => pb(g, p[0], p[1], p[0] + l, p[1] + l, 0, h - 0.035, leg || mat.legDark));
  }
  // Bürostuhl: Fünfstern, Säule, Sitz, Lehne an der Seite back
  function officeChair(g, x0, y0, x1, y1, back) {
    const cx = PX((x0 + x1) / 2), cy = PY((y0 + y1) / 2);
    [0, 1, 2, 3, 4].forEach(i => rb(g, cx, cy, 0.6, 0.04, 0.04, 0.08, i * 72, mat.black));
    mb(g, cx - 0.025, cy - 0.025, cx + 0.025, cy + 0.025, 0.08, 0.44, mat.steel);
    mb(g, cx - 0.24, cy - 0.24, cx + 0.24, cy + 0.24, 0.44, 0.52, mat.black);
    const b = { n: [-0.24, -0.26, 0.24, -0.22], s: [-0.24, 0.22, 0.24, 0.26], w: [-0.26, -0.24, -0.22, 0.24], e: [0.22, -0.24, 0.26, 0.24] }[back];
    mb(g, cx + b[0], cy + b[1], cx + b[2], cy + b[3], 0.58, 1.05, mat.black);
  }
  // Hänge-WC: Vorwand-Platte und ovale Schüssel, Rücken an der Seite back
  function toilet(g, x0, y0, x1, y1, back) {
    const f = frame(x0, y0, x1, y1, back === 'n' ? 's' : back === 's' ? 'n' : back === 'e' ? 'w' : 'e');
    f.box(g, (f.U0 + f.U1) / 2 - 0.2 * PXM, (f.U0 + f.U1) / 2 + 0.2 * PXM, f.D - 0.05 * PXM, f.D, 0.0, 1.12, mat.tileWhite);
    f.box(g, (f.U0 + f.U1) / 2 - 0.1 * PXM, (f.U0 + f.U1) / 2 + 0.1 * PXM, f.D - 0.052 * PXM, f.D - 0.05 * PXM, 0.95, 1.05, mat.handle);
    const ns = back === 'n' || back === 's', len = 0.54, wid = 0.36;
    const cx = PX((x0 + x1) / 2), cy = PY((y0 + y1) / 2);
    const off = { n: [0, -(f.D / PXM) / 2 + len / 2 + 0.05], s: [0, (f.D / PXM) / 2 - len / 2 - 0.05], w: [-(f.D / PXM) / 2 + len / 2 + 0.05, 0], e: [(f.D / PXM) / 2 - len / 2 - 0.05, 0] }[back];
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.22, 28), mat.sanitary);
    bowl.scale.set(ns ? wid : len, 1, ns ? len : wid);
    bowl.position.set(cx + off[0] - CX, 0.31, cy + off[1] - CZ); bowl.castShadow = true;
    g.add(bowl);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 28), mat.white);
    seat.scale.copy(bowl.scale); seat.position.set(bowl.position.x, 0.435, bowl.position.z);
    g.add(seat);
  }
  // Waschtisch: Unterschrank (optional), Platte, Becken, Armatur an der Wandseite back
  function vanity(g, x0, y0, x1, y1, back, h, cab) {
    const side = back === 'n' ? 's' : back === 's' ? 'n' : back === 'e' ? 'w' : 'e';
    if (cab) cabinet(g, x0, y0, x1, y1, 0.45, h - 0.04, cab, side, { rows: [0.5, 0.5], plinth: 0 });
    const f = frame(x0, y0, x1, y1, side);
    f.box(g, f.U0, f.U1, 0, f.D, h - 0.04, h, mat.sanitary);
    const uc = (f.U0 + f.U1) / 2, bw = Math.min(0.25 * PXM, (f.U1 - f.U0) * 0.35);
    f.box(g, uc - bw, uc + bw, 0.06 * PXM, f.D - 0.12 * PXM, h - 0.002, h + 0.001, mat.basinIn);
    f.box(g, uc - 0.015 * PXM, uc + 0.015 * PXM, f.D - 0.09 * PXM, f.D - 0.03 * PXM, h, h + 0.2, mat.handle);
  }
  // Waschmaschine / Trockner: Korpus, Bedienblende, Bullauge auf der Seite side
  function washer(g, x0, y0, x1, y1, h0, side) {
    const f = frame(x0, y0, x1, y1, side);
    f.box(g, f.U0, f.U1, 0, f.D, h0, h0 + 0.85, mat.white);
    f.box(g, f.U0 + 0.02 * PXM, f.U1 - 0.02 * PXM, -0.005 * PXM, 0, h0 + 0.72, h0 + 0.82, mat.basinIn);
    const uc = (f.U0 + f.U1) / 2;
    f.box(g, uc - 0.16 * PXM, uc + 0.16 * PXM, -0.01 * PXM, 0, h0 + 0.2, h0 + 0.52, mat.glassDark);
  }
  // Kochfeld mit vier Zonen, Spüle mit Armatur
  function hob(g, x0, y0, x1, y1, h) {
    pb(g, x0, y0, x1, y1, h, h + 0.006, mat.hob);
    const cx = PX((x0 + x1) / 2), cy = PY((y0 + y1) / 2), dx = (PX(x1) - PX(x0)) / 4, dy = (PY(y1) - PY(y0)) / 4;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(p => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 24), mat.steel);
      r.rotation.x = -Math.PI / 2; r.position.set(cx + p[0] * dx - CX, h + 0.008, cy + p[1] * dy - CZ);
      g.add(r);
    });
  }
  function sink(g, x0, y0, x1, y1, h, tapSide) {
    pb(g, x0, y0, x1, y1, h + 0.001, h + 0.004, mat.steel);
    const e = 0.03 * PXM;
    pb(g, x0 + e, y0 + e, x1 - e, y1 - e, h + 0.004, h + 0.005, mat.basinIn);
    const f = frame(x0, y0, x1, y1, tapSide === 'n' ? 's' : tapSide === 's' ? 'n' : tapSide === 'e' ? 'w' : 'e'), uc = (f.U0 + f.U1) / 2;
    f.box(g, uc - 0.015 * PXM, uc + 0.015 * PXM, f.D + 0.01 * PXM, f.D + 0.05 * PXM, h, h + 0.32, mat.handle);
  }
  // Duschtasse mit Glaswand und Regenbrause
  function shower(g, x0, y0, x1, y1, glassSide) {
    pb(g, x0, y0, x1, y1, 0, 0.03, mat.sanitary);
    const f = frame(x0, y0, x1, y1, glassSide);
    f.box(g, f.U0, f.U1 - 0.25 * PXM, 0, 0.01 * PXM, 0.03, 2.0, mat.glass);
    const cx = PX((x0 + x1) / 2), cy = PY((y0 + y1) / 2);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 24), mat.handle);
    head.position.set(cx - CX, 2.1, cy - CZ); high.add(head);
  }
  // freistehende ovale Wanne
  function tub(g, x0, y0, x1, y1) {
    const cx = PX((x0 + x1) / 2), cy = PY((y0 + y1) / 2), w = PX(x1) - PX(x0), d = PY(y1) - PY(y0);
    const o = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.46, 0.58, 40), mat.sanitary);
    o.scale.set(w, 1, d); o.position.set(cx - CX, 0.29, cy - CZ); o.castShadow = true; o.receiveShadow = true; g.add(o);
    const i = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.004, 40), mat.basinIn);
    i.scale.set(w - 0.12, 1, d - 0.12); i.position.set(cx - CX, 0.582, cy - CZ); g.add(i);
  }

  // ----- Deko und Kleinteile
  const cyl = (g, x, y, r0, r1, h0, h1, m, seg) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h1 - h0, seg || 20), m);
    c.position.set(PX(x) - CX, (h0 + h1) / 2, PY(y) - CZ); c.castShadow = !m.transparent; c.receiveShadow = true;
    g.add(c); return c;
  };
  function rug(g, x0, y0, x1, y1, m) { pb(g, x0, y0, x1, y1, 0.004, 0.016, m || mat.rugGrey).castShadow = false; }
  // Topfpflanze: Topf und mehrere Blattkugeln, size ~ Höhe in m
  function plant(g, x, y, size, potMat) {
    const s = size || 1.0;
    cyl(g, x, y, 0.14 * s, 0.18 * s, 0, 0.32 * s, potMat || mat.pot);
    [[0, 0, 0.62, 0.24], [0.08, 0.05, 0.82, 0.18], [-0.07, -0.06, 0.9, 0.16], [0.03, -0.09, 1.0, 0.13]].forEach((b, i) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(b[3] * s, 0), i % 2 ? mat.leafDark : mat.leaf);
      m.position.set(PX(x) + b[0] * s - CX, b[2] * s, PY(y) + b[1] * s - CZ); m.rotation.set(i, i * 0.7, 0);
      m.castShadow = true; g.add(m);
    });
  }
  // Bild an der Wand: Rechteck in px, eine Seite dünn (Wandseite = wall)
  function picture(g, x0, y0, x1, y1, h0, h1, art, wall) {
    pb(g, x0, y0, x1, y1, h0, h1, mat.artFrame);
    const f = frame(x0, y0, x1, y1, wall === 'n' ? 's' : wall === 's' ? 'n' : wall === 'e' ? 'w' : 'e');
    f.box(g, f.U0 + 0.04 * PXM, f.U1 - 0.04 * PXM, -0.004 * PXM, 0.1, h0 + 0.04, h1 - 0.04, mat.canvas);
    f.box(g, f.U0 + 0.1 * PXM, f.U1 - 0.1 * PXM, -0.006 * PXM, 0.1, h0 + 0.1, h1 - 0.1, art || mat.art1);
  }
  function mirror(g, x0, y0, x1, y1, h0, h1) { pb(g, x0, y0, x1, y1, h0, h1, mat.mirror); }
  function floorLamp(g, x, y) {
    cyl(g, x, y, 0.16, 0.16, 0, 0.03, mat.black);
    cyl(g, x, y, 0.012, 0.012, 0.03, 1.45, mat.black, 8);
    cyl(g, x, y, 0.22, 0.15, 1.35, 1.62, mat.shade);
  }
  function tableLamp(g, x, y, h) {
    cyl(g, x, y, 0.06, 0.06, h, h + 0.02, mat.steel);
    cyl(g, x, y, 0.01, 0.01, h + 0.02, h + 0.3, mat.steel, 8);
    cyl(g, x, y, 0.11, 0.08, h + 0.24, h + 0.4, mat.shade);
  }
  // Bildschirm auf dem Schreibtisch, Bildfläche zeigt nach side
  function monitor(g, x0, y0, x1, y1, h, side) {
    const f = frame(x0, y0, x1, y1, side), uc = (f.U0 + f.U1) / 2;
    f.box(g, uc - 0.1 * PXM, uc + 0.1 * PXM, 0, 0.18 * PXM, h, h + 0.015, mat.steel);
    f.box(g, uc - 0.02 * PXM, uc + 0.02 * PXM, 0.08 * PXM, 0.11 * PXM, h, h + 0.3, mat.steel);
    f.box(g, f.U0, f.U1, 0.05 * PXM, 0.08 * PXM, h + 0.12, h + 0.48, mat.black);
    f.box(g, f.U0 + 0.01 * PXM, f.U1 - 0.01 * PXM, 0.048 * PXM, 0.05 * PXM, h + 0.13, h + 0.47, mat.glassDark);
    f.box(g, uc - 0.22 * PXM, uc + 0.22 * PXM, -0.25 * PXM, -0.1 * PXM, h, h + 0.015, mat.black);   // Tastatur
  }
  // Bücher-/Dekoreihe auf einer Fläche (entlang der längeren Seite)
  function books(g, x0, y0, x1, y1, h) {
    const alongX = x1 - x0 >= y1 - y0, n = Math.max(3, Math.round(((alongX ? x1 - x0 : y1 - y0) / PXM) / 0.05));
    const ms = [mat.book1, mat.book2, mat.book3];
    for (let i = 0; i < n; i++) {
      if (i % 7 === 6) continue;
      const t0 = i / n, t1 = (i + 0.85) / n, hh = h + 0.2 + (i * 37 % 7) * 0.012;
      if (alongX) pb(g, x0 + (x1 - x0) * t0, y0, x0 + (x1 - x0) * t1, y1, h, hh, ms[i % 3]);
      else pb(g, x0, y0 + (y1 - y0) * t0, x1, y0 + (y1 - y0) * t1, h, hh, ms[i % 3]);
    }
  }
  function stool(g, x, y) {
    cyl(g, x, y, 0.2, 0.2, 0, 0.02, mat.black);
    cyl(g, x, y, 0.025, 0.025, 0.02, 0.62, mat.steel, 8);
    cyl(g, x, y, 0.19, 0.19, 0.62, 0.68, mat.uphol);
    cyl(g, x, y, 0.16, 0.16, 0.25, 0.27, mat.steel);
  }
  // Pendelleuchte (nur bei voller Wandhöhe)
  function pendant(g, x, y, ceil, low) {
    cyl(g, x, y, 0.004, 0.004, low + 0.25, ceil, mat.black, 6);
    cyl(g, x, y, 0.2, 0.06, low, low + 0.25, mat.black);
    cyl(g, x, y, 0.17, 0.17, low - 0.002, low + 0.001, mat.shade);
  }
  // Liege: Gestell, Auflage, hochgestellte Rückenlehne am Kopfende head
  function lounger(g, x0, y0, x1, y1, head) {
    const f = frame(x0, y0, x1, y1, head);
    f.box(g, f.U0, f.U1, 0, f.D, 0.18, 0.24, mat.wood);
    f.box(g, f.U0 + 0.03 * PXM, f.U1 - 0.03 * PXM, 0.55 * PXM, f.D - 0.02 * PXM, 0.24, 0.3, mat.canvas);
    f.box(g, f.U0 + 0.03 * PXM, f.U1 - 0.03 * PXM, 0.05 * PXM, 0.55 * PXM, 0.24, 0.62, mat.canvas);
    [[f.U0, 0], [f.U1 - 0.04 * PXM, 0], [f.U0, f.D - 0.04 * PXM], [f.U1 - 0.04 * PXM, f.D - 0.04 * PXM]]
      .forEach(p => f.box(g, p[0], p[0] + 0.04 * PXM, p[1], p[1] + 0.04 * PXM, 0, 0.18, mat.wood));
  }
  function parasol(g, x, y, r) {
    cyl(g, x, y, 0.25, 0.25, 0, 0.06, mat.black);
    cyl(g, x, y, 0.02, 0.02, 0.06, 2.3, mat.steel, 8);
    cyl(g, x, y, r || 1.3, 0.05, 2.0, 2.35, mat.canvas, 8).castShadow = true;
  }
  // Regal: Steher, Böden, Kisten; Mitte in Plan-Metern, Winkel a
  function rack(g, cx, cy, len, dep, a) {
    const r = a * Math.PI / 180, dx = Math.cos(r), dy = -Math.sin(r);
    [-len / 2, len / 2].forEach(u => [-dep / 2, dep / 2].forEach(v =>
      rb(g, cx + u * dx - v * dy, cy + u * dy + v * dx, 0.04, 0.04, 0, 2.0, a, mat.steel)));
    [0.1, 0.6, 1.1, 1.6, 1.98].forEach((h, i) => {
      rb(g, cx, cy, len, dep, h, h + 0.02, a, mat.oak);
      if (i === 4) return;
      [-0.38, 0.05, 0.4].forEach((u, j) => {
        const uu = u * len, w = 0.3 + ((i + j) % 3) * 0.08;
        rb(g, cx + uu * dx, cy + uu * dy, w, dep * 0.8, h + 0.02, h + 0.2 + ((i * 3 + j) % 3) * 0.06, a, (i + j) % 2 ? mat.box : mat.book3);
      });
    });
  }
  // Handtuchheizkörper an einer Wand, Rohre quer zur Wand side
  function towelRadiator(g, x0, y0, x1, y1, h0, h1) {
    const alongX = x1 - x0 >= y1 - y0;
    for (let h = h0; h <= h1; h += 0.08) pb(g, x0, y0, x1, y1, h, h + 0.018, mat.white);
    if (alongX) { pb(g, x0, y0, x0 + 1, y1, h0, h1, mat.white); pb(g, x1 - 1, y0, x1, y1, h0, h1, mat.white); }
    else { pb(g, x0, y0, x1, y0 + 1, h0, h1, mat.white); pb(g, x0, y1 - 1, x1, y1, h0, h1, mat.white); }
  }

  // Esszimmerstuhl: Sitz, Lehne an der Seite side, vier Beine
  function diningChair(g, x0, y0, x1, y1, side) {
    const t = 0.077, e = 0.031;
    mb(g, x0, y0, x1, y1, 0.42, 0.48, mat.uphol);
    const b = { n: [x0, y0, x1, y0 + t], s: [x0, y1 - t, x1, y1], w: [x0, y0, x0 + t, y1], e: [x1 - t, y0, x1, y1] }[side];
    mb(g, b[0], b[1], b[2], b[3], 0.48, 0.92, mat.uphol);
    [[x0 + e, y0 + e], [x1 - 2 * e, y0 + e], [x0 + e, y1 - 2 * e], [x1 - 2 * e, y1 - 2 * e]].forEach(p => mb(g, p[0], p[1], p[0] + e, p[1] + e, 0, 0.42, mat.black));
  }
  // Auto: Karosserie, Kabine, Räder; Mitte in Plan-Metern, Längsachse im Winkel a
  function car(g, cx, cy, a) {
    const r = a * Math.PI / 180, back = -0.25;
    rb(g, cx, cy, 4.6, 1.85, 0.18, 0.85, a, mat.car);
    rb(g, cx + back * Math.cos(r), cy - back * Math.sin(r), 2.5, 1.62, 0.85, 1.42, a, mat.carGlass);
    [[1.45, 0.8], [1.45, -0.8], [-1.45, 0.8], [-1.45, -0.8]].forEach(w => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 20), mat.black);
      t.rotation.x = Math.PI / 2; t.castShadow = true;
      const q = new THREE.Group(); q.add(t);
      q.position.set(cx + w[0] * Math.cos(r) + w[1] * Math.sin(r) - CX, 0.33, cy - w[0] * Math.sin(r) + w[1] * Math.cos(r) - CZ);
      q.rotation.y = r;
      g.add(q);
    });
  }
  // Terrassentisch rund mit vier Stühlen auf Höhe base
  function patioSet(g, cx, cy, r, b) {
    b = b || 0;
    cyl(g, cx, cy, r, r, b + 0.72, b + 0.76, mat.wood, 28);
    cyl(g, cx, cy, 0.04, 0.04, b, b + 0.72, mat.steel, 10);
    [0, 1, 2, 3].forEach(i => {
      const a = Math.PI / 4 + i * Math.PI / 2, d = r + 0.32, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      mb(g, x - 0.22, y - 0.22, x + 0.22, y + 0.22, b + 0.45, b + 0.5, mat.wood);
      [[-0.18, -0.18], [0.15, -0.18], [-0.18, 0.15], [0.15, 0.15]].forEach(l => mb(g, x + l[0], y + l[1], x + l[0] + 0.03, y + l[1] + 0.03, b, b + 0.45, mat.steel));
    });
  }
  const BUILDERS = { pb: mb, mb, rb, cyl, cabinet, worktop, bed, nightstand, sofa, table, officeChair, toilet, vanity, washer, hob, sink, shower, tub,
    rug, plant, picture, mirror, floorLamp, tableLamp, monitor, books, stool, pendant, lounger, parasol, rack, towelRadiator, diningChair, car, patioSet };
  // Material-Verweise '@name' auflösen, auch in Optionsobjekten
  const res = v => typeof v === 'string' && v[0] === '@' ? (mat[v.slice(1)] || mat.white)
    : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(e => [e[0], res(e[1])])) : v;

  // ----- Öffnungen
  const frameOf = o => {
    const dx = o.q[0] - o.p[0], dy = o.q[1] - o.p[1], L = Math.hypot(dx, dy), d = [dx / L, dy / L];
    return { L: L, d: d, n: [-d[1], d[0]], th: Math.atan2(-d[1], d[0]) };
  };
  // Quader im Achsensystem einer Öffnung: u entlang p→q, v quer (Richtung Normale)
  function ob(group, o, f, u0, u1, v0, v1, h0, h1, material) {
    if (h1 - h0 < 0.001 || u1 - u0 < 0.001) return null;
    const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(u1 - u0, h1 - h0, v1 - v0), material);
    m.position.set(o.p[0] + f.d[0] * u + f.n[0] * v - CX, (h0 + h1) / 2, o.p[1] + f.d[1] * u + f.n[1] * v - CZ);
    m.rotation.y = f.th;
    group.add(shade(m, material));
    return m;
  }
  // Bauteilachsen: u entlang Öffnung, z zur Innenseite; alle Angaben in Metern.
  function makeRaffstore(o, f, bot, top, shading) {
    const root = new THREE.Group();
    root.position.set(o.p[0] - CX, 0, o.p[1] - CZ);
    root.rotation.y = f.th;
    walls.add(root);
    const width = Math.max(0.05, f.L - 0.04), span = Math.max(0.02, top - bot);
    const spacing = Math.max(0.035, Math.min(0.20, num(shading.slat_spacing, 0.075)));
    const depth = Math.max(0.025, Math.min(0.2, num(shading.slat_width, 0.08)));
    const n = Math.min(100, Math.max(1, Math.ceil(span / spacing)));
    const offset = num(shading.offset, -(o.in || 1) * num(o.t, 0.25) * 0.5 - 0.05);
    const color = /^#[0-9a-f]{6}$/i.test(shading.color || '') ? shading.color : '#a0a0a0';
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide });
    const slats = [];
    for (let i = 0; i < n; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.007, depth), material);
      slat.position.set(f.L / 2, top - (i + 0.5) * span / n, offset);
      slat.castShadow = true;
      root.add(slat); slats.push(slat);
    }
    return { root, slats, bot, top, span, depth };
  }
  function setRaffstore(r, fraction, tilt) {
    const closed = Math.max(0, Math.min(1, fraction));
    const n = Math.round(r.slats.length * closed);
    // 0 % geschlossen: alle Lamellen kompakt oben; 100 % geschlossen: über gesamte Höhe verteilt.
    const angle = (Math.max(0, Math.min(100, tilt)) / 100 - 0.5) * Math.PI * 0.94;
    r.slats.forEach((s, i) => {
      s.visible = i < n;
      s.position.y = r.top - ((i + 0.5) / r.slats.length) * r.span;
      s.rotation.x = angle;
    });
  }
  function makeSectional(o, f, top, spec) {
    const root = new THREE.Group();
    root.position.set(o.p[0] - CX, 0, o.p[1] - CZ);
    root.rotation.y = f.th;
    walls.add(root);
    const height = Math.max(0.5, top), count = Math.max(2, Math.min(40, Math.ceil(height / Math.max(0.2, num(spec.panel_height, 0.5)))));
    const panelH = height / count, width = Math.max(0.1, f.L - 0.16);
    const lift = ['standard', 'high_lift', 'vertical'].includes(spec.track_type) ? spec.track_type : 'standard';
    const radius = Math.min(height * 0.35, Math.max(0.15, num(spec.radius, 0.35)));
    const clearance = Math.max(0.05, num(spec.ceiling_clearance, 0.35));
    const offset = num(spec.offset, 0);
    const material = new THREE.MeshStandardMaterial({color: /^#[0-9a-f]{6}$/i.test(spec.color || '') ? spec.color : '#d5d8da', metalness: 0.25, roughness: 0.52});
    const panels = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, panelH - 0.012, 0.045), material);
      mesh.position.set(f.L / 2, (i + 0.5) * panelH, offset);
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh); panels.push(mesh);
    }
    // Führungsschienen einschließlich Bogen und waagrechter Laufschiene (oder vertikaler Führung).
    const railMat = mat.steel;
    const railLength = Math.max(height, num(spec.horizontal_length, height));
    [-0.02, f.L + 0.02].forEach(u => {
      const addRail = (a, b) => {
        const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.025, v.length(), 0.025), railMat);
        mesh.position.set(u, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v.normalize());
        root.add(mesh);
      };
      if (lift === 'vertical') { addRail([u, 0, offset], [u, 2 * height + clearance, offset]); return; }
      const rise = lift === 'high_lift' ? Math.max(0, num(spec.high_lift, height * 0.5)) : 0;
      const transition = height + rise - radius;
      addRail([u, 0, offset], [u, transition, offset]);
      let last = [u, transition, offset];
      for (let j = 1; j <= 12; j++) {
        const a = j * Math.PI / 24;
        const next = [u, transition + radius * Math.sin(a), offset + radius * (1 - Math.cos(a))];
        addRail(last, next); last = next;
      }
      addRail(last, [u, height + rise, offset + radius + railLength]);
    });
    return { panels, top: height, panelH, radius, offset, lift, highLift: Math.max(0, num(spec.high_lift, height * 0.5)) };
  }
  function setSectional(door, fraction) {
    // fraction=1 bedeutet geschlossen (HA current_position=0), fraction=0 bedeutet offen.
    const progress = 1 - Math.max(0, Math.min(1, fraction));
    const r = door.radius, top = door.top, rise = door.lift === 'high_lift' ? door.highLift : 0;
    const transition = top + rise - r;
    const end = door.lift === 'vertical' ? 2 * top + rise : top + rise + r * Math.PI / 2 + 0.12;
    const distance = progress * end;
    door.panels.forEach((panel, i) => {
      const s = (i + 0.5) * door.panelH + distance;
      let y, z = door.offset, a = 0;
      if (door.lift === 'vertical' || s <= transition) y = s;
      else if (s < transition + Math.PI * r / 2) {
        a = (s - transition) / r;
        y = transition + r * Math.sin(a);
        z += r * (1 - Math.cos(a));
      } else {
        y = top + rise;
        z += r + s - transition - Math.PI * r / 2;
        a = Math.PI / 2;
      }
      panel.position.y = y;
      panel.position.z = z;
      panel.rotation.x = -a;
    });
  }
  function opening(o, H, ops) {
    const f = frameOf(o), L = f.L, t = o.t, k = o.kind, top = Math.min(o.top, H), J = 0.06;
    const sectionalType = k === 'sectional_door' || (k === 'gate' && !!o.sectional);
    const shading = o.shading && typeof o.shading === 'object' ? o.shading : null;
    let raffstore = null, sectional = null;
    if (H > o.top) ob(walls, o, f, -0.02, L + 0.02, -t / 2, t / 2, o.top, H, wallMats);   // Sturz
    if (k === 'd') {
      ob(walls, o, f, 0, L, -t / 2, t / 2, 0, 0.012, mat.door);
      ob(walls, o, f, 0, L, -0.03, 0.03, 0.012, top, mat.door);
      // Zarge und Drücker beidseitig
      [[0, 0.04], [L - 0.04, L]].forEach(u => ob(walls, o, f, u[0], u[1], -t / 2 - 0.01, t / 2 + 0.01, 0, Math.min(top + 0.04, H), mat.white));
      if (H > top) ob(walls, o, f, 0, L, -t / 2 - 0.01, t / 2 + 0.01, top, top + 0.04, mat.white);
      if (top > 1.06) [-1, 1].forEach(s => {
        ob(walls, o, f, L - 0.1, L - 0.07, s * 0.03, s * 0.05, 0.98, 1.12, mat.handle);
        ob(walls, o, f, L - 0.2, L - 0.07, s * 0.05, s * 0.065, 1.035, 1.055, mat.handle);
      });
      return;
    }
    let bot = 0.05, sill = null, pivot = null, leaf = null, leafMat = mat.glass, openMat = mat.glassOpen, shutter = null;
    if (k === 'w') {
      ob(walls, o, f, -0.02, L + 0.02, -t / 2, t / 2, 0, Math.min(o.par, H), wallMats);   // Brüstung
      bot = o.par + 0.04;
      if (o.in && H > o.par) ob(walls, o, f, -0.03, L + 0.03, o.in > 0 ? t * 0.38 : -t / 2 - 0.04, o.in > 0 ? t / 2 + 0.04 : -t * 0.38, o.par - 0.03, o.par, mat.stone);   // Fensterbank
      if (top - bot < 0.01) return;
      sill = ob(walls, o, f, 0, L, -t * 0.38, t * 0.38, o.par, bot, mat.frame);
    } else if (k !== 'gate' && !sectionalType) sill = ob(walls, o, f, 0, L, -t * 0.38, t * 0.38, 0, bot, mat.frame);
    if (k === 'gate' || sectionalType) {
      bot = 0;
      ob(walls, o, f, 0, 0.08, -t * 0.3, t * 0.3, 0, top, mat.frame);
      ob(walls, o, f, L - 0.08, L, -t * 0.3, t * 0.3, 0, top, mat.frame);
      if (sectionalType) { sectional = makeSectional(o, f, top, o.sectional || {}); setSectional(sectional, 1); }
      else shutter = ob(walls, o, f, 0.08, L - 0.08, -0.03, 0.03, 0, 1, mat.gate);   // Legacy-Torblatt
    } else {
      ob(walls, o, f, 0, J, -t * 0.25, t * 0.25, bot, top, mat.frame);
      ob(walls, o, f, L - J, L, -t * 0.25, t * 0.25, bot, top, mat.frame);
      let a = J, b = L - J;
      if (k === 'b' && L > 1.6) {   // breite Glastür: rechte Hälfte fix
        const mid = L / 2;
        ob(walls, o, f, mid - 0.035, mid + 0.035, -t * 0.25, t * 0.25, bot, top, mat.frame);
        ob(walls, o, f, mid + 0.035, L - J, -0.012, 0.012, bot, top, mat.glass);
        b = mid - 0.035;
      }
      if (k === 'f') ob(walls, o, f, a, b, -0.012, 0.012, bot, top, mat.glass);
      else {
        if (k === 'e') { leafMat = mat.entry; openMat = mat.doorOpen; }
        const len = b - a;
        pivot = new THREE.Group();
        pivot.position.set(o.p[0] + f.d[0] * a - CX, 0, o.p[1] + f.d[1] * a - CZ);
        pivot.rotation.y = f.th;
        leaf = new THREE.Mesh(new THREE.BoxGeometry(len, top - bot, k === 'e' ? 0.06 : 0.05), leafMat);
        leaf.position.set(len / 2, (top + bot) / 2, 0);
        leaf.receiveShadow = true; leaf.castShadow = k === 'e';
        pivot.add(leaf);
        walls.add(pivot);
      }
      if ((k === 'w' || k === 'b') && shading && (shading.type === 'raffstore' || shading.type === 'venetian_blind')) { raffstore = makeRaffstore(o, f, bot, top, shading); setRaffstore(raffstore, 0, 50); }
      else if ((k === 'w' || k === 'b') && (o.in || (shading && shading.type === 'roller_shutter')) && (!shading || shading.type !== 'none')) shutter = ob(walls, o, f, 0, L, -o.in * t * 0.32 - 0.015, -o.in * t * 0.32 + 0.015, 0, 1, mat.shutter);   // Rollo außen
    }
    if (shutter) {
      shutter.castShadow = true;
      if (k === 'gate') { shutter.scale.y = top; shutter.position.y = top / 2; } else shutter.visible = false;
    }
    if (o.name) {
      ob(walls, o, f, 0, L, -t / 2 - 0.02, t / 2 + 0.02, 0, Math.min(top + 0.25, Math.max(H, top)), mat.hit).userData.act = { opening: o.name };
      ops[o.name] = { pivot: pivot, base: f.th, leaf: leaf, leafMat: leafMat, openMat: openMat, sill: sill, shutter: shutter, raffstore: raffstore, sectional: sectional,
        top: top, bot: k === 'w' ? o.par : 0, ang: -(o.in || 1) * 0.75 };
    }
  }
  // Wände, Öffnungen, Attika, Geländer und Stiegen über dem Boden hängen von der Wandhöhe ab
  function buildWalls(H) {
    walls.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    walls.clear();
    const ops = api.openings = {};
    parts.forEach(p => {
      (p.walls || []).forEach(w => prismM(walls, w.o, 0, H, [mat.cap, mat.wall], w.h));
      (p.openings || []).forEach(o => opening(o, H, ops));
      (p.attika || []).forEach(a => prismM(walls, a.o, 0, Math.min(a.top, Math.max(H, 0.25)), [mat.cap, mat.attika], a.h));
      (p.rails || []).forEach(r => prismM(walls, r.o, 0, r.top || 1.0, [mat.steel, mat.railGlass], r.h));
      const st = p.stairs;
      if (st && (st.base || 0) >= 0) st.steps.forEach((s, i) => {
        const h1 = (st.base || 0) + (i + 1) * st.rise, h0 = Math.max(0, h1 - 0.22);
        if (h0 < H) prismM(walls, s, h0, Math.min(h1, H), [mat.stair, mat.stairSide]);
      });
    });
  }
  api.setOpening = (id, open, frac, tilt) => {
    const o = api.openings[id];
    if (!o) return;
    if (o.pivot) { o.pivot.rotation.y = o.base + (open ? o.ang : 0); o.leaf.material = open ? o.openMat : o.leafMat; }
    if (o.sill) o.sill.material = open ? mat.alert : mat.frame;
    if (o.raffstore) setRaffstore(o.raffstore, frac == null ? 0 : frac, tilt == null ? 50 : tilt);
    if (o.sectional) setSectional(o.sectional, frac == null ? 1 : frac);
    if (!o.shutter) return;
    const h = Math.max(0, Math.min(1, frac)) * (o.top - o.bot);
    o.shutter.visible = h > 0.01;
    o.shutter.scale.y = Math.max(h, 0.001);
    o.shutter.position.y = o.top - h / 2;
  };
  api.clickables = () => {
    const out = [];
    scene.traverseVisible(o => { if (o.isMesh && o.userData.act) out.push(o); });
    return out;
  };

  // ----- Format 2: Bauteile aus Grundformen (blocks) und 3D-Modelle (GLB)
  // Grundform: [art, maße, [x, h, y], [rx, ry, rz] | 0, [sx, sy, sz] | 0, material, oben]
  //   box [b, h, t] · cyl [r_oben, r_unten, h, segmente, offen, start, winkel] · ico [r, detail] · sphere [r, seg] · ring [r_innen, r_außen, seg]
  //   glb ['models/x.glb'] – Modell aus dem Plan-Paket
  const GEOM = {
    box: a => new THREE.BoxGeometry(a[0], a[1], a[2]),
    cyl: a => new THREE.CylinderGeometry(a[0], a[1], a[2], a[3] || 20, 1, !!a[4], a[5] || 0, a[6] === undefined ? Math.PI * 2 : a[6]),
    ico: a => new THREE.IcosahedronGeometry(a[0], a[1] || 0),
    sphere: a => new THREE.SphereGeometry(a[0], a[1] || 16, Math.max(6, Math.round((a[1] || 16) * 0.6))),
    ring: a => new THREE.RingGeometry(a[0], a[1], a[2] || 24)
  };
  const geoCache = {};
  const geoOf = (t, a) => { const k = t + JSON.stringify(a); return geoCache[k] || (geoCache[k] = GEOM[t](a)); };
  let gltf = null;
  function loadGlb(p, src, into) {
    if (!opts.assets || !THREE.GLTFLoader) { console.warn('smartify-floorplan3d: GLB ohne Lader', src); return; }
    gltf = gltf || new THREE.GLTFLoader();
    opts.assets(p, src).then(url => gltf.load(url, g => {
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      into.add(g.scene);
      if (opts.dirty) opts.dirty();
    }, undefined, e => console.warn('smartify-floorplan3d: GLB', src, e))).catch(e => console.warn('smartify-floorplan3d: GLB', src, e));
  }
  function prim(p, pr, g, hg) {
    const [t, a, pos, rot, scl, mn, hi] = pr;
    const into = hi ? hg : g;
    if (t === 'glb') {
      const holder = new THREE.Group();
      holder.position.set(pos[0], pos[1], pos[2]);
      if (rot) holder.rotation.set(rot[0], rot[1], rot[2]);
      if (scl) holder.scale.set(scl[0], scl[1], scl[2]);
      into.add(holder);
      loadGlb(p, a[0], holder);
      return;
    }
    if (!GEOM[t]) { console.warn('smartify-floorplan3d: unbekannte Grundform', t); return; }
    const m = mat[mn] || mat.white;
    const mesh = new THREE.Mesh(geoOf(t, a), m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scl) mesh.scale.set(scl[0], scl[1], scl[2]);
    shade(mesh, m);
    into.add(mesh);
  }
  // Bauteil im Plan: { block: 'name', pos: [x, y], rot: grad, h: anheben } oder { prims: [...] }
  function placeItem(p, it) {
    const parts_ = it.prims || ((p.blocks || {})[it.block]);
    if (!parts_) { console.warn('smartify-floorplan3d: Block fehlt', it.block); return; }
    const pos = it.pos || [0, 0];
    const mk = parent => {
      const g = new THREE.Group();
      g.position.set(pos[0] - CX, it.h || 0, pos[1] - CZ);
      g.rotation.y = (it.rot || 0) * Math.PI / 180;
      parent.add(g);
      return g;
    };
    const g = mk(it.g === 'high' ? high : furn), hg = mk(high);
    parts_.forEach(pr => prim(p, pr, g, hg));
  }

  // ----- Boden, Außenflächen, Einrichtung je Plan-Datei
  parts.forEach(p => {
    (p.foot || []).forEach(fp => { prismM(base, fp.o, -0.22, 0, mat.slab, fp.h).castShadow = false; });
    (p.floors || []).forEach(fl => { flat(base, fl.poly, 0.004, mat[fl.mat] || mat.tile, fl.holes).userData.room = fl.room; });
    (p.decks || []).forEach(d => {
      const h0 = d.h0 !== undefined ? d.h0 : -0.3;
      prismM(base, d.poly, h0, d.h - 0.03, mat.slab).castShadow = false;
      prismM(base, d.poly, d.h - 0.03, d.h, [mat[d.mat] || mat.paving, mat.slab]).castShadow = false;
    });
    const st = p.stairs;
    if (st && (st.base || 0) < 0) st.steps.forEach((s, i) => {   // Stiege aus dem Geschoss darunter im Stiegenloch
      const h1 = st.base + (i + 1) * st.rise;
      prismM(base, s, h1 - 0.22, h1, [mat.stair, mat.stairSide]);
    });
    (p.items || []).forEach(it => {
      if (!Array.isArray(it)) { placeItem(p, it); return; }
      // Format 1: Baustein-Aufruf der eingebauten Bibliothek
      const fn = BUILDERS[it[0]];
      if (!fn) { console.warn('smartify-floorplan3d: unbekannter Baustein', it[0]); return; }
      const args = it.slice(1).map(res);
      const hi = args[0] === 'high', keepHigh = high;
      let g = hi ? high : furn, hg = null;
      if (opts.record) {   // je Baustein eigene Gruppen, damit er sich als Grundformen auslesen lässt
        g = new THREE.Group(); hg = new THREE.Group();
        (hi ? keepHigh : furn).add(g); keepHigh.add(hg);
        high = hg;
        opts.record.push({ part: p, item: it, group: g, high: hg, hi: hi });
      }
      args[0] = g;
      try { fn(...args); } catch (e) { console.warn('smartify-floorplan3d: Baustein fehlerhaft', it, e); }
      high = keepHigh;
    });
  });
  let ground = null;
  if (shadows) {
    ground = new THREE.Mesh(new THREE.PlaneGeometry(SX * 5, SZ * 5), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.22; ground.receiveShadow = true;
    scene.add(ground);
  }

  // ----- Deckenleuchten (Plan: lights; Karte: model_lights)
  const halos = {};
  function halo(group, key, w, h, mrg) {
    const W = w + 2 * mrg, Hh = h + 2 * mrg, s = 200 / Math.max(W, Hh);
    const cv = document.createElement('canvas');
    cv.width = Math.max(8, Math.round(W * s)); cv.height = Math.max(8, Math.round(Hh * s));
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    c.shadowColor = '#fff'; c.shadowBlur = mrg * s * 0.9; c.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) { c.beginPath(); c.ellipse(cv.width / 2, cv.height / 2, w * s / 2, h * s / 2, 0, 0, Math.PI * 2); c.fill(); }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.MeshBasicMaterial({
      alphaMap: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    group.add(m);
    (halos[key] = halos[key] || []).push(m);
    return m;
  }
  // Leuchten des Plans: [x, y] / [x, y, h] oder { pos: [x, y, h], type: ceiling|spot|point, power, range, angle, color }
  const LIGHTS = {};
  parts.forEach(p => Object.keys(p.lights || {}).forEach(k => {
    const v = p.lights[k];
    LIGHTS[k] = Array.isArray(v) ? { pos: v } : Object.assign({}, v);
  }));
  const glows = {}, discs = {}, lamps = {};
  const warm = new THREE.Color(0xfff2cc);
  // Lichtquelle: Decke = Spot nach unten mit weichem Rand (eine Schattenkarte), sonst Punktlicht ohne Schatten
  function makeSource(L, spec) {
    const type = spec.type || 'ceiling', range = spec.range || 7;
    let src;
    if (type === 'point' || type === 'lamp') src = new THREE.PointLight(0xffffff, 0, range, 2);
    else {
      src = new THREE.SpotLight(0xffffff, 0, range, spec.angle || 1.2, spec.penumbra === undefined ? 0.9 : spec.penumbra, 2);
      src.target = new THREE.Object3D();
      scene.add(src.target);
      if (opts.lampShadows !== false) {
        src.castShadow = true;
        src.shadow.mapSize.set(512, 512);
        src.shadow.bias = -0.0006; src.shadow.normalBias = 0.03;
        src.shadow.camera.near = 0.1; src.shadow.camera.far = range;
      }
    }
    src.visible = false;
    scene.add(src);
    L.src = src; L.type = type; L.base = (type === 'point' || type === 'lamp' ? 5 : 9) * (spec.power === undefined ? 1 : spec.power);
    if (spec.color) L.tint = new THREE.Color(spec.color);
  }
  function makeLamp(k, extra, spec) {
    const gm = glows[k] = glows[k] || G(0xfff2cc);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 24), gm);
    disc.userData.act = { light: k };
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12), mat.hit);
    hit.userData.act = disc.userData.act;
    const glow = halo(furn, k, 1, 1, 1.1);
    glow.rotation.x = -Math.PI / 2;
    furn.add(disc, hit);
    discs[k] = disc;
    const L = lamps[k] = { disc: disc, hit: hit, glow: glow, extra: extra, showDisc: true };
    makeSource(L, spec || {});
    return L;
  }
  function placeLamp(L, x, y, h, size) {
    const s = size || 0.4;
    L.disc.scale.set(s, 1, s); L.hit.scale.set(Math.max(s * 2, 0.8), 1, Math.max(s * 2, 0.8));
    L.glow.scale.set(s, s, 1);
    L.disc.position.set(x - CX, h + 0.015, y - CZ);
    L.hit.position.copy(L.disc.position);
    L.glow.position.set(x - CX, h + 0.031, y - CZ);
    L.src.position.set(x - CX, h - 0.06, y - CZ);
    if (L.src.target) L.src.target.position.set(x - CX, 0, y - CZ);
  }
  const home = k => { const p = LIGHTS[k].pos; return [p[0], p[1], p[2] !== undefined ? p[2] : FULL - 0.045]; };
  Object.keys(LIGHTS).forEach(k => { const p = home(k); placeLamp(makeLamp(k, false, LIGHTS[k]), p[0], p[1], p[2]); });
  api.placeLight = (k, x, y, h, opt) => {
    opt = opt || {};
    const L = lamps[k] || makeLamp(k, true, opt), d = LIGHTS[k] ? home(k) : [x, y, FULL - 0.045];
    placeLamp(L, x === undefined ? d[0] : x, y === undefined ? d[1] : y, h === undefined ? d[2] : h, opt.size);
    L.showDisc = opt.disc !== false;
    if (opt.power !== undefined) L.base = (L.type === 'point' || L.type === 'lamp' ? 5 : 9) * opt.power;
    if (opt.range !== undefined) { L.src.distance = opt.range; if (L.src.shadow) L.src.shadow.camera.far = opt.range; }
    if (!glows[k].userData.on) glows[k].userData.on = warm.clone();
  };
  api.lightPos = k => lamps[k] ? lamps[k].disc.position.clone() : null;
  api.hasLight = k => !!LIGHTS[k] || !!lamps[k];
  api.resetLights = () => {
    Object.keys(lamps).forEach(k => {
      const L = lamps[k];
      if (L.extra) {
        [L.disc, L.hit, L.glow].forEach(o => { furn.remove(o); o.geometry.dispose(); });
        L.glow.material.alphaMap.dispose(); L.glow.material.dispose();
        scene.remove(L.src); if (L.src.target) scene.remove(L.src.target); if (L.src.shadow && L.src.shadow.map) L.src.shadow.map.dispose();
        delete lamps[k]; delete discs[k]; delete glows[k]; delete halos[k];
      } else {
        const p = home(k), spec = LIGHTS[k];
        placeLamp(L, p[0], p[1], p[2]); L.showDisc = true;
        L.base = (L.type === 'point' || L.type === 'lamp' ? 5 : 9) * (spec.power === undefined ? 1 : spec.power);
        L.src.distance = spec.range || 7;
      }
    });
  };
  // Farben je Material überschreibbar (Karten-Option colors, z. B. gate: '#d5d8da'; light = Farbe eingeschalteter Leuchten)
  const stock = {};
  Object.keys(mat).forEach(k => { if (mat[k].color) stock[k] = mat[k].color.clone(); });
  api.setColors = colors => {
    Object.keys(stock).forEach(k => {
      mat[k].color.copy(stock[k]);
      const c = colors && colors[k];
      if (!c) return;
      mat[k].color.set(c);
      if (!mat[k].isMeshBasicMaterial) mat[k].color.convertSRGBToLinear();
    });
    const on = new THREE.Color(colors && colors.light ? colors.light : 0xfff2cc);
    Object.keys(glows).forEach(k => { glows[k].userData.on = on.clone(); api.setLight(k, true, null); });
  };
  // idle: Leuchte ohne gebundenes Licht, wird ganz ausgeblendet; level: Helligkeit 0..1
  // Die Lichtquelle bleibt für gebundene Leuchten aktiv (Stärke 0 wenn aus), damit Schalten kein Neuübersetzen der Shader auslöst.
  api.setLight = (k, on, rgb, idle, level) => {
    const m = glows[k];
    if (!m) return;
    const L = lamps[k];
    if (discs[k]) discs[k].visible = !idle && L.showDisc;
    if (L) L.hit.visible = !idle;
    if (!on) m.color.set(0x3a3d40);
    else if (rgb) m.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).convertSRGBToLinear();
    else m.color.copy(m.userData.on);
    (halos[k] || []).forEach(h => { h.visible = on; h.material.color.copy(m.color); });
    if (!L) return;
    L.src.visible = !idle;
    const lv = level === undefined || level === null ? 1 : Math.max(0.02, Math.min(1, level));
    L.src.intensity = on ? L.base * lv * (api.lampScale || 1) : 0;
    L.src.color.copy(on ? (rgb ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : (L.tint || m.userData.on || warm)) : warm);
  };
  // Tageslicht 0..1 (0 = Nacht): Umgebung und Sonne dimmen, damit Leuchten im Raum sichtbar Licht werfen
  api.setDaylight = (f, nightLevel) => {
    const n = nightLevel === undefined ? 0.22 : nightLevel, d = Math.max(0, Math.min(1, f));
    hemi.intensity = n + (1 - n) * d;
    hemi.color.setHex(0xffffff).lerp(new THREE.Color(0x9fb4d6), 1 - d);           // nachts kühles Restlicht
    hemi.groundColor.setHex(0x9aa3ad).lerp(new THREE.Color(0x3c4150), 1 - d);
    sun.intensity = 1.3 * d;
    sun.castShadow = !!shadows && d > 0.05;
    if (ground) ground.material.opacity = 0.16 * d;
    api.lampScale = 1 - 0.55 * d;   // bei Tag wirken Lampen schwächer
  };
  api.setColors(null);
  api.lightsIdle = 'off';
  Object.keys(glows).forEach(k => api.setLight(k, false, null, true));
  return Object.assign(api, { scene, furn, high, buildWalls, glows, mat, SIZE_X: SX, SIZE_Z: SZ, CX, CZ, FULL, HALF });
}

/* ===== Plan-Dateien laden ===== */
const plans = {}, assetCache = {};
function planUrl(cfg, file) {
  if (/^(https?:)?\//.test(file)) return file;
  let base = (cfg && cfg.plans_path) || '/local/smartify-floorplan3d/';
  if (!base.endsWith('/')) base += '/';
  return base + file;
}
const WS = 'smartify_floorplan3d';
const hasIntegration = hass => !!(hass && hass.config && (hass.config.components || []).includes(WS));
// Quelle einer Plan-Datei: mit Integration über WebSocket (Ablage /config/smartify_floorplan3d), sonst Datei unter /local
function planSource(cfg, hass, file) {
  if (!(cfg && cfg.plans_path) && hasIntegration(hass) && !/^(https?:)?\//.test(file)) return { key: 'ws:' + file, file: file, where: 'Integration' };
  const url = planUrl(cfg, file);
  return { key: url, url: url, where: url };
}
function loadPlan(src, hass) {
  if (!plans[src.key]) {
    const p = src.url
      ? fetch(src.url, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error('Plan nicht gefunden: ' + src.url + ' (' + r.status + ')');
        return r.json();
      })
      : hass.callWS({ type: WS + '/plans/get', file: src.file }).then(r => r.plan, e => { throw new Error('Plan ' + src.file + ': ' + (e && e.message ? e.message : e)); });
    plans[src.key] = p.then(d => {
      if (!d || d.format !== 'smartify-floorplan3d') throw new Error('Keine Plan-Datei: ' + (src.file || src.url));
      Object.defineProperty(d, '_src', { value: src, enumerable: false });
      return d;
    });
    plans[src.key].catch(() => { delete plans[src.key]; });
  }
  return plans[src.key];
}
// nach Import oder Löschen: Zwischenspeicher dieser Datei verwerfen
function dropPlan(file) {
  Object.keys(plans).forEach(k => { if (k === 'ws:' + file || k.endsWith('/' + file)) delete plans[k]; });
  const stem = String(file).replace(/\.json$/, '') + '/';
  Object.keys(assetCache).forEach(k => { if (k.startsWith(stem)) { assetCache[k].then(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }, () => null); delete assetCache[k]; } });
}
// Ansichten aus der Konfiguration: floors: [eg, {id: og, name: OG, files: [og.json, garten.json], region: wohnen, clip: true}]
function viewsOf(cfg) {
  cfg = cfg || {};
  const l = Array.isArray(cfg.floors) && cfg.floors.length ? cfg.floors : [cfg.floor || 'eg'];
  return l.map(e => {
    const o = e && typeof e === 'object' ? e : { id: e };
    const id = String(o.id === undefined || o.id === null ? '' : o.id) || 'eg';
    let files = o.files || (o.file ? [o.file] : [id + '.json']);
    if (!Array.isArray(files)) files = [files];
    return { id: id, name: o.name || id.toUpperCase(), files: files.map(String), region: o.region, clip: o.clip !== false, margin: num(o.margin, 0.6) };
  });
}
// Ausschnitt: [x0, y0, x1, y1] in Metern, oder Raum-Schlüssel bzw. Liste davon (Räume der Plan-Dateien)
function regionOf(view, parts) {
  const r = view.region;
  if (!r) return null;
  if (Array.isArray(r) && r.length === 4 && r.every(v => !isNaN(num(v, NaN)))) return r.map(v => num(v, 0));
  const keys = (Array.isArray(r) ? r : [r]).map(v => String(v).toLowerCase());
  let b = null;
  parts.forEach(p => (p.floors || []).forEach(fl => {
    const name = ((p.rooms || {})[fl.room] || '').toLowerCase();
    if (!keys.includes(String(fl.room).toLowerCase()) && !keys.includes(name)) return;
    fl.poly.forEach(q => { b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])] : [q[0], q[1], q[0], q[1]]; });
  }));
  if (!b) return null;
  const m = view.margin;
  return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}


const CSS = `
:host { display: block; }
ha-card { overflow: hidden; height: 100%; }
.wrap { position: relative; width: 100%; container-type: inline-size; overflow: hidden; }
.stage, .layer { position: absolute; inset: 0; }
.stage { touch-action: none; }
.stage canvas { cursor: grab; }
.stage canvas:active { cursor: grabbing; }
.stage canvas { display: block; width: 100%; height: 100%; outline: none; }
.layer { pointer-events: none; }
.pin { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.pin[hidden] { display: none; }
.rot { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.rot.spin { animation: fp3d-spin 1.6s linear infinite; }
@keyframes fp3d-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .rot.spin { animation-duration: 8s; } }
.rot > .element { position: absolute; transform-origin: 0 0; transform: translate(-50%, -50%); pointer-events: auto; }
.lamp { display: grid; place-items: center; border-radius: 50%; cursor: pointer; box-sizing: border-box; touch-action: none;
  color: var(--lamp-color); background: color-mix(in srgb, var(--card-background-color, #fff) 88%, transparent);
  border: 1px solid var(--divider-color, #8884); box-shadow: 0 1px 4px rgba(0, 0, 0, .25); transition: box-shadow .2s; }
.lamp.on { border-color: var(--lamp-color); box-shadow: 0 0 14px 2px var(--lamp-color); }
.tools { position: absolute; right: 8px; top: 8px; display: flex; gap: 4px; z-index: 200000; }
.tools[hidden], .tools button[hidden] { display: none; }
.tools button { all: unset; cursor: pointer; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px;
  color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent); border: 1px solid var(--divider-color, #8884); }
.tools button.txt { width: auto; min-width: 34px; padding: 0 8px; box-sizing: border-box; font: 600 13px/1 inherit; }
.tools button:focus-visible { outline: 2px solid var(--primary-color); }
.tools button[aria-pressed="true"] { color: var(--primary-color); border-color: var(--primary-color); }
.tools ha-icon { --mdc-icon-size: 20px; }
.coord, .msg { position: absolute; left: 8px; bottom: 8px; z-index: 200000; padding: 4px 8px; border-radius: 6px; font: 500 13px/1.3 ui-monospace, Menlo, Consolas, monospace;
  color: var(--primary-text-color); background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #8884); user-select: all; }
.msg { right: 8px; font-family: inherit; user-select: text; }
.dock { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); width: min(92%, 380px); max-height: 85%; overflow: auto;
  z-index: 200001; border-radius: var(--ha-card-border-radius, 12px); box-shadow: 0 8px 28px rgba(0, 0, 0, .45); }
.dock[hidden] { display: none; }
.dock .x { all: unset; cursor: pointer; position: absolute; right: 6px; top: 6px; z-index: 2; width: 28px; height: 28px; display: grid; place-items: center;
  border-radius: 50%; font-size: 15px; color: var(--primary-text-color); background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent); }
`;

class SmartifyFloorplan3d extends HTMLElement {
  static getStubConfig() { return { floors: ['eg'], elements: [] }; }
  static getConfigElement() { return document.createElement('smartify-floorplan3d-editor'); }

  setConfig(config) {
    if (config.elements && !Array.isArray(config.elements)) throw new Error('elements muss eine Liste sein');
    if (config.floors && !Array.isArray(config.floors)) throw new Error('floors muss eine Liste sein');
    this._config = config;
    if (!this._ready) return;
    this._closeDock();
    const want = this._wantFloor();
    if (want.id !== this._floor || want.key !== this._file) this._switchFloor(want.id);
    else { this._applyConfig(); this._buildElements(); }
  }
  set hass(hass) {
    this._hass = hass;
    if (this._hassOk) { this._hassOk(); this._hassOk = null; }
    if (this.isConnected) this._subscribe();
    if (this._pins) this._pins.forEach(p => { p.el.hass = hass; this._spin(p); });
    if (this._dock) this._dock.el.hass = hass;
    this._applyStates();
  }
  getCardSize() { return 9; }
  getGridOptions() { return { columns: 'full', rows: 'auto', min_columns: 6 }; }

  constructor() {
    super();
    this._hassReady = new Promise(res => { this._hassOk = res; });
  }
  connectedCallback() {
    if (!this.shadowRoot) this._render();
    this._subscribe();
    if (this._ready) { this._resize(); this._start(); } else if (!this._loading) this._init();
  }
  disconnectedCallback() {
    this._closePlanEditor();
    cancelAnimationFrame(this._raf); this._raf = 0;
    if (this._unsub) { this._unsub.then(u => u && u()); this._unsub = null; }
  }

  _render() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style><style id="user"></style><ha-card><div class="wrap">' +
      '<div class="stage"></div><div class="layer"></div>' +
      '<div class="tools">' +
      '<button data-a="floor" class="txt" title="Geschoss wechseln" hidden></button>' +
      '<button data-a="iso" title="Schrägansicht"><ha-icon icon="mdi:cube-outline"></ha-icon></button>' +
      '<button data-a="top" title="Von oben"><ha-icon icon="mdi:floor-plan"></ha-icon></button>' +
      '<button data-a="rot" title="90° drehen"><ha-icon icon="mdi:rotate-right"></ha-icon></button>' +
      '<button data-a="wall" title="Volle Wandhöhe" aria-pressed="false"><ha-icon icon="mdi:wall"></ha-icon></button>' +
      '<button data-a="light" title="Licht"><ha-icon icon="mdi:theme-light-dark"></ha-icon></button>' +
      '<button data-a="edit" title="Grundriss auf dieser Karte bearbeiten"><ha-icon icon="mdi:pencil-ruler"></ha-icon></button>' +
      '</div><div class="coord" hidden></div><div class="msg" hidden></div>' +
      '<div class="dock" hidden><button class="x" title="Schließen">✕</button><div class="slot"></div></div></div></ha-card>';
    this._q = s => root.querySelector(s);
    this._q('.tools').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (b && this._ready) this._tool(b.dataset.a);
    });
    this._q('.dock .x').addEventListener('click', () => this._closeDock());
  }

  // ----- Ansichten (Geschosse, Bereiche)
  _floorList() {
    return viewsOf(this._config).map(v => Object.assign(v, { key: JSON.stringify([v.files, v.region, v.clip, this._config.plans_path]) }));
  }
  _wantFloor() {
    const cfg = this._config || {}, l = this._floorList();
    const pick = id => l.find(f => f.id === id);
    return (cfg.floor !== undefined && pick(String(cfg.floor))) || (this._floor !== undefined && pick(this._floor)) || pick(this._lastFloor()) || l[0];
  }
  _lastFloor() {
    if ((this._config || {}).remember_view === false) return null;
    try { return localStorage.getItem(this._baseKey() + ':floor'); } catch (e) { return null; }
  }
  async _loadParts(v) {
    await this._hassReady;
    const parts = await Promise.all(v.files.map(f => loadPlan(planSource(this._config, this._hass, f), this._hass)));
    if (parts.some(p => JSON.stringify(p.blocks || {}).includes('"glb"') || JSON.stringify(p.items || []).includes('"glb"'))) await loadGltf(this._config);
    return parts;
  }
  // Datei aus dem Plan-Paket (Textur, Modell): mit Integration angemeldet holen, sonst neben der Plan-Datei
  _asset(p, path) {
    const src = p._src || {}, stem = String(src.file || src.url || p.id || '').split('/').pop().replace(/\.json$/, '');
    const key = stem + '/' + path;
    assetCache[key] = assetCache[key] || (src.url
      ? Promise.resolve(src.url.replace(/[^/]*$/, '') + stem + '/' + path)
      : this._hass.fetchWithAuth('/api/' + WS + '/assets/' + encodeURIComponent(stem) + '/' + path.split('/').map(encodeURIComponent).join('/'))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }).then(b => URL.createObjectURL(b)));
    assetCache[key].catch(() => { delete assetCache[key]; });
    return assetCache[key];
  }
  // Tageslicht: lighting.mode auto (nach sun.sun), day oder night; Knopf in der Werkzeugleiste schaltet um
  _daylight() {
    const lc = (this._config || {}).lighting || {}, mode = this._lightMode || lc.mode || 'auto';
    if (mode === 'day') return 1;
    if (mode === 'night') return 0;
    const s = this._hass && this._hass.states[lc.sun || 'sun.sun'];
    if (!s) return 1;
    const el = s.attributes.elevation;
    if (typeof el !== 'number') return s.state === 'below_horizon' ? 0 : 1;
    return Math.max(0, Math.min(1, (el + 4) / 14));
  }
  _applyDaylight(force) {
    if (!this._model || !this._model.setDaylight) return;
    const d = Math.round(this._daylight() * 50) / 50, lc = (this._config || {}).lighting || {};
    if (!force && d === this._dayState) return;
    this._dayState = d;
    this._model.setDaylight(d, num(lc.night_ambient, 0.22));
    const b = this._q('[data-a="light"]');
    if (b) {
      const mode = this._lightMode || lc.mode || 'auto';
      b.querySelector('ha-icon').setAttribute('icon', mode === 'day' ? 'mdi:white-balance-sunny' : mode === 'night' ? 'mdi:weather-night' : 'mdi:theme-light-dark');
      b.title = 'Licht: ' + (mode === 'day' ? 'Tag' : mode === 'night' ? 'Nacht' : 'automatisch');
    }
    this._lightState = {};   // Lampenstärke hängt vom Tageslicht ab
    this._dirty = true;
  }
  // Integration meldet geänderte Plan-Dateien: betroffene Ansicht neu laden
  _subscribe() {
    if (this._unsub || !this._hass || !hasIntegration(this._hass) || !this._hass.connection) return;
    this._unsub = this._hass.connection.subscribeMessage(ev => {
      dropPlan(ev.file);
      const v = this._floorList().find(f => f.id === this._floor);
      if (this._ready && v && v.files.includes(ev.file)) this._switchFloor(this._floor);
    }, { type: WS + '/plans/subscribe' }).catch(() => null);
  }
  async _switchFloor(id) {
    const f = this._floorList().find(x => x.id === id) || this._floorList()[0];
    const seq = this._seq = (this._seq || 0) + 1;
    let parts;
    try { parts = await this._loadParts(f); } catch (e) {
      const m = this._q('.msg'); m.hidden = false;
      m.textContent = 'Ansicht ' + f.name + ' nicht ladbar: ' + (e && e.message ? e.message : e);
      return;
    }
    if (seq !== this._seq) return;
    this._q('.msg').hidden = true;
    this._closeDock();
    this._setModel(parts, f);
    try { localStorage.setItem(this._baseKey() + ':floor', f.id); } catch (e) { /* ohne Speicher weiter */ }
    const saved = this._loadView();
    this._full = saved ? !!saved.full : (this._config || {}).walls === 'full';
    this._applyConfig();
    this._moved = false; this._anim = null;
    if (saved && saved.p && saved.t) {
      this._camera.position.fromArray(saved.p); this._controls.target.fromArray(saved.t); this._controls.update(); this._moved = true;
    } else this._go('iso', this._az, true);
    await this._buildElements();
    this._applyStates(true);
  }
  _applyClip() {
    if (!this._model) return;
    const seen = new Set();
    this._model.scene.traverse(o => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => {
      if (seen.has(m)) return;
      seen.add(m);
      m.clippingPlanes = this._clip; m.clipShadows = !!this._clip; m.needsUpdate = true;
    }));
  }
  _setModel(parts, f) {
    if (this._model) {
      this._model.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => { if (m.alphaMap) m.alphaMap.dispose(); m.dispose(); });
      });
    }
    const T = this._T;
    const lc = (this._config || {}).lighting || {};
    this._model = this._M = createScene(T, parts, this._shadows, {
      assets: (p, path) => this._asset(p, path),
      dirty: () => { this._dirty = true; },
      lampShadows: this._shadows && lc.shadows !== false
    });
    this._dayState = undefined;
    this._parts = parts;
    this._floorIds = [f.id].concat(parts.map(p => p.id)).map(String);
    this._floor = f.id; this._file = f.key; this._mark = null;
    this._cx = this._M.CX; this._cz = this._M.CZ;
    // Ausschnitt: Kamera darauf ausrichten, optional alles außerhalb abschneiden
    const r = regionOf(f, parts);
    this._bounds = r ? { x: (r[0] + r[2]) / 2 - this._cx, z: (r[1] + r[3]) / 2 - this._cz, sx: r[2] - r[0], sz: r[3] - r[1] }
      : { x: 0, z: 0, sx: this._M.SIZE_X, sz: this._M.SIZE_Z };
    // Schnitt je Material, damit auch die Schatten abgeschnitten werden
    this._clip = r && f.clip ? [
      new T.Plane(new T.Vector3(1, 0, 0), -(r[0] - this._cx)), new T.Plane(new T.Vector3(-1, 0, 0), r[2] - this._cx),
      new T.Plane(new T.Vector3(0, 0, 1), -(r[1] - this._cz)), new T.Plane(new T.Vector3(0, 0, -1), r[3] - this._cz)] : null;
    if (this._renderer) this._renderer.localClippingEnabled = !!this._clip;
    this._applyClip();
    const l = this._floorList(), b = this._q('[data-a="floor"]');
    b.hidden = l.length < 2; b.textContent = f.name || '–';
    this._dirty = true;
  }

  async _init() {
    this._loading = true;
    const cfg = this._config || {};
    this._sizeWrap();
    let THREE, parts, f;
    try {
      THREE = await loadLib(cfg);
      f = this._wantFloor();
      parts = await this._loadParts(f);
      this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this._renderer.localClippingEnabled = true;
    } catch (e) {
      this._loading = false;
      const m = this._q('.msg'); m.hidden = false;
      m.textContent = '3D-Ansicht nicht verfügbar: ' + (e && e.message ? e.message : e);
      return;
    }
    this._T = THREE;
    const shadows = this._shadows = cfg.shadows !== false;
    const r = this._renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.physicallyCorrectLights = true;   // Lampen mit realistischem Abfall (1/d²)
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this._q('.stage').appendChild(r.domElement);

    this._setModel(parts, f);
    this._camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
    const c = this._controls = new THREE.OrbitControls(this._camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.09;
    c.maxPolarAngle = Math.PI / 2 - 0.04; c.minDistance = 2; c.maxDistance = 120;
    c.screenSpacePanning = false; c.enableZoom = cfg.zoom !== false;
    c.target.set(0, 0.3, 0);
    c.addEventListener('start', () => { this._moved = true; this._anim = null; });
    c.addEventListener('end', () => this._saveView());

    this._mode = 'iso';
    this._az = (cfg.azimuth === undefined ? 25 : cfg.azimuth) * Math.PI / 180;
    this._tilt = (cfg.tilt === undefined ? 50 : cfg.tilt) * Math.PI / 180;
    this._full = cfg.walls === 'full';
    this._dirty = true;
    this._ready = true; this._loading = false;

    const saved = this._loadView();
    if (saved) this._full = !!saved.full;
    this._applyConfig();
    this._resize();
    if (saved && saved.p && saved.t) {
      this._camera.position.fromArray(saved.p); c.target.fromArray(saved.t); c.update(); this._moved = true;
    } else this._go('iso', this._az, true);

    new ResizeObserver(() => this._resize()).observe(this._q('.wrap'));
    this._helper(r.domElement);
    await this._buildElements();
    this._applyStates(true);
    this._start();
  }

  _sizeWrap() {
    const cfg = this._config || {}, w = this._q('.wrap');
    if (cfg.height) { w.style.height = cfg.height; w.style.aspectRatio = ''; }
    else { w.style.height = ''; w.style.aspectRatio = cfg.aspect_ratio || '16 / 10'; }
    this._q('.tools').hidden = cfg.controls === false;
    this._q('#user').textContent = cfg.css || '';
  }
  _applyConfig() {
    const cfg = this._config || {}, m = this._model;
    this._sizeWrap();
    m.buildWalls(this._full ? this._M.FULL : this._M.HALF);
    // model_lights.<name>: light.x  oder  { entity: light.x, pos: [x, y, h], size: 0.4, disc: false }
    const ml = Object.assign({}, ...((this._parts || []).map(p => p.model_lights || {})), cfg.model_lights || {});
    this._lights = {}; this._lampIcons = [];
    if (m.resetLights) m.resetLights();
    Object.keys(ml).forEach(k => {
      const v = ml[k], o = v && typeof v === 'object' ? v : { entity: v };
      if (!o.entity) return;
      // Leuchte gehört zu einem anderen Geschoss: eigene mit floor, Plan-Leuchten nur, wenn der Plan sie kennt
      if (o.floor !== undefined && !this._floorIds.includes(String(o.floor))) return;
      if (m.hasLight && !m.hasLight(k) && !Array.isArray(o.pos)) return;
      this._lights[k] = o.entity;
      // icon: Symbol statt Scheibe, der Lichtschein bleibt
      if (o.icon && m.lightPos) this._lampIcons.push({ k: k, icon: o.icon, size: num(o.icon_size, 34), h: Array.isArray(o.pos) ? num(o.pos[2], undefined) : undefined });
      if (!m.placeLight || (!o.pos && o.size === undefined && o.disc === undefined && !o.icon && o.power === undefined && o.range === undefined && !o.type)) return;
      const p = Array.isArray(o.pos) ? o.pos : [];
      // power: Lichtstärke (1 = normal), range: Reichweite in m, type: ceiling | point | lamp (nur bei eigenen Leuchten)
      m.placeLight(k, num(p[0], undefined), num(p[1], undefined), num(p[2], undefined), { size: num(o.size, undefined), disc: o.icon && m.lightPos ? false : o.disc,
        power: num(o.power, undefined), range: num(o.range, undefined), type: o.type });
    });
    m.setColors(cfg.colors);
    // Modelle mit lightsIdle 'off' zeigen ungebundene Leuchten ausgeschaltet
    if (m.lightsIdle === 'off') Object.keys(m.glows).forEach(k => { if (!this._lights[k]) m.setLight(k, false, null, true); });
    this._applyClip();
    m.furn.visible = cfg.furniture !== false;
    m.high.visible = this._full;
    this._q('[data-a="wall"]').setAttribute('aria-pressed', String(this._full));
    this._lightState = {};
    this._opState = {};
    const color = cfg.background_color || ((this._parts || [])[0]?.appearance || {}).background_color;
    this._q('.wrap').style.background = color || 'var(--card-background-color, transparent)';
    this._dirty = true;
    this._applyStates(true);
  }

  // ----- Elemente wie bei picture-elements, verankert an einem Punkt im Raum
  async _buildElements() {
    const layer = this._q('.layer'), T = this._T, floor = this._floor;
    const allElements = ((this._config && this._config.elements) || []).concat(...((this._parts || []).map(p => p.ui_elements || [])));
    const els = allElements.filter(ec => ec.floor === undefined || this._floorIds.includes(String(ec.floor)));
    const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
    if (floor !== this._floor) return;   // inzwischen umgeschaltet
    layer.textContent = '';
    this._pins = els.map(ec => {
      const pin = document.createElement('div');
      pin.className = 'pin';
      layer.appendChild(pin);
      const dh = num(this._config.element_height, 1.25);
      // pos: [x, y] oder x / y; der HA-Editor macht aus dem Schlüssel y gern true (YAML 1.1), das wird mitgelesen
      const pos = Array.isArray(ec.pos) ? ec.pos : [ec.x, ec.y !== undefined ? ec.y : ec['true']];
      const p = { pin: pin, pos: new T.Vector3(num(pos[0], 0) - this._cx, num(pos.length > 2 ? pos[2] : ec.h, dh), num(pos[1], 0) - this._cz) };
      if (pos.slice(0, 2).some(v => v !== undefined && isNaN(num(v, NaN)))) console.warn('smartify-floorplan3d: Position nicht lesbar', ec);
      this._makeElement(p, ec, helpers);
      return p;
    });
    (this._lampIcons || []).forEach(li => {
      const at = this._model.lightPos(li.k);
      if (!at) return;
      at.y = li.h !== undefined ? li.h : num(this._config.element_height, 1.25);   // Symbol auf Elementhöhe, Lichtschein bleibt an der Decke
      const pin = document.createElement('div');
      pin.className = 'pin';
      layer.appendChild(pin);
      const p = { pin: pin, pos: at, lamp: li.k };
      this._makeLamp(p, li);
      this._paintLamp(p);
      this._pins.push(p);
    });
    this._dirty = true;
  }
  // Leuchten-Symbol: Tippen schaltet, langer Druck öffnet den Dialog
  _makeLamp(p, li) {
    const el = document.createElement('div');
    el.className = 'element lamp';
    el.style.width = el.style.height = li.size + 'px';
    el.style.setProperty('--mdc-icon-size', Math.round(li.size * 0.62) + 'px');
    const ic = document.createElement('ha-icon');
    ic.setAttribute('icon', li.icon);
    el.appendChild(ic);
    let timer = 0, held = false;
    el.addEventListener('pointerdown', ev => {
      ev.stopPropagation(); held = false;
      clearTimeout(timer);
      timer = setTimeout(() => { held = true; this._hold({ light: li.k }); }, 550);
    });
    el.addEventListener('pointerup', ev => {
      ev.stopPropagation(); clearTimeout(timer);
      if (!held) this._act({ light: li.k });
    });
    el.addEventListener('pointerleave', () => clearTimeout(timer));
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    const rot = document.createElement('div');
    rot.className = 'rot';
    rot.appendChild(el);
    p.pin.appendChild(rot);
    p.el = el; p.rot = rot; p.spin = null;
  }
  _paintLamp(p) {
    if (!p.lamp || !this._hass) return;
    const so = this._hass.states[this._lights[p.lamp]], on = !!so && so.state === 'on', rgb = on && so.attributes.rgb_color;
    p.el.classList.toggle('on', on);
    p.el.style.setProperty('--lamp-color', rgb ? 'rgb(' + rgb.join(',') + ')' : on ? 'var(--state-light-active-color, #ffb300)' : 'var(--state-icon-color, #44739e)');
  }
  _makeElement(p, ec, helpers) {
    const conf = Object.assign({}, ec);
    delete conf.x; delete conf.y; delete conf['true']; delete conf.pos; delete conf.h; delete conf.spin; delete conf.floor;
    let el;
    try {
      el = helpers ? helpers.createHuiElement(conf) : document.createElement('span');
    } catch (e) {
      el = document.createElement('span'); el.textContent = '⚠ ' + e.message;
    }
    el.classList.add('element');
    const st = conf.style || {};
    Object.keys(st).forEach(k => { if (k !== 'top' && k !== 'left') el.style.setProperty(k, st[k]); });
    if (this._hass) el.hass = this._hass;
    el.addEventListener('ll-rebuild', ev => { ev.stopPropagation(); this._makeElement(p, ec, helpers); }, { once: true });
    const rot = document.createElement('div');
    rot.className = 'rot';
    rot.appendChild(el);
    p.pin.textContent = '';
    p.pin.appendChild(rot);
    p.el = el; p.rot = rot; p.spin = ec.spin ? ec.entity : null;
    this._spin(p);
  }
  // spin: true dreht das Element, solange die Entität eingeschaltet ist (z. B. Lüfter)
  _spin(p) {
    if (!p.spin || !this._hass) return;
    const s = this._hass.states[p.spin];
    p.rot.classList.toggle('spin', !!s && s.state === 'on');
  }
  _placePins() {
    if (!this._pins) return;
    const cam = this._camera, w = this._w, h = this._h, v = this._v || (this._v = new this._T.Vector3());
    this._pins.forEach(p => {
      v.copy(p.pos).project(cam);
      const off = v.z > 1 || v.z < -1;
      p.pin.hidden = off;
      if (off) return;
      p.pin.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((0.5 - v.y * 0.5) * h).toFixed(1) + 'px)';
      p.pin.style.zIndex = String(Math.round((1 - v.z) * 1e5));
    });
  }

  // ----- Lichter, die Leuchtflächen im Modell färben
  _applyStates(force) {
    if (!this._ready || !this._hass) return;
    this._applyDaylight(force);
    const g = this._model.glows;
    Object.keys(g).forEach(k => {
      const id = this._lights[k];
      if (!id) return;
      const so = this._hass.states[id];
      if (!force && this._lightState[k] === so) return;
      this._lightState[k] = so;
      const on = !!so && so.state === 'on';
      const at = (so && so.attributes) || {};
      const rgb = !on ? null : at.rgb_color || (at.color_temp_kelvin ? kelvinRgb(at.color_temp_kelvin) : at.color_temp ? kelvinRgb(1e6 / at.color_temp) : null);
      const level = on && typeof at.brightness === 'number' ? at.brightness / 255 : 1;
      this._model.setLight(k, on, rgb, false, level);
      if (this._pins) this._pins.forEach(p => { if (p.lamp === k) this._paintLamp(p); });
      this._dirty = true;
    });
    // Fensterkontakte, Rollos und Tore an den Öffnungen
    const oc = (this._config || {}).openings || {};
    Object.keys(oc).forEach(id => {
      if (!this._model.openings[id]) return;
      const c = oc[id] || {}, cs = c.contact ? this._hass.states[c.contact] : null, vs = c.cover ? this._hass.states[c.cover] : null;
      const last = this._opState[id];
      if (!force && last && last[0] === cs && last[1] === vs) return;
      this._opState[id] = [cs, vs];
      let frac = c.cover ? 0 : null;
      let tilt = 50;
      if (vs) {
        const pos = vs.attributes.current_position;
        if (typeof vs.attributes.current_tilt_position === 'number') tilt = vs.attributes.current_tilt_position;
        frac = typeof pos === 'number' ? 1 - pos / 100 : vs.state === 'closed' ? 1 : vs.state === 'open' ? 0 : 0.5;
      }
      // ohne cover bleibt der Anteil des Modells (Tor zu, Rollo offen)
      if (frac === null) { const o = this._model.openings[id]; frac = (o.sectional || (o.shutter && o.shutter.visible)) ? 1 : 0; }
      this._model.setOpening(id, !!cs && cs.state === 'on', frac, tilt);
      this._dirty = true;
    });
  }
  // Klick auf ein Modellteil: Licht schalten oder Dialog der Öffnung zeigen
  _entityFor(act) {
    if (act.light) return this._lights[act.light];
    const c = ((this._config || {}).openings || {})[act.opening] || {};
    return c.cover || c.contact;
  }
  _act(act) {
    const id = this._entityFor(act);
    if (!id || !this._hass) return;
    const so = this._hass.states[id], oc = act.opening ? ((this._config || {}).openings || {})[act.opening] : null;
    if (oc && oc.card) this._openDock(act.opening, oc.card);
    else if (act.light && so && so.state !== 'unavailable') this._hass.callService('homeassistant', 'toggle', { entity_id: id });
    else this._moreInfo(id);
  }
  // langer Druck: Dialog des Lichts (Farbauswahl) bzw. der Öffnung
  _hold(act) {
    const id = this._entityFor(act);
    if (id) this._moreInfo(id);
  }
  _moreInfo(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }
  // Bedienkarte einer Öffnung (Option openings.<name>.card) unten in der Karte ein- und ausblenden
  async _openDock(id, conf) {
    if (this._dock && this._dock.id === id) { this._closeDock(); return; }
    const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
    const make = () => {
      let el;
      try {
        el = helpers ? helpers.createCardElement(conf) : document.createElement('span');
      } catch (e) {
        el = document.createElement('span'); el.textContent = '⚠ ' + e.message;
      }
      if (this._hass) el.hass = this._hass;
      el.addEventListener('ll-rebuild', ev => { ev.stopPropagation(); if (this._dock && this._dock.id === id) make(); }, { once: true });
      const slot = this._q('.dock .slot');
      slot.textContent = '';
      slot.appendChild(el);
      this._dock = { id: id, el: el };
    };
    make();
    this._q('.dock').hidden = false;
  }
  _closeDock() {
    if (!this._dock) return;
    this._dock = null;
    this._q('.dock').hidden = true;
    this._q('.dock .slot').textContent = '';
  }

  // Vollbild-Draufsicht: Bearbeitung findet auf der Karte statt, nicht in der Lovelace-Konfiguration.
  _openPlanEditor() {
    if (this._planOverlay || !this._hass || !this._parts) return;
    if (!this._hass.user || !this._hass.user.is_admin) {
      this._message('Zum Speichern der Gebäudepläne sind Administratorrechte erforderlich.'); return;
    }
    if (!hasIntegration(this._hass) || (this._config || {}).plans_path) {
      this._message('Für die Bearbeitung direkt auf der Karte müssen Pläne über die Smartify-Integration geladen werden.'); return;
    }
    const view = this._floorList().find(v => v.id === this._floor);
    if (!view) return;
    const host = document.createElement('div');
    host.className = 'smartify-plan-modal';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483640;display:flex;flex-direction:column;background:var(--primary-background-color,#fafafa);color:var(--primary-text-color,#222);padding:max(8px,env(safe-area-inset-top)) 10px max(8px,env(safe-area-inset-bottom));box-sizing:border-box;overflow:hidden;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding-bottom:8px;min-width:0;';
    const title = document.createElement('strong'); title.textContent = '2D-Grundriss bearbeiten – ' + view.name;
    const info = document.createElement('span'); info.style.cssText = 'display:none;';
    info.textContent = 'Elemente, Leuchten und Gegenstände ziehen, kopieren oder drehen';
    const close = document.createElement('button'); close.textContent = 'Schließen'; close.type = 'button';
    close.style.cssText = 'font:inherit;padding:8px 12px;border-radius:8px;cursor:pointer;margin-left:auto;flex-shrink:0;';
    close.addEventListener('click', () => {
      const editor = host.querySelector('smartify-floorplan3d-editor');
      if (editor && editor._modified && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
      this._closePlanEditor();
    });
    bar.append(title, info, close);
    const scroll = document.createElement('div'); scroll.style.cssText = 'flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;';
    const editor = document.createElement('smartify-floorplan3d-editor');
    editor._cardMode = true;
    editor._cardView = view;
    editor._cardFiles = view.files;
    editor._cardParts = this._parts.map(p => JSON.parse(JSON.stringify(p)));
    const base = editor._cardParts[0] || {};
    editor.setConfig(Object.assign({}, this._config, {
      floors: [{ id: view.id, name: view.name, files: view.files, region: view.region }],
      elements: JSON.parse(JSON.stringify(base.ui_elements || [])),
      model_lights: JSON.parse(JSON.stringify(base.model_lights || {}))
    }));
    editor.hass = this._hass;
    const saved = () => { this._closePlanEditor(); this._switchFloor(this._floor); };
    editor.addEventListener('plan-saved', saved, { once: true });
    scroll.appendChild(editor);
    host.append(bar, scroll);
    document.body.appendChild(host);
    this._planOverlay = host;
  }
  _closePlanEditor() {
    if (this._planOverlay) { this._planOverlay.remove(); this._planOverlay = null; }
  }
  _message(msg) {
    const el = this._q('.msg'); el.hidden = false; el.textContent = msg;
  }

  // ----- Kamera
  _fit(polar) {
    const cam = this._camera, v = cam.fov * Math.PI / 360, hh = Math.atan(Math.tan(v) * cam.aspect);
    const SX = this._bounds.sx, SZ = this._bounds.sz, diag = Math.hypot(SX, SZ), top = polar < 0.1;
    const needW = (top ? SX : diag * 0.86) / 2 / Math.tan(hh);
    const needH = (top ? SZ : diag * 0.86 * Math.cos(polar) + 2.2 * Math.sin(polar)) / 2 / Math.tan(v);
    return Math.max(needW, needH) * 1.12 + 1.5;
  }
  _go(mode, az, instant) {
    const T = this._T, top = mode === 'top', polar = top ? 0.0005 : this._tilt, d = this._fit(polar);
    this._mode = mode;
    if (top) az = 0; else this._az = az;
    const B = this._bounds, t = new T.Vector3(B.x, 0.3, B.z);
    const p = new T.Vector3(B.x + d * Math.sin(polar) * Math.sin(az), 0.3 + d * Math.cos(polar), B.z + d * Math.sin(polar) * Math.cos(az));
    if (instant) {
      this._camera.position.copy(p); this._controls.target.copy(t); this._controls.update(); this._dirty = true;
    } else this._anim = { p0: this._camera.position.clone(), t0: this._controls.target.clone(), p1: p, t1: t, s: performance.now() };
  }
  _tool(a) {
    if (a === 'edit') { this._openPlanEditor(); return; }
    if (a === 'floor') {
      const l = this._floorList(), i = l.findIndex(f => f.id === this._floor);
      this._switchFloor(l[(i + 1) % l.length].id);
      return;
    }
    if (a === 'wall') { this._full = !this._full; this._applyConfig(); this._saveView(); return; }
    if (a === 'light') {
      const lc = (this._config || {}).lighting || {}, order = ['auto', 'night', 'day'], cur = this._lightMode || lc.mode || 'auto';
      this._lightMode = order[(order.indexOf(cur) + 1) % 3];
      this._applyDaylight(true); this._applyStates(true);
      return;
    }
    this._moved = false;
    if (a === 'iso') this._go('iso', this._az);
    else if (a === 'top') this._go('top', 0);
    else this._go('iso', this._az + Math.PI / 2);
    this._clearView();
  }
  _baseKey() { return 'smartify-fp3d:' + ((this._config && this._config.id) || location.pathname); }
  _key() { return this._baseKey() + (this._floor ? ':' + this._floor : ''); }
  _saveView() {
    if ((this._config || {}).remember_view === false) return;
    try {
      localStorage.setItem(this._key(), JSON.stringify({ p: this._moved ? this._camera.position.toArray() : null, t: this._moved ? this._controls.target.toArray() : null, full: this._full }));
    } catch (e) { /* ohne Speicher weiter */ }
  }
  _clearView() { this._saveView(); }
  _loadView() {
    if ((this._config || {}).remember_view === false) return null;
    try { return JSON.parse(localStorage.getItem(this._key()) || 'null'); } catch (e) { return null; }
  }

  _resize() {
    if (!this._ready) return;
    const s = this._q('.stage'), w = s.clientWidth, h = s.clientHeight;
    if (!w || !h) return;
    this._w = w; this._h = h;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h; this._camera.updateProjectionMatrix();
    if (!this._moved) this._go(this._mode, this._az, true);
    this._dirty = true;
  }
  _start() {
    if (this._raf) return;
    const frame = now => {
      if (!this.isConnected) { this._raf = 0; return; }
      this._raf = requestAnimationFrame(frame);
      const a = this._anim;
      if (a) {
        const k = Math.min(1, (now - a.s) / 650), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this._camera.position.lerpVectors(a.p0, a.p1, e);
        this._controls.target.lerpVectors(a.t0, a.t1, e);
        if (k >= 1) this._anim = null;
        this._dirty = true;
      }
      if (this._controls.update()) this._dirty = true;
      if (this._dirty && this._w) {
        this._renderer.render(this._model.scene, this._camera);
        this._placePins();
        this._dirty = false;
      }
    };
    this._raf = requestAnimationFrame(frame);
  }

  // ----- Zeiger: Klick auf Modellteile, Positionshilfe (helper: true zeigt x / y in Metern)
  _helper(dom) {
    const T = this._T, ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
    const aim = ev => {
      const r = dom.getBoundingClientRect();
      ray.setFromCamera({ x: (ev.clientX - r.left) / r.width * 2 - 1, y: 1 - (ev.clientY - r.top) / r.height * 2 }, this._camera);
    };
    const pick = () => {
      const h = ray.intersectObjects(this._model.clickables(), false).find(i => this._entityFor(i.object.userData.act));
      return h ? h.object.userData.act : null;
    };
    let down = null, busy = false, held = false, timer = 0;
    dom.addEventListener('pointerdown', ev => {
      down = [ev.clientX, ev.clientY]; held = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!down) return;
        aim({ clientX: down[0], clientY: down[1] });
        const act = pick();
        if (act) { held = true; this._hold(act); }
      }, 550);
    });
    dom.addEventListener('pointercancel', () => { clearTimeout(timer); down = null; });
    dom.addEventListener('pointermove', ev => {
      if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4) clearTimeout(timer);
      if (ev.buttons || ev.pointerType !== 'mouse' || busy) return;
      busy = true;
      requestAnimationFrame(() => { busy = false; aim(ev); dom.style.cursor = pick() ? 'pointer' : ''; });
    });
    dom.addEventListener('pointerup', ev => {
      clearTimeout(timer);
      if (held) { held = false; down = null; return; }
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4) return;
      down = null;
      aim(ev);
      const act = pick();
      if (act) this._act(act); else this._closeDock();
      if (!(this._config || {}).helper || !ray.ray.intersectPlane(plane, hit)) return;
      const c = this._q('.coord'); c.hidden = false;
      c.textContent = 'pos: [' + (hit.x + this._cx).toFixed(2) + ', ' + (hit.z + this._cz).toFixed(2) + ']';
      if (!this._mark) {
        this._mark = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1.4, 12), new T.MeshBasicMaterial({ color: 0xff3d71 }));
        this._model.scene.add(this._mark);
      }
      this._mark.position.set(hit.x, 0.7, hit.z);
      this._dirty = true;
    });
  }
}

/* ===== Karten-Editor: Draufsicht, Elemente und Leuchten per Drag & Drop ===== */
const ED_CSS = `
:host { display: block; }
.ed { display: flex; flex-direction: column; gap: 10px; }
.tabs, .bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
button.t, button.b { font: inherit; font-size: 13px; cursor: pointer; padding: 6px 12px; border-radius: 16px; border: 1px solid var(--divider-color, #8885);
  background: var(--card-background-color, #fff); color: var(--primary-text-color); }
button.t[aria-pressed="true"], button.b[aria-pressed="true"] { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
button.b.warn { color: var(--error-color, #db4437); border-color: currentColor; }
.hint { font-size: 12px; color: var(--secondary-text-color); }
.plan { position: relative; width: 100%; border-radius: 10px; overflow: hidden; background: var(--secondary-background-color, #f3f3f3);
  touch-action: none; user-select: none; }
.plan.placing { cursor: crosshair; }
.plan svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mk { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; display: grid; place-items: center; cursor: grab;
  background: var(--card-background-color, #fff); color: var(--primary-color); border: 2px solid var(--primary-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .3); --mdc-icon-size: 18px; touch-action: none; }
.mk.light { color: #b27b00; border-color: #e0a800; }
/* Wenige, kleine Marker statt 95 grosser Kreise ueber dem Grundriss. */
.ed.card-edit .mk { width:18px;height:18px;margin:-9px 0 0 -9px;border-width:1px; --mdc-icon-size:12px;box-shadow:0 1px 2px #0003; }
.ed.card-edit .mk.object { width:12px;height:12px;margin:-6px 0 0 -6px;border:1px solid #64748b;background:#94a3b8cc;color:#fff;--mdc-icon-size:9px; }
.ed.card-edit .mk.object.sel { width:20px;height:20px;margin:-10px 0 0 -10px;border:2px solid var(--primary-color);--mdc-icon-size:13px;z-index:3; }
.ed.card-edit .mk.light { background:#ffefd0;color:#a86b00;border-color:#bc8b2d; }
.ed.card-edit .mk.element { background:color-mix(in srgb,var(--primary-color) 12%,var(--card-background-color,#fff)); }
.ed.card-edit .mk[hidden] { display:none; }
.ed.card-edit .plan { min-width:100%; }
.ed.card-edit .bar .b[data-filter] { border-radius:12px; }
.ed.card-edit .bar .b[data-filter][aria-pressed="false"] { opacity:.62; }
.ed.card-edit .mk .lbl { display:none; }
.ed.card-edit .mk:hover .lbl, .ed.card-edit .mk.sel .lbl { display:block; z-index:2; }
.mk.light.free { opacity: .55; border-style: dashed; }
.mk.sel { outline: 3px solid color-mix(in srgb, var(--primary-color) 45%, transparent); outline-offset: 2px; z-index: 2; }
.mk:active { cursor: grabbing; }
.mk .lbl { position: absolute; top: 31px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 10px; line-height: 1.2; padding: 1px 4px;
  border-radius: 4px; background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent); color: var(--primary-text-color); pointer-events: none; }
.panel { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; padding: 10px; border: 1px solid var(--divider-color, #8885); border-radius: 10px; }
.panel h4 { grid-column: 1 / -1; margin: 0; font-size: 14px; }
.panel .full { grid-column: 1 / -1; }
.panel label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--secondary-text-color); }
.panel input, .panel select { font: inherit; font-size: 14px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color, #8886);
  background: var(--card-background-color, #fff); color: var(--primary-text-color); min-width: 0; }
.panel .row { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
.panel, .panel .full { min-width: 0; }
.panel .full > * { min-width: 0; max-width: 100%; }
@media (max-width: 700px) { .panel { grid-template-columns: 1fr; } }
.ed.card-edit { width: 100%; max-width: 1500px; min-width:0; margin: auto; padding: 4px; box-sizing:border-box; }
.ed:not(.card-edit) > .tabs, .ed:not(.card-edit) > .bar, .ed:not(.card-edit) > .plan-scroll, .ed:not(.card-edit) > .sel { display:none; }
.plan-scroll { overflow:auto; width:100%; max-width:100%; max-height:min(70vh, 760px); border:1px solid var(--divider-color,#8885); border-radius:10px; touch-action:none; overscroll-behavior:contain; box-sizing:border-box; }
.ed.card-edit .plan { max-height: none; overflow: hidden; flex-shrink:0; }
.ed.card-edit .sel { width:100%; min-width:0; overflow:visible; }
.ed.card-edit .sel:empty { display:none; }
.ed.card-edit .sel .panel { width:100%; box-sizing:border-box; background:var(--card-background-color,#fff); }
.ed.card-edit .bar { align-items:center; }
.zoom-controls { display:flex;justify-content:flex-end;align-items:center;gap:8px; }
.zoom-controls button { font:inherit;cursor:pointer;border:1px solid var(--divider-color,#8885);color:var(--primary-text-color);background:var(--card-background-color,#fff);border-radius:8px;padding:5px 12px;min-height:36px; }
.zoom-controls span { min-width:52px;text-align:center;font-size:13px;color:var(--secondary-text-color); }
@media (max-width:700px) { .ed.card-edit .panel { grid-template-columns:minmax(0,1fr); } .ed.card-edit .panel .full { grid-column:1; } .ed.card-edit .bar { gap:8px; } }
.ed.card-edit .plans-box, .ed.card-edit .more-box { display: none; }
.ed.card-edit .bar.savebar { position:sticky;top:0;z-index:10;background:var(--primary-background-color,#fafafa);padding:8px 0; }

/* Fullscreen editor controls: solid, theme-aware, readable on phone and tablet. */
.ed.card-edit, .ed.card-edit .sel, .ed.card-edit .panel { max-width:100%;min-width:0;box-sizing:border-box; }
.ed.card-edit .panel { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;padding:12px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222); }
.ed.card-edit .fp-field { display:flex;flex-direction:column;gap:5px;min-width:0;max-width:100%;color:var(--primary-text-color,#222);font-size:13px; }
.ed.card-edit .fp-field-title { font-weight:600;opacity:1; }
.ed.card-edit .fp-field > input, .ed.card-edit .fp-field > select, .ed.card-edit .fp-field > ha-entity-picker, .ed.card-edit .fp-field > ha-icon-picker { display:block;box-sizing:border-box;min-width:0;width:100%;max-width:100%;min-height:40px;font-size:16px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);opacity:1; }
.ed.card-edit .light-picker { position:relative;min-width:0;width:100%;max-width:100%; }
.ed.card-edit .light-picker input { min-height:42px;font-size:16px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);opacity:1; }
.ed.card-edit .light-picker .light-results { position:relative;z-index:15;display:flex;flex-direction:column;gap:2px;max-height:min(270px,36vh);overflow-y:auto;overscroll-behavior:contain;background:var(--card-background-color,#fff);box-shadow:0 3px 12px #0002; }
.ed.card-edit .light-picker .light-results[hidden] { display:none; }
.ed.card-edit .light-option { display:flex;flex-direction:column;gap:2px;text-align:left;min-height:45px;padding:9px;border-radius:6px;color:var(--primary-text-color,#222); }
.ed.card-edit .light-option small { font-size:11px;color:var(--secondary-text-color,#666); }
.ed.card-edit .light-empty { padding:10px;color:var(--secondary-text-color,#666); }
.ed.card-edit .light-option:focus-visible, .ed.card-edit .light-option:hover { background:var(--secondary-background-color,#eee); }
/* Furniture footprints are drawn on the floor; tapping selects one without covering it with icons. */
.plan svg .fp-object { cursor:pointer;pointer-events:visiblePainted; }
.plan svg .fp-object > * { vector-effect:non-scaling-stroke;stroke-width:1px; }
.plan svg .fp-object.selected > * { stroke:var(--primary-color,#03a9f4);stroke-width:2px; }

.light-picker { display:flex;flex-direction:column;gap:4px; min-width:0; }
.light-picker input { width:100%;box-sizing:border-box; }
.light-picker .light-results { max-height:220px;overflow:auto;border:1px solid var(--divider-color,#8885);border-radius:8px;background:var(--card-background-color,#fff); }
.light-picker .light-results[hidden] { display:none; }
.light-picker button { display:block;width:100%;text-align:left;padding:9px;border:0;background:transparent;color:var(--primary-text-color);cursor:pointer;white-space:normal;overflow-wrap:anywhere; }
.light-picker button:hover { background:var(--secondary-background-color,#eee); }
details { border: 1px solid var(--divider-color, #8885); border-radius: 10px; padding: 8px 10px; }
details summary { cursor: pointer; font-size: 14px; }
details .panel { border: 0; padding: 8px 0 0; }
.err { color: var(--error-color, #db4437); font-size: 13px; }
.plans { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; }
.plans .it { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; border-radius: 8px; background: var(--secondary-background-color, #f3f3f3); }
.plans .it b { font-weight: 600; }
.plans .it .m { font-size: 12px; color: var(--secondary-text-color); flex: 1; min-width: 120px; }
.plans .ok { color: var(--success-color, #43a047); font-size: 13px; }
.plans .bad { color: var(--error-color, #db4437); font-size: 13px; }
`;
const DOMAIN_ICONS = { light: 'mdi:lightbulb', switch: 'mdi:toggle-switch', fan: 'mdi:fan', cover: 'mdi:window-shutter', climate: 'mdi:thermostat',
  sensor: 'mdi:eye', binary_sensor: 'mdi:checkbox-blank-circle-outline', camera: 'mdi:cctv', media_player: 'mdi:speaker', lock: 'mdi:lock',
  scene: 'mdi:palette', script: 'mdi:script-text', vacuum: 'mdi:robot-vacuum', person: 'mdi:account', input_boolean: 'mdi:toggle-switch-outline' };
const FILL = { tile: '#e6e3dc', parquet: '#e8d6b8', coating: '#d4d8db', screed: '#dcd8d0', paving: '#d9d4cb', larch: '#dcc3a2', gravel: '#d6d3cc' };
const RECT_ITEMS = ['cabinet', 'worktop', 'bed', 'nightstand', 'sofa', 'table', 'toilet', 'vanity', 'washer', 'shower', 'tub', 'lounger', 'diningChair', 'rug'];
const r2 = v => Math.round(v * 20) / 20;   // 5-cm-Raster
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class SmartifyFloorplan3dEditor extends HTMLElement {
  setConfig(config) {
    // eigene Änderungen kommen über HA zurück: dann nicht neu aufbauen, nur übernehmen
    if (this._sent && JSON.stringify(config) === this._sent) { this._config = config; return; }
    this._config = config;
    if (this.shadowRoot) this._load();
  }
  constructor() {
    super();
    this._hassReady = new Promise(res => { this._hassOk = res; });
  }
  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (this._hassOk) { this._hassOk(); this._hassOk = null; }
    if (first && this.shadowRoot) this._renderPlans();
    this.shadowRoot && this.shadowRoot.querySelectorAll('ha-entity-picker, ha-icon-picker').forEach(p => { p.hass = h; });
    if (first && this.shadowRoot) this._renderMarks();
  }
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + ED_CSS + '</style><div class="ed' + (this._cardMode ? ' card-edit' : '') + '"><div class="tabs"></div><div class="bar">' +
      '<button class="b" data-a="add">+ Element</button><button class="b" data-a="addlight">+ Leuchte</button>' +
      (this._cardMode ? '<button type="button" class="b" data-filter="object" aria-pressed="false">Gegenstände anzeigen</button>' : '') +
      '<span class="hint"></span></div>' +
      (this._cardMode ? '<div class="zoom-controls" aria-label="Grundriss-Zoom"><button type="button" data-zoom="out" aria-label="Verkleinern">−</button><span data-zoom-value>100 %</span><button type="button" data-zoom="in" aria-label="Vergrößern">+</button><button type="button" data-zoom="fit">Einpassen</button></div>' : '') +
      '<div class="err" hidden></div><div class="plan-scroll"><div class="plan"><svg></svg></div></div><div class="sel"></div>' +
      (this._cardMode ? '<div class="bar savebar"><button class="b" data-save="yes">Änderungen im Plan speichern</button><span class="hint">Positionen werden in der jeweiligen JSON-Datei gespeichert.</span></div>' : '') +
      (!this._cardMode ? '<p class="hint">Entitäten, Leuchten und 3D-Gegenstände bearbeitest du direkt auf der Karte über das Stift-Symbol.</p>' : '') +
      '<details class="pl plans-box" open><summary>Pläne</summary><div class="plans"></div></details>' +
      '<details class="more-box"><summary>Weitere Einstellungen</summary><div class="panel more"></div></details></div>';
    this._q = s => root.querySelector(s);
    this._q('.bar').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.filter === 'object') { this._showObjects = !this._showObjects; b.setAttribute('aria-pressed', String(!!this._showObjects)); this._renderMarks(); return; }
      if (!b.dataset.a) return;
      this._placing = this._placing === b.dataset.a ? null : b.dataset.a;
      this._renderBar();
    });
    this._wirePlan();
    if (this._cardMode) {
      this._zoom = 1;
      this._showObjects = false;
      this._q('.zoom-controls').addEventListener('click', ev => {
        const b = ev.target.closest('[data-zoom]');
        if (!b) return;
        const scroll = this._q('.plan-scroll');
        const midX = scroll.scrollLeft + scroll.clientWidth / 2, midY = scroll.scrollTop + scroll.clientHeight / 2;
        const previous = this._zoom || 1;
        this._zoom = b.dataset.zoom === 'fit' ? 1 : Math.max(1, Math.min(6, previous + (b.dataset.zoom === 'in' ? 0.5 : -0.5)));
        this._applyPlanZoom();
        scroll.scrollLeft = midX * this._zoom / previous - scroll.clientWidth / 2;
        scroll.scrollTop = midY * this._zoom / previous - scroll.clientHeight / 2;
      });
    }
    if (this._cardMode) this._q('[data-save]').addEventListener('click', () => this._savePlanEdits());
    if (!this._cardMode) this._loadPickers();
    this._load();
    if (!this._cardMode) this._renderPlans();
  }
  // HA lädt ha-entity-picker erst bei Bedarf: über den Editor einer Standardkarte nachladen
  async _loadPickers() {
    if (customElements.get('ha-entity-picker')) return;
    try {
      const h = await window.loadCardHelpers();
      const c = await h.createCardElement({ type: 'entities', entities: [] });
      if (c && c.constructor.getConfigElement) await c.constructor.getConfigElement();
      await customElements.whenDefined('ha-entity-picker');
      this._renderSel();
    } catch (e) { /* Textfeld als Ersatz */ }
  }
  _fire() {
    if (this._cardMode) { this._modified = true; return; }
    this._sent = JSON.stringify(this._config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }
  _edit(fn) {
    const c = JSON.parse(JSON.stringify(this._config || {}));
    fn(c);
    this._config = c;
    this._fire();
  }

  // ----- Ansicht laden und zeichnen
  async _load() {
    const views = viewsOf(this._config);
    if (!this._view || !views.find(v => v.id === this._view)) this._view = views[0].id;
    this._renderTabs(views);
    this._renderBar();
    this._renderMore();
    const v = views.find(x => x.id === this._view), seq = this._seq = (this._seq || 0) + 1, err = this._q('.err');
    try {
      await this._hassReady;
      const parts = this._cardMode ? this._cardParts : await Promise.all(v.files.map(f => loadPlan(planSource(this._config, this._hass, f), this._hass)));
      if (seq !== this._seq) return;
      err.hidden = true;
      this._parts = parts;
      const SX = Math.max(...parts.map(p => (p.size || [20, 15])[0])), SZ = Math.max(...parts.map(p => (p.size || [20, 15])[1]));
      const r = regionOf(v, parts) || [0, 0, SX, SZ];
      this._vb = { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
      this._lights = {};
      parts.forEach(p => Object.assign(this._lights, p.lights || {}));
      this._drawPlan();
    } catch (e) {
      if (seq !== this._seq) return;
      this._parts = null;
      err.hidden = false;
      const src = planSource(this._config, this._hass, v.files[0]);
      err.textContent = (e && e.message ? e.message : e) + (src.url ? ' – liegt die Datei unter ' + src.url + '?' : ' – unten unter „Pläne“ importieren.');
      this._q('.plan svg').innerHTML = '';
    }
    this._renderMarks();
    this._renderSel();
  }
  _renderTabs(views) {
    const t = this._q('.tabs');
    t.innerHTML = views.length > 1 ? views.map(v => '<button class="t" data-v="' + esc(v.id) + '" aria-pressed="' + (v.id === this._view) + '">' + esc(v.name) + '</button>').join('') : '';
    t.onclick = ev => { const b = ev.target.closest('button'); if (b) { this._view = b.dataset.v; this._sel = null; this._load(); } };
  }
  _renderBar() {
    this._q('.bar').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(this._placing === b.dataset.a)));
    if (this._cardMode && !this._q('[data-bg]')) {
      const lbl = document.createElement('label'); lbl.textContent = 'Hintergrund ';
      const inp = document.createElement('input'); inp.type = 'color'; inp.dataset.bg = 'yes';
      inp.value = /^#[0-9a-f]{6}$/i.test(this._cardParts?.[0]?.appearance?.background_color || '') ? this._cardParts[0].appearance.background_color : '#f3f3f3';
      inp.addEventListener('input', () => { this._modified = true; this._q('.plan').style.background = inp.value; });
      lbl.appendChild(inp); this._q('.bar').appendChild(lbl);
    }
    this._q('.plan').classList.toggle('placing', !!this._placing);
    this._q('.hint').textContent = this._placing ? 'In den Plan tippen, um zu platzieren' : 'Symbole ziehen zum Verschieben, antippen zum Bearbeiten';
  }
  _applyPlanZoom() {
    if (!this._cardMode) return;
    const zoom = this._zoom || 1;
    const plan = this._q('.plan');
    plan.style.width = (zoom * 100) + '%';
    const display = this._q('[data-zoom-value]');
    if (display) display.textContent = Math.round(zoom * 100) + ' %';
  }
  _itemFootprint(part, it) {
    // Format-2 block primitives have [type, size, [x,height,y], rotation,...].
    // Derive a top-down outline without loading the 3D scene or changing the JSON.
    const prims = Array.isArray(it.prims) ? it.prims : (part.blocks || {})[it.block];
    if (!Array.isArray(prims)) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const prim of prims) {
      if (!Array.isArray(prim) || !Array.isArray(prim[2])) continue;
      const type = prim[0], dim = prim[1], at = prim[2];
      if (!Array.isArray(dim) || type === 'glb') continue;
      let w = 0, d = 0;
      if (type === 'box') { w = Number(dim[0]); d = Number(dim[2]); }
      else if (['cyl','sphere','ico'].includes(type)) { w = d = 2 * Number(dim[0]); }
      else if (type === 'ring') { w = d = 2 * Number(dim[1]); }
      if (!(w > 0 && d > 0)) continue;
      // A primitive can have a local Y rotation: include it in its XY bounding box.
      const ry = Array.isArray(prim[3]) ? Number(prim[3][1]) || 0 : 0;
      const cw = Math.abs(Math.cos(ry)), sw = Math.abs(Math.sin(ry));
      const bw = w * cw + d * sw, bd = d * cw + w * sw;
      const x = Number(at[0]) || 0, y = Number(at[2]) || 0;
      minX = Math.min(minX, x - bw/2); maxX = Math.max(maxX, x + bw/2);
      minY = Math.min(minY, y - bd/2); maxY = Math.max(maxY, y + bd/2);
    }
    if (!Number.isFinite(minX)) return { x:-0.16, y:-0.16, w:0.32, h:0.32 };
    return { x:minX, y:minY, w:Math.max(.06,maxX-minX), h:Math.max(.06,maxY-minY) };
  }
  _drawPlan() {
    const vb = this._vb, svg = this._q('.plan svg'), plan = this._q('.plan');
    plan.style.aspectRatio = vb.w + ' / ' + vb.h;
    this._applyPlanZoom();
    svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' '));
    const path = (o, h) => [o].concat(h || []).map(p => 'M' + p.map(q => q[0].toFixed(3) + ' ' + q[1].toFixed(3)).join('L') + 'Z').join('');
    let s = '';
    this._parts.forEach(p => {
      (p.decks || []).forEach(d => { s += '<path d="' + path(d.poly) + '" fill="' + (FILL[d.mat] || '#ddd') + '" stroke="#b9b2a8" stroke-width="0.03"/>'; });
      (p.foot || []).forEach(f => { s += '<path d="' + path(f.o, f.h) + '" fill="#cfd3d6" fill-rule="evenodd"/>'; });
      (p.floors || []).forEach(f => { s += '<path d="' + path(f.poly, f.holes) + '" fill="' + (FILL[f.mat] || '#eee') + '" fill-rule="evenodd"/>'; });
      (p.items || []).forEach(it => {
        // Format 2: {block, pos, rot, prims} sind Objekte und dürfen niemals
        // wie alte Format-1-Bausteinarrays destrukturiert werden.
        // Die anklickbaren Objektmarker zeichnet _renderMarks separat.
        if (!Array.isArray(it)) return;
        const [t, g, x0, y0, x1, y1] = it;
        if (g !== 'furn') return;
        if (RECT_ITEMS.includes(t) || (t === 'pb' && (x1 - x0) * (y1 - y0) > 0.12 && it[7] > 0.3)) {
          s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" fill="#fff" fill-opacity="' + (t === 'rug' ? 0.35 : 0.75) +
            '" stroke="#8d949b" stroke-width="0.02"/>';
        } else if (t === 'plant' || t === 'cyl') s += '<circle cx="' + x0 + '" cy="' + y0 + '" r="' + (t === 'plant' ? 0.18 : 0.12) + '" fill="#9cb98a"/>';
      });
      // Format-2 furniture/appliances: show their projected footprint at true position.
      // A single outline per block avoids painting 95 large object markers.
      (p.items || []).forEach((it, ii) => {
        if (!it || Array.isArray(it) || !Array.isArray(it.pos)) return;
        const foot = this._itemFootprint(p, it);
        if (!foot) return;
        const index = this._parts.indexOf(p), id = 'o' + index + '_' + ii;
        const rot = -(Number(it.rot) || 0);
        s += '<g class="fp-object' + (id === this._sel ? ' selected' : '') + '" data-object-id="' + id + '" transform="translate(' + Number(it.pos[0]) + ' ' + Number(it.pos[1]) + ') rotate(' + rot + ')">' +
          '<rect x="' + foot.x.toFixed(3) + '" y="' + foot.y.toFixed(3) + '" width="' + foot.w.toFixed(3) + '" height="' + foot.h.toFixed(3) + '" rx="0.03" fill="#a5b5b9" fill-opacity="0.55" stroke="#64748b" stroke-width="0.018"/>' +
          '</g>';
      });
      (p.walls || []).forEach(w => { s += '<path d="' + path(w.o, w.h) + '" fill="#4b5560" fill-rule="evenodd"/>'; });
      (p.attika || []).forEach(a => { s += '<path d="' + path(a.o, a.h) + '" fill="#a7a19a" fill-rule="evenodd"/>'; });
      (p.rails || []).forEach(a => { s += '<path d="' + path(a.o, a.h) + '" fill="#7fa7bd"/>'; });
      (p.openings || []).forEach(o => {
        const glass = o.kind !== 'd' && o.kind !== 'e' && o.kind !== 'gate';
        s += '<line x1="' + o.p[0] + '" y1="' + o.p[1] + '" x2="' + o.q[0] + '" y2="' + o.q[1] + '" stroke="' + (glass ? '#cfe6f5' : '#f4efe8') + '" stroke-width="' + (o.t * 0.95) + '"/>';
        if (glass) s += '<line x1="' + o.p[0] + '" y1="' + o.p[1] + '" x2="' + o.q[0] + '" y2="' + o.q[1] + '" stroke="#5c9ccc" stroke-width="0.04"/>';
      });
      // Raumnamen in der Mitte der größten Fläche
      const big = {};
      (p.floors || []).forEach(f => {
        const xs = f.poly.map(q => q[0]), ys = f.poly.map(q => q[1]), a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        if (!big[f.room] || big[f.room].a < a) big[f.room] = { a: a, x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
      });
      Object.keys(big).forEach(k => {
        s += '<text x="' + big[k].x + '" y="' + big[k].y + '" font-size="0.32" text-anchor="middle" fill="#6b7178" font-family="sans-serif">' + esc((p.rooms || {})[k] || k) + '</text>';
      });
    });
    svg.innerHTML = s;
  }

  // ----- Marker
  // Geschoss-Kennungen dieser Ansicht: Ansicht selbst und die Plan-Dateien darin
  _ids() { return [this._view].concat((this._parts || []).map(p => p.id)).map(String); }
  _floorTag() { return viewsOf(this._config).length > 1 ? String((this._parts && this._parts[0] && this._parts[0].id) || this._view) : undefined; }
  _marks() {
    const cfg = this._config || {}, ids = this._ids(), out = [];
    const mine = f => f === undefined || ids.includes(String(f));
    (cfg.elements || []).forEach((ec, i) => {
      if (!mine(ec.floor)) return;
      const pos = Array.isArray(ec.pos) ? ec.pos : [ec.x, ec.y !== undefined ? ec.y : ec['true']];
      const x = num(pos[0], NaN), y = num(pos[1], NaN);
      out.push({ id: 'e' + i, kind: 'e', i: i, x: isNaN(x) ? this._vb.x + this._vb.w / 2 : x, y: isNaN(y) ? this._vb.y + this._vb.h / 2 : y, ec: ec });
    });
    const ml = cfg.model_lights || {};
    const keys = Object.keys(this._lights || {}).concat(Object.keys(ml).filter(k => !(this._lights || {})[k]));
    keys.forEach(k => {
      const v = ml[k], o = v && typeof v === 'object' ? v : { entity: v };
      const home = (this._lights || {})[k];
      if (!home && (!Array.isArray(o.pos) || !mine(o.floor))) return;   // Leuchte eines anderen Geschosses
      if (home && o.floor !== undefined && !mine(o.floor)) return;
      // Plan-Lichter sind {pos:[x,y,h], type:...}, nicht direkte Koordinatenarrays.
      const p = Array.isArray(o.pos) ? o.pos : (Array.isArray(home) ? home : (home && Array.isArray(home.pos) ? home.pos : null));
      if (!p || !Number.isFinite(num(p[0], NaN)) || !Number.isFinite(num(p[1], NaN))) return;
      out.push({ id: 'l' + k, kind: 'l', k: k, x: num(p[0], 0), y: num(p[1], 0), o: o, free: !o.entity });
    });
    if (this._cardMode) (this._parts || []).forEach((part, pi) => (part.items || []).forEach((it, ii) => {
      if (!it || Array.isArray(it) || !Array.isArray(it.pos) || it.pos.length < 2) return;
      out.push({ id: 'o' + pi + '_' + ii, kind: 'o', pi, ii, it, x: num(it.pos[0], 0), y: num(it.pos[1], 0) });
    }));
    // Leuchten und Gegenstände unten, Entitäten obenauf
    return out.filter(m => m.kind === 'o').concat(out.filter(m => m.kind === 'l'), out.filter(m => m.kind === 'e'));
  }
  _iconFor(entity, icon) {
    if (icon) return icon;
    const st = this._hass && entity ? this._hass.states[entity] : null;
    if (st && st.attributes.icon) return st.attributes.icon;
    return DOMAIN_ICONS[String(entity || '').split('.')[0]] || 'mdi:map-marker';
  }
  _nameFor(entity) {
    const st = this._hass && entity ? this._hass.states[entity] : null;
    return st ? (st.attributes.friendly_name || entity) : (entity || 'ohne Entität');
  }
  _renderMarks() {
    const plan = this._q('.plan');
    plan.querySelectorAll('.mk').forEach(m => m.remove());
    if (!this._vb) return;
    const vb = this._vb;
    this._marks().forEach(m => {
      if (m.x < vb.x || m.y < vb.y || m.x > vb.x + vb.w || m.y > vb.y + vb.h) return;
      const el = document.createElement('div');
      el.className = 'mk ' + (m.kind === 'o' ? 'object' : m.kind === 'l' ? 'light' : 'element') + (m.free ? ' free' : '') + (this._sel === m.id ? ' sel' : '');
      if (m.kind === 'o' && this._cardMode && !this._showObjects && this._sel !== m.id) el.hidden = true;
      el.dataset.id = m.id;
      el.style.left = ((m.x - vb.x) / vb.w * 100) + '%';
      el.style.top = ((m.y - vb.y) / vb.h * 100) + '%';
      const ic = document.createElement('ha-icon');
      ic.setAttribute('icon', m.kind === 'o' ? 'mdi:cube-outline' : m.kind === 'l' ? (m.o.icon || 'mdi:ceiling-light') : this._iconFor(m.ec.entity, m.ec.icon));
      el.appendChild(ic);
      const lb = document.createElement('span');
      lb.className = 'lbl';
      const room = (this._parts || []).map(p => (p.rooms || {})[m.k]).find(Boolean);
      lb.textContent = m.kind === 'o' ? (m.it.name || m.it.block || 'Gegenstand ' + (m.ii + 1)) : m.kind === 'l' ? (m.o.entity ? this._nameFor(m.o.entity) : 'Leuchte ' + (room || m.k)) : this._nameFor(m.ec.entity);
      el.appendChild(lb);
      el.title = lb.textContent;
      plan.appendChild(el);
    });
  }
  // ----- Ziehen, Antippen, Platzieren
  _wirePlan() {
    const plan = this._q('.plan');
    const scroll = this._q('.plan-scroll');
    const point = ev => {
      const r = plan.getBoundingClientRect(), vb = this._vb;
      return [vb.x + (ev.clientX - r.left) / r.width * vb.w, vb.y + (ev.clientY - r.top) / r.height * vb.h];
    };
    const pointers = new Map();
    let drag = null, pan = null, pinch = null;
    const metric = () => {
      const values = [...pointers.values()];
      if (values.length < 2) return null;
      const a = values[0], b = values[1];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const beginPinch = () => {
      const m = metric(); if (!m) return;
      drag = null; pan = null;
      const r = scroll.getBoundingClientRect();
      pinch = { ...m, zoom: this._zoom || 1, xContent: scroll.scrollLeft + m.x - r.left, yContent: scroll.scrollTop + m.y - r.top };
    };
    plan.addEventListener('pointerdown', ev => {
      if (!this._vb) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      plan.setPointerCapture(ev.pointerId);
      if (pointers.size === 2 && this._cardMode) { beginPinch(); return; }
      const mk = ev.target.closest('.mk:not([hidden])');
      const footprint = !mk && ev.target.closest('.fp-object[data-object-id]');
      if (this._placing && !mk && !footprint) {
        const p = point(ev).map(r2);
        if (this._placing === 'add') this._addElement(p); else this._addLight(p);
        this._placing = null; this._renderBar();
        return;
      }
      if (mk || footprint) {
        drag = { id: mk ? mk.dataset.id : footprint.dataset.objectId, mk, pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, moved: false, p: null };
      } else {
        pan = { pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, moved: false };
      }
    });
    plan.addEventListener('pointermove', ev => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size >= 2) {
        const m = metric(), old = this._zoom || 1;
        this._zoom = Math.min(6, Math.max(1, pinch.zoom * (m.distance / Math.max(1, pinch.distance))));
        this._applyPlanZoom();
        const r = scroll.getBoundingClientRect();
        scroll.scrollLeft = pinch.xContent * this._zoom / pinch.zoom - (m.x - r.left);
        scroll.scrollTop = pinch.yContent * this._zoom / pinch.zoom - (m.y - r.top);
        return;
      }
      if (pan && pan.pointer === ev.pointerId) {
        if (Math.hypot(ev.clientX - pan.x, ev.clientY - pan.y) > 4) pan.moved = true;
        scroll.scrollLeft = pan.left + pan.x - ev.clientX;
        scroll.scrollTop = pan.top + pan.y - ev.clientY;
        return;
      }
      if (!drag || drag.pointer !== ev.pointerId) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 5) return;
      drag.moved = true;
      const p = point(ev), vb = this._vb;
      p[0] = Math.min(vb.x + vb.w, Math.max(vb.x, p[0]));
      p[1] = Math.min(vb.y + vb.h, Math.max(vb.y, p[1]));
      drag.p = p.map(r2);
      if (drag.mk) {
        drag.mk.style.left = ((drag.p[0] - vb.x) / vb.w * 100) + '%';
        drag.mk.style.top = ((drag.p[1] - vb.y) / vb.h * 100) + '%';
      }
    });
    const end = ev => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (pinch) { if (pointers.size < 2) { pinch = null; drag = null; pan = null; } return; }
      if (drag && drag.pointer === ev.pointerId) {
        const d = drag; drag = null;
        this._sel = d.id;
        if (d.moved && d.p) this._move(d.id, d.p);
        if (d.id[0] === 'o') this._drawPlan();
        this._renderMarks(); this._renderSel();
      } else if (pan && pan.pointer === ev.pointerId) {
        const moved = pan.moved; pan = null;
        if (!moved) { this._sel = null; this._renderMarks(); this._renderSel(); }
      }
    };
    plan.addEventListener('pointerup', end);
    plan.addEventListener('pointercancel', end);
  }
  _setPos(old, p) {
    const h = Array.isArray(old) && old.length > 2 ? [old[2]] : [];
    return [p[0], p[1]].concat(h);
  }
  _move(id, p) {
    if (id[0] === 'o') {
      const m = /^o(\d+)_(\d+)$/.exec(id);
      if (!m) return;
      const item = this._parts[+m[1]]?.items?.[+m[2]];
      if (item && !Array.isArray(item)) { item.pos = this._setPos(item.pos, p); this._modified = true; }
      return;
    }
    this._edit(c => {
      if (id[0] === 'e') {
        const ec = c.elements[+id.slice(1)];
        const hOld = ec.h !== undefined ? ec.h : undefined;
        ec.pos = this._setPos(ec.pos, p);
        if (hOld !== undefined && ec.pos.length < 3) { ec.pos.push(num(hOld, 1.25)); }
        delete ec.x; delete ec.y; delete ec['true']; delete ec.h;
      } else {
        const k = id.slice(1);
        c.model_lights = c.model_lights || {};
        const v = c.model_lights[k], o = v && typeof v === 'object' ? v : (v ? { entity: v } : {});
        o.pos = this._setPos(o.pos, p);
        const tag = this._floorTag();
        if (tag !== undefined) o.floor = tag;
        c.model_lights[k] = o;
      }
    });
  }
  _addElement(p) {
    const tag = this._floorTag();
    this._edit(c => {
      c.elements = c.elements || [];
      const ec = { type: 'state-icon', entity: '', pos: p, tap_action: { action: 'toggle' }, hold_action: { action: 'more-info' } };
      if (tag !== undefined) ec.floor = tag;
      c.elements.push(ec);
      this._sel = 'e' + (c.elements.length - 1);
    });
    this._renderMarks(); this._renderSel();
  }
  _addLight(p) {
    this._edit(c => {
      c.model_lights = c.model_lights || {};
      let n = 1;
      while (c.model_lights['licht_' + n] || (this._lights || {})['licht_' + n]) n++;
      c.model_lights['licht_' + n] = { entity: '', pos: p };
      if (this._floorTag() !== undefined) c.model_lights['licht_' + n].floor = this._floorTag();
      this._sel = 'llicht_' + n;
    });
    this._renderMarks(); this._renderSel();
  }

  // ----- Bearbeitungsfeld des gewählten Markers
  _picker(value, cb, domains) {
    if (!this._cardMode && customElements.get('ha-entity-picker')) {
      const p = document.createElement('ha-entity-picker');
      p.hass = this._hass; p.value = value || ''; p.allowCustomEntity = true;
      if (domains) p.includeDomains = domains;
      p.addEventListener('value-changed', ev => cb(ev.detail.value || ''));
      return p;
    }
    const i = document.createElement('input');
    i.value = value || ''; i.placeholder = 'light.wohnzimmer';
    i.setAttribute('list', 'fp3d-ents');
    i.addEventListener('change', () => cb(i.value.trim()));
    return i;
  }
  _lightPicker(value, cb, domains = ['light', 'switch']) {
    const box = document.createElement('div'); box.className = 'light-picker';
    const input = document.createElement('input'); input.type = 'search'; input.value = value || '';
    input.autocomplete = 'off'; input.placeholder = domains ? 'Entität nach Name oder ID suchen' : 'Alle Entitäten durchsuchen';
    input.setAttribute('aria-label', 'Home Assistant Entität suchen');
    const list = document.createElement('div'); list.className = 'light-results'; list.hidden = true;
    const entities = Object.entries((this._hass && this._hass.states) || {})
      .filter(([id]) => !domains || domains.includes(id.split('.')[0]))
      .map(([id, state]) => ({ id, name: String(state.attributes?.friendly_name || id) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const close = () => { list.hidden = true; };
    const choose = id => {
      value = id; input.value = id; close(); cb(id);
    };
    const show = () => {
      const q = input.value.trim().toLocaleLowerCase();
      const rows = entities.filter(x => x.id.toLocaleLowerCase().includes(q) || x.name.toLocaleLowerCase().includes(q)).slice(0, 40);
      list.replaceChildren();
      for (const x of rows) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'light-option';
        const name = document.createElement('span'); name.textContent = x.name;
        const id = document.createElement('small'); id.textContent = x.id;
        b.append(name, id);
        // Do not prevent pointerdown: iOS may suppress the following synthetic click.
        b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); choose(x.id); });
        list.appendChild(b);
      }
      if (!rows.length) { const empty = document.createElement('div'); empty.className = 'light-empty'; empty.textContent = 'Keine passenden Entitäten'; list.appendChild(empty); }
      list.hidden = false;
    };
    input.addEventListener('focus', show);
    input.addEventListener('input', show);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { close(); input.blur(); }
      if (ev.key === 'Enter') { ev.preventDefault(); const id = input.value.trim(); if (entities.some(e => e.id === id) || id === '') choose(id); }
    });
    // No onchange handler: it fires after clicking an option and can revert the selection.
    box.append(input, list); return box;
  }
  _iconInput(value, cb) {
    if (!this._cardMode && customElements.get('ha-icon-picker')) {
      const p = document.createElement('ha-icon-picker');
      p.hass = this._hass; p.value = value || '';
      p.addEventListener('value-changed', ev => cb(ev.detail.value || ''));
      return p;
    }
    const i = document.createElement('input');
    i.value = value || ''; i.placeholder = 'mdi:lightbulb';
    i.addEventListener('change', () => cb(i.value.trim()));
    return i;
  }
  _field(label, node, full) {
    // Not a <label>: wrapping option buttons/selects in a label causes click-to-focus
    // forwarding on iOS/Safari and can immediately close or reopen an entity list.
    const field = document.createElement('div');
    field.className = 'fp-field' + (full ? ' full' : '');
    const caption = document.createElement('span'); caption.className = 'fp-field-title';
    caption.textContent = label;
    field.append(caption, node);
    return field;
  }
  _input(value, cb, type, ph) {
    const i = document.createElement('input');
    i.type = type || 'text'; i.value = value === undefined ? '' : value; if (ph) i.placeholder = ph;
    if (type === 'number') i.step = '0.05';
    i.addEventListener('change', () => cb(i.value));
    return i;
  }
  _select(value, opts, cb) {
    const s = document.createElement('select');
    s.innerHTML = opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    s.addEventListener('change', () => cb(s.value));
    return s;
  }
  _button(text, cb, warn) {
    const b = document.createElement('button');
    b.className = 'b' + (warn ? ' warn' : ''); b.textContent = text;
    b.addEventListener('click', cb);
    return b;
  }
  _renderSel() {
    const box = this._q('.sel');
    box.textContent = '';
    const m = this._sel && this._vb ? this._marks().find(x => x.id === this._sel) : null;
    if (!m) return;
    const panel = document.createElement('div');
    panel.className = 'panel';
    const after = () => { this._renderMarks(); };
    if (this._hass && !customElements.get('ha-entity-picker')) {
      const dl = document.createElement('datalist'); dl.id = 'fp3d-ents';
      dl.innerHTML = Object.keys(this._hass.states).sort().map(e => '<option value="' + esc(e) + '">').join('');
      panel.appendChild(dl);
    }
    if (m.kind === 'o') {
      const it = m.it;
      const setItem = fn => { fn(it); this._modified = true; this._renderMarks(); this._renderSel(); };
      const title = document.createElement('h4'); title.textContent = 'Gegenstand – ' + (it.name || it.block || 'Objekt');
      panel.appendChild(title);
      panel.appendChild(this._field('Position (x, y in m)', this._input(it.pos.join(', '), v => {
        const xy = String(v).split(/[;,\s]+/).map(x => num(x, NaN));
        if (xy.length >= 2 && xy.slice(0, 2).every(Number.isFinite)) { this._move(m.id, xy.slice(0, 2)); this._renderMarks(); this._renderSel(); }
      }), true));
      panel.appendChild(this._field('Drehung (Grad)', this._input(it.rot || 0, v => setItem(x => { x.rot = num(v, 0); }), 'number', '0')));
      const row = document.createElement('div'); row.className = 'row';
      row.appendChild(this._button('Kopieren', () => {
        const part = this._parts[m.pi];
        const copy = JSON.parse(JSON.stringify(it));
        copy.pos = [r2(m.x + 0.5), r2(m.y + 0.5)];
        if (copy.id) { let n = 2, prefix = String(copy.id); while (part.items.some(v => v && v.id === prefix + '_' + n)) n++; copy.id = prefix + '_' + n; }
        part.items.push(copy);
        this._modified = true; this._sel = 'o' + m.pi + '_' + (part.items.length - 1);
        this._renderMarks(); this._renderSel();
      }));
      row.appendChild(this._button('Entfernen', () => {
        this._parts[m.pi].items.splice(m.ii, 1); this._modified = true; this._sel = null; this._renderMarks(); this._renderSel();
      }, true));
      panel.appendChild(row);
    } else if (m.kind === 'e') {
      const i = m.i, ec = m.ec, setE = fn => { this._edit(c => fn(c.elements[i])); after(); };
      const pos = Array.isArray(ec.pos) ? ec.pos : [];
      panel.innerHTML += '<h4>Element</h4>';
      panel.appendChild(this._field('Entität', this._lightPicker(ec.entity, v => setE(e => { e.entity = v; }), null), true));
      panel.appendChild(this._field('Darstellung', this._select(ec.type || 'state-icon',
        [['state-icon', 'Symbol'], ['state-label', 'Wert'], ['state-badge', 'Badge'], ['icon', 'Nur Symbol']], v => setE(e => { e.type = v; if (v === 'icon' && !e.icon) e.icon = this._iconFor(e.entity); }))));
      panel.appendChild(this._field('Tippen', this._select((ec.tap_action || {}).action || 'more-info',
        [['toggle', 'Schalten'], ['more-info', 'Dialog'], ['none', 'Nichts']], v => setE(e => { e.tap_action = { action: v }; }))));
      panel.appendChild(this._field('Symbol (leer = automatisch)', this._iconInput(ec.icon, v => setE(e => { if (v) e.icon = v; else delete e.icon; })), true));
      panel.appendChild(this._field('Höhe über Boden (m)', this._input(pos[2] !== undefined ? pos[2] : (ec.h !== undefined ? ec.h : ''), v => setE(e => {
        const p = Array.isArray(e.pos) ? e.pos.slice(0, 2) : [m.x, m.y];
        if (String(v).trim() !== '') p.push(num(v, 1.25));
        e.pos = p; delete e.h;
      }), 'number', 'Standard')));
      panel.appendChild(this._field('Position', this._input(r2(m.x) + ', ' + r2(m.y), v => {
        const p = String(v).split(/[;,\s]+/).map(x => num(x, NaN));
        if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) { this._move(m.id, [p[0], p[1]]); after(); }
      }, 'text', 'x, y')));
      const row = document.createElement('div'); row.className = 'row';
      row.appendChild(this._button('Entfernen', () => { this._edit(c => { c.elements.splice(i, 1); }); this._sel = null; this._renderMarks(); this._renderSel(); }, true));
      panel.appendChild(row);
    } else {
      const k = m.k, o = m.o, setL = fn => {
        this._edit(c => {
          c.model_lights = c.model_lights || {};
          const v = c.model_lights[k], x = v && typeof v === 'object' ? v : (v ? { entity: v } : {});
          fn(x);
          // Kurzform, wenn nur die Entität übrig bleibt
          c.model_lights[k] = Object.keys(x).length === 1 && x.entity ? x.entity : x;
        });
        after();
      };
      panel.innerHTML += '<h4>Leuchte „' + esc(k) + '“' + ((this._lights || {})[k] ? '' : ' (eigene)') + '</h4>';
      panel.appendChild(this._field('Licht-Entität', this._lightPicker(o.entity, v => setL(x => { x.entity = v; })), true));
      panel.appendChild(this._field('Symbol statt Scheibe (leer = Scheibe)', this._iconInput(o.icon, v => setL(x => { if (v) x.icon = v; else delete x.icon; })), true));
      panel.appendChild(this._field('Größe Scheibe (m)', this._input(o.size !== undefined ? o.size : '', v => setL(x => { if (String(v).trim()) x.size = num(v, 0.4); else delete x.size; }), 'number', '0.4')));
      panel.appendChild(this._field('Lichtstärke (1 = normal)', this._input(o.power !== undefined ? o.power : '', v => setL(x => { if (String(v).trim()) x.power = num(v, 1); else delete x.power; }), 'number', '1')));
      panel.appendChild(this._field('Reichweite (m)', this._input(o.range !== undefined ? o.range : '', v => setL(x => { if (String(v).trim()) x.range = num(v, 7); else delete x.range; }), 'number', '7')));
      if (!(this._lights || {})[k]) panel.appendChild(this._field('Art', this._select(o.type || 'ceiling', [['ceiling', 'Deckenleuchte'], ['lamp', 'Steh-/Tischlampe']],
        v => setL(x => { if (v === 'ceiling') delete x.type; else x.type = v; }))));
      panel.appendChild(this._field('Darstellung', this._select(o.disc === false ? 'glow' : 'disc', [['disc', 'Scheibe und Schein'], ['glow', 'Nur Lichtschein']],
        v => setL(x => { if (v === 'glow') x.disc = false; else delete x.disc; }))));
      const row = document.createElement('div'); row.className = 'row';
      if ((this._lights || {})[k] && Array.isArray(o.pos)) row.appendChild(this._button('Position aus dem Plan', () => setL(x => { delete x.pos; })));
      row.appendChild(this._button((this._lights || {})[k] ? 'Zuordnung entfernen' : 'Entfernen', () => {
        this._edit(c => { if (c.model_lights) delete c.model_lights[k]; });
        this._sel = null; this._renderMarks(); this._renderSel();
      }, true));
      panel.appendChild(row);
    }
    box.appendChild(panel);
  }
  // ----- Pläne: Liste, Import, als Ansicht hinzufügen, löschen
  async _renderPlans(note) {
    const box = this._q('.plans');
    if (!box || !this._hass) return;
    box.textContent = '';
    if (!hasIntegration(this._hass)) {
      box.innerHTML = '<span class="m">Für Import und Planverwaltung die Integration „smartify Floorplan 3D“ einrichten. Ohne Integration liegen die Plan-Dateien unter ' +
        esc(planUrl(this._config, '')) + '.</span>';
      return;
    }
    const bar = document.createElement('div'); bar.className = 'bar';
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,.zip,application/json,application/zip'; inp.multiple = true; inp.hidden = true;
    inp.addEventListener('change', () => this._import([...inp.files]));
    bar.append(inp, this._button('Plan importieren …', () => inp.click()));
    const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'Plan (.json) oder Paket mit Modellen und Texturen (.zip)';
    bar.appendChild(hint);
    box.appendChild(bar);
    if (note) { const n = document.createElement('div'); n.className = note.ok ? 'ok' : 'bad'; n.textContent = note.text; box.appendChild(n); }
    let list = [];
    try { list = (await this._hass.callWS({ type: WS + '/plans/list' })).plans; } catch (e) {
      const n = document.createElement('div'); n.className = 'bad'; n.textContent = 'Pläne nicht lesbar: ' + (e.message || e); box.appendChild(n); return;
    }
    if (!list.length) { const n = document.createElement('span'); n.className = 'hint'; n.textContent = 'Noch keine Pläne importiert.'; box.appendChild(n); }
    const used = new Set(viewsOf(this._config).flatMap(v => v.files));
    list.forEach(p => {
      const it = document.createElement('div'); it.className = 'it';
      const m = document.createElement('span'); m.className = 'm';
      if (p.error) m.innerHTML = '<b>' + esc(p.file) + '</b> · <span class="bad">' + esc(p.error) + '</span>';
      else m.innerHTML = '<b>' + esc(p.name) + '</b> · ' + esc(p.file) + ' · ' + Object.keys(p.rooms || {}).length + ' Räume, ' + (p.lights || []).length + ' Leuchten' +
        (p.assets ? ', ' + p.assets + ' Modelle/Texturen' : '') + (p.version > 1 ? '' : ' · Format 1') + (used.has(p.file) ? ' · in Verwendung' : '');
      it.appendChild(m);
      if (!p.error && !used.has(p.file)) it.appendChild(this._button('Als Ansicht', () => this._addView(p)));
      it.appendChild(this._button('Löschen', async () => {
        if (!confirm('Plan ' + p.file + ' löschen?')) return;
        try { await this._hass.callWS({ type: WS + '/plans/delete', file: p.file }); dropPlan(p.file); this._renderPlans({ ok: true, text: p.file + ' gelöscht' }); }
        catch (e) { this._renderPlans({ ok: false, text: e.message || String(e) }); }
      }, true));
      box.appendChild(it);
    });
  }
  // Import über HTTP (JSON oder Zip-Paket mit Modellen und Texturen), angemeldet über fetchWithAuth
  async _import(files) {
    let done = [], bad = [];
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('file', f, f.name));
      const r = await this._hass.fetchWithAuth('/api/' + WS + '/import', { method: 'POST', body: fd });
      const body = await r.json().catch(() => ({ errors: [{ file: '', error: 'HTTP ' + r.status }] }));
      (body.plans || []).forEach(p => { dropPlan(p.file); done.push(p.file + (p.assets ? ' (' + p.assets + ' Dateien)' : '')); });
      bad = (body.errors || []).map(e => (e.file ? e.file + ': ' : '') + e.error);
      if (!r.ok && !bad.length) bad.push(body.message || 'HTTP ' + r.status);
    } catch (e) { bad.push(e.message || String(e)); }
    this._renderPlans(bad.length ? { ok: false, text: (done.length ? 'Importiert: ' + done.join(', ') + '. ' : '') + 'Fehler: ' + bad.join('; ') }
      : { ok: true, text: 'Importiert: ' + done.join(', ') });
    if (done.length) this._load();
  }
  _addView(p) {
    this._edit(c => {
      const views = Array.isArray(c.floors) && c.floors.length ? c.floors : viewsOf(c).map(v => v.id);
      const id = String(p.id || p.file.replace(/\.json$/, ''));
      let vid = id, n = 2;
      while (viewsOf({ floors: views }).some(v => v.id === vid)) vid = id + '_' + n++;
      views.push(p.file === vid + '.json' && vid === id ? vid : { id: vid, name: p.name, files: [p.file] });
      c.floors = views;
      this._view = vid;
    });
    this._load(); this._renderPlans();
  }
  async _savePlanEdits() {
    const button = this._q('[data-save]');
    if (!this._hass || !this._cardMode || !this._parts?.length) return;
    if (!this._hass.user?.is_admin) { alert('Zum Speichern sind Administratorrechte erforderlich.'); return; }
    button.disabled = true; button.textContent = 'Speichere …';
    try {
      const plans = this._parts;
      // Der erste Plan enthält neu angelegte Entitäten und Leuchten. Möbel/Objekte
      // bleiben jeweils in dem Plan, zu dem sie ursprünglich gehören.
      const target = plans[0];
      target.ui_elements = JSON.parse(JSON.stringify(this._config.elements || []));
      target.model_lights = JSON.parse(JSON.stringify(this._config.model_lights || {}));
      target.appearance = Object.assign({}, target.appearance || {}, { background_color: this._q('[data-bg]').value });
      for (let i = 0; i < plans.length; i++) {
        await this._hass.callWS({ type: WS + '/plans/import', file: this._cardFiles[i], data: plans[i], overwrite: true });
        dropPlan(this._cardFiles[i]);
      }
      this._modified = false;
      this.dispatchEvent(new CustomEvent('plan-saved', { bubbles: true, composed: true }));
    } catch (e) { alert('Plan konnte nicht gespeichert werden: ' + (e?.message || e)); }
    finally { button.disabled = false; button.textContent = 'Änderungen im Plan speichern'; }
  }
  // ----- weitere Optionen
  _renderMore() {
    const p = this._q('.more'), cfg = this._config || {};
    p.textContent = '';
    const set = (k, v) => this._edit(c => { if (v === '' || v === undefined) delete c[k]; else c[k] = v; });
    p.appendChild(this._field('Karten-Hintergrundfarbe', this._input(cfg.background_color || '', v => set('background_color', /^#[0-9a-f]{6}$/i.test(v) ? v : ''), 'text', '#f3f3f3'), true));
    p.appendChild(this._field('Plan-Ordner', this._input(cfg.plans_path || '', v => set('plans_path', v.trim()), 'text', '/local/smartify-floorplan3d/'), true));
    p.appendChild(this._field('Ansichten (eg, og, …)', this._input(viewsOf(cfg).filter(v => !v.region && v.files.length === 1 && v.files[0] === v.id + '.json').length === viewsOf(cfg).length
      ? viewsOf(cfg).map(v => v.id).join(', ') : '', v => {
      const ids = v.split(/[,;\s]+/).filter(Boolean);
      if (ids.length) { set('floors', ids); this._load(); }
    }, 'text', 'Bereiche mit Ausschnitt im YAML'), true));
    p.appendChild(this._field('Seitenverhältnis', this._input(cfg.aspect_ratio || '', v => set('aspect_ratio', v.trim()), 'text', '16 / 10')));
    p.appendChild(this._field('Wandhöhe beim Start', this._select(cfg.walls === 'full' ? 'full' : 'half', [['half', 'Halb (Schnitt)'], ['full', 'Voll']], v => set('walls', v === 'full' ? 'full' : ''))));
    p.appendChild(this._field('Höhe der Symbole (m)', this._input(cfg.element_height !== undefined ? cfg.element_height : '', v => set('element_height', String(v).trim() ? num(v, 1.25) : ''), 'number', '1.25')));
    p.appendChild(this._field('Schatten', this._select(cfg.shadows === false ? 'off' : 'on', [['on', 'An'], ['off', 'Aus']], v => set('shadows', v === 'off' ? false : ''))));
    const lc = cfg.lighting || {}, setL = (k, v) => this._edit(c => { const l = Object.assign({}, c.lighting || {}); if (v === '' || v === undefined) delete l[k]; else l[k] = v; if (Object.keys(l).length) c.lighting = l; else delete c.lighting; });
    p.appendChild(this._field('Licht', this._select(lc.mode || 'auto', [['auto', 'Automatisch (Sonnenstand)'], ['night', 'Immer Nacht'], ['day', 'Immer Tag']], v => setL('mode', v === 'auto' ? '' : v))));
    p.appendChild(this._field('Schatten der Lampen', this._select(lc.shadows === false ? 'off' : 'on', [['on', 'An (Licht endet an Wänden)'], ['off', 'Aus (schneller)']], v => setL('shadows', v === 'off' ? false : ''))));
  }
}


// für Werkzeuge (Plan-Umwandlung, Tests)
window.smartifyFloorplan3d = { version: VERSION, createScene: createScene, MAT_DEFS: MAT_DEFS };

if (!customElements.get('smartify-floorplan3d')) {
  customElements.define('smartify-floorplan3d', SmartifyFloorplan3d);
  if (!customElements.get('smartify-floorplan3d-editor')) customElements.define('smartify-floorplan3d-editor', SmartifyFloorplan3dEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'smartify-floorplan3d', name: 'smartify Floorplan 3D', description: 'Drehbarer 3D-Grundriss aus Plan-Dateien, Elemente per Drag & Drop', preview: false });
  console.info('%c smartify-floorplan3d %c ' + VERSION + ' ', 'background:#1d5fa6;color:#fff', 'background:#ddd;color:#000');
}
})();
