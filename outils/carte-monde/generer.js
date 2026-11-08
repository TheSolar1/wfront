// ══════════════════════════════════════════════════════════════════
// generer.js — Fabrique src/monde_reel.bin, la carte du monde reel.
//
//   cd outils/carte-monde && npm install && node generer.js
//
// 1. Terres : contours Natural Earth 1:50m (domaine public), via le
//    paquet npm world-atlas (land-50m.json).
// 2. Projection Equal Earth : surfaces respectees (l'Afrique est 14 fois
//    plus grande que le Groenland, comme en vrai), formes peu deformees.
//    Latitudes gardees : 56° S (Terre de Feu) a 83° N ; l'Antarctique
//    est retire.
// 3. Terrains : chaines de montagnes, deserts, forets et toundra places
//    a la main d'apres la geographie reelle (approximation de jeu).
//
// Sortie : en-tete "WFMONDE1", largeur u16, hauteur u16, puis les cases
// ligne par ligne en RLE (repetitions u8, code terrain u8). Le serveur
// (monde.rs) la reechantillonne a la taille de carte voulue.
// ══════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');

const OCEAN = 0, PLAINE = 2, FORET = 3, COLLINE = 4, MONTAGNE = 5, DESERT = 6, TOUNDRA = 7;
const RAD = Math.PI / 180;

// ── Projection Equal Earth (Savric, Patterson, Jenny 2018) ──────────
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function projeter(lon, lat) {
  const t = Math.asin(M * Math.sin(lat * RAD)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (lon * RAD) * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}
function inverse(x, y) {
  let t = y;
  for (let k = 0; k < 12; k++) {
    const t2 = t * t, t6 = t2 * t2 * t2;
    const f = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
    const d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    t -= f / d;
    if (Math.abs(f) < 1e-10) break;
  }
  const t2 = t * t, t6 = t2 * t2 * t2;
  const d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
  const lon = M * x * d / Math.cos(t) / RAD;
  const lat = Math.asin(Math.sin(t) / M) / RAD;
  return [lon, lat];
}

// ── Masque des terres (equirectangulaire, 5' d'arc) ─────────────────
const ML = 4320, MH = 2160;
function masqueTerres() {
  const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
  const geo = topojson.feature(topo, topo.objects.land);
  const anneaux = [];
  for (const f of geo.features || [geo]) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const r of p) anneaux.push(r);
  }
  // Anneaux « deroules » : la longitude reste continue quand un contour
  // traverse l'antimeridien (Tchoukotka, Fidji…), puis chaque anneau est
  // rempli separement (pair-impair) et replie modulo 360°.
  const m = new Uint8Array(ML * MH);
  for (const brut of anneaux) {
    const r = [];
    let decal = 0;
    for (let i = 0; i < brut.length; i++) {
      if (i > 0) {
        const d = brut[i][0] - brut[i - 1][0];
        if (d > 180) decal -= 360; else if (d < -180) decal += 360;
      }
      r.push([brut[i][0] + decal, brut[i][1]]);
    }
    const parLigne = new Map();
    for (let i = 0; i < r.length - 1; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[i + 1];
      if (y1 === y2) continue;
      const r1 = (90 - Math.max(y1, y2)) / 180 * MH - 0.5, r2 = (90 - Math.min(y1, y2)) / 180 * MH - 0.5;
      for (let l = Math.max(0, Math.ceil(r1)); l <= Math.min(MH - 1, Math.floor(r2)); l++) {
        const lat = 90 - (l + 0.5) / MH * 180;
        if ((y1 <= lat && y2 > lat) || (y2 <= lat && y1 > lat)) {
          if (!parLigne.has(l)) parLigne.set(l, []);
          parLigne.get(l).push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
        }
      }
    }
    for (const [l, xs] of parLigne) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c1 = Math.ceil((xs[k] + 180) / 360 * ML - 0.5), c2 = Math.floor((xs[k + 1] + 180) / 360 * ML - 0.5);
        for (let c = c1; c <= c2; c++) m[l * ML + (((c % ML) + ML) % ML)] ^= 1;
      }
    }
  }
  return m;
}
const terre = (m, lon, lat) => {
  const c = Math.min(ML - 1, Math.max(0, Math.floor((lon + 180) / 360 * ML)));
  const l = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) / 180 * MH)));
  return m[l * ML + c] === 1;
};

