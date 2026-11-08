// ══════════════════════════════════════════════════════════════════
// modeles.js — Modèles 3D détaillés des bâtiments
// Chaque bâtiment est assemblé à partir de formes simples (façades à
// fenêtres, toits, cuves, tuyaux, véhicules, arbres…), puis fusionné en
// UNE géométrie à couleurs de sommets : un seul objet à dessiner par
// bâtiment, même avec des centaines de bâtiments sur la carte. Les
// parties « pays » (drapeaux, toits officiels) prennent la couleur de la
// nation. Une case fait 1 de rayon ; les modèles tiennent dans un disque
// d'environ 0,34 de rayon, posés sur une petite dalle.
// ══════════════════════════════════════════════════════════════════
import * as THREE from '../vendor/three.module.min.js';

const C = {
  // Murs et sols
  pierre: '#e3dccb', creme: '#efe8d6', brique: '#a8553c', beton: '#bdbab3', betonFonce: '#8f8c86', dalle: '#a9a69f',
  asphalte: '#3d4148', gravier: '#9b9182', terre: '#8a6f52', terreClaire: '#b39a74', herbe: '#6f9a45', sable: '#d8c38f',
  // Toits
  tuile: '#b5523b', ardoise: '#4a5260', toleGris: '#8e979f', toleBleu: '#5b7896', toleVert: '#5e7d57',
  // Matériaux
  vitre: '#2f4e66', vitreClair: '#7fb6d1', metal: '#b9c3ca', acier: '#7c868e', sombre: '#40464e', noir: '#25292e',
  bois: '#86643f', blanc: '#f4f3ef', jaune: '#e8b923', orange: '#e07b24', rouge: '#b83228', vertMil: '#5c6b3c', kaki: '#8b8a5c',
  or: '#d2a332', violet: '#8e44ad', uranium: '#9ccf3c', lave: '#e2552d', feuille: '#3f7d3a', feuilleClaire: '#5d9a43', tronc: '#6b4a2b',
  conteneurs: ['#c0392b', '#2471a3', '#d68910', '#1e8449', '#7d3c98', '#b3b6b7'],
};
const PAYS = 'pays'; // remplacé par la couleur de la nation

// ── Assemblage ────────────────────────────────────────────────────
function piece(geo, couleur, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  g.userData.couleur = couleur;
  return g;
}

/** Déplace et tourne un groupe de pièces déjà construites (autour de l'axe vertical). */
function placer(pieces, x = 0, z = 0, ry = 0, y = 0) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  m.setPosition(x, y, z);
  for (const g of pieces) {
    const c = g.userData.couleur;
    g.applyMatrix4(m);
    g.userData.couleur = c;
  }
  return pieces;
}

