// ══════════════════════════════════════════════════════════════════
// modeles.js — Petits modèles 3D des bâtiments (low-poly)
// Chaque bâtiment est assemblé à partir de formes simples, puis fusionné
// en UNE géométrie à couleurs de sommets : un seul objet à dessiner par
// bâtiment, même avec des centaines de bâtiments sur la carte. Les
// parties « pays » (toits, drapeaux) prennent la couleur de la nation.
// Une case fait 1 de rayon ; les modèles tiennent dans ~0,9 de large.
// ══════════════════════════════════════════════════════════════════
import * as THREE from '../vendor/three.module.min.js';

const C = {
  mur: '#ece6d8', beton: '#c9c6bf', gris: '#9aa3ab', sombre: '#4b5563', noir: '#2b2f36',
  bois: '#8d6e4a', verre: '#8fc9e0', champ: '#86b049', ble: '#e3c565', rouge: '#c0392b',
  jaune: '#f2c230', metal: '#b8c4cc', violet: '#9b59b6', vert: '#3fa34d', blanc: '#f7f7f5',
  or: '#d4a72c', piste: '#3a3f47', eau: '#4a90b8', terre: '#7a6248', panneau: '#1f3b63',
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

// Formes de base (posées sur le sol : y = 0 en bas)
const boite = (l, h, p, coul, x = 0, y = 0, z = 0, ry = 0) => piece(new THREE.BoxGeometry(l, h, p), coul, x, y + h / 2, z, ry);
const cyl = (rh, rb, h, coul, x = 0, y = 0, z = 0, seg = 8) => piece(new THREE.CylinderGeometry(rh, rb, h, seg), coul, x, y + h / 2, z);
const cone = (r, h, coul, x = 0, y = 0, z = 0, seg = 8, ry = 0) => piece(new THREE.ConeGeometry(r, h, seg), coul, x, y + h / 2, z, ry);
const dome = (r, coul, x = 0, y = 0, z = 0) => piece(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), coul, x, y, z);
/** Toit à deux pans : prisme triangulaire de longueur l (axe x). */
const toit = (l, h, p, coul, x = 0, y = 0, z = 0, ry = 0) => piece(new THREE.CylinderGeometry(p / 2, p / 2, l, 3, 1, false, Math.PI / 2), coul, x, y + p / 4, z, ry, 0, Math.PI / 2);
const drapeau = (x, y, z, h = 0.55) => [
  cyl(0.012, 0.012, h, C.sombre, x, y, z, 5),
  boite(0.2, 0.12, 0.01, PAYS, x + 0.1, y + h - 0.13, z),
];

