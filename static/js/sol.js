// ══════════════════════════════════════════════════════════════════
// sol.js — Calcul du sol de la carte (relief, couleurs, arbres, grille)
// Utilisé par carte.js (fil principal) et par sol-worker.js (calcul en
// parallèle, pour que l'affichage reste fluide pendant que les tuiles
// détaillées se préparent). Aucun accès à la page ni à Three.js hors
// Color : tout renvoie des tableaux bruts, transférables entre fils.
// ══════════════════════════════════════════════════════════════════
import { Color } from '../vendor/three.module.min.js';

export const R = 1;                       // rayon d'un hexagone
export const LX = Math.sqrt(3) * R;       // pas horizontal
export const LZ = 1.5 * R;                // pas vertical
// Altitude de base et rugosite par terrain (ocean, mer, plaine, foret,
// collines, montagnes, desert, toundra, neant).
export const ALT = [-1.25, -0.38, 0.2, 0.3, 0.85, 1.9, 0.24, 0.33, -2.6];
export const RUG = [0.05, 0.04, 0.06, 0.12, 0.42, 1.2, 0.09, 0.12, 0];
export const BIOMES = ['#1f4f73', '#3f86a8', '#8db35a', '#4f7f3a', '#9c9a5e', '#8a8378', '#dcc684', '#b3bdb0', '#07030c'];
// Nuances reelles de chaque terrain (melangees par plusieurs bruits) : un
// meme terrain n'a jamais deux fois la meme couleur, rien ne se repete.
export const NUANCES = [
  null, null,
  ['#7da24c', '#94ad57', '#6b9444', '#a7b467', '#86a952'],          // plaine : herbe grasse, seche, prairie
  ['#3c6a31', '#4a7a39', '#33592b', '#56813f', '#2f5528'],          // foret
  ['#8d975a', '#9f9a66', '#7e8a52', '#a8a374', '#8a8c5e'],          // collines
  ['#7b7166', '#8b8277', '#6d655c', '#958d83', '#80776b'],          // montagnes (roche)
  ['#dcc684', '#d1b26c', '#e6d3a0', '#c9a764', '#e0c98c'],          // desert : sable, regs
  ['#a9b5a2', '#93a08a', '#bcc5b5', '#8a9682', '#c8cfc2'],          // toundra : lichens, mousses
];
export const T_NEANT = 8;

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function bruit(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, o) {
  let v = 0, amp = 0.5, f = 1, t = 0;
  for (let i = 0; i < o; i++) { v += bruit(x * f, y * f) * amp; t += amp; amp *= 0.5; f *= 2.03; }
  return v / t;
}
export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const VOISINS_PAIR = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const VOISINS_IMPAIR = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export class Sol {
  /** terrain : Uint8Array (une valeur par case), l x h cases. */
  constructor(terrain, l, h, sombre, mobile, reel = false) {
    this.terrain = terrain;
    this.reel = reel;
    this.l = l; this.h = h; this.n = l * h;
    this.mobile = mobile;
    this.largeurMonde = LX * (l + 0.5);
    this.hauteurMonde = LZ * h;
    this.palette = {
      pal: BIOMES.map(x => new Color(x)),
      nuances: NUANCES.map(l2 => l2 && l2.map(x => new Color(x))),
      sable: new Color('#d6c794'), roche: new Color('#7b7166'), neige: new Color('#f4f6f9'),
      fond: new Color(sombre ? '#0b2236' : '#1f4f73'), hautFond: new Color('#5f9fae'),
    };
    this._c = new Color();
    this._t = new Color();
  }

  idx(x, y) { return (x < 0 || y < 0 || x >= this.l || y >= this.h) ? -1 : y * this.l + x; }
  pos(i) { const x = i % this.l, y = (i / this.l) | 0; return [LX * (x + 0.5 * (y & 1)), LZ * y]; }

  hexDepuis(x, z) {
    const q = (Math.sqrt(3) / 3 * x - z / 3) / R;
    const r = (2 / 3 * z) / R;
    const cx = q, cz = r, cy = -q - r;
    let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
    const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return this.idx(rx + (rz - (rz & 1)) / 2, rz);
  }

  /** Altitude du terrain en un point : moyenne lissee des cases voisines
   *  + cretes (montagnes) et ondulations (plaines). */
  altitude(x, z) {
    const i0 = this.hexDepuis(x, z);
    if (i0 < 0) return ALT[0];
    let sw = 0, sa = 0, sr = 0;
    const cx0 = i0 % this.l, cy0 = (i0 / this.l) | 0;
    const d = (cy0 & 1) ? VOISINS_IMPAIR : VOISINS_PAIR;
    for (let k = -1; k < 6; k++) {
      const i = k < 0 ? i0 : this.idx(cx0 + d[k][0], cy0 + d[k][1]);
      if (i < 0) continue;
      const y = (i / this.l) | 0, px = LX * (i % this.l + 0.5 * (y & 1)), pz = LZ * y;
      const w = Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / 0.85);
      const t = this.terrain[i];
      sw += w; sa += w * ALT[t]; sr += w * RUG[t];
    }
    const base = sa / sw, rug = sr / sw;
    const crete = 1 - Math.abs(2 * fbm(x * 0.5, z * 0.5, 4) - 1);
    const onde = fbm(x * 0.9 + 100, z * 0.9 + 100, 3) - 0.5;
    return base + rug * (crete * crete * 1.4 - 0.4) + onde * 0.14;
  }

  /** Terrain vu sous un point du sol, avec des frontieres naturelles (le
   *  point est deplace par un bruit) au lieu des bords des hexagones. */
  terrainNaturel(x, z, ci) {
    const t0 = ci >= 0 ? this.terrain[ci] : 0;
    if (t0 <= 1 || t0 === T_NEANT) return t0;
    const dx = (fbm(x * 0.55 + 11.3, z * 0.55 - 4.1, 3) - 0.5) * 1.5, dz = (fbm(x * 0.55 - 7.7, z * 0.55 + 19.2, 3) - 0.5) * 1.5;
    const cj = this.hexDepuis(x + dx, z + dz);
    const t = cj >= 0 ? this.terrain[cj] : t0;
    return t <= 1 || t === T_NEANT ? t0 : t;
  }

  /** Couleur de terrain : melange de nuances par des bruits a plusieurs echelles. */
  nuance(t, x, z, c) {
    const N = this.palette.nuances[t];
    if (!N) return c.copy(this.palette.pal[t]);
    const a = fbm(x * 0.07 + t * 13.1, z * 0.07 - t * 5.3, 3);
    const b = fbm(x * 0.45 - t * 3.7, z * 0.45 + t * 9.9, 3);
    const f = Math.min(N.length - 1.001, Math.max(0, a * 1.6 - 0.3) * (N.length - 1));
    const i = Math.floor(f);
    c.copy(N[i]).lerp(N[i + 1], f - i);
    c.lerp(N[(i + 2) % N.length], Math.max(0, b - 0.55) * 0.9);
    return c;
  }

  /** Altitude des neiges. Carte du monde : elle depend de la latitude,
   *  comme en vrai (tres haut sous les tropiques : seuls les plus hauts
   *  sommets du Kenya ou des Andes sont blancs ; bas pres des poles). */
  limiteNeige(z) {
    if (!this.reel) return 1.75;
    const lat = Math.abs(83 - (z / this.hauteurMonde) * 139);
    if (lat <= 15) return 2.5;
    if (lat <= 35) return 2.5 - (lat - 15) / 20 * 0.75;
    if (lat <= 55) return 1.75;
    return Math.max(1.45, 1.75 - (lat - 55) / 15 * 0.3);
  }

  /** Couleur de base d'un sommet : biome, plages, neige, roche en pente, fonds marins. */
  couleurSommet(k, pos, nor, out, cas) {
    const P = this.palette, c = this._c;
    const h = pos[3 * k + 1], x = pos[3 * k], z = pos[3 * k + 2];
    const t = this.terrainNaturel(x, z, cas[k]);
    const pente = 1 - nor[3 * k + 1];
    this.nuance(t, x, z, c);
    if (t === T_NEANT) {
      c.setRGB(0.03, 0.01, 0.05).lerp(P.roche, Math.max(0, Math.min(0.25, (h + 0.6) * 0.2)));
    } else if (h < 0) {
      c.copy(P.hautFond).lerp(P.fond, Math.min(1, -h / 1.2));
    } else {
      if (h < 0.16) c.lerp(P.sable, (0.16 - h) / 0.16 * 0.85);
      if (pente > 0.18) c.lerp(P.roche, Math.min(0.8, (pente - 0.18) * 3));
      const sn = this.limiteNeige(z);
      if (h > sn) c.lerp(P.neige, Math.min(1, (h - sn) / 0.45));
      const v = (fbm(x * 2.3, z * 2.3, 2) - 0.5) * 0.1 + (bruit(x * 7.1, z * 7.1) - 0.5) * 0.04;
      const ht = (fbm(x * 0.2 + 40, z * 0.2, 2) - 0.5) * 0.025;
      c.offsetHSL(ht, 0, v);
    }
    out[3 * k] = c.r; out[3 * k + 1] = c.g; out[3 * k + 2] = c.b;
  }

  /** Maillage du sol sur un rectangle : hauteurs, normales (par differences,
   *  sans couture entre tuiles), couleurs, numero de case. Tableaux bruts. */
  maillage(x0, z0, l, p, pas, lisse = false) {
    const nx = Math.ceil(l / pas) + 1, nz = Math.ceil(p / pas) + 1, nv = nx * nz;
    const H = new Float32Array((nx + 2) * (nz + 2));
    // Lisse (carte lointaine) : moyenne de 5 points autour du sommet, pour
    // eviter le mouchete de cretes et de neige quand les sommets sont espaces.
    const dq = pas * 0.35;
    const alt = lisse
      ? (x, z) => (2 * this.altitude(x, z) + this.altitude(x - dq, z - dq) + this.altitude(x + dq, z - dq) + this.altitude(x - dq, z + dq) + this.altitude(x + dq, z + dq)) / 6
      : (x, z) => this.altitude(x, z);
    for (let j = -1; j <= nz; j++) for (let i = -1; i <= nx; i++) H[(j + 1) * (nx + 2) + (i + 1)] = alt(x0 + i * pas, z0 + j * pas);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cas = new Float32Array(nv), col = new Float32Array(nv * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * pas, z = z0 + j * pas, b = (j + 1) * (nx + 2) + (i + 1);
        pos[3 * k] = x; pos[3 * k + 1] = H[b]; pos[3 * k + 2] = z;
        const gx = H[b + 1] - H[b - 1], gz = H[b + nx + 2] - H[b - nx - 2], d = 2 * pas, L = Math.hypot(gx, d, gz);
        nor[3 * k] = -gx / L; nor[3 * k + 1] = d / L; nor[3 * k + 2] = -gz / L;
        cas[k] = this.hexDepuis(x, z);
      }
    }
    for (let k = 0; k < nv; k++) this.couleurSommet(k, pos, nor, col, cas);
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      idx[q++] = k; idx[q++] = k + nx; idx[q++] = k + 1;
      idx[q++] = k + 1; idx[q++] = k + nx; idx[q++] = k + nx + 1;
    }
    return { pos, nor, col, cas, idx };
  }

  /** Carte lointaine : le monde entier, allege. */
  maillageLoin(pas) {
    return this.maillage(-LX * 1.5, -LZ * 1.5, this.largeurMonde + LX * 3, this.hauteurMonde + LZ * 3, pas, true);
  }

  /** Tuile detaillee (tx, tz) : sol, grille des cases, arbres. */
  tuile(tx, tz, T, pas) {
    const x0 = -LX * 1.5 + tx * T, z0 = -LZ * 1.5 + tz * T;
    const sol = this.maillage(x0, z0, T, T, pas);
    const cases = [];
    const ya = Math.max(0, Math.floor(z0 / LZ) - 1), yb = Math.min(this.h - 1, Math.ceil((z0 + T) / LZ) + 1);
    const xa = Math.max(0, Math.floor(x0 / LX) - 1), xb = Math.min(this.l - 1, Math.ceil((x0 + T) / LX) + 1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const i = y * this.l + x, [cx, cz] = this.pos(i);
      if (cx >= x0 && cx < x0 + T && cz >= z0 && cz < z0 + T) cases.push(i);
    }
    // Grille des cases (terres seulement).
    const lignes = [];
    const coin = j => { const a = (Math.PI / 180) * (60 * j - 30); return [Math.cos(a) * R, Math.sin(a) * R]; };
    for (const i of cases) {
      const t = this.terrain[i];
      if (t <= 1 || t === T_NEANT) continue;
      const [cx, cz] = this.pos(i);
      for (let j = 0; j < 3; j++) {
        const [ax, az] = coin(j), [bx, bz] = coin(j + 1);
        for (let s2 = 0; s2 < 2; s2++) {
          const t1 = s2 / 2, t2 = (s2 + 1) / 2;
          const x1 = cx + ax + (bx - ax) * t1, z1 = cz + az + (bz - az) * t1, x2 = cx + ax + (bx - ax) * t2, z2 = cz + az + (bz - az) * t2;
          lignes.push(x1, Math.max(0.02, this.altitude(x1, z1)) + 0.04, z1, x2, Math.max(0.02, this.altitude(x2, z2)) + 0.04, z2);
        }
      }
    }
    // Arbres : coniferes (nord, toundra, altitude) et feuillus ; hasard tire
    // de l'index de la case (les memes arbres a chaque construction).
    const types = [[], []];
    const col = this._t;
    for (const i of cases) {
      const t = this.terrain[i];
      const hz = mulberry(i * 7919 + 13);
      let nb = t === 3 ? 9 : t === 7 ? 2 : t === 2 && hz() < 0.3 ? 2 : t === 4 && hz() < 0.45 ? 2 : 0;
      if (this.mobile) nb = Math.ceil(nb / 3);
      const [cx, cz] = this.pos(i);
      const nord = ((i / this.l) | 0) / this.h;
      for (let k = 0; k < nb; k++) {
        const a = hz() * Math.PI * 2, r = Math.sqrt(hz()) * 0.78;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = this.altitude(x, z);
        const conif = t === 7 || nord < 0.28 || h > 1.0 || (t === 3 && hz() < 0.25);
        const e = 0.6 + hz() * 0.65, rot = hz() * Math.PI * 2, c1 = hz(), c2 = hz(), c3 = hz();
        if (!(h > 0.08 && h < 1.6)) continue;
        const type = conif ? 0 : 1, ey = e * (type === 0 ? 1.15 : 1), cs = Math.cos(rot), sn = Math.sin(rot);
        if (type === 0) col.set(t === 7 ? '#2f5a46' : '#2b5a32');
        else col.set(['#3f7a35', '#4f8a3b', '#5d8f3a', '#466f2e', '#6b8f3c'][Math.floor(c1 * 5)]);
        col.offsetHSL((c2 - 0.5) * 0.03, 0, (c3 - 0.5) * 0.1);
        // Matrice (colonnes) : rotation autour de y, echelle, position.
        types[type].push([cs * e, 0, -sn * e, 0, 0, ey, 0, 0, sn * e, 0, cs * e, 0, x, h - 0.03, z, 1], [col.r, col.g, col.b], i);
      }
    }
    const arbres = types.map(l2 => {
      const nb = l2.length / 3, mat = new Float32Array(nb * 16), cou = new Float32Array(nb * 3), cs = new Int32Array(nb);
      for (let k = 0; k < nb; k++) { mat.set(l2[3 * k], 16 * k); cou.set(l2[3 * k + 1], 3 * k); cs[k] = l2[3 * k + 2]; }
      return { mat, cou, cas: cs };
    });
    return { sol, grille: new Float32Array(lignes), arbres };
  }
}

/** Tampons a transferer entre fils (sans copie). */
export function tampons(o, out = []) {
  if (!o) return out;
  if (ArrayBuffer.isView(o)) out.push(o.buffer);
  else if (Array.isArray(o)) o.forEach(x => tampons(x, out));
  else if (typeof o === 'object') Object.values(o).forEach(x => tampons(x, out));
  return out;
}
