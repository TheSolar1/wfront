// ══════════════════════════════════════════════════════════════════
// carte.js — Rendu 3D de la carte (Three.js)
// Hexagones extrudes (InstancedMesh), frontieres aux couleurs des
// nations, batiments / armees / missiles en sprites dessines a partir
// des icones VEX, effets (explosions, frappe nucleaire), camera libre.
// ══════════════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.min.js';
import { Grille, melanger, BASE } from './util.js';
import { geometrieBatiment, materielBatiments } from './modeles.js';

// Téléphone / tablette : écran tactile ou petit écran -> rendu allégé.
const MOBILE = matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;

const R = 1;                       // rayon d'un hexagone
const LX = Math.sqrt(3) * R;       // pas horizontal
const LZ = 1.5 * R;                // pas vertical
// Altitude de base et rugosite par terrain (ocean, mer, plaine, foret,
// collines, montagnes, desert, toundra) + couleur de biome.
const ALT = [-1.25, -0.38, 0.2, 0.3, 0.85, 1.9, 0.24, 0.33];
const RUG = [0.05, 0.04, 0.06, 0.12, 0.42, 1.2, 0.09, 0.12];
const BIOMES = ['#1f4f73', '#3f86a8', '#8db35a', '#4f7f3a', '#9c9a5e', '#8a8378', '#dcc684', '#b3bdb0'];
const DIRS_COINS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]]; // voisin k -> coins de l'arete

// ── Icones SVG -> images blanches pour les textures ──────────────
const imgCache = new Map();
function imageIcone(nom) {
  if (!nom) return Promise.resolve(null);
  if (!imgCache.has(nom)) {
    imgCache.set(nom, fetch(`${BASE}static/img/solid/${nom}.svg`)
      .then(r => (r.ok ? r.text() : Promise.reject()))
      .then(t => new Promise(ok => {
        t = t.replace(/currentColor/g, '#ffffff').replace('<svg ', '<svg width="128" height="128" ');
        if (!/fill=/.test(t)) t = t.replace(/<path /g, '<path fill="#ffffff" ');
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t);
      }))
      .catch(() => null));
  }
  return imgCache.get(nom);
}
const imgPretes = new Map();
function iconeSync(nom) {
  if (imgPretes.has(nom)) return imgPretes.get(nom);
  imageIcone(nom).then(img => imgPretes.set(nom, img));
  return undefined;
}

