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
// 3. Relief reel (altitude NASA, donnees/altitude-nasa.png) : montagnes la
//    ou la pente est forte, collines sur les plateaux et terrains vallonnes.
//    Deserts, forets et toundra places a la main d'apres le climat reel.
//
// 4. Pays reels (Natural Earth, countries-50m) : l'outre-mer est rattache
//    au pays qui le dirige (voir SOUVERAIN) ; capitales dans capitales.js,
//    noms francais du paquet world-countries.
//
// Sorties :
// - src/monde_reel.bin : en-tete "WFMONDE2", largeur u16, hauteur u16,
//   puis deux couches ligne par ligne en RLE (repetitions u8, valeur u8) :
//   les terrains, puis l'index du pays (0 = aucun). Le serveur (monde.rs)
//   la reechantillonne a la taille de carte voulue.
// - src/pays_reels.json : la liste des pays (index = position + 1).
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

// ── Rasterisation (equirectangulaire, 5' d'arc) ─────────────────────
const ML = 4320, MH = 2160;
function anneauxDe(geometrie) {
  const polys = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.type === 'MultiPolygon' ? geometrie.coordinates : [];
  return polys.flat();
}
// Remplit des anneaux (regle pair-impair) et appelle f(ligne, colonne)
// pour chaque pixel couvert. Les anneaux sont « deroules » : la longitude
// reste continue quand un contour traverse l'antimeridien (Tchoukotka,
// Fidji…), puis les colonnes sont repliees modulo 360°.
function remplir(anneaux, f) {
  const bascules = new Map(); // ligne -> colonnes ou la parite change
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
    const xsParLigne = new Map();
    for (let i = 0; i < r.length - 1; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[i + 1];
      if (y1 === y2) continue;
      const r1 = (90 - Math.max(y1, y2)) / 180 * MH - 0.5, r2 = (90 - Math.min(y1, y2)) / 180 * MH - 0.5;
      for (let l = Math.max(0, Math.ceil(r1)); l <= Math.min(MH - 1, Math.floor(r2)); l++) {
        const lat = 90 - (l + 0.5) / MH * 180;
        if ((y1 <= lat && y2 > lat) || (y2 <= lat && y1 > lat)) {
          if (!xsParLigne.has(l)) xsParLigne.set(l, []);
          xsParLigne.get(l).push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
        }
      }
    }
    for (const [l, xs] of xsParLigne) {
      xs.sort((a, b) => a - b);
      if (!bascules.has(l)) bascules.set(l, []);
      const b = bascules.get(l);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c1 = Math.ceil((xs[k] + 180) / 360 * ML - 0.5), c2 = Math.floor((xs[k + 1] + 180) / 360 * ML - 0.5);
        if (c2 >= c1) b.push(c1, c2 + 1);
      }
    }
  }
  for (const [l, b] of bascules) {
    b.sort((x, y) => x - y);
    for (let k = 0; k + 1 < b.length; k += 2) {
      for (let c = b[k]; c < b[k + 1]; c++) f(l, ((c % ML) + ML) % ML);
    }
  }
}
function masqueTerres() {
  const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'));
  const geo = topojson.feature(topo, topo.objects.land);
  const m = new Uint8Array(ML * MH);
  remplir((geo.features || [geo]).flatMap(f => anneauxDe(f.geometry)), (l, c) => { m[l * ML + c] = 1; });
  return m;
}

// ── Pays reels ──────────────────────────────────────────────────────
// Pays jouables : les Etats independants, plus Taiwan, la Palestine, le
// Kosovo et le Sahara occidental. L'outre-mer et les territoires
// rattaches appartiennent au pays qui les dirige.
const SOUVERAIN = {
  GL: 'DK', FO: 'DK', AX: 'FI', HK: 'CN', MO: 'CN',
  PR: 'US', VI: 'US', GU: 'US', AS: 'US', MP: 'US',
  GS: 'GB', IO: 'GB', SH: 'GB', PN: 'GB', AI: 'GB', FK: 'GB', KY: 'GB', BM: 'GB', VG: 'GB', TC: 'GB', MS: 'GB', JE: 'GB', GG: 'GB', IM: 'GB',
  NU: 'NZ', CK: 'NZ', AW: 'NL', CW: 'NL', SX: 'NL',
  PM: 'FR', WF: 'FR', MF: 'FR', BL: 'FR', PF: 'FR', NC: 'FR', TF: 'FR',
  HM: 'AU', NF: 'AU',
};
// Entites sans code ISO dans Natural Earth.
const SANS_CODE = { 'Somaliland': 'SO', 'Kosovo': 'XK', 'N. Cyprus': 'CY', 'Indian Ocean Ter.': 'AU', 'Siachen Glacier': 'IN' };
const AUSSI_JOUABLES = ['TW', 'PS', 'XK', 'EH'];
const NOMS = { CD: 'RD Congo', CG: 'Congo', KP: 'Corée du Nord', KR: 'Corée du Sud', VA: 'Vatican', PS: 'Palestine', EH: 'Sahara occidental' };