function fusionner(pieces, couleurPays) {
  let n = 0;
  for (const g of pieces) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  let k = 0;
  for (const g of pieces) {
    c.set(g.userData.couleur === PAYS ? couleurPays : g.userData.couleur);
    c.convertSRGBToLinear();
    const p = g.attributes.position, q = g.attributes.normal;
    for (let i = 0; i < p.count; i++, k++) {
      pos[k * 3] = p.getX(i); pos[k * 3 + 1] = p.getY(i); pos[k * 3 + 2] = p.getZ(i);
      nor[k * 3] = q.getX(i); nor[k * 3 + 1] = q.getY(i); nor[k * 3 + 2] = q.getZ(i);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// ── Formes de base (posées sur le sol : y = 0 en bas) ─────────────
const boite = (l, h, p, coul, x = 0, y = 0, z = 0, ry = 0) => piece(new THREE.BoxGeometry(l, h, p), coul, x, y + h / 2, z, ry);
const cyl = (rh, rb, h, coul, x = 0, y = 0, z = 0, seg = 10) => piece(new THREE.CylinderGeometry(rh, rb, h, seg), coul, x, y + h / 2, z);
const cone = (r, h, coul, x = 0, y = 0, z = 0, seg = 10, ry = 0) => piece(new THREE.ConeGeometry(r, h, seg), coul, x, y + h / 2, z, ry);
const boule = (r, coul, x = 0, y = 0, z = 0, seg = 10) => piece(new THREE.SphereGeometry(r, seg, Math.max(4, seg * 0.6 | 0)), coul, x, y, z);
const dome = (r, coul, x = 0, y = 0, z = 0, seg = 12) => piece(new THREE.SphereGeometry(r, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2), coul, x, y, z);
/** Toit à deux pans (faîtage selon x), posé à la hauteur y. */
function toit2(l, h, p, coul, x = 0, y = 0, z = 0, ry = 0) {
  const s = new THREE.Shape();
  s.moveTo(-p / 2, 0); s.lineTo(p / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: l, bevelEnabled: false });
  g.translate(0, 0, -l / 2);
  g.rotateY(Math.PI / 2);
  return piece(g, coul, x, y, z, ry);
}
/** Cylindre entre deux points (tuyaux, poutres, câbles). */
function barre(a, b, r, coul, seg = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = va.clone().add(vb).multiplyScalar(0.5);
  return piece(g, coul, m.x, m.y, m.z);
}

// ── Éléments détaillés ────────────────────────────────────────────
/** Dalle de sol (béton, gravier, herbe…). */
const dalle = (l, p, coul = C.dalle, x = 0, z = 0, ry = 0) => boite(l, 0.012, p, coul, x, 0, z, ry);
const dalleRonde = (r, coul = C.dalle, x = 0, z = 0) => cyl(r, r, 0.012, coul, x, 0, z, 16);

/** Rangées de fenêtres sur les 4 faces d'un bloc l x h x p (centré en x,z, base y). */
function fenetres(l, h, p, x, y, z, etages, colonnes, coul = C.vitre, rdc = 0) {
  const out = [];
  const he = (h - rdc) / etages, fw = Math.min(0.045, l / colonnes * 0.55), fh = he * 0.5;
  for (let e = 0; e < etages; e++) {
    const fy = y + rdc + he * e + he * 0.3;
    for (let c = 0; c < colonnes; c++) {
      const fx = x - l / 2 + (c + 0.5) * l / colonnes;
      out.push(boite(fw, fh, 0.006, coul, fx, fy, z + p / 2 + 0.002), boite(fw, fh, 0.006, coul, fx, fy, z - p / 2 - 0.002));
    }
    const cp = Math.max(1, Math.round(colonnes * p / l));
    for (let c = 0; c < cp; c++) {
      const fz = z - p / 2 + (c + 0.5) * p / cp;
      out.push(boite(0.006, fh, Math.min(0.045, p / cp * 0.55), coul, x + l / 2 + 0.002, fy, fz), boite(0.006, fh, Math.min(0.045, p / cp * 0.55), coul, x - l / 2 - 0.002, fy, fz));
    }
  }
  return out;
}
/** Immeuble : bloc, fenêtres, acrotère et équipements de toit. */
function immeuble(l, h, p, mur, x = 0, z = 0, etages = 4, opts = {}) {
  const col = Math.max(2, Math.round(l / 0.05));
  const out = [boite(l, h, p, mur, x, 0, z), ...fenetres(l, h, p, x, 0, z, etages, col, opts.vitre || C.vitre, opts.rdc || 0)];
  out.push(boite(l + 0.008, 0.012, p + 0.008, opts.toit || C.betonFonce, x, h, z));
  if (opts.clim !== false) out.push(boite(Math.min(0.05, l * 0.3), 0.02, Math.min(0.04, p * 0.3), C.metal, x + l * 0.2, h + 0.012, z - p * 0.15));
  if (opts.porte) out.push(boite(0.035, 0.05, 0.006, C.sombre, x, 0, z + p / 2 + 0.003));
  return out;
}
/** Maison : murs, toit à deux pans, porte, fenêtres, cheminée. */
function maison(l, h, p, mur = C.creme, toit = C.tuile, x = 0, z = 0, ry = 0) {
  const out = [
    boite(l, h, p, mur), toit2(l + 0.02, p * 0.45, p + 0.025, toit, 0, h, 0),
    boite(0.022, 0.04, 0.005, C.bois, 0, 0, p / 2 + 0.002),
    boite(0.022, 0.02, 0.005, C.vitre, -l * 0.3, h * 0.45, p / 2 + 0.002), boite(0.022, 0.02, 0.005, C.vitre, l * 0.3, h * 0.45, p / 2 + 0.002),
    boite(0.016, p * 0.4, 0.016, C.brique, l * 0.28, h + p * 0.1, -p * 0.15),
  ];
  return placer(out, x, z, ry);
}
/** Arbre feuillu ou conifère. */
function arbre(x, z, s = 1, conifere = false) {
  return conifere
    ? [cyl(0.006 * s, 0.008 * s, 0.03 * s, C.tronc, x, 0, z, 5), cone(0.035 * s, 0.09 * s, C.feuille, x, 0.02 * s, z, 7), cone(0.026 * s, 0.06 * s, C.feuille, x, 0.065 * s, z, 7)]
    : [cyl(0.006 * s, 0.009 * s, 0.035 * s, C.tronc, x, 0, z, 5), boule(0.032 * s, C.feuilleClaire, x, 0.06 * s, z, 7), boule(0.022 * s, C.feuille, x + 0.012 * s, 0.08 * s, z - 0.008 * s, 6)];
}
/** Cuve cylindrique : corps, toit bombé, cerclages, échelle. */
function cuve(r, h, coul, x, z, toitCoul = coul) {
  return [
    cyl(r, r, h, coul, x, 0, z, 14), dome(r * 1.01, toitCoul, x, h, z, 14),
    cyl(r * 1.02, r * 1.02, 0.006, C.acier, x, h * 0.33, z, 14), cyl(r * 1.02, r * 1.02, 0.006, C.acier, x, h * 0.66, z, 14),
    boite(0.006, h, 0.012, C.acier, x + r + 0.004, 0, z),
  ];
}
/** Sphère de stockage sur pieds (gaz). */
function sphereGaz(r, x, z) {
  const out = [boule(r, C.blanc, x, r + 0.03, z, 12)];
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; out.push(barre([x + Math.cos(a) * r * 0.8, 0, z + Math.sin(a) * r * 0.8], [x + Math.cos(a) * r * 0.75, r + 0.03, z + Math.sin(a) * r * 0.75], 0.004, C.acier, 4)); }
  return out;
}
/** Cheminée d'usine à bandes. */
function cheminee(r, h, x, z, bandes = true) {
  const out = [cyl(r * 0.75, r, h, C.beton, x, 0, z, 10)];
  if (bandes) for (const t of [0.72, 0.86]) out.push(cyl(r * 0.79, r * 0.79, h * 0.06, C.rouge, x, h * t, z, 10));
  out.push(cyl(r * 0.8, r * 0.8, 0.008, C.sombre, x, h, z, 10));
  return out;
}
/** Tour de refroidissement hyperbolique (révolution). */
function tourRefroid(r, h, x, z) {
  const pts = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(r * (0.62 + 0.38 * Math.pow(Math.abs(t - 0.62) / 0.62, 1.6)), t * h)); }
  const g = new THREE.LatheGeometry(pts, 16);
  return [piece(g, C.beton, x, 0, z), cyl(r * 0.98, r * 0.98, 0.004, C.betonFonce, x, h * 0.02, z, 16)];
}
/** Clôture rectangulaire (poteaux + lisses). */
function cloture(l, p, x = 0, z = 0, coul = C.acier, porteLargeur = 0) {
  const out = [], h = 0.03;
  const cotes = [[[-l / 2, -p / 2], [l / 2, -p / 2]], [[l / 2, -p / 2], [l / 2, p / 2]], [[l / 2, p / 2], [porteLargeur / 2, p / 2]], [[-porteLargeur / 2, p / 2], [-l / 2, p / 2]], [[-l / 2, p / 2], [-l / 2, -p / 2]]];
  for (const [[ax, az], [bx, bz]] of cotes) {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const n = Math.max(1, Math.round(L / 0.06));
    for (let k = 0; k <= n; k++) out.push(boite(0.005, h, 0.005, coul, x + ax + (bx - ax) * k / n, 0, z + az + (bz - az) * k / n));
    out.push(barre([x + ax, h * 0.9, z + az], [x + bx, h * 0.9, z + bz], 0.0025, coul, 4), barre([x + ax, h * 0.45, z + az], [x + bx, h * 0.45, z + bz], 0.0025, coul, 4));
  }
  return out;
}
/** Mât et drapeau aux couleurs du pays. */
const drapeau = (x, y, z, h = 0.22) => [cyl(0.004, 0.005, h, C.metal, x, y, z, 5), boite(0.08, 0.05, 0.004, PAYS, x + 0.04, y + h - 0.055, z), boule(0.007, C.or, x, y + h, z, 5)];
/** Camion (cabine + benne). */
function camion(x, z, ry = 0, benne = C.jaune) {
  return placer([
    boite(0.05, 0.03, 0.035, benne, -0.012, 0.008, 0), boite(0.022, 0.028, 0.033, C.blanc, 0.026, 0.008, 0), boite(0.004, 0.012, 0.026, C.vitre, 0.038, 0.02, 0),
    ...[-0.03, -0.004, 0.026].flatMap(dx => [piece(new THREE.CylinderGeometry(0.009, 0.009, 0.04, 8), C.noir, dx, 0.009, 0, 0, Math.PI / 2, 0)]),
  ], x, z, ry);
}
/** Voiture. */
function voiture(x, z, ry = 0, coul = C.rouge) {
  return placer([boite(0.036, 0.012, 0.018, coul, 0, 0.005, 0), boite(0.02, 0.01, 0.016, coul, -0.002, 0.017, 0), boite(0.021, 0.006, 0.017, C.vitre, -0.002, 0.019, 0)], x, z, ry);
}
/** Conteneur maritime. */
const conteneur = (x, y, z, coul, ry = 0) => [boite(0.06, 0.024, 0.024, coul, x, y, z, ry), boite(0.062, 0.003, 0.026, C.acier, x, y + 0.024, z, ry)];
/** Tas de minerai / gravier. */
const tas = (r, h, coul, x, z) => cone(r, h, coul, x, 0, z, 9);
/** Char d'assaut (caisse, tourelle, canon, chenilles). */
function char(x, z, ry = 0, coul = C.vertMil) {
  return placer([
    boite(0.07, 0.016, 0.04, coul, 0, 0.012, 0), boite(0.072, 0.014, 0.01, C.noir, 0, 0.004, 0.019), boite(0.072, 0.014, 0.01, C.noir, 0, 0.004, -0.019),
    cyl(0.014, 0.017, 0.012, coul, -0.004, 0.028, 0, 8), piece(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 6), C.sombre, 0.03, 0.035, 0, 0, 0, Math.PI / 2),
  ], x, z, ry);
}
/** Petit avion de ligne / chasseur. */
function avion(x, z, ry = 0, coul = C.blanc) {
  return placer([
    piece(new THREE.CylinderGeometry(0.009, 0.007, 0.12, 8), coul, 0, 0.02, 0, 0, 0, Math.PI / 2),
    piece(new THREE.ConeGeometry(0.009, 0.02, 8), coul, 0.07, 0.02, 0, 0, 0, -Math.PI / 2),
    boite(0.03, 0.003, 0.11, coul, -0.005, 0.017, 0), boite(0.018, 0.003, 0.04, coul, -0.05, 0.021, 0), boite(0.018, 0.025, 0.003, PAYS, -0.052, 0.022, 0),
  ], x, z, ry);
}
/** Grue à tour. */
function grue(x, z, h = 0.3, ry = 0) {
  const out = [boite(0.012, h, 0.012, C.jaune, 0, 0, 0)];
  for (let k = 1; k < 6; k++) out.push(barre([-0.006, h * k / 6, -0.006], [0.006, h * (k + 0.5) / 6, 0.006], 0.0015, C.jaune, 3));
  out.push(boite(0.18, 0.01, 0.01, C.jaune, 0.05, h, 0), boite(0.025, 0.02, 0.02, C.betonFonce, -0.035, h - 0.02, 0), barre([0.12, h, 0], [0.12, h * 0.55, 0], 0.0012, C.noir, 3));
  return placer(out, x, z, ry);
}