// ── Bruit (frontieres naturelles entre les zones) ───────────────────
function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function bruit(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => (bruit(x, y, s) + 0.5 * bruit(x * 2.1, y * 2.1, s + 1) + 0.25 * bruit(x * 4.3, y * 4.3, s + 2)) / 1.75;

// ── Geographie (approximative, a l'echelle d'un jeu) ────────────────
// Chaines : [epaisseur en degres, [lon, lat], ...]. Le cœur est montagneux,
// la bordure (2,2 x) en collines.
const CHAINES = [
  [2.2, [73, 35.5], [78, 32.5], [84, 28.8], [88, 27.9], [92, 27.8], [95.5, 28.8]],          // Himalaya
  [1.8, [67, 35], [71, 36.5], [75, 36.2], [75, 39], [72, 39]],                               // Hindou Kouch, Karakoram, Pamir
  [1.5, [69, 42], [76, 42], [82, 43], [88, 43.3], [94, 43]],                                 // Tian Shan
  [1.3, [84, 50], [88, 49], [92, 48], [97, 46.5]],                                           // Altai
  [1.2, [96, 52], [101, 51.5], [106, 50.5]],                                                 // Saian
  [1.5, [45, 36.5], [47.5, 34], [51, 31], [54, 29], [57, 27.5]],                             // Zagros
  [0.9, [48, 37], [51, 36.3], [55, 36.8], [59, 37]],                                         // Elbourz, Kopet-Dag
  [1.0, [37.5, 44.5], [41, 43.3], [45, 42.5], [49, 41]],                                     // Caucase
  [1.1, [5.5, 44.3], [7, 45.8], [9, 46.4], [11.5, 46.9], [14.5, 47.2]],                      // Alpes
  [0.6, [-1.8, 43], [0.5, 42.7], [3, 42.5]],                                                 // Pyrenees
  [0.7, [-8, 42.5], [-5, 40.5], [-3.5, 37.2]],                                               // Meseta, Sierra Nevada
  [0.8, [14.5, 45.5], [17, 44], [19.5, 42.5], [21.5, 41], [22, 39.5]],                       // Dinarides, Pinde
  [0.8, [18, 49.3], [22, 49], [25, 47.6], [25.5, 45.5], [22.5, 45]],                         // Carpates
  [0.7, [9.5, 44.3], [12.5, 43], [15, 41], [16, 39]],                                        // Apennins
  [1.2, [5.5, 59], [8.5, 61.5], [12.5, 64.5], [16.5, 67.5], [20, 69.3]],                     // Alpes scandinaves
  [1.0, [59, 51], [59, 56], [59.5, 61], [61, 65], [65, 68]],                                 // Oural
  [1.3, [-9, 30.8], [-6, 32.2], [-2, 33.8], [2, 35], [6, 35.6], [9, 36.2]],                   // Atlas
  [1.0, [36, 0.5], [35.5, -4], [34.5, -8.5]],                                                // Rift est-africain
  [0.9, [27.5, -30.5], [29.5, -28.5], [31, -25.5]],                                          // Drakensberg
  [3.0, [-152, 62.5], [-142, 61.5], [-133, 59.5], [-125, 55], [-118, 50], [-113, 46.5], [-110, 43.5], [-107.5, 39.5], [-106, 35.5]], // Rocheuses
  [1.0, [-121.5, 49], [-121.5, 45], [-120.5, 40.5], [-118.5, 36.5]],                          // Cascades, Sierra Nevada
  [1.5, [-109, 29], [-105, 25], [-102, 21.5], [-98, 18.5], [-95.5, 17]],                     // Sierra Madre
  [1.0, [-91.5, 15.5], [-87, 14], [-84.5, 11], [-83, 9]],                                    // Amerique centrale
  [2.0, [-73, 10.5], [-76, 6], [-77.5, 2], [-78.5, -2], [-77, -8], [-74, -13], [-70.5, -16.5], [-68, -20], [-67.5, -24], [-69.5, -28], [-70, -33], [-71, -38], [-72, -44], [-73, -49], [-72, -52.5]], // Andes
  [1.1, [-85, 34], [-82, 36.5], [-79, 39.5], [-76, 41.5], [-73.5, 43.5], [-70, 45.5]],       // Appalaches
  [1.1, [145.5, -16], [147, -21], [149.5, -26.5], [150.5, -31.5], [148.5, -36], [146.5, -37.5]], // Cordillere australienne
  [0.8, [167.5, -45.5], [170.5, -43.5], [172.5, -41.5]],                                     // Alpes neo-zelandaises
  [1.0, [136.5, 35], [138, 36.5], [140, 38.5], [141, 41]],                                   // Alpes japonaises
  [1.6, [127, 66.5], [130, 63], [137, 62.5], [145, 63.5], [155, 63], [163, 63]],             // Verkhoiansk, Tcherski, Kolyma
  [1.0, [157, 52.5], [159.5, 56], [161, 59]],                                                // Kamtchatka
  [1.0, [-161, 68], [-152, 68.3], [-143, 68.8]],                                             // Chaine de Brooks
  [0.9, [-66, 58], [-63, 55], [-61, 52]],                                                    // Labrador
  [1.0, [99, 25], [99, 20], [98.5, 15]],                                                     // Monts Shan, Arakan
  [1.0, [103, 30], [102.5, 26.5]],                                                           // Hengduan
  [0.8, [100.5, 5], [102, 2.5]],                                                             // Malaisie
];
// Plateaux et massifs : [lon, lat, rayon lon, rayon lat, terrain].
const MASSIFS = [
  [88, 33.5, 13, 4.5, MONTAGNE],   // Tibet
  [39, 10, 4.5, 5, MONTAGNE],      // Hauts plateaux ethiopiens
  [35, 39, 7, 2.3, COLLINE],       // Anatolie
  [56, 32.5, 9, 4, COLLINE],       // Plateau iranien
  [69, 34, 4, 3, MONTAGNE],        // Afghanistan
  [-45, -17, 7, 7, COLLINE],       // Plateau bresilien
  [-104, 40, 6, 9, COLLINE],       // Grandes Plaines hautes / Colorado
  [-113, 38, 5, 5, COLLINE],       // Grand Bassin
  [100, 46, 9, 3, COLLINE],        // Mongolie
  [78, 18, 5, 6, COLLINE],         // Deccan
  [-102, 23, 4, 4, COLLINE],       // Plateau mexicain
  [-67, -21, 3, 4, MONTAGNE],      // Altiplano
  [126, 41, 4, 3, COLLINE],        // Coree du Nord, Mandchourie
  [107, 27, 5, 3, COLLINE],        // Yunnan-Guizhou
  [18, -21, 5, 5, COLLINE],        // Plateau namibien
  [29, -13, 6, 4, COLLINE],        // Plateau d'Afrique australe
  [22, 6, 7, 3, COLLINE],          // Dorsale centrafricaine
  [-3, 54.8, 1.5, 2.5, COLLINE],   // Ecosse, nord de l'Angleterre
  [134, 48, 4, 3, COLLINE],        // Sikhote-Aline
];
// Deserts : [lon, lat, rayon lon, rayon lat].
const DESERTS = [
  [10, 23, 23, 8.5],   // Sahara
  [-12, 22, 4, 5],     // Sahara atlantique
  [47, 22.5, 9, 7],    // Arabie
  [41, 32, 5, 3],      // Syrie, Irak
  [58, 32, 6, 4],      // Dasht-e Kavir, Lout
  [64, 29, 5, 2.5],    // Baloutchistan
  [71, 27, 4, 3],      // Thar
  [61, 41, 8, 4],      // Karakoum, Kyzylkoum
  [83, 39.5, 7, 3],    // Taklamakan
  [104, 42.5, 12, 4],  // Gobi
  [21, -23, 6, 5.5],   // Kalahari
  [15, -22, 2, 7],     // Namib
  [128, -25, 15, 7.5], // Deserts australiens
  [-70, -24, 2, 7],    // Atacama
  [-113, 32.5, 7, 4.5],// Mojave, Sonora, Chihuahua
  [47, 7, 5, 4],       // Corne de l'Afrique
  [-68, -45, 3, 5],    // Patagonie
  [52, 46, 6, 2.5],    // Caspienne nord
];
// Forets : [lon, lat, rayon lon, rayon lat].
const FORETS = [
  [-62, -5, 16, 9.5],  // Amazonie
  [20, 0, 10, 6],      // Congo
  [-6, 7, 9, 3],       // Golfe de Guinee
  [102, 13, 7, 10],    // Indochine
  [115, -1, 26, 7.5],  // Insulinde, Nouvelle-Guinee
  [-86, 13, 7, 6],     // Amerique centrale
  [48, -18, 2.5, 6],   // Madagascar est
  [92, 25, 5, 3.5],    // Nord-est de l'Inde, Birmanie
  [112, 26, 9, 5],     // Chine du Sud
  [-82, 38, 11, 9],    // Est des Etats-Unis
  [16, 50, 13, 5],     // Europe centrale
  [-123, 48, 4, 7],    // Cote pacifique nord-americaine
  [136, 37, 8, 6],     // Japon, Coree
  [-73, -43, 3, 7],    // Sud du Chili
  [-50, -27, 5, 4],    // Foret atlantique bresilienne
  [150.5, -30, 3, 9],  // Cote est australienne
  [172, -42, 4, 6],    // Nouvelle-Zelande
  [-74, 4, 4, 5],      // Colombie
];
// Steppes (pas de foret boreale) : [lon, lat, rayon lon, rayon lat].
const STEPPES = [[65, 49, 20, 4.5], [40, 47, 10, 3], [-100, 50, 12, 4]];

function dans(e, lon, lat, marge = 0) {
  const dx = (lon - e[0]) / (e[2] * (1 + marge)), dy = (lat - e[1]) / (e[3] * (1 + marge));
  return dx * dx + dy * dy < 1;
}
function distSegment(px, py, ax, ay, bx, by) {
  const k = Math.cos(py * RAD); // degres de longitude plus courts vers les poles
  const vx = (bx - ax) * k, vy = by - ay, wx = (px - ax) * k, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(wx - t * vx, wy - t * vy);
}
function relief(lon, lat) {
  let best = Infinity;
  for (const [ep, ...pts] of CHAINES) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = distSegment(lon, lat, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) / ep;
      if (d < best) best = d;
    }
  }
  return best; // < 1 : cœur montagneux ; < 2,2 : collines
}