// ── Modèles ───────────────────────────────────────────────────────
const MODELES = {
  capitale: () => [
    boite(0.8, 0.12, 0.62, C.beton),
    boite(0.56, 0.3, 0.4, C.mur, 0, 0.12),
    ...[-0.2, -0.07, 0.07, 0.2].map(x => cyl(0.025, 0.025, 0.3, C.blanc, x, 0.12, 0.23, 6)),
    boite(0.6, 0.04, 0.44, C.mur, 0, 0.42),
    cyl(0.14, 0.16, 0.1, C.mur, 0, 0.46),
    dome(0.15, PAYS, 0, 0.56),
    boite(0.12, 0.42, 0.12, C.mur, -0.33, 0.12, -0.2), cone(0.1, 0.14, PAYS, -0.33, 0.54, -0.2, 4, Math.PI / 4),
    boite(0.12, 0.42, 0.12, C.mur, 0.33, 0.12, -0.2), cone(0.1, 0.14, PAYS, 0.33, 0.54, -0.2, 4, Math.PI / 4),
    ...drapeau(0, 0.7, 0, 0.35),
  ],
  ville: () => [
    boite(0.22, 0.5, 0.22, C.mur, -0.18, 0, -0.12), boite(0.24, 0.06, 0.24, PAYS, -0.18, 0.5, -0.12),
    boite(0.2, 0.34, 0.24, C.beton, 0.16, 0, -0.16), boite(0.22, 0.05, 0.26, PAYS, 0.16, 0.34, -0.16),
    boite(0.26, 0.22, 0.2, C.mur, 0.06, 0, 0.2), toit(0.26, 0.1, 0.2, C.rouge, 0.06, 0.22, 0.2),
    boite(0.14, 0.7, 0.14, C.verre, -0.02, 0, 0.0),
    boite(0.16, 0.18, 0.16, C.mur, -0.3, 0, 0.2), toit(0.16, 0.08, 0.16, C.rouge, -0.3, 0.18, 0.2),
  ],
  centre_admin: () => [
    boite(0.7, 0.08, 0.5, C.beton),
    boite(0.56, 0.3, 0.34, C.mur, 0, 0.08, -0.03),
    ...[-0.22, -0.11, 0, 0.11, 0.22].map(x => cyl(0.022, 0.022, 0.3, C.blanc, x, 0.08, 0.18, 6)),
    toit(0.62, 0.14, 0.44, PAYS, 0, 0.38, 0.0),
  ],
  ambassade: () => [
    boite(0.5, 0.26, 0.36, C.mur), toit(0.52, 0.12, 0.38, PAYS, 0, 0.26),
    boite(0.12, 0.16, 0.02, C.bois, 0, 0, 0.19),
    ...drapeau(0.3, 0, 0.2), ...drapeau(-0.3, 0, 0.2),
  ],
  ferme: () => [
    boite(0.36, 0.03, 0.62, C.champ, -0.2, 0, 0), boite(0.32, 0.035, 0.62, C.ble, 0.2, 0, 0.0),
    boite(0.24, 0.18, 0.2, C.rouge, 0.18, 0.03, -0.14), toit(0.24, 0.09, 0.22, C.sombre, 0.18, 0.21, -0.14),
    cyl(0.06, 0.06, 0.34, C.metal, 0.36, 0.03, 0.06), dome(0.06, C.metal, 0.36, 0.37, 0.06),
  ],
  mine: () => [
    cone(0.36, 0.22, C.terre, -0.08, 0, 0.06, 7),
    boite(0.03, 0.46, 0.03, C.bois, 0.18, 0, -0.12), boite(0.03, 0.46, 0.03, C.bois, 0.32, 0, -0.12),
    boite(0.18, 0.03, 0.05, C.bois, 0.25, 0.44, -0.12),
    cyl(0.06, 0.06, 0.03, C.sombre, 0.25, 0.46, -0.12, 10),
    boite(0.14, 0.08, 0.1, C.gris, 0.1, 0, 0.26), boite(0.1, 0.05, 0.06, C.sombre, 0.1, 0.08, 0.26),
  ],
  puits_petrole: () => [
    boite(0.36, 0.04, 0.16, C.sombre, -0.05, 0, 0),
    boite(0.04, 0.26, 0.04, C.jaune, -0.05, 0.04, 0),
    piece(new THREE.BoxGeometry(0.46, 0.04, 0.05), C.jaune, -0.05, 0.32, 0, 0, 0, 0.18),
    boite(0.06, 0.12, 0.07, C.noir, 0.17, 0.26, 0),
    cyl(0.12, 0.12, 0.22, C.metal, 0.26, 0, 0.2), cyl(0.1, 0.1, 0.16, C.blanc, -0.24, 0, 0.24),
  ],
  mine_uranium: () => [
    cone(0.34, 0.18, C.terre, -0.05, 0, 0.0, 7),
    boite(0.24, 0.16, 0.18, C.beton, 0.2, 0, -0.18), boite(0.26, 0.03, 0.2, PAYS, 0.2, 0.16, -0.18),
    ...[[0.2, 0.2], [0.3, 0.12], [0.3, 0.26]].map(([x, z]) => cyl(0.045, 0.045, 0.1, C.jaune, x, 0, z, 8)),
  ],
  extracteur_tr: () => [
    boite(0.46, 0.06, 0.4, C.beton),
    piece(new THREE.OctahedronGeometry(0.14), C.violet, -0.1, 0.24, 0.02),
    piece(new THREE.OctahedronGeometry(0.08), C.violet, 0.06, 0.16, 0.12),
    boite(0.14, 0.26, 0.14, C.metal, 0.16, 0.06, -0.1), boite(0.16, 0.03, 0.16, PAYS, 0.16, 0.32, -0.1),
  ],
  centrale_thermique: () => [
    boite(0.4, 0.24, 0.3, C.beton, -0.06, 0, 0.06), boite(0.42, 0.03, 0.32, PAYS, -0.06, 0.24, 0.06),
    cyl(0.05, 0.065, 0.62, C.gris, 0.2, 0, -0.18, 8), boite(0.11, 0.05, 0.11, C.rouge, 0.2, 0.5, -0.18),
    cyl(0.05, 0.065, 0.5, C.gris, 0.3, 0, 0.0, 8),
  ],
  parc_solaire: () => {
    const p = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      p.push(piece(new THREE.BoxGeometry(0.2, 0.015, 0.14), C.panneau, -0.24 + c * 0.24, 0.1, -0.2 + r * 0.2, 0, -0.5));
      p.push(boite(0.015, 0.08, 0.015, C.gris, -0.24 + c * 0.24, 0, -0.2 + r * 0.2));
    }
    return p;
  },
  centrale_nucleaire: () => [
    cyl(0.14, 0.2, 0.46, C.beton, -0.2, 0, -0.1, 12), cyl(0.14, 0.2, 0.46, C.beton, 0.12, 0, -0.2, 12),
    boite(0.22, 0.18, 0.2, C.mur, 0.18, 0, 0.18), dome(0.12, C.blanc, -0.12, 0, 0.22),
    boite(0.24, 0.03, 0.22, PAYS, 0.18, 0.18, 0.18),
  ],
  enrichissement: () => [
    boite(0.5, 0.2, 0.26, C.mur, 0, 0, -0.14), boite(0.52, 0.03, 0.28, PAYS, 0, 0.2, -0.14),
    ...[-0.2, -0.1, 0, 0.1, 0.2].map(x => cyl(0.035, 0.035, 0.26, C.metal, x, 0, 0.16, 8)),
  ],
  usine: () => [
    boite(0.56, 0.2, 0.4, C.beton, -0.04, 0, 0.04),
    ...[-0.22, -0.04, 0.14].map(x => piece(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 3, 1, false, Math.PI), PAYS, x, 0.255, 0.04, 0, Math.PI / 2, 0)),
    cyl(0.04, 0.05, 0.56, C.rouge, 0.3, 0, -0.18, 8),
  ],
  laboratoire: () => [
    boite(0.44, 0.26, 0.32, C.blanc, -0.06, 0, 0.04), boite(0.46, 0.03, 0.34, PAYS, -0.06, 0.26, 0.04),
    cyl(0.12, 0.12, 0.12, C.blanc, 0.08, 0.29, -0.02, 12), dome(0.12, C.metal, 0.08, 0.41, -0.02),
    cyl(0.008, 0.008, 0.26, C.sombre, -0.2, 0.29, 0.12, 4), piece(new THREE.SphereGeometry(0.025, 6, 4), C.rouge, -0.2, 0.56, 0.12),
  ],
  entrepot: () => [
    boite(0.62, 0.2, 0.34, C.beton), piece(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 10, 1, false, 0, Math.PI), PAYS, 0, 0.2, 0, 0, 0, Math.PI / 2),
    boite(0.14, 0.12, 0.01, C.sombre, 0, 0, 0.175),
  ],
  banque: () => [
    boite(0.56, 0.08, 0.44, C.beton),
    boite(0.46, 0.28, 0.3, C.mur, 0, 0.08, -0.04),
    ...[-0.18, -0.06, 0.06, 0.18].map(x => cyl(0.024, 0.024, 0.28, C.blanc, x, 0.08, 0.15, 6)),
    toit(0.52, 0.12, 0.4, C.or, 0, 0.36, 0),
  ],
  hopital: () => [
    boite(0.5, 0.3, 0.34, C.blanc), boite(0.52, 0.03, 0.36, PAYS, 0, 0.3),
    boite(0.18, 0.05, 0.05, C.rouge, 0, 0.18, 0.175), boite(0.05, 0.18, 0.05, C.rouge, 0, 0.115, 0.175),
  ],
  caserne: () => [
    boite(0.6, 0.04, 0.5, C.terre),
    boite(0.46, 0.14, 0.16, C.vert, 0, 0.04, -0.14), toit(0.46, 0.07, 0.18, PAYS, 0, 0.18, -0.14),
    boite(0.3, 0.12, 0.14, C.vert, -0.08, 0.04, 0.12), toit(0.3, 0.06, 0.16, PAYS, -0.08, 0.16, 0.12),
    ...drapeau(0.24, 0.04, 0.14),
  ],
  usine_blindes: () => [
    piece(new THREE.CylinderGeometry(0.22, 0.22, 0.56, 10, 1, false, 0, Math.PI), C.gris, 0, 0.0, -0.08, 0, 0, Math.PI / 2),
    boite(0.58, 0.02, 0.46, C.beton, 0, 0, 0.02),
    boite(0.2, 0.06, 0.12, C.vert, 0.1, 0.02, 0.2), boite(0.1, 0.05, 0.08, C.vert, 0.1, 0.08, 0.2),
    piece(new THREE.CylinderGeometry(0.012, 0.012, 0.14), C.sombre, 0.18, 0.11, 0.2, 0, 0, Math.PI / 2),
    boite(0.58, 0.03, 0.03, PAYS, 0, 0.22, 0.14),
  ],
  aeroport: () => [
    boite(0.86, 0.02, 0.18, C.piste, 0, 0, 0.12),
    boite(0.8, 0.021, 0.02, C.blanc, 0, 0, 0.12),
    cyl(0.04, 0.05, 0.4, C.beton, -0.28, 0, -0.18, 8), cyl(0.08, 0.06, 0.08, C.verre, -0.28, 0.4, -0.18, 8),
    piece(new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10, 1, false, 0, Math.PI), PAYS, 0.14, 0, -0.18, 0, 0, Math.PI / 2),
  ],
  port: () => [
    boite(0.7, 0.06, 0.2, C.beton, 0, 0, -0.14),
    boite(0.14, 0.05, 0.36, C.bois, 0.22, 0, 0.12), boite(0.14, 0.05, 0.36, C.bois, -0.2, 0, 0.12),
    boite(0.04, 0.5, 0.04, C.jaune, 0.0, 0.06, -0.16), piece(new THREE.BoxGeometry(0.4, 0.03, 0.03), C.jaune, 0.12, 0.54, -0.16),
    boite(0.16, 0.08, 0.1, PAYS, -0.24, 0.06, -0.16),
  ],
  silo: () => [
    cyl(0.3, 0.32, 0.06, C.beton, 0, 0, 0, 12),
    cyl(0.07, 0.07, 0.46, C.blanc, 0, 0.06, 0, 10), cone(0.07, 0.14, PAYS, 0, 0.52, 0, 10),
    ...[0, 2.1, 4.2].map(a => boite(0.04, 0.1, 0.12, C.sombre, Math.cos(a) * 0.08, 0.06, Math.sin(a) * 0.08, -a)),
  ],
  defense_aa: () => [
    cyl(0.26, 0.3, 0.08, C.beton, 0, 0, 0, 10),
    cyl(0.12, 0.14, 0.12, C.vert, 0, 0.08, 0, 8),
    piece(new THREE.CylinderGeometry(0.015, 0.015, 0.34), C.sombre, 0.05, 0.3, 0.1, 0, 0.9, 0),
    piece(new THREE.CylinderGeometry(0.015, 0.015, 0.34), C.sombre, -0.05, 0.3, 0.1, 0, 0.9, 0),
    boite(0.1, 0.03, 0.1, PAYS, 0, 0.2, 0),
  ],
  fort: () => {
    const p = [];
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      p.push(boite(0.36, 0.16, 0.06, C.gris, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, -a + Math.PI / 2));
      p.push(cyl(0.05, 0.05, 0.22, C.gris, Math.cos(a + Math.PI / 6) * 0.34, 0, Math.sin(a + Math.PI / 6) * 0.34, 6));
    }
    p.push(cyl(0.09, 0.1, 0.34, C.gris, 0, 0, 0, 8), cone(0.12, 0.12, PAYS, 0, 0.34, 0, 8));
    return p;
  },
  radar: () => [
    boite(0.3, 0.06, 0.3, C.beton),
    boite(0.05, 0.4, 0.05, C.metal, 0, 0.06, 0),
    piece(new THREE.SphereGeometry(0.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 3), C.blanc, 0, 0.62, 0.06, 0, -2.1, 0),
    boite(0.12, 0.1, 0.12, PAYS, 0.12, 0.06, 0.1),
  ],
};

const cache = new Map();

/** Géométrie (mise en cache) d'un bâtiment aux couleurs d'une nation. */
export function geometrieBatiment(type, couleurPays) {
  const cle = type + '|' + couleurPays;
  let g = cache.get(cle);
  if (!g) {
    const f = MODELES[type] || (() => [boite(0.4, 0.3, 0.4, C.mur), boite(0.42, 0.04, 0.42, PAYS, 0, 0.3)]);
    g = fusionner(f(), couleurPays);
    cache.set(cle, g);
  }
  return g;
}

export const materielBatiments = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.05 });