function paysReels() {
  const pays = require('world-countries');
  const capitales = require('./capitales.js');
  const parNum = new Map(pays.map(c => [c.ccn3, c]));
  const jouables = pays.filter(c => c.independent || AUSSI_JOUABLES.includes(c.cca2)).sort((a, b) => a.cca2.localeCompare(b.cca2));
  const index = new Map(jouables.map((c, i) => [c.cca2, i + 1]));
  const liste = jouables.map(c => {
    if (!capitales[c.cca2]) throw new Error('capitale manquante : ' + c.cca2);
    return { code: c.cca2, nom: NOMS[c.cca2] || c.translations.fra.common, capitale: capitales[c.cca2] };
  });
  const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
  const m = new Uint8Array(ML * MH);
  const sansPays = [];
  for (const f of topojson.feature(topo, topo.objects.countries).features) {
    let code = f.id ? parNum.get(f.id)?.cca2 : SANS_CODE[f.properties.name];
    if (code === 'AQ') continue;
    code = SOUVERAIN[code] || code;
    const k = index.get(code);
    if (!k) { sansPays.push(f.properties.name); continue; }
    remplir(anneauxDe(f.geometry), (l, c) => { m[l * ML + c] = k; });
  }
  if (sansPays.length) console.log('territoires sans pays jouable :', sansPays.join(', '));
  return { liste, masque: m };
}
const terre = (m, lon, lat) => {
  const c = Math.min(ML - 1, Math.max(0, Math.floor((lon + 180) / 360 * ML)));
  const l = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) / 180 * MH)));
  return m[l * ML + c] === 1;
};

// ── Altitude reelle (NASA, domaine public) ──────────────────────────
// donnees/altitude-nasa.png : relief terrestre de la NASA (Blue Marble
// topography, 2048 x 1024, equirectangulaire), repris du paquet npm
// three-globe (MIT). Niveau de gris ~ altitude : environ 24 m par niveau
// (Tibet ~200 = 4 800 m, Denver ~68 = 1 600 m).
const { PNG } = require('pngjs');
const ALT = (() => {
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'donnees', 'altitude-nasa.png')));
  const a = new Float32Array(png.width * png.height);
  for (let i = 0; i < a.length; i++) a[i] = png.data[i * 4] * 24;
  return { l: png.width, h: png.height, a };
})();
/** Altitude (m) en un point, interpolee. */
function altitude(lon, lat) {
  const x = ((lon + 180) / 360 * ALT.l - 0.5 + ALT.l) % ALT.l, y = Math.max(0, Math.min(ALT.h - 1.001, (90 - lat) / 180 * ALT.h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % ALT.l;
  const g = (xx, yy) => ALT.a[yy * ALT.l + xx];
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x1, y0 + 1) * fx) * fy;
}
/** Relief local (m) : ecart entre le point le plus haut et le plus bas
 *  dans un rayon d'environ 40 km. Fort = pentes raides (vraie montagne). */