// ── Modèles ───────────────────────────────────────────────────────
const MODELES = {
  // Palais présidentiel : corps central à coupole, portique à colonnes,
  // ailes à fenêtres, parvis, jardins et mât.
  capitale: () => [
    dalle(0.66, 0.6, C.pierre), dalle(0.2, 0.2, C.herbe, -0.22, 0.2), dalle(0.2, 0.2, C.herbe, 0.22, 0.2),
    ...immeuble(0.2, 0.13, 0.17, C.pierre, -0.19, -0.06, 3, { clim: false, toit: C.ardoise }),
    ...immeuble(0.2, 0.13, 0.17, C.pierre, 0.19, -0.06, 3, { clim: false, toit: C.ardoise }),
    ...immeuble(0.2, 0.17, 0.22, C.creme, 0, -0.06, 3, { clim: false, toit: C.ardoise }),
    boite(0.2, 0.012, 0.07, C.pierre, 0, 0, 0.085), boite(0.18, 0.012, 0.06, C.pierre, 0, 0.012, 0.08),
    ...[-0.075, -0.045, -0.015, 0.015, 0.045, 0.075].map(x => cyl(0.007, 0.008, 0.13, C.blanc, x, 0.024, 0.1, 8)),
    toit2(0.07, 0.04, 0.19, C.creme, 0, 0.154, 0.09, Math.PI / 2),
    cyl(0.055, 0.06, 0.05, C.creme, 0, 0.17, -0.06, 16), ...fenetres(0.08, 0.05, 0.08, 0, 0.17, -0.06, 1, 4, C.vitre),
    dome(0.058, PAYS, 0, 0.22, -0.06, 16), cyl(0.006, 0.006, 0.03, C.or, 0, 0.275, -0.06, 6), boule(0.008, C.or, 0, 0.31, -0.06, 6),
    ...drapeau(0, 0, 0.25, 0.2), ...arbre(-0.27, 0.22, 1.1), ...arbre(0.27, 0.22, 1.1), ...arbre(-0.18, 0.25), ...arbre(0.18, 0.25),
  ],
  // Quartier urbain : tours de bureaux, immeubles, maisons, rues, voitures.
  ville: () => [
    dalle(0.66, 0.6, C.dalle), boite(0.66, 0.013, 0.05, C.asphalte, 0, 0, 0.05), boite(0.05, 0.013, 0.6, C.asphalte, 0.02, 0, 0),
    ...immeuble(0.12, 0.42, 0.12, C.vitreClair, -0.12, -0.13, 12, { vitre: C.vitre, toit: C.sombre }),
    ...immeuble(0.1, 0.3, 0.1, C.beton, 0.15, -0.16, 9),
    ...immeuble(0.14, 0.18, 0.1, C.brique, -0.17, 0.18, 5, { porte: true }),
    ...immeuble(0.1, 0.22, 0.12, C.creme, 0.17, 0.17, 6, { porte: true }),
    ...maison(0.07, 0.05, 0.06, C.creme, C.tuile, -0.05, 0.2), ...maison(0.07, 0.05, 0.06, C.pierre, C.ardoise, 0.06, -0.24, Math.PI / 2),
    ...voiture(-0.2, 0.05, 0, C.rouge), ...voiture(0.1, 0.06, Math.PI, C.blanc), ...voiture(0.02, -0.18, Math.PI / 2, C.toleBleu),
    ...arbre(0.27, -0.02, 0.9), ...arbre(-0.28, 0.0, 0.9), ...arbre(-0.02, -0.27, 0.8),
  ],
  // Ministère : long bâtiment néoclassique, fronton à la couleur du pays.
  centre_admin: () => [
    dalle(0.62, 0.5, C.pierre),
    ...immeuble(0.5, 0.16, 0.2, C.pierre, 0, -0.06, 3, { clim: false, toit: C.ardoise }),
    boite(0.22, 0.012, 0.06, C.pierre, 0, 0, 0.07),
    ...[-0.08, -0.048, -0.016, 0.016, 0.048, 0.08].map(x => cyl(0.007, 0.008, 0.15, C.blanc, x, 0.012, 0.08, 8)),
    boite(0.21, 0.016, 0.05, C.creme, 0, 0.162, 0.08), toit2(0.05, 0.045, 0.21, PAYS, 0, 0.178, 0.08, Math.PI / 2),
    ...drapeau(-0.24, 0, 0.18), ...drapeau(0.24, 0, 0.18), ...arbre(-0.2, 0.18), ...arbre(0.2, 0.18), ...voiture(0.08, 0.2, 0, C.noir),
  ],
  // Ambassade : villa dans un parc clos, grille, deux drapeaux.
  ambassade: () => [
    dalle(0.58, 0.54, C.herbe),
    ...immeuble(0.26, 0.11, 0.16, C.creme, 0, -0.06, 2, { clim: false, toit: C.creme }), toit2(0.27, 0.06, 0.17, C.ardoise, 0, 0.11, -0.06),
    boite(0.08, 0.06, 0.04, C.pierre, 0, 0, 0.04), ...[-0.03, 0.03].map(x => cyl(0.005, 0.005, 0.06, C.blanc, x, 0, 0.065, 6)),
    boite(0.04, 0.012, 0.22, C.gravier, 0, 0, 0.14), ...cloture(0.54, 0.5, 0, 0, C.noir, 0.06),
    ...drapeau(-0.07, 0, 0.12, 0.18), ...drapeau(0.07, 0, 0.12, 0.18),
    ...arbre(-0.2, 0.15), ...arbre(0.2, 0.15), ...arbre(-0.21, -0.18, 1, true), ...arbre(0.21, -0.18, 1, true),
  ],
  // Ferme (ancienne) : grange, silo, champs en sillons, tracteur.
  ferme: () => {
    const p = [dalle(0.62, 0.56, C.terreClaire)];
    for (let k = 0; k < 7; k++) p.push(boite(0.26, 0.014, 0.022, k % 2 ? '#9cbf4f' : '#c9b25a', -0.16, 0, -0.22 + k * 0.035));
    for (let k = 0; k < 6; k++) p.push(boite(0.022, 0.014, 0.24, '#7fa646', 0.06 + k * 0.035, 0, 0.12));
    p.push(boite(0.16, 0.09, 0.11, C.rouge, 0.15, 0, -0.14), toit2(0.17, 0.06, 0.12, C.ardoise, 0.15, 0.09, -0.14), boite(0.04, 0.05, 0.005, C.blanc, 0.15, 0, -0.084));
    p.push(...cuve(0.035, 0.2, C.metal, 0.27, -0.03), ...camion(-0.05, 0.2, 0.4, C.vert));
    return p;
  },
  // Mine commune : fosse à gradins, chevalement, convoyeur, tas de minerai, camion.
  mine: () => {
    const p = [dalle(0.62, 0.58, C.gravier)];
    for (let k = 0; k < 4; k++) p.push(cyl(0.2 - k * 0.04, 0.2 - k * 0.04, 0.012, k % 2 ? C.terre : C.terreClaire, -0.1, 0.012 - k * 0.003, 0.06, 14));
    p.push(cyl(0.05, 0.05, 0.004, C.sombre, -0.1, 0.012, 0.06, 12));
    // Chevalement (tour de puits) en treillis
    const tx = 0.18, tz = -0.14;
    for (const [dx, dz] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) p.push(barre([tx + dx, 0, tz + dz], [tx + dx * 0.4, 0.24, tz + dz * 0.4], 0.004, C.rouge, 4));
    for (let k = 1; k < 4; k++) p.push(boite(0.06 - k * 0.012, 0.004, 0.06 - k * 0.012, C.rouge, tx, k * 0.06, tz));
    p.push(piece(new THREE.TorusGeometry(0.022, 0.004, 4, 12), C.sombre, tx, 0.25, tz), boite(0.08, 0.06, 0.06, C.toleGris, tx + 0.06, 0, tz + 0.05));
    p.push(barre([tx - 0.02, 0.03, tz + 0.05], [-0.0, 0.1, 0.12], 0.008, C.acier, 4), tas(0.06, 0.06, '#6f6a62', 0.0, 0.2), ...camion(0.18, 0.18, -0.6));
    return p;
  },
  // Puits de pétrole : chevalet de pompage détaillé, cuves, tuyauterie.
  puits_petrole: () => {
    const p = [dalle(0.58, 0.52, C.sable), dalle(0.2, 0.12, C.beton, -0.08, 0.0)];
    const bx = -0.08;
    p.push(boite(0.18, 0.02, 0.05, C.sombre, bx, 0.012, 0));
    p.push(barre([bx - 0.01, 0.03, -0.02], [bx, 0.14, 0], 0.005, C.jaune, 4), barre([bx - 0.01, 0.03, 0.02], [bx, 0.14, 0], 0.005, C.jaune, 4), barre([bx + 0.04, 0.03, 0], [bx, 0.14, 0], 0.005, C.jaune, 4));
    p.push(piece(new THREE.BoxGeometry(0.2, 0.014, 0.014), C.jaune, bx + 0.01, 0.15, 0, 0, 0, -0.18));
    p.push(piece(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 12, 1, false, 0, Math.PI), C.jaune, bx + 0.105, 0.14, 0, 0, Math.PI / 2, -0.4));
    p.push(boite(0.035, 0.03, 0.03, C.sombre, bx - 0.08, 0.1, 0), cyl(0.02, 0.02, 0.025, C.acier, bx - 0.065, 0.03, 0, 10));
    p.push(barre([bx + 0.12, 0.13, 0], [bx + 0.12, 0.012, 0], 0.002, C.noir, 3), cyl(0.012, 0.016, 0.03, C.acier, bx + 0.12, 0.012, 0, 8));
    p.push(...cuve(0.05, 0.08, C.blanc, 0.18, -0.12), ...cuve(0.05, 0.08, C.blanc, 0.18, 0.04), ...cuve(0.035, 0.06, C.metal, 0.06, -0.18));
    p.push(barre([bx + 0.12, 0.02, 0], [0.13, 0.02, -0.12], 0.005, C.acier, 5), barre([0.18, 0.02, -0.07], [0.18, 0.02, -0.01], 0.005, C.acier, 5));
    p.push(...cloture(0.54, 0.48, 0, 0, C.acier, 0.08), ...camion(-0.15, 0.18, 0.2, C.blanc));
    return p;
  },
  // Mine radioactive : hall industriel, chevalement, fûts jaunes, clôture.
  mine_uranium: () => {
    const p = [dalle(0.6, 0.56, C.gravier)];
    p.push(...immeuble(0.22, 0.1, 0.14, C.toleGris, -0.12, -0.12, 2, { toit: C.toleBleu }), boite(0.05, 0.06, 0.006, C.sombre, -0.12, 0, -0.049));
    const tx = 0.14, tz = -0.12;
    for (const [dx, dz] of [[-0.025, -0.025], [0.025, -0.025], [-0.025, 0.025], [0.025, 0.025]]) p.push(barre([tx + dx, 0, tz + dz], [tx + dx * 0.4, 0.2, tz + dz * 0.4], 0.004, C.acier, 4));
    p.push(piece(new THREE.TorusGeometry(0.018, 0.004, 4, 12), C.sombre, tx, 0.21, tz));
    for (let k = 0; k < 9; k++) p.push(cyl(0.012, 0.012, 0.03, C.jaune, -0.02 + (k % 3) * 0.028, 0, 0.1 + Math.floor(k / 3) * 0.028, 10), cyl(0.0125, 0.0125, 0.003, C.noir, -0.02 + (k % 3) * 0.028, 0.012, 0.1 + Math.floor(k / 3) * 0.028, 10));
    p.push(tas(0.05, 0.04, C.uranium, 0.17, 0.13), boite(0.06, 0.04, 0.003, C.jaune, 0.17, 0.0, -0.27), ...cloture(0.56, 0.52, 0, 0, C.acier, 0.07), ...camion(0.05, 0.22, Math.PI, C.jaune));
    return p;
  },
  // Mine rare : fosse, usine de traitement, minerai violet, convoyeur.
  extracteur_tr: () => {
    const p = [dalle(0.6, 0.56, C.gravier)];
    for (let k = 0; k < 3; k++) p.push(cyl(0.16 - k * 0.04, 0.16 - k * 0.04, 0.012, k % 2 ? C.terre : C.terreClaire, -0.12, 0.012 - k * 0.003, 0.08, 14));
    p.push(...immeuble(0.16, 0.12, 0.12, C.beton, 0.14, -0.14, 2, { toit: C.toleGris }), ...cuve(0.03, 0.14, C.metal, 0.24, 0.0), ...cuve(0.03, 0.14, C.metal, 0.17, 0.02));
    p.push(barre([-0.06, 0.015, 0.04], [0.08, 0.1, -0.1], 0.008, C.acier, 4));
    p.push(piece(new THREE.OctahedronGeometry(0.03), C.violet, 0.0, 0.03, 0.2), piece(new THREE.OctahedronGeometry(0.022), C.violet, 0.05, 0.022, 0.17), tas(0.05, 0.035, '#7a5a8c', 0.08, 0.22));
    p.push(...camion(-0.2, -0.16, 0.8));
    return p;
  },
  // Carrière : front de taille en gradins, blocs, pelleteuse, tas de pierre.
  carriere: () => {
    const p = [dalle(0.62, 0.58, C.gravier)];
    for (let k = 0; k < 4; k++) p.push(boite(0.4 - k * 0.06, 0.04 + k * 0.04, 0.08, k % 2 ? '#a39b8d' : '#b6ae9f', -0.06 + k * 0.03, 0, -0.2 + k * 0.0));
    for (const [x, z] of [[0.05, 0.02], [0.1, 0.05], [-0.08, 0.04]]) p.push(boite(0.04, 0.025, 0.03, '#c9c2b4', x, 0, z, x * 7));
    p.push(tas(0.06, 0.05, '#a9a296', 0.2, 0.16), tas(0.045, 0.04, '#8f887c', 0.1, 0.22));
    // Pelleteuse
    p.push(...placer([boite(0.05, 0.012, 0.04, C.noir, 0, 0.004, 0), boite(0.04, 0.025, 0.035, C.jaune, 0, 0.016, 0), boite(0.015, 0.02, 0.02, C.vitre, 0.01, 0.04, 0.006), barre([0.02, 0.03, 0], [0.07, 0.06, 0], 0.004, C.jaune, 4), barre([0.07, 0.06, 0], [0.09, 0.02, 0], 0.004, C.jaune, 4), boite(0.02, 0.015, 0.025, C.acier, 0.095, 0.01, 0)], -0.12, 0.12, 0.5));
    p.push(...camion(0.18, -0.02, -0.4, C.orange));
    return p;
  },
  // Mine légendaire : derrick de forage au-dessus d'un cratère de météorite incandescent.
  foreuse: () => {
    const p = [dalle(0.6, 0.56, '#5b4a44')];
    p.push(cyl(0.2, 0.17, 0.02, '#3d302b', -0.04, 0, 0.04, 16), cyl(0.09, 0.07, 0.024, C.lave, -0.04, 0, 0.04, 12));
    for (const [x, z] of [[-0.08, 0.02], [0.0, 0.08], [-0.02, -0.02]]) p.push(piece(new THREE.DodecahedronGeometry(0.018), '#c0392b', x, 0.03, z));
    const tx = 0.15, tz = -0.13;
    for (const [dx, dz] of [[-0.035, -0.035], [0.035, -0.035], [-0.035, 0.035], [0.035, 0.035]]) p.push(barre([tx + dx, 0, tz + dz], [tx, 0.32, tz], 0.004, C.acier, 4));
    for (let k = 1; k < 5; k++) { const f = 1 - k / 5, s = 0.07 * f; p.push(boite(s, 0.003, s, C.acier, tx, k * 0.064, tz)); }
    p.push(boite(0.1, 0.05, 0.08, C.toleGris, tx + 0.02, 0, tz + 0.1), ...cuve(0.025, 0.08, C.rouge, 0.24, 0.05), ...drapeau(0.24, 0, -0.2, 0.16));
    return p;
  },
  // Raffinerie : colonnes de distillation, sphères de gaz, cuves, tuyauterie, torchère.
  raffinerie: () => {
    const p = [dalle(0.64, 0.6, C.beton)];
    for (const [x, z, h] of [[-0.18, -0.16, 0.3], [-0.12, -0.18, 0.24], [-0.06, -0.15, 0.34]]) {
      p.push(cyl(0.018, 0.022, h, C.metal, x, 0, z, 10));
      for (let y = 0.06; y < h; y += 0.07) p.push(cyl(0.03, 0.03, 0.004, C.acier, x, y, z, 10));
    }
    p.push(...sphereGaz(0.045, 0.15, -0.15), ...sphereGaz(0.035, 0.24, -0.06));
    p.push(...cuve(0.05, 0.07, C.blanc, -0.15, 0.13), ...cuve(0.05, 0.07, C.blanc, -0.03, 0.15), ...cuve(0.04, 0.06, C.blanc, 0.1, 0.17));
    for (const z of [-0.05, -0.03, -0.01]) p.push(barre([-0.24, 0.04, z], [0.26, 0.04, z], 0.004, z === -0.03 ? C.jaune : C.acier, 5));
    p.push(barre([0.24, 0, 0.12], [0.24, 0.32, 0.12], 0.006, C.rouge, 6), cone(0.012, 0.03, C.orange, 0.24, 0.32, 0.12, 6));
    p.push(...immeuble(0.1, 0.06, 0.06, C.creme, 0.17, 0.05, 2));
    return p;
  },
  // Fabrique : atelier à toit en sheds, quai de chargement, cheminée.
  fabrique: () => {
    const p = [dalle(0.6, 0.54, C.beton)];
    p.push(boite(0.36, 0.1, 0.26, C.brique, -0.04, 0, -0.04), ...fenetres(0.36, 0.1, 0.26, -0.04, 0, -0.04, 1, 8));
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.09, 0); s.lineTo(0, 0.05); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: false }); g.translate(-0.22 + k * 0.09, 0, -0.17);
      p.push(piece(g, k % 2 ? C.toleGris : C.vitreClair, 0, 0.1, 0));
    }
    p.push(...cheminee(0.022, 0.3, 0.2, -0.16), boite(0.12, 0.03, 0.06, C.betonFonce, -0.04, 0, 0.13), ...camion(0.1, 0.18, 0, C.toleBleu), ...conteneur(-0.2, 0.012, 0.18, C.conteneurs[0]));
    return p;
  },
  // Centrale thermique : salle des chaudières, deux cheminées, stock de charbon, convoyeur.
  centrale_thermique: () => {
    const p = [dalle(0.64, 0.6, C.beton)];
    p.push(...immeuble(0.26, 0.16, 0.16, C.toleGris, -0.08, -0.08, 3, { toit: C.betonFonce }), ...immeuble(0.12, 0.1, 0.16, C.beton, 0.12, -0.08, 2));
    p.push(...cheminee(0.03, 0.46, -0.2, -0.22), ...cheminee(0.03, 0.46, -0.1, -0.22));
    p.push(tas(0.08, 0.05, C.noir, 0.14, 0.16), tas(0.06, 0.04, '#2f2f2f', 0.02, 0.2), barre([0.1, 0.03, 0.12], [-0.06, 0.12, 0.0], 0.008, C.acier, 4));
    p.push(...cuve(0.035, 0.09, C.blanc, 0.24, -0.15), barre([-0.24, 0.12, 0.1], [0.28, 0.12, 0.1], 0.003, C.acier, 4));
    for (const x of [-0.22, 0.0, 0.24]) p.push(boite(0.006, 0.12, 0.006, C.acier, x, 0, 0.1));
    return p;
  },
  // Parc solaire : rangées de panneaux inclinés sur châssis, onduleur.
  parc_solaire: () => {
    const p = [dalle(0.64, 0.6, C.gravier)];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      const x = -0.2 + c * 0.17, z = -0.22 + r * 0.1;
      // Panneau incliné vers le soleil : cadre clair, cellules bleu nuit, pieds.
      p.push(piece(new THREE.BoxGeometry(0.155, 0.006, 0.066), C.metal, x, 0.045, z, 0, 0.5));
      for (let k = 0; k < 3; k++) p.push(piece(new THREE.BoxGeometry(0.046, 0.007, 0.056), '#2d5d8f', x - 0.05 + k * 0.05, 0.0462, z, 0, 0.5));
      p.push(boite(0.005, 0.03, 0.005, C.acier, x - 0.06, 0, z + 0.015), boite(0.005, 0.03, 0.005, C.acier, x + 0.06, 0, z + 0.015), boite(0.005, 0.06, 0.005, C.acier, x - 0.06, 0, z - 0.015), boite(0.005, 0.06, 0.005, C.acier, x + 0.06, 0, z - 0.015));
    }
    p.push(boite(0.05, 0.04, 0.04, C.blanc, 0.27, 0, 0.22), ...cloture(0.62, 0.58, 0, 0, C.acier, 0.06));
    return p;
  },
  // Centrale nucléaire : deux tours de refroidissement, enceinte du réacteur, salle des turbines.
  centrale_nucleaire: () => {
    const p = [dalle(0.66, 0.62, C.beton)];
    p.push(...tourRefroid(0.1, 0.3, -0.16, -0.14), ...tourRefroid(0.1, 0.3, 0.06, -0.18));
    p.push(cyl(0.065, 0.065, 0.12, C.blanc, 0.18, 0, 0.1, 16), dome(0.065, C.blanc, 0.18, 0.12, 0.1, 16));
    p.push(...immeuble(0.2, 0.1, 0.1, C.beton, -0.05, 0.14, 2, { toit: PAYS }), ...cheminee(0.012, 0.22, 0.27, -0.02, false));
    p.push(...cloture(0.64, 0.6, 0, 0, C.acier, 0.07));
    return p;
  },
  // Centre d'enrichissement : halls et cascade de centrifugeuses.
  enrichissement: () => {
    const p = [dalle(0.62, 0.56, C.beton)];
    p.push(...immeuble(0.4, 0.09, 0.16, C.blanc, 0, -0.14, 2, { toit: C.toleGris }));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) p.push(cyl(0.01, 0.01, 0.08, C.metal, -0.2 + c * 0.055, 0.012, 0.04 + r * 0.05, 8), boule(0.01, C.acier, -0.2 + c * 0.055, 0.092, 0.04 + r * 0.05, 6));
    p.push(boite(0.46, 0.008, 0.18, C.toleBleu, 0, 0.13, 0.09));
    for (const x of [-0.22, 0.22]) for (const z of [0.0, 0.18]) p.push(boite(0.006, 0.13, 0.006, C.acier, x, 0, z));
    p.push(...cloture(0.6, 0.54, 0, 0, C.acier, 0.07), ...drapeau(0.25, 0, -0.22, 0.16));
    return p;
  },
  // Complexe industriel : grand hall à sheds, bureaux, cheminée, cuves, camions.
  usine: () => {
    const p = [dalle(0.66, 0.62, C.beton)];
    p.push(boite(0.4, 0.12, 0.26, C.toleGris, -0.06, 0, -0.08), ...fenetres(0.4, 0.12, 0.26, -0.06, 0, -0.08, 1, 10));
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.08, 0); s.lineTo(0, 0.045); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: false }); g.translate(-0.26 + k * 0.08, 0, -0.21);
      p.push(piece(g, k % 2 ? PAYS : C.vitreClair, 0, 0.12, 0));
    }
    p.push(...immeuble(0.12, 0.14, 0.08, C.vitreClair, 0.2, 0.12, 4), ...cheminee(0.025, 0.36, 0.22, -0.18), ...cuve(0.04, 0.1, C.metal, 0.24, -0.04));
    p.push(...camion(-0.14, 0.18, 0, C.blanc), ...camion(0.0, 0.2, 0, C.toleBleu), ...conteneur(-0.24, 0.012, 0.12, C.conteneurs[2], 0.2));
    return p;
  },
  // Laboratoire : bâtiment moderne vitré, observatoire, antenne parabolique.
  laboratoire: () => {
    const p = [dalle(0.6, 0.56, C.dalle), dalle(0.2, 0.18, C.herbe, -0.18, 0.18)];
    p.push(...immeuble(0.3, 0.14, 0.16, C.blanc, -0.04, -0.08, 3, { vitre: C.vitreClair, porte: true }), ...immeuble(0.12, 0.2, 0.12, C.vitreClair, 0.18, -0.12, 5));
    p.push(cyl(0.045, 0.045, 0.04, C.blanc, -0.1, 0.14, -0.08, 14), dome(0.045, C.metal, -0.1, 0.18, -0.08, 14));
    p.push(barre([0.18, 0.2, -0.12], [0.18, 0.28, -0.12], 0.003, C.acier, 4), piece(new THREE.SphereGeometry(0.04, 12, 4, 0, Math.PI * 2, 0, 0.9), C.blanc, 0.18, 0.31, -0.1, 0, -2.4, 0));
    p.push(...arbre(-0.22, 0.2), ...arbre(-0.14, 0.24), ...voiture(0.12, 0.16, 0, C.blanc), ...voiture(0.2, 0.16, 0, C.toleBleu));
    return p;
  },
  // Entrepôt : hangars à toit en tôle, portes de quai, conteneurs empilés, camion.
  entrepot: () => {
    const p = [dalle(0.64, 0.6, C.dalle), boite(0.64, 0.013, 0.08, C.asphalte, 0, 0, 0.18)];
    for (const z of [-0.16, 0.0]) {
      p.push(boite(0.42, 0.09, 0.13, C.beton, -0.06, 0, z), toit2(0.43, 0.035, 0.14, C.toleBleu, -0.06, 0.09, z));
      for (let k = 0; k < 4; k++) p.push(boite(0.05, 0.06, 0.004, C.toleGris, -0.22 + k * 0.1, 0, z + 0.067));
    }
    for (let k = 0; k < 6; k++) p.push(...conteneur(0.2, 0.012 + (k % 2) * 0.026, -0.2 + Math.floor(k / 2) * 0.03, C.conteneurs[k], Math.PI / 2));
    p.push(...camion(-0.1, 0.18, 0, C.blanc), ...camion(0.08, 0.18, 0, C.rouge));
    return p;
  },
  // Place financière : gratte-ciel de verre, socle à colonnes, couronne dorée.
  banque: () => {
    const p = [dalle(0.56, 0.54, C.pierre)];
    p.push(...immeuble(0.18, 0.5, 0.16, C.vitre, 0, -0.04, 16, { vitre: C.vitreClair, toit: C.sombre, clim: false }));
    p.push(boite(0.26, 0.06, 0.22, C.pierre, 0, 0, -0.04), ...[-0.09, -0.03, 0.03, 0.09].map(x => cyl(0.008, 0.009, 0.06, C.blanc, x, 0, 0.075, 8)));
    p.push(boite(0.14, 0.03, 0.12, C.or, 0, 0.5, -0.04), cone(0.05, 0.06, C.or, 0, 0.53, -0.04, 4, Math.PI / 4), cyl(0.002, 0.002, 0.06, C.metal, 0, 0.59, -0.04, 4));
    p.push(...arbre(-0.2, 0.18), ...arbre(0.2, 0.18), ...voiture(0.0, 0.2, 0, C.noir), ...drapeau(-0.2, 0, -0.18, 0.18));
    return p;
  },
  // Hôpital : bâtiment en H, croix rouge, héliport sur le toit, ambulances.
  hopital: () => {
    const p = [dalle(0.6, 0.56, C.dalle)];
    p.push(...immeuble(0.1, 0.2, 0.3, C.blanc, -0.13, -0.04, 6, { clim: false }), ...immeuble(0.1, 0.2, 0.3, C.blanc, 0.13, -0.04, 6, { clim: false }), ...immeuble(0.16, 0.16, 0.08, C.blanc, 0, -0.04, 5, { clim: false, porte: true }));
    p.push(boite(0.08, 0.02, 0.025, C.rouge, 0, 0.11, 0.0), boite(0.025, 0.07, 0.006, C.rouge, 0, 0.085, 0.003));
    p.push(cyl(0.045, 0.045, 0.004, C.sombre, 0.13, 0.2, -0.04, 16), boite(0.006, 0.002, 0.04, C.blanc, 0.115, 0.205, -0.04), boite(0.006, 0.002, 0.04, C.blanc, 0.145, 0.205, -0.04), boite(0.03, 0.002, 0.006, C.blanc, 0.13, 0.205, -0.04));
    p.push(...camion(-0.04, 0.2, 0, C.blanc), boite(0.012, 0.004, 0.035, C.rouge, -0.04, 0.038, 0.2), ...arbre(0.22, 0.2), ...arbre(-0.22, 0.2));
    return p;
  },
  // Caserne : baraquements, place d'armes, mirador, véhicules, drapeau.
  caserne: () => {
    const p = [dalle(0.64, 0.6, C.terreClaire), dalle(0.26, 0.2, C.gravier, 0.08, 0.12)];
    for (const z of [-0.2, -0.1]) p.push(boite(0.3, 0.06, 0.07, C.kaki, -0.1, 0, z), toit2(0.31, 0.035, 0.08, C.toleVert, -0.1, 0.06, z), ...fenetres(0.3, 0.06, 0.07, -0.1, 0, z, 1, 6));
    p.push(...immeuble(0.1, 0.1, 0.1, C.creme, 0.2, -0.16, 2, { toit: PAYS }));
    p.push(...[[-0.025, -0.025], [0.025, -0.025], [-0.025, 0.025], [0.025, 0.025]].map(([dx, dz]) => barre([-0.24 + dx, 0, 0.18 + dz], [-0.24 + dx * 0.7, 0.16, 0.18 + dz * 0.7], 0.003, C.bois, 4)));
    p.push(boite(0.05, 0.03, 0.05, C.bois, -0.24, 0.16, 0.18), toit2(0.06, 0.02, 0.06, C.toleVert, -0.24, 0.19, 0.18));
    p.push(...char(0.0, 0.1, 0.3), ...char(0.12, 0.16, 0.3), ...camion(0.18, 0.06, 0, C.vertMil), ...drapeau(0.08, 0, 0.0, 0.22), ...cloture(0.62, 0.58, 0, 0, C.acier, 0.07));
    return p;
  },
  // Usine de blindés : grand hall voûté, chars sur l'aire d'essai.
  usine_blindes: () => {
    const p = [dalle(0.66, 0.6, C.beton)];
    p.push(piece(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 14, 1, false, 0, Math.PI), C.toleGris, -0.02, 0.06, -0.14, 0, 0, Math.PI / 2));
    p.push(boite(0.42, 0.06, 0.24, C.toleGris, -0.02, 0, -0.14), boite(0.1, 0.1, 0.004, C.sombre, -0.02, 0, -0.018), boite(0.42, 0.012, 0.012, PAYS, -0.02, 0.06, -0.018));
    p.push(...char(-0.14, 0.12, 0), ...char(0.0, 0.14, 0.2), ...char(0.14, 0.12, -0.3), ...cheminee(0.018, 0.28, 0.25, -0.2), ...camion(0.22, 0.04, Math.PI / 2, C.vertMil));
    return p;
  },
  // Base aérienne : piste balisée, tour de contrôle, hangar, avions.
  aeroport: () => {
    const p = [dalle(0.7, 0.62, C.herbe)];
    p.push(boite(0.68, 0.014, 0.1, C.asphalte, 0, 0, 0.14));
    for (let k = 0; k < 8; k++) p.push(boite(0.04, 0.0145, 0.006, C.blanc, -0.28 + k * 0.08, 0, 0.14));
    p.push(boite(0.3, 0.013, 0.08, C.asphalte, 0.0, 0, 0.03), boite(0.04, 0.013, 0.1, C.asphalte, 0.0, 0, 0.08));
    p.push(piece(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 12, 1, false, 0, Math.PI), C.toleGris, -0.16, 0, -0.14, 0, 0, Math.PI / 2), boite(0.2, 0.006, 0.16, C.toleGris, -0.16, 0, -0.14));
    p.push(boite(0.08, 0.07, 0.004, C.sombre, -0.16, 0, -0.06));
    p.push(cyl(0.016, 0.02, 0.22, C.beton, 0.16, 0, -0.18, 10), cyl(0.032, 0.026, 0.04, C.vitre, 0.16, 0.22, -0.18, 10), cyl(0.034, 0.034, 0.006, C.sombre, 0.16, 0.26, -0.18, 10));
    p.push(...immeuble(0.14, 0.06, 0.08, C.creme, 0.17, -0.07, 2), ...avion(0.05, 0.03, 0.2, C.acier), ...avion(-0.12, 0.03, -0.1, C.acier), ...drapeau(0.28, 0, -0.08, 0.16));
    return p;
  },
  // Chantier naval : quai, portique à conteneurs, navire en cale, entrepôt.
  port: () => {
    const p = [dalle(0.66, 0.34, C.beton, 0, -0.12), boite(0.66, 0.04, 0.02, C.betonFonce, 0, -0.03, 0.05)];
    // Navire
    p.push(...placer([boite(0.36, 0.05, 0.08, '#4a5a6a', 0, -0.02, 0), piece(new THREE.ConeGeometry(0.045, 0.08, 4), '#4a5a6a', 0.22, 0.005, 0, 0, Math.PI / 4, -Math.PI / 2), boite(0.06, 0.06, 0.06, C.blanc, -0.12, 0.03, 0), boite(0.02, 0.05, 0.02, PAYS, -0.12, 0.09, 0), ...conteneur(0.0, 0.03, -0.015, C.conteneurs[1], 0), ...conteneur(0.07, 0.03, 0.015, C.conteneurs[0], 0)], 0.0, 0.14));
    // Portique
    const gx = 0.1;
    for (const [dx, dz] of [[-0.05, -0.08], [0.05, -0.08], [-0.05, 0.02], [0.05, 0.02]]) p.push(boite(0.008, 0.2, 0.008, C.rouge, gx + dx, 0, dz));
    p.push(boite(0.11, 0.012, 0.3, C.rouge, gx, 0.2, 0.0), boite(0.03, 0.02, 0.03, C.sombre, gx, 0.18, 0.1));
    for (let k = 0; k < 6; k++) p.push(...conteneur(-0.14 + (k % 3) * 0.07, 0.012 + Math.floor(k / 3) * 0.026, -0.18, C.conteneurs[(k + 2) % 6], 0));
    p.push(...immeuble(0.14, 0.07, 0.08, C.toleBleu, 0.22, -0.2, 1), ...grue(-0.26, -0.06, 0.24, 0.6));
    return p;
  },
  // Silo à missiles : trappe blindée, missile en partie sorti, bunker, enceinte.
  silo: () => {
    const p = [dalle(0.6, 0.56, C.gravier), dalleRonde(0.12, C.betonFonce, 0, 0)];
    p.push(cyl(0.07, 0.07, 0.02, C.beton, 0, 0.012, 0, 16), cyl(0.05, 0.05, 0.022, C.noir, 0, 0.012, 0, 16));
    p.push(piece(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, 0, Math.PI), C.acier, 0.09, 0.04, 0, 0, 0, Math.PI / 2 - 0.5));
    p.push(cyl(0.018, 0.018, 0.2, C.blanc, 0, 0.03, 0, 12), cone(0.018, 0.05, PAYS, 0, 0.23, 0, 12), ...[0, 2.1, 4.2].map(a => boite(0.004, 0.03, 0.02, C.sombre, Math.cos(a) * 0.02, 0.03, Math.sin(a) * 0.02, -a)));
    p.push(boite(0.1, 0.04, 0.08, C.betonFonce, -0.18, 0, -0.16), boite(0.03, 0.025, 0.004, C.sombre, -0.18, 0, -0.118));
    p.push(barre([0.2, 0, -0.16], [0.2, 0.12, -0.16], 0.003, C.acier, 4), piece(new THREE.SphereGeometry(0.03, 10, 4, 0, Math.PI * 2, 0, 0.9), C.blanc, 0.2, 0.14, -0.15, 0, -2.3, 0));
    p.push(...cloture(0.56, 0.52, 0, 0, C.acier, 0.06), ...cloture(0.3, 0.3, 0, 0, C.acier, 0));
    return p;
  },
  // Batterie sol-air : lanceur à 4 tubes, radar de conduite de tir, sacs de sable.
  defense_aa: () => {
    const p = [dalle(0.56, 0.52, C.terreClaire)];
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; p.push(boite(0.04, 0.025, 0.02, C.sable, Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, -a)); }
    p.push(...placer([boite(0.12, 0.03, 0.06, C.vertMil, 0, 0.012, 0), boite(0.03, 0.03, 0.06, C.vertMil, 0.07, 0.012, 0),
      ...[-0.012, 0.012].flatMap(dz => [-0.012, 0.012].map(dy => piece(new THREE.BoxGeometry(0.1, 0.018, 0.018), C.kaki, -0.01, 0.08 + dy, dz, 0, 0, 0.6))),
      ...[-0.04, 0, 0.04].map(dx => piece(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 8), C.noir, dx, 0.01, 0, 0, Math.PI / 2, 0))], 0, 0, 0.4));
    p.push(boite(0.05, 0.04, 0.04, C.vertMil, 0.2, 0, -0.15), boite(0.06, 0.05, 0.004, C.sombre, 0.2, 0.06, -0.15, 0.4), ...drapeau(-0.2, 0, -0.18, 0.15));
    return p;
  },
  // Fortifications : remparts à bastions, tours, donjon central.
  fort: () => {
    const p = [dalleRonde(0.33, C.herbe)];
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, b = a + Math.PI / 3;
      p.push(barre([Math.cos(a) * 0.24, 0.035, Math.sin(a) * 0.24], [Math.cos(b) * 0.24, 0.035, Math.sin(b) * 0.24], 0.03, C.pierre, 4));
      p.push(cyl(0.04, 0.05, 0.1, C.pierre, Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25, 8), cyl(0.045, 0.045, 0.012, C.betonFonce, Math.cos(a) * 0.25, 0.1, Math.sin(a) * 0.25, 8));
      for (let c = 0; c < 4; c++) { const t = (c + 0.5) / 4, ax = Math.cos(a) * 0.24 * (1 - t) + Math.cos(b) * 0.24 * t, az = Math.sin(a) * 0.24 * (1 - t) + Math.sin(b) * 0.24 * t; p.push(boite(0.012, 0.014, 0.012, C.pierre, ax, 0.064, az)); }
    }
    p.push(...immeuble(0.1, 0.16, 0.1, C.pierre, 0, 0, 3, { clim: false }), cone(0.08, 0.06, PAYS, 0, 0.16, 0, 4, Math.PI / 4), ...drapeau(0, 0.2, 0, 0.12));
    return p;
  },
  // Centrale à fusion : tokamak lumineux sous une halle ouverte, échangeurs.
  centrale_fusion: () => {
    const p = [dalle(0.64, 0.6, C.blanc)];
    p.push(piece(new THREE.TorusGeometry(0.11, 0.04, 10, 24), C.metal, 0, 0.08, -0.04, 0, Math.PI / 2, 0), piece(new THREE.TorusGeometry(0.11, 0.022, 8, 24), '#8fe3ff', 0, 0.081, -0.04, 0, Math.PI / 2, 0));
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; p.push(boite(0.012, 0.11, 0.03, C.acier, Math.cos(a) * 0.11, 0.025, -0.04 + Math.sin(a) * 0.11, -a)); }
    p.push(cyl(0.025, 0.025, 0.14, C.vitreClair, 0, 0.012, -0.04, 12));
    for (const x of [-0.26, 0.26]) for (const z of [-0.22, 0.14]) p.push(boite(0.012, 0.24, 0.012, C.metal, x, 0, z));
    p.push(boite(0.54, 0.01, 0.38, C.vitreClair, 0, 0.24, -0.04), ...cuve(0.035, 0.1, C.blanc, 0.22, 0.2), ...cuve(0.035, 0.1, C.blanc, -0.22, 0.2), ...drapeau(0, 0, 0.22, 0.16));
    return p;
  },
  // Laboratoire quantique : bâtiment futuriste, anneau, antennes.
  labo_quantique: () => {
    const p = [dalle(0.6, 0.56, C.dalle)];
    p.push(cyl(0.14, 0.16, 0.12, C.vitre, 0, 0, -0.02, 20), ...fenetres(0.2, 0.12, 0.2, 0, 0, -0.02, 3, 5, C.vitreClair));
    p.push(cyl(0.12, 0.12, 0.012, C.blanc, 0, 0.12, -0.02, 20), dome(0.08, C.vitreClair, 0, 0.13, -0.02, 16));
    p.push(piece(new THREE.TorusGeometry(0.2, 0.012, 6, 32), PAYS, 0, 0.08, -0.02, 0, Math.PI / 2, 0));
    for (const [x, z] of [[0.22, -0.2], [-0.22, -0.2]]) p.push(barre([x, 0, z], [x, 0.2, z], 0.003, C.acier, 4), boule(0.008, C.rouge, x, 0.205, z, 6));
    p.push(...arbre(-0.22, 0.2), ...arbre(0.22, 0.2), ...voiture(0.05, 0.2, 0, C.blanc));
    return p;
  },
  // Station radar : radôme sur tour, antenne tournante, bâtiment technique.
  radar: () => {
    const p = [dalle(0.56, 0.52, C.gravier)];
    for (const [dx, dz] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) p.push(barre([-0.08 + dx, 0, -0.06 + dz], [-0.08 + dx * 0.6, 0.18, -0.06 + dz * 0.6], 0.004, C.acier, 4));
    p.push(boite(0.06, 0.01, 0.06, C.acier, -0.08, 0.18, -0.06), boule(0.07, C.blanc, -0.08, 0.25, -0.06, 14));
    p.push(barre([0.14, 0, 0.1], [0.14, 0.12, 0.1], 0.006, C.acier, 6), piece(new THREE.BoxGeometry(0.16, 0.05, 0.008), C.metal, 0.14, 0.14, 0.1, 0.5, -0.3, 0));
    p.push(...immeuble(0.14, 0.06, 0.1, C.creme, 0.14, -0.14, 1, { toit: PAYS }), ...cloture(0.52, 0.48, 0, 0, C.acier, 0.06));
    return p;
  },
};

const cache = new Map();

/** Géométrie (mise en cache) d'un bâtiment aux couleurs d'une nation. */
export function geometrieBatiment(type, couleurPays) {
  const cle = type + '|' + couleurPays;
  let g = cache.get(cle);
  if (!g) {
    const f = MODELES[type] || (() => [dalle(0.5, 0.46), ...immeuble(0.24, 0.14, 0.2, C.beton, 0, 0, 3, { toit: PAYS })]);
    g = fusionner(f(), couleurPays);
    cache.set(cle, g);
  }
  return g;
}

/** Liste des bâtiments modélisés (pour la page d'aperçu des modèles). */
export const TYPES_MODELES = Object.keys(MODELES);

export const materielBatiments = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05 });