function terrainDe(m, lon0, lat0) {
  if (!terre(m, lon0, lat0)) return OCEAN;
  // Coordonnees deformees : les zones ont des contours naturels, pas des
  // ellipses ou des tubes parfaits.
  const lon = lon0 + 7 * (fbm(lon0 / 9, lat0 / 9, 11) - 0.5);
  const lat = lat0 + 5 * (fbm(lon0 / 9 + 50, lat0 / 9 + 30, 13) - 0.5);
  const n = fbm(lon / 4, lat / 4, 1) - 0.5;   // frontieres irregulieres
  const n2 = fbm(lon / 2.5, lat / 2.5, 7);
  const d = relief(lon, lat) * (1 + 0.5 * n);
  if (d < 1) return MONTAGNE;
  for (const ms of MASSIFS) {
    if (dans(ms, lon, lat, n * 0.4)) return ms[4] === MONTAGNE && n2 < 0.35 ? COLLINE : ms[4];
  }
  if (d < 2.2) return COLLINE;
  // Groenland, grand nord, sud de la Patagonie
  const gro = lon0 > -75 && lon0 < -10 && lat0 > 59.5;
  if (gro || lat0 > 66 + 4 * n || lat0 < -52) return TOUNDRA;
  if (DESERTS.some(e => dans(e, lon, lat, n * 0.5))) return DESERT;
  if (FORETS.some(e => dans(e, lon, lat, n * 0.5))) return n2 > 0.72 ? PLAINE : FORET;
  // Foret boreale entre 50 et 66 N, sauf steppes
  if (lat > 50 + 3 * n && !STEPPES.some(e => dans(e, lon, lat, n * 0.5))) return n2 > 0.78 ? PLAINE : FORET;
  return n2 > 0.74 ? FORET : PLAINE;
}