function relief(lon, lat) {
  const d = 0.36, k = 1 / Math.max(0.2, Math.cos(lat * RAD));
  let min = Infinity, max = -Infinity;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const e = altitude(lon + dx * d * k, lat + dy * d);
    if (e < min) min = e;
    if (e > max) max = e;
  }
  return max - min;
}

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
function terrainDe(m, lon0, lat0) {
  if (!terre(m, lon0, lat0)) return OCEAN;
  // Coordonnees deformees : les zones ont des contours naturels, pas des
  // ellipses ou des tubes parfaits.
  const lon = lon0 + 7 * (fbm(lon0 / 9, lat0 / 9, 11) - 0.5);
  const lat = lat0 + 5 * (fbm(lon0 / 9 + 50, lat0 / 9 + 30, 13) - 0.5);
  const n = fbm(lon / 4, lat / 4, 1) - 0.5;   // frontieres irregulieres
  const n2 = fbm(lon / 2.5, lat / 2.5, 7);
  // Relief reel : montagne = pente forte (on ne peut pas y construire) ;
  // collines = terrain eleve ou vallonne mais praticable (Tibet, Altiplano,
  // Massif central…).
  const e = altitude(lon0, lat0), r = relief(lon0, lat0);
  const gro0 = lon0 > -75 && lon0 < -10 && lat0 > 59.5;
  if (!gro0) {
    if (r >= 1000 || (r >= 650 && e >= 1800)) return MONTAGNE;
    if (e >= 1100 || r >= 420) return COLLINE;
  }
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
const RW = 2048, RH = Math.round(RW * hauteurP / largeurP);

const masque = masqueTerres();
const { liste: PAYS, masque: masquePays } = paysReels();
const raster = new Uint8Array(RW * RH);
const rasterPays = new Uint8Array(RW * RH);
let terres = 0;
for (let r = 0; r < RH; r++) {
  const y = YN + MARGE * 2 * XMAX - (r + 0.5) / RH * hauteurP;
  for (let c = 0; c < RW; c++) {
    const x = -XMAX * (1 + 2 * MARGE) + (c + 0.5) / RW * largeurP;
    let t = OCEAN;
    if (y <= YN && y >= YS) {
      const [lon, lat] = inverse(x, y);
      if (Math.abs(lon) <= 180) {
        t = terrainDe(masque, lon, lat);
        if (t) {
          const mc = Math.min(ML - 1, Math.max(0, Math.floor((lon + 180) / 360 * ML)));
          const ml = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) / 180 * MH)));
          rasterPays[r * RW + c] = masquePays[ml * ML + mc];
          // Terre sans pays : la mer Caspienne (comptee comme terre dans
          // land-50m) ; elle redevient de l'eau.
          if (!rasterPays[r * RW + c]) t = OCEAN;
        }
      }
    }
    raster[r * RW + c] = t;
    if (t) terres++;
  }
}

// RLE ligne par ligne : les terrains, puis les pays.
const octets = [...Buffer.from('WFMONDE2'), RW & 255, RW >> 8, RH & 255, RH >> 8];
for (const couche of [raster, rasterPays]) {
  for (let r = 0; r < RH; r++) {
    let c = 0;
    while (c < RW) {
      const t = couche[r * RW + c];
      let n = 1;
      while (c + n < RW && n < 255 && couche[r * RW + c + n] === t) n++;
      octets.push(n, t);
      c += n;
    }
  }
}
// Liste des pays (index = position + 1) et capitale en coordonnees
// normalisees de la carte (0..1).
const u = x => (x + XMAX * (1 + 2 * MARGE)) / largeurP;
const v = y => (YN + MARGE * 2 * XMAX - y) / hauteurP;
const pays = PAYS.map(p => {
  const [x, y] = projeter(p.capitale[0], p.capitale[1]);
  return { code: p.code, nom: p.nom, capitale: [+u(x).toFixed(5), +v(y).toFixed(5)] };
});
fs.writeFileSync(path.join(__dirname, '..', '..', 'src', 'pays_reels.json'), JSON.stringify(pays, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${pays.length} pays jouables`);
const sortie = path.join(__dirname, '..', '..', 'src', 'monde_reel.bin');
fs.writeFileSync(sortie, Buffer.from(octets));
console.log(`${sortie} : ${RW} x ${RH}, ${(terres / (RW * RH) * 100).toFixed(1)} % de terres, ${octets.length} octets`);

// Apercu PNG-like en PPM (pour verifier a l'œil) si demande.
if (process.argv.includes('--apercu')) {
  const coul = { 0: [30, 79, 122], 2: [143, 191, 90], 3: [63, 125, 58], 4: [168, 161, 92], 5: [138, 129, 118], 6: [217, 194, 126], 7: [185, 198, 201] };
  const f = process.argv[process.argv.indexOf('--apercu') + 1];
  const ppm = Buffer.alloc(RW * RH * 3), ppm2 = Buffer.alloc(RW * RH * 3);
  for (let i = 0; i < RW * RH; i++) {
    const k = coul[raster[i]]; ppm[i * 3] = k[0]; ppm[i * 3 + 1] = k[1]; ppm[i * 3 + 2] = k[2];
    const p = rasterPays[i];
    const q = raster[i] ? (p ? [60 + hash(p, 1, 3) * 190, 60 + hash(p, 2, 3) * 190, 60 + hash(p, 3, 3) * 190] : [255, 0, 255]) : [30, 79, 122];
    ppm2[i * 3] = q[0]; ppm2[i * 3 + 1] = q[1]; ppm2[i * 3 + 2] = q[2];
  }
  fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${RW} ${RH} 255\n`), ppm]));
  fs.writeFileSync(f.replace(/(\.ppm)?$/, '-pays.ppm'), Buffer.concat([Buffer.from(`P6 ${RW} ${RH} 255\n`), ppm2]));
  console.log('apercus :', f);
}