// ── Bruit (relief) ───────────────────────────────────────────────
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function bruit(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, o) {
  let v = 0, amp = 0.5, f = 1, t = 0;
  for (let i = 0; i < o; i++) { v += bruit(x * f, y * f) * amp; t += amp; amp *= 0.5; f *= 2.03; }
  return v / t;
}
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Carte {
  constructor(el, init, rappels) {
    this.el = el;
    this.defs = init.defs;
    this.rappels = rappels;
    const c = init.carte;
    this.g = new Grille(c.largeur, c.hauteur);
    const n = this.g.n;
    this.terrain = Uint8Array.from(c.terrain, ch => +ch);
    this.depot = Uint8Array.from(c.depot, ch => +ch);
    this.proprio = new Int32Array(n).fill(-1);
    this.bat = new Array(n).fill('');
    this.niv = new Uint8Array(n);
    this.irr = new Uint8Array(n);
    this.vision = null;
    this.pays = new Map();
    this.blocs = new Map();
    this.moi = null;
    this.mode = 'politique';
    this.zone = null;
    this.zoneCouleur = '#ffffff';
    this.armees = [];
    this.missions = [];
    this.missiles = [];
    this.selArmee = null;
    this.recu = performance.now();
    this.theme = document.documentElement.dataset.theme || 'light';
    this.batDefs = new Map(this.defs.batiments.map(b => [b.id, b]));
    this.uniDefs = new Map(this.defs.unites.map(u => [u.id, u]));

    this.initScene();
    this.initTerrain();
    this.initControles();
    this.texCache = new Map();
    this.spritesBat = new Map();
    this.spritesDepot = new Map();
    this.spritesArmees = new Map();
    this.spritesMissions = new Map();
    this.spritesMissiles = new Map();
    this.labels = new Map();
    this.effets = [];
    this.bordSale = true;
    this.couleursSales = true;
    this.labelsSales = true;

    // Precharge les icones utiles.
    const noms = new Set(['landmark', 'star', 'crown', 'plane', 'rocket', 'radiation']);
    this.defs.batiments.forEach(b => noms.add(b.icone));
    this.defs.unites.forEach(u => noms.add(u.icone));
    this.defs.depots.forEach(d => d.icone && noms.add(d.icone));
    this.defs.emblemes.forEach(e => noms.add(e));
    Promise.all([...noms].map(nm => imageIcone(nm).then(img => imgPretes.set(nm, img)))).then(() => this.redessinerTextures());

    this.boucle = this.boucle.bind(this);
    requestAnimationFrame(this.boucle);
  }

  // ── Scene ────────────────────────────────────────────────────────
  initScene() {
    // Sur mobile : pas de lissage, résolution limitée, ombres simples.
    this.renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: MOBILE ? 'default' : 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.25 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 700);
    const sombre = this.theme === 'dark';
    const ciel = sombre ? 0x0f1418 : 0xcfdbe6;
    this.scene.background = new THREE.Color(ciel);
    this.scene.fog = new THREE.Fog(ciel, 120, 280);
    this.largeurMonde = LX * (this.g.l + 0.5);
    this.hauteurMonde = LZ * this.g.h;

    this.scene.add(new THREE.HemisphereLight(sombre ? 0x9fb4c8 : 0xe8f1ff, sombre ? 0x1b2530 : 0x5d6b52, sombre ? 0.75 : 0.9));
    // Soleil rasant : c'est lui qui dessine le relief (ombres portees).
    const soleil = new THREE.DirectionalLight(sombre ? 0xdfe6ff : 0xfff1dc, sombre ? 1.15 : 1.7);
    soleil.position.set(this.largeurMonde / 2 - 70, 75, this.hauteurMonde / 2 - 45);
    soleil.target.position.set(this.largeurMonde / 2, 0, this.hauteurMonde / 2);
    soleil.castShadow = true;
    soleil.shadow.mapSize.set(MOBILE ? 1024 : 4096, MOBILE ? 1024 : 4096);
    const demi = Math.max(this.largeurMonde, this.hauteurMonde) * 0.62;
    Object.assign(soleil.shadow.camera, { left: -demi, right: demi, top: demi, bottom: -demi, near: 10, far: 320 });
    soleil.shadow.bias = -0.0006;
    soleil.shadow.normalBias = 0.05;
    this.scene.add(soleil, soleil.target);

    // Mer translucide au niveau 0 : les fonds marins restent visibles.
    this.eau = new THREE.Mesh(
      new THREE.PlaneGeometry(this.largeurMonde * 5, this.hauteurMonde * 5),
      new THREE.MeshPhongMaterial({ color: sombre ? 0x15466e : 0x2d7db5, transparent: true, opacity: 0.74, shininess: 110, specular: 0xa9dcff, depthWrite: false })
    );
    this.eau.rotation.x = -Math.PI / 2;
    this.eau.position.set(this.largeurMonde / 2, 0, this.hauteurMonde / 2);
    this.eau.renderOrder = 1;
    this.eau.receiveShadow = true;
    this.scene.add(this.eau);
    const abysses = new THREE.Mesh(
      new THREE.PlaneGeometry(this.largeurMonde * 5, this.hauteurMonde * 5),
      new THREE.MeshLambertMaterial({ color: sombre ? 0x071624 : 0x15415f })
    );
    abysses.rotation.x = -Math.PI / 2;
    abysses.position.set(this.largeurMonde / 2, -1.5, this.hauteurMonde / 2);
    this.scene.add(abysses);

    this.cam = { x: this.largeurMonde / 2, z: this.hauteurMonde / 2, d: 70, lacet: 0, tangage: 0.9 };
    this.redimensionner();
    new ResizeObserver(() => this.redimensionner()).observe(this.el);

    this.groupes = {};
    for (const k of ['bords', 'depots', 'bats', 'armees', 'chemins', 'air', 'effets', 'labels', 'selection']) {
      this.groupes[k] = new THREE.Group();
      this.scene.add(this.groupes[k]);
    }
  }

  redimensionner() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  pos(i) {
    const [x, y] = this.g.xy(i);
    return [LX * (x + 0.5 * (y & 1)), LZ * y];
  }

  /** Altitude du sol au centre d'une case (jamais sous l'eau pour les sprites). */
  haut(i) {
    return this.hCase[i];
  }

  /** Altitude du terrain en un point : moyenne lissee des cases voisines
   *  + cretes (montagnes) et ondulations (plaines). */
  altitude(x, z) {
    const i0 = this.hexDepuis(x, z);
    if (i0 < 0) return ALT[0];
    let sw = 0, sa = 0, sr = 0;
    const cand = this.g.voisins(i0);
    cand.push(i0);
    for (const i of cand) {
      if (i < 0) continue;
      const [cx, cz] = this.pos(i);
      const w = Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / 0.85);
      const t = this.terrain[i];
      sw += w; sa += w * ALT[t]; sr += w * RUG[t];
    }
    const base = sa / sw, rug = sr / sw;
    const crete = 1 - Math.abs(2 * fbm(x * 0.5, z * 0.5, 4) - 1);
    const onde = fbm(x * 0.9 + 100, z * 0.9 + 100, 3) - 0.5;
    return base + rug * (crete * crete * 1.4 - 0.4) + onde * 0.14;
  }

  initTerrain() {
    const sombre = this.theme === 'dark';
    const n = this.g.n;
    this.hCase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = this.pos(i);
      this.hCase[i] = Math.max(0.05, this.altitude(x, z));
    }

    // ── Maillage continu du relief ──
    const pas = 0.3;
    const x0 = -LX * 1.5, z0 = -LZ * 1.5;
    const nx = Math.ceil((this.largeurMonde + LX * 3) / pas) + 1;
    const nz = Math.ceil((this.hauteurMonde + LZ * 3) / pas) + 1;
    const nv = nx * nz;
    const pos = new Float32Array(nv * 3);
    this.vCase = new Int32Array(nv);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * pas, z = z0 + j * pas;
        pos[3 * k] = x;
        pos[3 * k + 1] = this.altitude(x, z);
        pos[3 * k + 2] = z;
        this.vCase[k] = this.hexDepuis(x, z);
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        idx[p++] = k; idx[p++] = k + nx; idx[p++] = k + 1;
        idx[p++] = k + 1; idx[p++] = k + nx; idx[p++] = k + nx + 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // Couleurs de base : biome, plages, neige, roche en pente, fonds marins.
    const nor = geo.getAttribute('normal').array;
    this.vBase = new Float32Array(nv * 3);
    const c = new THREE.Color(), tmp = new THREE.Color();
    const pal = BIOMES.map(h => new THREE.Color(h));
    const sable = new THREE.Color('#d6c794'), roche = new THREE.Color('#7b7166'), neige = new THREE.Color('#f4f6f9');
    const fond = new THREE.Color(sombre ? '#0b2236' : '#1f4f73'), hautFond = new THREE.Color('#5f9fae');
    for (let k = 0; k < nv; k++) {
      const h = pos[3 * k + 1], ci = this.vCase[k];
      const t = ci >= 0 ? this.terrain[ci] : 0;
      const pente = 1 - nor[3 * k + 1];
      c.copy(pal[t]);
      if (h < 0) {
        c.copy(hautFond).lerp(fond, Math.min(1, -h / 1.2));
      } else {
        if (h < 0.16) c.lerp(sable, (0.16 - h) / 0.16 * 0.85);
        if (pente > 0.18) c.lerp(roche, Math.min(0.8, (pente - 0.18) * 3));
        if (h > 1.75) c.lerp(neige, Math.min(1, (h - 1.75) / 0.45));
        const v = (fbm(pos[3 * k] * 2.1, pos[3 * k + 2] * 2.1, 2) - 0.5) * 0.14;
        c.offsetHSL(0, 0, v);
      }
      this.vBase[3 * k] = c.r; this.vBase[3 * k + 1] = c.g; this.vBase[3 * k + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.vBase), 3));
    this.relief = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.relief.castShadow = this.relief.receiveShadow = true;
    this.scene.add(this.relief);

    // ── Arbres (forets, toundra, quelques-uns en plaine) ──
    const hasard = mulberry(this.g.l * 1000 + this.g.h);
    const places = [];
    for (let i = 0; i < n; i++) {
      const t = this.terrain[i];
      let nb = t === 3 ? 7 : t === 7 ? 2 : t === 2 && hasard() < 0.25 ? 1 : t === 4 && hasard() < 0.4 ? 1 : 0;
      if (MOBILE) nb = Math.ceil(nb / 2.5); // moins d'arbres sur mobile
      const [cx, cz] = this.pos(i);
      for (let k = 0; k < nb; k++) {
        const a = hasard() * Math.PI * 2, r = Math.sqrt(hasard()) * 0.72;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const h = this.altitude(x, z);
        if (h > 0.08 && h < 1.6) places.push([x, h, z, 0.75 + hasard() * 0.6, t]);
      }
    }
    const cone = new THREE.ConeGeometry(0.14, 0.46, 6);
    cone.translate(0, 0.25, 0);
    this.arbres = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), places.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    places.forEach(([x, h, z, e, t], k) => {
      m.compose(v.set(x, h - 0.03, z), q, s.set(e, e * (t === 7 ? 1.3 : 1), e));
      this.arbres.setMatrixAt(k, m);
      tmp.set(t === 7 ? '#2f5d4a' : '#2e6b2f').offsetHSL(0, 0, (hasard() - 0.5) * 0.12);
      this.arbres.setColorAt(k, tmp);
    });
    this.arbres.castShadow = true;
    this.scene.add(this.arbres);

    // ── Quadrillage discret des cases (terres uniquement) ──
    const lignes = [];
    for (let i = 0; i < n; i++) {
      if (!this.defs.terrains[this.terrain[i]].terre) continue;
      const [cx, cz] = this.pos(i);
      for (let j = 0; j < 3; j++) {
        const [ax, az] = this.coin(j), [bx, bz] = this.coin(j + 1);
        for (let s2 = 0; s2 < 3; s2++) {
          const t1 = s2 / 3, t2 = (s2 + 1) / 3;
          const x1 = cx + ax + (bx - ax) * t1, z1 = cz + az + (bz - az) * t1;
          const x2 = cx + ax + (bx - ax) * t2, z2 = cz + az + (bz - az) * t2;
          lignes.push(x1, Math.max(0.02, this.altitude(x1, z1)) + 0.04, z1, x2, Math.max(0.02, this.altitude(x2, z2)) + 0.04, z2);
        }
      }
    }
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.Float32BufferAttribute(lignes, 3));
    this.grille = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: sombre ? 0xffffff : 0x1c2a1c, transparent: true, opacity: sombre ? 0.08 : 0.1, depthWrite: false }));
    this.scene.add(this.grille);

    // Contour de survol / selection : anneau hexagonal epais, toujours visible.
    this.anneauGeo = this.geometrieAnneau(0.14);
    this.survolMesh = new THREE.Mesh(this.anneauGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.selMesh = new THREE.Mesh(this.anneauGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 1, depthTest: false }));
    this.survolMesh.visible = this.selMesh.visible = false;
    this.survolMesh.renderOrder = this.selMesh.renderOrder = 10;
    this.groupes.selection.add(this.survolMesh, this.selMesh);
  }

  coin(j, echelle = 1) {
    const a = (Math.PI / 180) * (60 * j - 30);
    return [Math.cos(a) * R * echelle, Math.sin(a) * R * echelle];
  }

  geometrieAnneau(ep) {
    const v = [];
    for (let j = 0; j < 6; j++) {
      const [ax, az] = this.coin(j), [bx, bz] = this.coin((j + 1) % 6);
      const [cx, cz] = this.coin(j, 1 - ep), [dx, dz] = this.coin((j + 1) % 6, 1 - ep);
      v.push(ax, 0, az, bx, 0, bz, dx, 0, dz, ax, 0, az, dx, 0, dz, cx, 0, cz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
  }

  // ── Couleurs : teinte de la nation, brouillard, zone de tir ───────
  recolorer() {
    const n = this.g.n;
    const teinte = new Float32Array(n * 4);
    const brume = new Uint8Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let a = 0;
      const t = this.defs.terrains[this.terrain[i]];
      if (this.mode === 'politique' && this.proprio[i] >= 0) {
        const pa = this.pays.get(this.proprio[i]);
        if (pa) { c.set(melanger(pa.couleur, '#ffffff', 0.12)); a = 0.42; }
      } else if (this.mode === 'ressources' && t.terre) {
        const d = this.depot[i];
        if (d > 0) { c.set(this.defs.depots[d].couleur); a = 0.7; } else { c.set('#9ca3af'); a = 0.45; }
      }
      if (this.irr[i]) { c.set('#b6ff3b'); a = 0.55; }
      if (this.zone && this.zone.has(i)) { c.set(this.zoneCouleur); a = Math.max(a, 0.4); }
      teinte[4 * i] = c.r; teinte[4 * i + 1] = c.g; teinte[4 * i + 2] = c.b; teinte[4 * i + 3] = a;
      brume[i] = this.vision && !this.vision[i] ? 1 : 0;
    }
    const sombre = this.theme === 'dark';
    const [vr, vg, vb] = sombre ? [0.06, 0.08, 0.1] : [0.86, 0.89, 0.92];
    const col = this.relief.geometry.getAttribute('color');
    const out = col.array, base = this.vBase, cas = this.vCase, hauts = this.relief.geometry.getAttribute('position').array;
    for (let k = 0; k < cas.length; k++) {
      let r = base[3 * k], g = base[3 * k + 1], b = base[3 * k + 2];
      const i = cas[k];
      if (i >= 0 && hauts[3 * k + 1] > -0.05) {
        const a = teinte[4 * i + 3];
        if (a > 0) { r += (teinte[4 * i] - r) * a; g += (teinte[4 * i + 1] - g) * a; b += (teinte[4 * i + 2] - b) * a; }
        if (brume[i]) {
          const l = 0.3 * r + 0.59 * g + 0.11 * b;
          r = (r + (l - r) * 0.6); g = (g + (l - g) * 0.6); b = (b + (l - b) * 0.6);
          const f = sombre ? 0.3 : 0.35;
          r += (vr - r) * f; g += (vg - g) * f; b += (vb - b) * f;
        }
      } else if (i >= 0 && brume[i]) {
        r *= 0.75; g *= 0.75; b *= 0.8;
      }
      out[3 * k] = r; out[3 * k + 1] = g; out[3 * k + 2] = b;
    }
    col.needsUpdate = true;
    this.couleursSales = false;
  }

  // ── Frontieres (rubans qui epousent le relief) ────────────────────
  construireBords() {
    const pos = [], col = [];
    const c = new THREE.Color(), bc = new THREE.Color();
    const y = (x, z) => Math.max(0.03, this.altitude(x, z)) + 0.07;
    const ruban = (x, z, a1, a2, e1, e2, coul) => {
      const N = 4;
      for (let s = 0; s < N; s++) {
        const t1 = s / N, t2 = (s + 1) / N;
        const ext1 = [x + a1[0] + (a2[0] - a1[0]) * t1, z + a1[1] + (a2[1] - a1[1]) * t1];
        const ext2 = [x + a1[0] + (a2[0] - a1[0]) * t2, z + a1[1] + (a2[1] - a1[1]) * t2];
        const int1 = [x + e1[0] + (e2[0] - e1[0]) * t1, z + e1[1] + (e2[1] - e1[1]) * t1];
        const int2 = [x + e1[0] + (e2[0] - e1[0]) * t2, z + e1[1] + (e2[1] - e1[1]) * t2];
        const P = [ext1, ext2, int2, ext1, int2, int1];
        for (const [px, pz] of P) { pos.push(px, y(px, pz), pz); col.push(coul.r, coul.g, coul.b); }
      }
    };
    for (let i = 0; i < this.g.n; i++) {
      const p = this.proprio[i];
      if (p < 0) continue;
      const pa = this.pays.get(p);
      if (!pa) continue;
      c.set(pa.couleur);
      const bloc = pa.bloc != null ? this.blocs.get(pa.bloc) : null;
      const [x, z] = this.pos(i);
      this.g.voisins(i).forEach((v, k) => {
        if (v >= 0 && this.proprio[v] === p) return;
        const [a, b] = DIRS_COINS[k];
        const ep = 0.17;
        ruban(x, z, this.coin(a), this.coin(b), this.coin(a, 1 - ep), this.coin(b, 1 - ep), c);
        if (bloc && (v < 0 || this.proprio[v] < 0 || this.pays.get(this.proprio[v])?.bloc !== pa.bloc)) {
          bc.set(bloc.couleur);
          ruban(x, z, this.coin(a, 1 - ep), this.coin(b, 1 - ep), this.coin(a, 1 - ep - 0.07), this.coin(b, 1 - ep - 0.07), bc);
        }
      });
    }
    this.groupes.bords.clear();
    if (this.bordMesh) this.bordMesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.bordMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.bordMesh.renderOrder = 2;
    this.groupes.bords.add(this.bordMesh);
    this.bordSale = false;
  }

  // ── Textures de sprites ─────────────────────────────────────────
  texture(cle, w, h, dessin) {
    let t = this.texCache.get(cle);
    if (t) return t;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const redessiner = () => { ctx.clearRect(0, 0, w, h); dessin(ctx, w, h); t.needsUpdate = true; };
    t.userData.redessiner = redessiner;
    redessiner();
    if (this.texCache.size > 900) {
      for (const [k, v] of this.texCache) { v.dispose(); this.texCache.delete(k); if (this.texCache.size < 600) break; }
    }
    this.texCache.set(cle, t);
    return t;
  }

  dessinerBadge(ctx, cx, cy, r, fond, icone, bord = '#ffffff') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fond;
    ctx.fill();
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = bord;
    ctx.stroke();
    const img = iconeSync(icone);
    if (img) ctx.drawImage(img, cx - r * 0.58, cy - r * 0.58, r * 1.16, r * 1.16);
    else if (img === undefined) imageIcone(icone).then(() => this.redessinerTextures());
  }

  /** Redessine les textures une fois les icônes chargées. Regroupé en un
   *  seul passage par image : sans cela, chaque badge en attente relançait
   *  le redessin de TOUTES les textures (des centaines × des centaines
   *  dès qu'il y a beaucoup de bâtiments et d'armées, page figée). */
  redessinerTextures() {
    if (this.redessinPrevu) return;
    this.redessinPrevu = true;
    requestAnimationFrame(() => {
      this.redessinPrevu = false;
      this.texCache.forEach(t => t.userData.redessiner && t.userData.redessiner());
    });
  }

  texBatiment(bat, niv, couleur) {
    return this.texture(`b|${bat}|${niv}|${couleur}`, 128, 128, (ctx, w) => {
      const def = this.batDefs.get(bat);
      const capitale = bat === 'capitale';
      this.dessinerBadge(ctx, w / 2, w / 2, capitale ? 54 : 44, capitale ? couleur : '#263238', def ? def.icone : 'question', capitale ? '#ffd54f' : couleur);
      if (!capitale && niv > 0) {
        ctx.beginPath();
        ctx.arc(w - 26, w - 26, 20, 0, Math.PI * 2);
        ctx.fillStyle = couleur;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(niv), w - 26, w - 25);
      }
    });
  }

  texArmee(icone, couleur, texte, selection, hostile) {
    return this.texture(`a|${icone}|${couleur}|${texte}|${selection}|${hostile}`, 128, 160, (ctx, w) => {
      if (selection) {
        ctx.beginPath();
        ctx.arc(w / 2, 58, 58, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(74,222,128,0.45)';
        ctx.fill();
      }
      this.dessinerBadge(ctx, w / 2, 58, 46, couleur, icone, hostile ? '#ff5252' : '#ffffff');
      ctx.font = 'bold 30px Arial';
      const tw = ctx.measureText(texte).width + 22;
      ctx.fillStyle = 'rgba(17,24,39,0.88)';
      const x = (w - tw) / 2, y = 112;
      ctx.beginPath();
      ctx.roundRect(x, y, tw, 40, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texte, w / 2, y + 21);
    });
  }

  texTexte(txt, couleur, taille = 44) {
    return this.texture(`t|${txt}|${couleur}|${taille}`, 512, 96, (ctx, w, h) => {
      ctx.font = `800 ${taille}px 'Segoe UI', Arial, sans-serif`;
      // Reduit la police tant que le nom ne tient pas dans la texture.
      let t = taille;
      while (ctx.measureText(txt).width > w - 24 && t > 14) {
        t -= 2;
        ctx.font = `800 ${t}px 'Segoe UI', Arial, sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(10,14,18,0.8)';
      ctx.strokeText(txt, w / 2, h / 2);
      ctx.fillStyle = couleur;
      ctx.fillText(txt, w / 2, h / 2);
    });
  }

  sprite(tex, echelle, sx = 1, sy = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(echelle * sx, echelle * sy, 1);
    return s;
  }

  // ── Mise a jour depuis le serveur ────────────────────────────────
  majPublics(publics) {
    if (!publics) return;
    const avant = JSON.stringify([...this.pays.values()].map(p => [p.id, p.couleur, p.bloc, p.nom]))
      + JSON.stringify([...this.blocs.values()].map(b => [b.id, b.couleur]));
    this.pays = new Map(publics.pays.map(p => [p.id, p]));
    this.blocs = new Map(publics.blocs.map(b => [b.id, b]));
    const apres = JSON.stringify([...this.pays.values()].map(p => [p.id, p.couleur, p.bloc, p.nom]))
      + JSON.stringify([...this.blocs.values()].map(b => [b.id, b.couleur]));
    if (avant !== apres) {
      this.bordSale = this.couleursSales = this.labelsSales = true;
      this.batsSales = true;
    }
  }

  majEtat(e) {
    this.recu = performance.now();
    if (e.cases && e.cases.length) {
      for (const [i, p, b, nv, ir] of e.cases) {
        if (this.proprio[i] !== p) { this.bordSale = true; this.labelsSales = true; }
        this.proprio[i] = p;
        this.bat[i] = b;
        this.niv[i] = nv;
        this.irr[i] = ir;
        this.majBatiment(i);
      }
      this.couleursSales = true;
    }
    if (e.vision !== undefined) {
      const avant = this.visionHex;
      if (e.vision && e.vision !== avant) {
        const v = new Uint8Array(this.g.n);
        for (let k = 0; k < e.vision.length; k++) {
          const x = parseInt(e.vision[k], 16);
          for (let b = 0; b < 4; b++) if (4 * k + b < this.g.n) v[4 * k + b] = (x >> b) & 1;
        }
        this.vision = v;
        this.couleursSales = true;
      } else if (!e.vision && this.vision) {
        this.vision = null;
        this.couleursSales = true;
      }
      this.visionHex = e.vision;
    }
    this.armees = e.armees || [];
    this.missions = e.missions || [];
    this.missiles = e.missiles || [];
    this.majArmees();
    this.majAir();
    for (const f of e.effets || []) this.effet(f.genre, f.case);
    if (e.nuages) this.majNuages(e.nuages);
    if (this.batsSales) {
      for (let i = 0; i < this.g.n; i++) if (this.bat[i]) this.majBatiment(i);
      this.batsSales = false;
    }
  }

  /** Petit modèle 3D du bâtiment, plus grand avec le niveau, et son
   *  numéro de niveau dans une pastille aux couleurs du pays. */
  majBatiment(i) {
    const ancien = this.spritesBat.get(i);
    if (ancien) {
      this.groupes.bats.remove(ancien);
      ancien.traverse(o => { if (o.isSprite) o.material.dispose(); });
      this.spritesBat.delete(i);
    }
    const b = this.bat[i];
    if (!b) return;
    const p = this.pays.get(this.proprio[i]);
    const couleur = p ? p.couleur : '#607d8b';
    const niv = this.niv[i];
    const groupe = new THREE.Group();
    const modele = new THREE.Mesh(geometrieBatiment(b, couleur), materielBatiments);
    modele.castShadow = true;
    const echelle = (b === 'capitale' ? 1.25 : 1) * (0.9 + 0.05 * Math.min(niv, 8));
    modele.scale.setScalar(echelle);
    // Orientation variée mais stable d'une case à l'autre.
    modele.rotation.y = ((i * 7919) % 6) * Math.PI / 3 + 0.3;
    groupe.add(modele);
    if (niv > 1 && b !== 'capitale') {
      const s = this.sprite(this.texNiveau(niv, couleur), 0.3);
      s.position.set(0.42, 0.62, 0.3);
      s.renderOrder = 3;
      groupe.add(s);
    }
    const [x, z] = this.pos(i);
    groupe.position.set(x, this.haut(i) - 0.02, z);
    this.groupes.bats.add(groupe);
    this.spritesBat.set(i, groupe);
  }

  /** Commandants du joueur : pastille étoilée sur leur case, qui glisse
   *  vers la province qu'ils conquièrent au fil de la campagne. */
  majCommandants(moi) {
    this.cmdtsVus ??= new Map();
    const liste = moi && !moi.elimine ? moi.commandants || [] : [];
    const couleur = moi ? (this.pays.get(moi.id)?.couleur || '#607d8b') : '#607d8b';
    const vus = new Set();
    for (const cd of liste) {
      vus.add(cd.id);
      let s = this.cmdtsVus.get(cd.id);
      const cle = `${cd.vitesse}|${couleur}`;
      if (!s || s.userData.cle !== cle) {
        if (s) { this.groupes.armees.remove(s); s.material.dispose(); }
        s = this.sprite(this.texCommandant(cd.vitesse, couleur), 0.95, 1, 1.25);
        s.userData.cle = cle;
        s.renderOrder = 4;
        this.groupes.armees.add(s);
        this.cmdtsVus.set(cd.id, s);
      }
      const c = moi.chantiers.find(x => x.cmdt === cd.id);
      s.userData.depart = cd.case;
      s.userData.cible = c ? c.case : null;
      s.userData.prog = c ? 1 - c.reste / c.total : 0;
      s.userData.taux = c ? 1 / c.total : 0;
      s.userData.t0 = performance.now();
    }
    for (const [id, s] of this.cmdtsVus) {
      if (!vus.has(id)) { this.groupes.armees.remove(s); s.material.dispose(); this.cmdtsVus.delete(id); }
    }
  }

  texCommandant(vitesse, couleur) {
    return this.texture(`cmdt|${vitesse}|${couleur}`, 128, 160, (ctx, w) => {
      this.dessinerBadge(ctx, w / 2, 56, 44, couleur, 'user-tie', '#ffd54f');
      ctx.font = 'bold 26px Arial';
      const txt = '★'.repeat(vitesse);
      const tw = ctx.measureText(txt).width + 18;
      ctx.fillStyle = 'rgba(17,24,39,0.88)';
      ctx.beginPath();
      ctx.roundRect((w - tw) / 2, 110, tw, 36, 10);
      ctx.fill();
      ctx.fillStyle = '#ffd54f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, w / 2, 129);
    });
  }

  texNiveau(niv, couleur) {
    return this.texture(`n|${niv}|${couleur}`, 64, 64, (ctx, w) => {
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, 28, 0, Math.PI * 2);
      ctx.fillStyle = couleur;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 34px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(niv), w / 2, w / 2 + 2);
    });
  }

  /** Nuages radioactifs : amas de sphères verdâtres qui glissent d'une
   *  case à l'autre. */
  majNuages(liste) {
    this.nuagesVus ??= new Map();
    const vus = new Set();
    for (const n of liste) {
      vus.add(n.id);
      let o = this.nuagesVus.get(n.id);
      if (!o) {
        o = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x9bbf6a, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
        for (const [dx, dy, dz, r] of [[0, 0, 0, 0.7], [0.55, -0.1, 0.2, 0.5], [-0.5, -0.05, -0.15, 0.55], [0.1, 0.25, -0.4, 0.45], [-0.2, 0.2, 0.45, 0.4]]) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
          s.position.set(dx, dy, dz);
          o.add(s);
        }
        const [x, z] = this.pos(n.case);
        o.position.set(x, 2.4, z);
        o.userData.cible = [x, z];
        this.groupes.effets.add(o);
        this.nuagesVus.set(n.id, o);
      }
      o.userData.cible = this.pos(n.case);
    }
    for (const [id, o] of this.nuagesVus) {
      if (!vus.has(id)) {
        this.groupes.effets.remove(o);
        o.children.forEach(s => s.geometry.dispose());
        o.children[0]?.material.dispose();
        this.nuagesVus.delete(id);
      }
    }
  }

  majDepots() {
    const ressources = this.mode === 'ressources';
    const montrer = ressources || this.cam.d < 24;
    this.groupes.depots.visible = montrer;
    if (!montrer || this.spritesDepot.size) return;
    for (let i = 0; i < this.g.n; i++) {
      const d = this.depot[i];
      // Les sols fertiles, tres nombreux, ne s'affichent qu'en mode Ressources.
      if (!d || (d === 5 && !ressources)) continue;
      const def = this.defs.depots[d];
      const tex = this.texture(`d|${d}`, 96, 96, (ctx, w) => this.dessinerBadge(ctx, w / 2, w / 2, 34, def.couleur, def.icone, 'rgba(255,255,255,0.9)'));
      const s = this.sprite(tex, 0.62);
      const [x, z] = this.pos(i);
      s.position.set(x + 0.42, this.haut(i) + 0.32, z + 0.3);
      s.material.opacity = 0.9;
      this.groupes.depots.add(s);
      this.spritesDepot.set(i, s);
    }
  }

  majArmees() {
    const vus = new Set();
    const parCase = new Map();
    for (const a of this.armees) {
      const k = a.case;
      parCase.set(k, (parCase.get(k) || 0) + 1);
      a._rang = parCase.get(k) - 1;
    }
    for (const a of this.armees) {
      vus.add(a.id);
      const p = this.pays.get(a.proprio);
      const couleur = p ? p.couleur : '#607d8b';
      const def = this.uniDefs.get(a.principal);
      const icone = def ? def.icone : 'person-rifle';
      const texte = a.total != null ? String(a.total) : '~' + a.estimation;
      const hostile = this.moi != null && a.proprio !== this.moi && this.relations?.[a.proprio]?.etat === 'guerre';
      const tex = this.texArmee(icone, couleur, texte, a.id === this.selArmee, hostile);
      let s = this.spritesArmees.get(a.id);
      if (!s) {
        s = this.sprite(tex, 1.25, 1, 1.25);
        s.renderOrder = 4;
        this.groupes.armees.add(s);
        this.spritesArmees.set(a.id, s);
        const [x, z] = this.pos(a.case);
        s.position.set(x, this.haut(a.case) + 1.3, z);
      } else if (s.material.map !== tex) {
        s.material.map = tex;
        s.material.needsUpdate = true;
      }
      s.userData = { a, n: parCase.get(a.case) };
    }
    for (const [id, s] of this.spritesArmees) {
      if (!vus.has(id)) { this.groupes.armees.remove(s); s.material.dispose(); this.spritesArmees.delete(id); }
    }
    this.majChemins();
  }

  majChemins() {
    this.groupes.chemins.children.forEach(o => o.geometry.dispose());
    this.groupes.chemins.clear();
    for (const a of this.armees) {
      if (a.chemin && a.chemin.length && (a.proprio === this.moi)) {
        const pts = [a.case, ...a.chemin].map(i => { const [x, z] = this.pos(i); return new THREE.Vector3(x, this.haut(i) + 0.18, z); });
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const sel = a.id === this.selArmee;
        const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: sel ? 0x4ade80 : 0xffffff, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: sel ? 1 : 0.6 }));
        l.computeLineDistances();
        this.groupes.chemins.add(l);
        const fin = pts[pts.length - 1];
        const m = new THREE.Mesh(this.anneauGeo, new THREE.MeshBasicMaterial({ color: sel ? 0x4ade80 : 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
        m.position.set(fin.x, fin.y, fin.z);
        this.groupes.chemins.add(m);
      }
      const cible = a.assaut ?? (a.proprio === this.moi ? a.bombarde : null);
      if (cible != null) {
        const [x1, z1] = this.pos(a.case), [x2, z2] = this.pos(cible);
        const y1 = this.haut(a.case) + 0.4, y2 = this.haut(cible) + 0.4;
        const courbe = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1, y1, z1), new THREE.Vector3((x1 + x2) / 2, Math.max(y1, y2) + 1.2, (z1 + z2) / 2), new THREE.Vector3(x2, y2, z2));
        const g = new THREE.BufferGeometry().setFromPoints(courbe.getPoints(16));
        this.groupes.chemins.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: a.assaut != null ? 0xff5252 : 0xffb300 })));
      }
    }
  }

  majAir() {
    const vus = new Set();
    for (const m of this.missions) {
      vus.add('m' + m.id);
      let s = this.spritesMissions.get(m.id);
      if (!s) {
        const p = this.pays.get(m.proprio);
        s = this.sprite(this.texture(`air|${p?.couleur}`, 96, 96, (ctx, w) => this.dessinerBadge(ctx, w / 2, w / 2, 36, p ? p.couleur : '#607d8b', 'jet-fighter')), 0.95);
        s.renderOrder = 6;
        this.groupes.air.add(s);
        this.spritesMissions.set(m.id, s);
      }
      s.userData = { m, t0: performance.now() };
    }
    for (const [id, s] of this.spritesMissions) if (!vus.has('m' + id)) { this.groupes.air.remove(s); this.spritesMissions.delete(id); }

    const vusM = new Set();
    for (const m of this.missiles) {
      vusM.add(m.id);
      let o = this.spritesMissiles.get(m.id);
      if (!o) {
        const nucl = m.genre === 'missile_nucleaire';
        const [x1, z1] = this.pos(m.depart), [x2, z2] = this.pos(m.cible);
        const d = Math.hypot(x2 - x1, z2 - z1);
        const courbe = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(x1, this.haut(m.depart) + 0.5, z1),
          new THREE.Vector3((x1 + x2) / 2, 3 + d * 0.35, (z1 + z2) / 2),
          new THREE.Vector3(x2, this.haut(m.cible) + 0.3, z2));
        const trace = new THREE.Line(new THREE.BufferGeometry().setFromPoints(courbe.getPoints(48)),
          new THREE.LineDashedMaterial({ color: nucl ? 0xff1744 : 0xffab40, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.8 }));
        trace.computeLineDistances();
        const tete = this.sprite(this.texture(`mis|${nucl}`, 96, 96, (ctx, w) => this.dessinerBadge(ctx, w / 2, w / 2, 34, nucl ? '#b71c1c' : '#e65100', nucl ? 'radiation' : 'rocket')), nucl ? 1.2 : 0.85);
        tete.renderOrder = 7;
        this.groupes.air.add(trace, tete);
        o = { trace, tete, courbe };
        this.spritesMissiles.set(m.id, o);
      }
      o.m = m;
      o.t0 = performance.now();
    }
    for (const [id, o] of this.spritesMissiles) {
      if (!vusM.has(id)) { this.groupes.air.remove(o.trace, o.tete); o.trace.geometry.dispose(); this.spritesMissiles.delete(id); }
    }
  }

  majLabels() {
    this.groupes.labels.children.forEach(s => s.material.dispose());
    this.groupes.labels.clear();
    const sommes = new Map();
    for (let i = 0; i < this.g.n; i++) {
      const p = this.proprio[i];
      if (p < 0) continue;
      const [x, z] = this.pos(i);
      const s = sommes.get(p) || { x: 0, z: 0, n: 0 };
      s.x += x; s.z += z; s.n++;
      sommes.set(p, s);
    }
    for (const [pid, s] of sommes) {
      const p = this.pays.get(pid);
      if (!p) continue;
      const sp = this.sprite(this.texTexte(p.nom.toUpperCase(), '#ffffff', 46), 3.2 + Math.min(4, Math.sqrt(s.n) * 0.55), 1, 0.1875);
      sp.position.set(s.x / s.n, 4.2, s.z / s.n);
      sp.renderOrder = 9;
      sp.material.depthTest = false;
      this.groupes.labels.add(sp);
    }
    this.labelsSales = false;
  }

  // ── Effets ──────────────────────────────────────────────────────
  effet(genre, i) {
    const [x, z] = this.pos(i);
    const y = this.haut(i);
    const ajout = (geo, couleur, duree, echelleMax, opacite = 0.9, hauteur = 0.4) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: opacite, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(x, y + hauteur, z);
      m.scale.setScalar(0.01);
      this.groupes.effets.add(m);
      this.effets.push({ m, t0: performance.now(), duree, echelleMax, opacite });
    };
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    if (genre === 'nucleaire') {
      ajout(sphere, 0xffffff, 1400, 5.5, 1, 1);
      ajout(sphere, 0xff6d00, 3600, 4.2, 0.9, 2.2);
      ajout(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), 0xffe082, 2600, 12, 0.9, 0.2);
      ajout(new THREE.CylinderGeometry(0.35, 0.6, 4, 16), 0x9e9e9e, 5000, 1.4, 0.55, 2);
      this.rappels.flash?.();
    } else if (genre === 'explosion') {
      ajout(sphere, 0xff9100, 1100, 1.6);
      ajout(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), 0xffcc80, 900, 3, 0.8, 0.1);
    } else if (genre === 'interception') {
      ajout(sphere, 0x40c4ff, 900, 1.3, 0.9, 5);
    } else if (genre === 'frappe') {
      for (let k = 0; k < 3; k++) setTimeout(() => ajout(sphere, 0xff6e40, 700, 0.9), k * 160);
    } else if (genre === 'bataille') {
      ajout(sphere, 0xffd740, 1000, 1.2);
    } else {
      ajout(sphere, genre === 'obus' ? 0xffab40 : 0xffe57f, 500, 0.55, 0.85, 0.6 + Math.random() * 0.4);
    }
  }

  // ── Selection / zone ────────────────────────────────────────────
  setMode(m) { this.mode = m; this.couleursSales = true; this.spritesDepot.forEach(s => this.groupes.depots.remove(s)); this.spritesDepot.clear(); }
  setMoi(id) { this.moi = id; }
  setRelations(r) { this.relations = r; }
  setZone(cases, couleur = '#ffffff') { this.zone = cases ? new Set(cases) : null; this.zoneCouleur = couleur; this.couleursSales = true; }
  selectionnerCase(i) {
    if (i == null || i < 0) { this.selMesh.visible = false; return; }
    const [x, z] = this.pos(i);
    this.selMesh.position.set(x, this.haut(i) + 0.12, z);
    this.selMesh.visible = true;
  }
  selectionnerArmee(id) { this.selArmee = id; this.majArmees(); }
  centrerSur(i, d) {
    const [x, z] = this.pos(i);
    this.anim = { x0: this.cam.x, z0: this.cam.z, d0: this.cam.d, x1: x, z1: z, d1: d ?? Math.min(this.cam.d, 38), t0: performance.now() };
  }

  /** Position a l'ecran (px, relative a la carte) du sommet d'une case. */
  ecranDe(i, dy = 0.4) {
    const [x, z] = this.pos(i);
    const v = new THREE.Vector3(x, this.haut(i) + dy, z).project(this.camera);
    const r = this.renderer.domElement;
    return { x: (v.x + 1) / 2 * r.clientWidth, y: (1 - v.y) / 2 * r.clientHeight, devant: v.z < 1 };
  }

  // ── Controles ───────────────────────────────────────────────────
  initControles() {
    const cv = this.renderer.domElement;
    cv.tabIndex = 0;
    let bas = null;
    const pointeurs = new Map();
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      bas = { x: e.clientX, y: e.clientY, bouton: e.button, bouge: false, cam: { ...this.cam } };
      if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()];
        bas.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        bas.angle = Math.atan2(b.y - a.y, b.x - a.x);
        bas.milieuY = (a.y + b.y) / 2;
        bas.bouge = true; // deux doigts : jamais un clic
      }
    });
    cv.addEventListener('pointermove', e => {
      if (pointeurs.has(e.pointerId)) pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!bas) { this.survol(e); return; }
      const dx = e.clientX - bas.x, dy = e.clientY - bas.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) bas.bouge = true;
      if (!bas.bouge) return;
      if (pointeurs.size === 2 && bas.pinch) {
        // Deux doigts : pincer = zoom, tourner = pivoter la vue,
        // glisser ensemble vers le haut / le bas = incliner.
        const [a, b] = [...pointeurs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.d = Math.min(110, Math.max(7, bas.cam.d * bas.pinch / Math.max(1, d)));
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        this.cam.lacet = bas.cam.lacet - (angle - bas.angle);
        const my = (a.y + b.y) / 2;
        this.cam.tangage = Math.min(1.45, Math.max(0.3, bas.cam.tangage + (my - bas.milieuY) * 0.004));
        this.anim = null;
        return;
      }
      if (bas.bouton === 2 || e.shiftKey) {
        this.cam.lacet = bas.cam.lacet - dx * 0.006;
        this.cam.tangage = Math.min(1.45, Math.max(0.3, bas.cam.tangage + dy * 0.004));
      } else {
        const k = this.cam.d * 0.0019;
        const c = Math.cos(this.cam.lacet), s = Math.sin(this.cam.lacet);
        this.cam.x = bas.cam.x - (dx * c + dy * s / Math.sin(this.cam.tangage)) * k;
        this.cam.z = bas.cam.z - (-dx * s + dy * c / Math.sin(this.cam.tangage)) * k;
        this.borner();
      }
    });
    const fin = e => {
      pointeurs.delete(e.pointerId);
      if (!bas) return;
      // Un doigt se relève après un geste à deux doigts : on repart du
      // doigt restant, sans saut de caméra ni clic parasite.
      if (pointeurs.size === 1 && bas.pinch) {
        const [r] = [...pointeurs.values()];
        bas = { x: r.x, y: r.y, bouton: 0, bouge: true, cam: { ...this.cam } };
        return;
      }
      if (!bas.bouge) {
        const i = this.caseSous(e.clientX, e.clientY);
        if (bas.bouton === 2) this.rappels.clicDroit?.(i, e);
        else if (bas.bouton === 0) this.rappels.clic?.(i, e);
      }
      if (pointeurs.size === 0) bas = null;
    };
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', e => { pointeurs.delete(e.pointerId); bas = null; });
    cv.addEventListener('pointerleave', () => { this.survolMesh.visible = false; this.rappels.survol?.(null); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.anim = null;
      this.cam.d = Math.min(110, Math.max(7, this.cam.d * (1 + Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) * 0.0012))));
    }, { passive: false });
    cv.addEventListener('dblclick', e => {
      const i = this.caseSous(e.clientX, e.clientY);
      if (i >= 0) this.centrerSur(i, Math.max(12, this.cam.d * 0.6));
    });
    this.touches = new Set();
    window.addEventListener('keydown', e => {
      if (/input|textarea|select/i.test(document.activeElement?.tagName)) return;
      this.touches.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', e => this.touches.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.touches.clear());
  }

  borner() {
    this.cam.x = Math.min(this.largeurMonde + 6, Math.max(-6, this.cam.x));
    this.cam.z = Math.min(this.hauteurMonde + 6, Math.max(-6, this.cam.z));
  }

  clavier(dt) {
    const t = this.touches;
    if (!t.size) return;
    const v = this.cam.d * 0.9 * dt;
    let fx = 0, fz = 0;
    if (t.has('z') || t.has('w') || t.has('arrowup')) fz -= 1;
    if (t.has('s') || t.has('arrowdown')) fz += 1;
    if (t.has('q') || t.has('a') || t.has('arrowleft')) fx -= 1;
    if (t.has('d') || t.has('arrowright')) fx += 1;
    if (fx || fz) {
      const c = Math.cos(this.cam.lacet), s = Math.sin(this.cam.lacet);
      this.cam.x += (fx * c + fz * s) * v;
      this.cam.z += (-fx * s + fz * c) * v;
      this.borner();
      this.anim = null;
    }
    if (t.has('e')) this.cam.lacet -= 1.2 * dt;
    if (t.has('r')) this.cam.lacet += 1.2 * dt;
    if (t.has('+') || t.has('=')) this.cam.d = Math.max(7, this.cam.d * (1 - dt));
    if (t.has('-') || t.has('6')) this.cam.d = Math.min(110, this.cam.d * (1 + dt));
  }

  caseSous(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // Intersection rayon / relief par approximations successives.
    let y = 0.3;
    const p = new THREE.Vector3();
    for (let k = 0; k < 6; k++) {
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p)) return -1;
      const ny = Math.max(0, this.altitude(p.x, p.z));
      if (Math.abs(ny - y) < 0.02) break;
      y = y + (ny - y) * 0.7;
    }
    return this.hexDepuis(p.x, p.z);
  }

  hexDepuis(x, z) {
    const q = (Math.sqrt(3) / 3 * x - z / 3) / R;
    const r = (2 / 3 * z) / R;
    let cx = q, cz = r, cy = -q - r;
    let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const col = rx + (rz - (rz & 1)) / 2, row = rz;
    return this.g.idx(col, row);
  }

  survol(e) {
    const i = this.caseSous(e.clientX, e.clientY);
    if (i === this.survolCase) return;
    this.survolCase = i;
    if (i >= 0) {
      const [x, z] = this.pos(i);
      this.survolMesh.position.set(x, this.haut(i) + 0.1, z);
      // Pas d'anneau qui suit la souris en permanence : seulement pendant
      // un ordre (déplacement, frappe...) pour viser la case.
      this.survolMesh.visible = !!this.visee;
    } else this.survolMesh.visible = false;
    this.rappels.survol?.(i >= 0 ? i : null, e);
  }

  // ── Boucle de rendu ──────────────────────────────────────────────
  boucle(t) {
    requestAnimationFrame(this.boucle);
    if (document.hidden) return;
    const dt = Math.min(0.1, (t - (this.dernier || t)) / 1000);
    this.dernier = t;
    this.clavier(dt);
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      this.cam.x = this.anim.x0 + (this.anim.x1 - this.anim.x0) * e;
      this.cam.z = this.anim.z0 + (this.anim.z1 - this.anim.z0) * e;
      this.cam.d = this.anim.d0 + (this.anim.d1 - this.anim.d0) * e;
      if (k >= 1) this.anim = null;
    }
    if (this.couleursSales) this.recolorer();
    if (this.bordSale) this.construireBords();
    if (this.labelsSales) this.majLabels();
    this.majDepots();

    const c = this.cam;
    const cp = Math.cos(c.tangage), sp = Math.sin(c.tangage);
    this.camera.position.set(c.x + Math.sin(c.lacet) * cp * c.d, sp * c.d, c.z + Math.cos(c.lacet) * cp * c.d);
    this.camera.lookAt(c.x, 0, c.z);

    this.groupes.labels.visible = c.d > 20;
    this.groupes.labels.children.forEach(s => (s.material.opacity = Math.min(1, (c.d - 20) / 12)));
    this.groupes.bats.visible = c.d < 95;

    // Interpolation des armees en mouvement
    const ecoule = (performance.now() - this.recu) / 1000;
    for (const s of this.spritesArmees.values()) {
      const { a, n } = s.userData;
      const [x0, z0] = this.pos(a.case);
      let x = x0, z = z0, y = this.haut(a.case);
      if (a.prochaine != null && a.assaut == null) {
        const [x1, z1] = this.pos(a.prochaine);
        const cout = this.defs.terrains[this.terrain[a.prochaine]]?.cout_mvt || 1;
        const p = Math.min(0.98, a.progres + ecoule * (a.vitesse || 3) / 60 / cout);
        x = x0 + (x1 - x0) * p; z = z0 + (z1 - z0) * p;
        y = y + (this.haut(a.prochaine) - y) * p;
      } else if (a.assaut != null) {
        const [x1, z1] = this.pos(a.assaut);
        const osc = 0.28 + Math.sin(t / 120) * 0.06;
        x = x0 + (x1 - x0) * osc; z = z0 + (z1 - z0) * osc;
      }
      // Decale les armees d'une case occupee par un batiment, et les
      // unes des autres quand plusieurs partagent la case.
      const decal = n > 1 ? (a._rang - (n - 1) / 2) * 0.62 : 0;
      const aBat = this.bat[a.case] ? 0.62 : 0;
      s.position.set(x + decal + aBat, y + 1.25, z - aBat * 0.35 + (n > 1 ? 0.1 * a._rang : 0));
    }
    for (const s of this.spritesMissions.values()) {
      const { m, t0 } = s.userData;
      const p = Math.min(1, m.progres + (performance.now() - t0) / 1000 / Math.max(1, m.duree));
      const [a, b] = m.retour ? [m.cible, m.base] : [m.base, m.cible];
      const [x1, z1] = this.pos(a), [x2, z2] = this.pos(b);
      s.position.set(x1 + (x2 - x1) * p, 3 + Math.sin(Math.PI * p) * 2.5, z1 + (z2 - z1) * p);
    }
    for (const o of this.spritesMissiles.values()) {
      const p = Math.min(1, o.m.progres + (performance.now() - o.t0) / 1000 / Math.max(1, o.m.duree));
      o.tete.position.copy(o.courbe.getPoint(p));
      o.trace.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(t / 200));
    }
    // Effets
    const maint = performance.now();
    this.effets = this.effets.filter(f => {
      const k = (maint - f.t0) / f.duree;
      if (k >= 1) { this.groupes.effets.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); return false; }
      f.m.scale.setScalar(0.05 + f.echelleMax * Math.pow(k, 0.45));
      f.m.material.opacity = f.opacite * (1 - k);
      return true;
    });
    // Commandants : de leur case vers la province en cours de conquête
    if (this.cmdtsVus) for (const s of this.cmdtsVus.values()) {
      const { depart, cible, prog, taux, t0 } = s.userData;
      const [x0, z0] = this.pos(depart);
      let x = x0, z = z0, y = this.haut(depart);
      if (cible != null) {
        const p = Math.min(1, prog + (performance.now() - t0) / 1000 * taux * (this.vitesseJeu || 1));
        const [x1, z1] = this.pos(cible);
        x += (x1 - x0) * p; z += (z1 - z0) * p;
        y += (this.haut(cible) - y) * p;
      }
      s.position.set(x - 0.45, y + 1.05, z + 0.25);
    }
    // Nuages radioactifs : glissent vers leur case et ondulent
    if (this.nuagesVus) for (const o of this.nuagesVus.values()) {
      const [cx, cz] = o.userData.cible;
      o.position.x += (cx - o.position.x) * Math.min(1, dt * 0.25);
      o.position.z += (cz - o.position.z) * Math.min(1, dt * 0.25);
      o.position.y = 2.4 + Math.sin(t / 900 + o.id) * 0.12;
      o.rotation.y += dt * 0.05;
    }
    // Pulsation des cases irradiees / selection
    this.selMesh.material.opacity = 0.65 + 0.35 * Math.sin(t / 250);

    this.renderer.render(this.scene, this.camera);
  }
}