// ── Raster final, dans la projection ────────────────────────────────
const LAT_N = 83, LAT_S = -56, MARGE = 0.02;
const XMAX = projeter(180, 0)[0];
const YN = projeter(0, LAT_N)[1], YS = projeter(0, LAT_S)[1];
const largeurP = 2 * XMAX * (1 + 2 * MARGE), hauteurP = (YN - YS) + 2 * MARGE * 2 * XMAX;
const RW = 1440, RH = Math.round(RW * hauteurP / largeurP);

const masque = masqueTerres();
const raster = new Uint8Array(RW * RH);
let terres = 0;
for (let r = 0; r < RH; r++) {
  const y = YN + MARGE * 2 * XMAX - (r + 0.5) / RH * hauteurP;
  for (let c = 0; c < RW; c++) {
    const x = -XMAX * (1 + 2 * MARGE) + (c + 0.5) / RW * largeurP;
    let t = OCEAN;
    if (y <= YN && y >= YS) {
      const [lon, lat] = inverse(x, y);
      if (Math.abs(lon) <= 180) t = terrainDe(masque, lon, lat);
    }
    raster[r * RW + c] = t;
    if (t) terres++;
  }
}

// RLE ligne par ligne
const octets = [...Buffer.from('WFMONDE1'), RW & 255, RW >> 8, RH & 255, RH >> 8];
for (let r = 0; r < RH; r++) {
  let c = 0;
  while (c < RW) {
    const t = raster[r * RW + c];
    let n = 1;
    while (c + n < RW && n < 255 && raster[r * RW + c + n] === t) n++;
    octets.push(n, t);
    c += n;
  }
}
const sortie = path.join(__dirname, '..', '..', 'src', 'monde_reel.bin');
fs.writeFileSync(sortie, Buffer.from(octets));
console.log(`${sortie} : ${RW} x ${RH}, ${(terres / (RW * RH) * 100).toFixed(1)} % de terres, ${octets.length} octets`);

// Apercu PNG-like en PPM (pour verifier a l'œil) si demande.
if (process.argv.includes('--apercu')) {
  const coul = { 0: [30, 79, 122], 2: [143, 191, 90], 3: [63, 125, 58], 4: [168, 161, 92], 5: [138, 129, 118], 6: [217, 194, 126], 7: [185, 198, 201] };
  const ppm = Buffer.alloc(RW * RH * 3);
  for (let i = 0; i < RW * RH; i++) { const k = coul[raster[i]]; ppm[i * 3] = k[0]; ppm[i * 3 + 1] = k[1]; ppm[i * 3 + 2] = k[2]; }
  const f = process.argv[process.argv.indexOf('--apercu') + 1];
  fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${RW} ${RH} 255\n`), ppm]));
  console.log('apercu :', f);
}
