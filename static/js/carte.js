// ══════════════════════════════════════════════════════════════════
// carte.js — Rendu 3D de la carte (Three.js)
// Hexagones extrudes (InstancedMesh), frontieres aux couleurs des
// nations, batiments / armees / missiles en sprites dessines a partir
// des icones VEX, effets (explosions, frappe nucleaire), camera libre.
// ══════════════════════════════════════════════════════════════════

import * as THREE from '../vendor/three.module.min.js';
import { Grille, melanger, BASE } from './util.js';
import { geometrieBatiment, materielBatiments } from './modeles.js';
import { Sol, R, LX, LZ, T_NEANT, bruit, fbm, mulberry } from './sol.js';

// Téléphone / tablette : écran tactile ou petit écran -> rendu allégé.
const MOBILE = matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;

// Sensibilite de la camera (plus petit = plus lent). glisser = 1 : la
// carte suit exactement la souris.
const SENSI = {
  glisser: 1,
  rotation: 0.0028,        // clic droit + glisser (avant : 0.006)
  inclinaison: 0.0018,     // (avant : 0.004)
  zoom: 0.0006,            // molette (avant : 0.0012)
  zoomMax: 0.12,           // par cran de molette (avant : 0.25)
  clavier: 0.45,           // ZQSD / fleches (avant : 0.9)
  rotationClavier: 0.7,    // E / R (avant : 1.2)
  zoomClavier: 0.6,        // + / - (avant : 1)
};
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
    // Carte du monde : vrai pays de chaque case (0 = mer).
    this.regions = init.monde_reel ? Uint8Array.from(atob(init.monde_reel.regions), ch => ch.charCodeAt(0)) : null;
    // Religion (un octet par case) et habitants (echelle log2 x 16) de
    // chaque case, envoyes une fois au chargement.
    const octets = b64 => b64 ? Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)) : new Uint8Array(n);
    this.rel = octets(init.religions);
    this.habLog = octets(init.habitants);
    this.relDefs = new Map((init.defs.religions || []).map(r => [r.id, r]));
    this.enRevolte = new Set();
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
    // Lissage des bords partout (MSAA : presque gratuit sur les GPU de
    // telephone, qui travaillent par tuiles). Pas d'ombres sur mobile.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Resolution : ajustee en direct pour tenir au moins 30 images/s. Sur
    // mobile on part de 1 et on monte jusqu'a 1,5 si le telephone suit.
    this.ratioMax = Math.min(window.devicePixelRatio, 1.5);
    this.ratio = Math.min(this.ratioMax, MOBILE ? 1 : 1.5);
    this.renderer.setPixelRatio(this.ratio);
    // Pas d'ombres sur mobile ; sur ordinateur, seulement autour de la vue.
    this.renderer.shadowMap.enabled = !MOBILE;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 1400);
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
    soleil.castShadow = !MOBILE;
    soleil.shadow.mapSize.set(2048, 2048);
    Object.assign(soleil.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 320 });
    this.soleil = soleil;
    soleil.shadow.bias = -0.0006;
    soleil.shadow.normalBias = 0.05;
    this.scene.add(soleil, soleil.target);

    // Mer translucide au niveau 0 : les fonds marins restent visibles.
    this.eau = new THREE.Mesh(
      new THREE.PlaneGeometry(this.largeurMonde * 8, this.hauteurMonde * 8),
      new THREE.MeshPhongMaterial({ color: sombre ? 0x15466e : 0x2d7db5, transparent: true, opacity: 0.74, shininess: 60, specular: 0x6f93a8, depthWrite: false })
    );
    this.eauPres = new THREE.Color(sombre ? 0x15466e : 0x2d7db5);
    this.eauLoin = new THREE.Color(sombre ? 0x0f3554 : 0x1f5f8f);
    this.eau.rotation.x = -Math.PI / 2;
    this.eau.position.set(this.largeurMonde / 2, 0, this.hauteurMonde / 2);
    this.eau.renderOrder = 1;
    this.eau.receiveShadow = true;
    this.scene.add(this.eau);
    // Fond marin au-dela de la carte : meme couleur, meme profondeur et meme
    // eclairage que l'ocean de la carte, pour qu'aucun bord ne se voie.
    const abysses = new THREE.Mesh(
      new THREE.PlaneGeometry(this.largeurMonde * 8, this.hauteurMonde * 8),
      new THREE.MeshStandardMaterial({ color: sombre ? '#0b2236' : '#1f4f73', roughness: 0.92, metalness: 0 })
    );
    abysses.rotation.x = -Math.PI / 2;
    abysses.position.set(this.largeurMonde / 2, -1.25, this.hauteurMonde / 2);
    this.scene.add(abysses);

    this.cam = { x: this.largeurMonde / 2, z: this.hauteurMonde / 2, d: 70, lacet: 0, tangage: 0.9 };
    // Recul maximal : assez pour voir toute la carte du monde d'un coup.
    this.dMax = Math.max(110, this.largeurMonde * 0.62);
    this.camera.far = Math.max(1400, this.dMax * 3.2);
    this.camera.updateProjectionMatrix();
    // En dessous de ce recul : sol detaille, arbres, grille.
    this.D_DETAIL = 75;
    this.redimensionner();
    new ResizeObserver(() => this.redimensionner()).observe(this.el);

    this.groupes = {};
    for (const k of ['frontieres', 'bords', 'depots', 'bats', 'armees', 'chemins', 'air', 'effets', 'labels', 'selection']) {
      this.groupes[k] = new THREE.Group();
      this.scene.add(this.groupes[k]);
    }
    // Frontieres des vrais pays : apres le relief (altitude), sans bloquer.
    setTimeout(() => this.construireFrontieresReelles(), 0);
  }

  redimensionner() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Recul maximal selon la forme de l'ecran : en portrait (telephone tenu
    // droit), il faut reculer plus pour voir toute la largeur du monde.
    if (this.largeurMonde) this.dMax = Math.max(110, this.largeurMonde * 0.62 * Math.max(1, 1.5 / this.camera.aspect));
  }

  pos(i) {
    const [x, y] = this.g.xy(i);
    return [LX * (x + 0.5 * (y & 1)), LZ * y];
  }

  /** Altitude du sol au centre d'une case (jamais sous l'eau pour les sprites). */
  haut(i) {
    let h = this.hCase[i];
    if (h !== h) { const [x, z] = this.pos(i); h = this.hCase[i] = Math.max(0.05, this.altitude(x, z)); } // calcul a la demande
    return h;
  }

  /** Altitude du terrain en un point (calcul partage avec sol-worker.js). */
  altitude(x, z) {
    return this.sol.altitude(x, z);
  }

  /** Des cases ont change de terrain (cratere d'antimatiere) : le relief
   *  s'enfonce autour d'elles (carte lointaine recalculee, tuiles refaites). */
  reformer(cases, delai = 0) {
    setTimeout(() => {
      const zone = new Set(cases);
      for (const i of cases) for (const v of this.g.voisins(i)) if (v >= 0) zone.add(v);
      for (const i of zone) this.hCase[i] = NaN;
      const touchees = new Set();
      for (const i of zone) { const [x, z] = this.pos(i); touchees.add(this.cleTuile(x, z)); }
      for (const c of touchees) this.jeterTuile(c);
      const modifs = cases.map(i => [i, this.terrain[i]]);
      if (this.travailleur) this.travailleur.postMessage({ t: 'terrain', cases: modifs, pasLoin: this.pasLoin });
      else this.poserLoin(this.sol.maillageLoin(this.pasLoin));
      for (const i of zone) if (this.bat[i]) this.majBatiment(i);
      this.couleursSales = true;
      this.bordSale = true;
    }, delai);
  }

  initTerrain() {
    const n = this.g.n;
    const sombre = this.theme === 'dark';
    // Calcul du sol (relief, couleurs) : partage avec le travailleur.
    this.sol = new Sol(this.terrain, this.g.l, this.g.h, sombre, MOBILE, !!this.regions);
    // Altitude des cases : calculee a la demande (voir haut()).
    this.hCase = new Float32Array(n).fill(NaN);

    // ── Teintes par case (pays, ressources, brouillard), lues par la carte
    // graphique : une petite image (4 octets par case) au lieu de recolorer
    // des millions de sommets a chaque message du serveur.
    const lt = 1024, ht = Math.ceil(n / lt);
    this.teintes = new THREE.DataTexture(new Uint8Array(lt * ht * 4), lt, ht, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.teintes.magFilter = this.teintes.minFilter = THREE.NearestFilter;
    this.teintes.needsUpdate = true;
    const [vr, vg, vb] = sombre ? [0.06, 0.08, 0.1] : [0.86, 0.89, 0.92];
    const uniformes = { tCases: { value: this.teintes }, uVoile: { value: new THREE.Vector3(vr, vg, vb) } };
    this.matSol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.matSol.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniformes);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aCase;
uniform sampler2D tCases;
varying vec4 vTeinte;
varying float vBrume;
varying float vHaut;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vHaut = position.y; vTeinte = vec4(0.0); vBrume = 0.0;
if (aCase >= 0.0) {
  int ci = int(aCase + 0.5);
  vec4 t = texelFetch(tCases, ivec2(ci % 1024, ci / 1024), 0);
  float v = floor(t.a * 255.0 + 0.5);
  vBrume = v >= 128.0 ? 1.0 : 0.0;
  vTeinte = vec4(t.rgb, mod(v, 128.0) / 127.0);
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uVoile;
varying vec4 vTeinte;
varying float vBrume;
varying float vHaut;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
if (vHaut > -0.05) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vTeinte.rgb, vTeinte.a);
  // Brouillard : on garde les vraies couleurs, juste ternies (avant, tout
  // le monde devenait gris uniforme). Le fond de la mer n'est pas voile :
  // sinon il ne raccordait plus avec le fond autour de la carte.
  if (vBrume > 0.5) {
    float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, vec3(l), 0.25), uVoile, 0.1);
  }
}`);
    };
    this.matSol.customProgramCacheKey = () => 'sol-wfront';
    // Carte lointaine : meme materiau. De pres, elle est un peu abaissee
    // (voir majTuiles) pour que les tuiles detaillees passent devant. Pas de
    // decalage de profondeur : vu en biais et de loin, il repoussait tout
    // le sol derriere la mer.
    this.matLoin = this.matSol;

    // ── Carte lointaine : tout le monde, allegee (vue d'ensemble) ──
    const surface = (this.largeurMonde + LX * 3) * (this.hauteurMonde + LZ * 3);
    this.pasLoin = Math.max(0.3, Math.sqrt(surface / (MOBILE ? 2.5e5 : 4e5)));
    this.reliefLoin = new THREE.Mesh(new THREE.BufferGeometry(), this.matLoin);
    this.reliefLoin.receiveShadow = !MOBILE;
    this.reliefLoin.visible = false;
    this.reliefLoin.position.y = 0;
    this.scene.add(this.reliefLoin);
    // Travailleur : calcule le sol en parallele de l'affichage. Sans lui
    // (navigateur trop ancien), le calcul se fait ici, par petits morceaux.
    this.attente = new Map();     // tuiles demandees : cle -> version
    this.versionTuile = 0;
    try {
      this.travailleur = new Worker(new URL('./sol-worker.js', import.meta.url), { type: 'module' });
      this.travailleur.onmessage = e => this.recevoirSol(e.data);
      this.travailleur.onerror = () => this.sansTravailleur();
      this.travailleur.postMessage({ t: 'init', terrain: this.terrain.slice(), l: this.g.l, h: this.g.h, sombre, mobile: MOBILE, reel: !!this.regions, pasLoin: this.pasLoin });
    } catch (x) {
      this.sansTravailleur();
    }

    // ── Tuiles detaillees (sol fin, grille, arbres), construites a la
    // demande autour de ce que l'on regarde ──
    this.TUILE = 24;
    this.pasPres = MOBILE ? 0.5 : 0.3;
    this.tuiles = new Map();
    this.groupes.tuiles = new THREE.Group();
    this.scene.add(this.groupes.tuiles);
    this.arbresGeo = this.geometriesArbres();
    this.matArbre = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, vertexColors: true });
    this.matGrille = new THREE.LineBasicMaterial({ color: sombre ? 0xffffff : 0x1c2a1c, transparent: true, opacity: sombre ? 0.05 : 0.06, depthWrite: false });

    // Contour de survol / selection : anneau hexagonal epais, toujours visible.
    this.anneauGeo = this.geometrieAnneau(0.14);
    this.survolMesh = new THREE.Mesh(this.anneauGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.selMesh = new THREE.Mesh(this.anneauGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 1, depthTest: false }));
    this.survolMesh.visible = this.selMesh.visible = false;
    this.survolMesh.renderOrder = this.selMesh.renderOrder = 10;
    this.groupes.selection.add(this.survolMesh, this.selMesh);
  }

  /** Geometrie Three.js depuis les tableaux calcules par sol.js. */
  geoDepuis(d) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
    geo.setAttribute('aCase', new THREE.BufferAttribute(d.cas, 1));
    geo.setIndex(new THREE.BufferAttribute(d.idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  poserLoin(d) {
    const ancienne = this.reliefLoin.geometry;
    this.reliefLoin.geometry = this.geoDepuis(d);
    ancienne.dispose();
    this.loinPret = true;
    this.reliefLoin.visible = true;
  }

  /** Reponse du travailleur : carte lointaine ou tuile. */
  recevoirSol(m) {
    if (m.t === 'loin') this.poserLoin(m.loin);
    else if (m.t === 'tuile') {
      if (this.attente.get(m.cle) !== m.version) return; // tuile jetee entre-temps
      this.attente.delete(m.cle);
      this.poserTuile(m.cle, m);
    }
  }

  /** Pas de travailleur : tout se calcule ici. */
  sansTravailleur() {
    if (this.travailleur) { this.travailleur.terminate(); this.travailleur = null; }
    this.attente.clear();
    if (!this.loinPret) this.poserLoin(this.sol.maillageLoin(this.pasLoin));
  }

  /** Geometries des deux modeles d'arbres (conifere a etages, feuillu). */
  geometriesArbres() {
    const assembler = parts => {
      let n2 = 0;
      const geos = parts.map(([g, coul]) => { const ng = g.index ? g.toNonIndexed() : g; n2 += ng.attributes.position.count; return [ng, new THREE.Color(coul)]; });
      const posA = new Float32Array(n2 * 3), norA = new Float32Array(n2 * 3), colA = new Float32Array(n2 * 3);
      let o = 0;
      for (const [g, c] of geos) {
        g.computeVertexNormals();
        posA.set(g.attributes.position.array, o * 3); norA.set(g.attributes.normal.array, o * 3);
        for (let v = 0; v < g.attributes.position.count; v++) colA.set([c.r, c.g, c.b], (o + v) * 3);
        o += g.attributes.position.count;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(posA, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
      out.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      return out;
    };
    const seg = MOBILE ? 5 : 7;
    const trn = (rb, rh, hh) => { const g = new THREE.CylinderGeometry(rh, rb, hh, 5); g.translate(0, hh / 2, 0); return g; };
    const cn = (r, hh, y) => { const g = new THREE.ConeGeometry(r, hh, seg); g.translate(0, y + hh / 2, 0); return g; };
    const conifere = MOBILE
      ? assembler([[trn(0.03, 0.022, 0.12), '#d9b48a'], [cn(0.16, 0.3, 0.08), '#ffffff'], [cn(0.1, 0.22, 0.26), '#ededed']])
      : assembler([[trn(0.03, 0.022, 0.12), '#d9b48a'], [cn(0.17, 0.26, 0.08), '#ffffff'], [cn(0.13, 0.22, 0.2), '#f2f2f2'], [cn(0.085, 0.18, 0.31), '#e6e6e6']]);
    const couronne = new THREE.IcosahedronGeometry(0.15, MOBILE ? 0 : 1);
    { const pp = couronne.attributes.position; for (let v = 0; v < pp.count; v++) { const f = 0.85 + 0.3 * bruit(pp.getX(v) * 9 + 3, pp.getZ(v) * 9 + pp.getY(v) * 5); pp.setXYZ(v, pp.getX(v) * f, pp.getY(v) * f * 0.85, pp.getZ(v) * f); } couronne.translate(0, 0.27, 0); }
    const parts = [[trn(0.032, 0.022, 0.2), '#d9b48a'], [couronne, '#ffffff']];
    if (!MOBILE) { const petite = new THREE.IcosahedronGeometry(0.09, 0); petite.translate(0.07, 0.35, -0.04); parts.push([petite, '#eeeeee']); }
    return [conifere, assembler(parts)];
  }

  cleTuile(x, z) {
    return Math.floor((x + LX * 1.5) / this.TUILE) + ',' + Math.floor((z + LZ * 1.5) / this.TUILE);
  }

  jeterTuile(cle) {
    this.attente.delete(cle);
    const t = this.tuiles.get(cle);
    if (!t) return;
    this.groupes.tuiles.remove(t.groupe);
    t.groupe.traverse(o => { if (o.geometry && o.geometry !== this.arbresGeo[0] && o.geometry !== this.arbresGeo[1]) o.geometry.dispose(); });
    this.tuiles.delete(cle);
  }

  /** Demande la tuile (tx, tz) : au travailleur, ou calcul immediat. */
  demanderTuile(tx, tz) {
    const cle = tx + ',' + tz, version = ++this.versionTuile;
    this.attente.set(cle, version);
    if (this.travailleur) this.travailleur.postMessage({ t: 'tuile', tx, tz, T: this.TUILE, pas: this.pasPres, cle, version });
    else { this.attente.delete(cle); this.poserTuile(cle, this.sol.tuile(tx, tz, this.TUILE, this.pasPres)); }
  }

  /** Pose une tuile calculee : sol detaille, grille, arbres. */
  poserTuile(cle, d) {
    const [tx, tz] = cle.split(',').map(Number);
    if (this.tuiles.has(cle)) this.jeterTuile(cle);
    const groupe = new THREE.Group();
    const sol = new THREE.Mesh(this.geoDepuis(d.sol), this.matSol);
    sol.receiveShadow = !MOBILE;
    groupe.add(sol);
    if (d.grille.length) {
      const gl = new THREE.BufferGeometry();
      gl.setAttribute('position', new THREE.BufferAttribute(d.grille, 3));
      const grille = new THREE.LineSegments(gl, this.matGrille);
      grille.userData.grille = true;
      grille.visible = this.cam.d < 60;
      groupe.add(grille);
    }
    const parCase = new Map();
    d.arbres.forEach((a, type) => {
      const nb = a.cas.length;
      if (!nb) return;
      const im = new THREE.InstancedMesh(this.arbresGeo[type], this.matArbre, nb);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(a.mat, 16);
      im.instanceColor = new THREE.InstancedBufferAttribute(a.cou, 3);
      for (let k = 0; k < nb; k++) {
        const i = a.cas[k];
        if (!parCase.has(i)) parCase.set(i, []);
        parCase.get(i).push([im, k, new THREE.Matrix4().fromArray(a.mat, 16 * k)]);
      }
      im.castShadow = !MOBILE;
      im.computeBoundingSphere();
      groupe.add(im);
    });
    const tuile = { groupe, parCase, cle, tx, tz };
    this.tuiles.set(cle, tuile);
    this.groupes.tuiles.add(groupe);
    // Pas d'arbres sous les batiments deja construits.
    for (const i of parCase.keys()) if (this.bat[i]) this.arbresVisibles(i, false);
  }

  /** Zone du sol visible (rectangle), d'apres les coins de l'ecran. */
  zoneVisible() {
    const ray = this._ray ??= new THREE.Raycaster(), plan = this._plan ??= new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // Au-dela, les details ne se voient plus : la carte lointaine suffit.
    const p = new THREE.Vector3(), lim = Math.max(45, this.cam.d * 1.7);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [-1, 0], [1, 0]]) {
      ray.setFromCamera({ x: sx, y: sy }, this.camera);
      let ok = ray.ray.intersectPlane(plan, p);
      if (!ok || p.distanceTo(this.camera.position) > lim) {
        // Vers l'horizon : on s'arrete a la distance utile.
        p.copy(this.camera.position).addScaledVector(ray.ray.direction, lim); p.y = 0;
      }
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    return [x0, x1, z0, z1];
  }

  /** De pres : construit les tuiles visibles (quelques-unes par image) ; de
   *  loin : la carte allegee suffit. */
  majTuiles() {
    const pres = this.cam.d < this.D_DETAIL;
    // La carte lointaine reste toujours dessous : les tuiles detaillees
    // apparaissent par-dessus au fur et a mesure, sans trou ni attente.
    this.groupes.tuiles.visible = pres;
    this.reliefLoin.position.y = pres ? -0.12 : 0;
    if (!pres) return;
    const T = this.TUILE, ox = -LX * 1.5, oz = -LZ * 1.5;
    const [x0, x1, z0, z1] = this.zoneVisible();
    const ta = Math.floor((x0 - ox) / T), tb = Math.floor((x1 - ox) / T), ua = Math.floor((z0 - oz) / T), ub = Math.floor((z1 - oz) / T);
    const ntx = Math.ceil((this.largeurMonde + LX * 3) / T), ntz = Math.ceil((this.hauteurMonde + LZ * 3) / T);
    const voulues = [];
    for (let u = Math.max(0, ua - 1); u <= Math.min(ntz - 1, ub + 1); u++) for (let t = Math.max(0, ta - 1); t <= Math.min(ntx - 1, tb + 1); t++) voulues.push([t, u]);
    const cx = (this.cam.x - ox) / T, cz = (this.cam.z - oz) / T;
    voulues.sort((a, b) => Math.hypot(a[0] + 0.5 - cx, a[1] + 0.5 - cz) - Math.hypot(b[0] + 0.5 - cx, b[1] + 0.5 - cz));
    // Avec le travailleur : jusqu'a 6 tuiles en preparation a la fois. Sans
    // lui : une seule par image, pour ne pas figer l'affichage.
    let place = this.travailleur ? 6 - this.attente.size : 1;
    for (const [t, u] of voulues) {
      const cle = t + ',' + u;
      if (this.tuiles.has(cle) || this.attente.has(cle)) continue;
      if (place-- <= 0) break;
      this.demanderTuile(t, u);
    }
    const grilleVue = this.cam.d < 60;
    const op = (this.theme === 'dark' ? 0.05 : 0.06) * Math.min(1, (60 - this.cam.d) / 25);
    this.matGrille.opacity = op;
    for (const tu of this.tuiles.values()) tu.groupe.children.forEach(o => { if (o.userData.grille) o.visible = grilleVue; });
    // Memoire : on garde les tuiles proches, on jette les plus lointaines.
    const max = MOBILE ? 70 : 180;
    if (this.tuiles.size > max) {
      const loin = [...this.tuiles.values()].sort((a, b) => Math.hypot(b.tx + 0.5 - cx, b.tz + 0.5 - cz) - Math.hypot(a.tx + 0.5 - cx, a.tz + 0.5 - cz));
      for (const tu of loin.slice(0, this.tuiles.size - max)) this.jeterTuile(tu.cle);
    }
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
    const n = this.g.n, d = this.teintes.image.data;
    const cache = this._teintesPays ??= new Map(), c = new THREE.Color();
    const rgb = hex => { let v = cache.get(hex); if (!v) { c.set(hex); v = [c.r * 255, c.g * 255, c.b * 255]; cache.set(hex, v); } return v; };
    for (let i = 0; i < n; i++) {
      let a = 0, col = null;
      const t = this.defs.terrains[this.terrain[i]];
      if (this.mode === 'politique' && this.proprio[i] >= 0) {
        const pa = this.pays.get(this.proprio[i]);
        if (pa) { col = rgb(pa._teinte ??= melanger(pa.couleur, '#ffffff', 0.12)); a = 0.42; }
      } else if (this.mode === 'religions' && t.terre) {
        const r = this.relDefs.get(this.rel[i]);
        if (r) { col = rgb(r.couleur); a = 0.62; }
      } else if (this.mode === 'ressources' && t.terre) {
        const dd = this.depot[i];
        if (dd > 0) { col = rgb(this.defs.depots[dd].couleur); a = 0.7; } else { col = rgb('#9ca3af'); a = 0.45; }
      }
      if (this.irr[i]) { col = rgb('#b6ff3b'); a = 0.55; }
      if (this.enRevolte.has(i)) { col = rgb('#ef4444'); a = 0.6; }
      if (this.zone && this.zone.has(i)) { col = rgb(this.zoneCouleur); a = Math.max(a, 0.4); }
      const brume = this.vision && !this.vision[i] ? 128 : 0;
      const o = 4 * i;
      if (col) { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; }
      d[o + 3] = Math.round(a * 127) + brume;
    }
    this.teintes.needsUpdate = true;
    this.couleursSales = false;
    this.derniereTeinte = performance.now();
  }

  // ── Frontieres (rubans qui epousent le relief) ────────────────────
  /** Carte du monde : fines frontieres des vrais pays (fixes). */
  construireFrontieresReelles() {
    if (!this.regions) return;
    const pos = [];
    for (let i = 0; i < this.g.n; i++) {
      const r = this.regions[i];
      if (!r) continue;
      const [x, z] = this.pos(i);
      this.g.voisins(i).forEach((v, k) => {
        if (v < 0 || !this.regions[v] || this.regions[v] === r) return;
        const [a, b] = DIRS_COINS[k];
        const A = this.coin(a), B = this.coin(b), A2 = this.coin(a, 0.95), B2 = this.coin(b, 0.95);
        const P = [[x + A[0], z + A[1]], [x + B[0], z + B[1]], [x + B2[0], z + B2[1]], [x + A2[0], z + A2[1]]];
        const h = P.map(([px, pz]) => Math.max(0.03, this.altitude(px, pz)) + 0.06);
        for (const t of [0, 1, 2, 0, 2, 3]) pos.push(P[t][0], h[t], P[t][1]);
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c1e21, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 1;
    this.groupes.frontieres.add(mesh);
  }

  construireBords() {
    const pos = [], col = [];
    const c = new THREE.Color(), bc = new THREE.Color();
    // Le relief ne change jamais : la hauteur de chaque point de frontiere
    // est calculee une seule fois (altitude() est couteuse), puis reprise a
    // chaque reconstruction.
    const cache = this.cacheBords ??= new Map();
    const y = (x, z) => {
      const k = Math.round(x * 512) * 65536 + Math.round(z * 512);
      let h = cache.get(k);
      if (h === undefined) { h = Math.max(0.03, this.altitude(x, z)) + 0.07; cache.set(k, h); }
      return h;
    };
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
    this.bordMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.bordMesh = new THREE.Mesh(g, this.bordMat);
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

  /** Habitants approximatifs d'une case (chiffre recu au chargement). */
  habitants(i) { return Math.max(0, Math.pow(2, this.habLog[i] / 16) - 1); }

  majEtat(e) {
    this.recu = performance.now();
    if (e.revoltes) {
      const cases = new Set(e.revoltes.flatMap(r => r.cases));
      if (cases.size !== this.enRevolte.size || [...cases].some(k => !this.enRevolte.has(k))) { this.enRevolte = cases; this.couleursSales = true; }
    }
    if (e.cases && e.cases.length) {
      const terrains = [];
      for (const [i, p, b, nv, ir, t, r] of e.cases) {
        if (t !== undefined && this.terrain[i] !== t) { this.terrain[i] = t; terrains.push(i); }
        if (r !== undefined && this.rel[i] !== r) { this.rel[i] = r; this.relSales = true; if (this.mode === 'religions') this.labelsSales = true; }
        if (this.proprio[i] !== p) { this.bordSale = true; this.labelsSales = true; }
        this.proprio[i] = p;
        this.bat[i] = b;
        this.niv[i] = nv;
        this.irr[i] = ir;
        this.majBatiment(i);
      }
      // Cratere : le sol s'enfonce juste apres l'eclair de l'antimatiere.
      if (terrains.length) this.reformer(terrains, 700);
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
        this.appliquerVision();
      } else if (!e.vision && this.vision) {
        this.vision = null;
        this.couleursSales = true;
        this.appliquerVision();
      }
      this.visionHex = e.vision;
    }
    this.armees = e.armees || [];
    this.missions = e.missions || [];
    this.missiles = e.missiles || [];
    this.majArmees();
    this.majAir();
    for (const f of e.effets || []) this.effet(f.genre, f.case, f.rayon || 0);
    if (e.nuages) this.majNuages(e.nuages);
    if (e.trous_noirs) this.majTrousNoirs(e.trous_noirs);
    if (this.batsSales) {
      for (let i = 0; i < this.g.n; i++) if (this.bat[i]) this.majBatiment(i);
      this.batsSales = false;
    }
  }

  /** Petit modèle 3D du bâtiment, plus grand avec le niveau, et son
   *  numéro de niveau dans une pastille aux couleurs du pays. */
  // Brouillard de guerre : montre/cache les sprites selon ce que le joueur voit.
  appliquerVision() {
    const vu = i => !this.vision || !!this.vision[i];
    this.spritesBat.forEach((g, i) => { g.visible = vu(i); });
    this.spritesDepot.forEach((s, i) => { s.visible = vu(i); });
    this.labelsSales = true;
  }

  /** Montre ou cache les arbres d'une case (une foret laisse la place au batiment). */
  arbresVisibles(i, visibles) {
    if (!this.tuiles) return;
    const [x, z] = this.pos(i);
    const t = this.tuiles.get(this.cleTuile(x, z));
    const l = t && t.parCase.get(i);
    if (!l) return;
    const vide = this._vide ??= new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [im, idx, m] of l) { im.setMatrixAt(idx, visibles ? m : vide); im.instanceMatrix.needsUpdate = true; }
  }

  majBatiment(i) {
    this.arbresVisibles(i, !this.bat[i]);
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
    // Modeles detailles et plus petits que la case ; ils grandissent un peu avec le niveau.
    const echelle = (b === 'capitale' ? 1.2 : 1) * (0.92 + 0.04 * Math.min(niv, 8));
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
    groupe.visible = !this.vision || !!this.vision[i];   // caché sous le brouillard
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
  /** Trous noirs permanents : sphere noire, deux disques d'accretion qui
   *  tournent et de la matiere aspiree, a la taille de leur rayon. */
  majTrousNoirs(liste) {
    this.trousVus ??= new Map();
    const vus = new Set();
    const mat = (couleur, op) => new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    for (const t of liste) {
      vus.add(t.id);
      let o = this.trousVus.get(t.id);
      if (!o) {
        const g = new THREE.Group();
        const coeur = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        coeur.renderOrder = 8;
        const d1 = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.9, 96), mat(0xff6e40, 0.6));
        const d2 = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.65, 96), mat(0xb388ff, 0.6));
        d1.renderOrder = d2.renderOrder = 6;
        const n = 220, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd180, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        pts.renderOrder = 6;
        const part = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: 0.8 + Math.random() * 1.2, h: (Math.random() - 0.5) * 0.4, v: 0.5 + Math.random(), p: Math.random() }));
        // Horizon : disque noir au ras du sol et liseré violet, la carte avalee.
        const horizon = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x030106, transparent: true, opacity: 0.93, depthWrite: false, fog: false }));
        horizon.renderOrder = 2;
        const lisere = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.06, 96).rotateX(-Math.PI / 2), mat(0x9c27b0, 0.55));
        lisere.renderOrder = 3;
        g.add(coeur, d1, d2, pts, horizon, lisere);
        const [x, z] = this.pos(t.case);
        g.position.set(x, this.haut(t.case), z);
        this.groupes.effets.add(g);
        o = { g, coeur, d1, d2, pts, part, pos, horizon, lisere, y0: this.haut(t.case) };
        this.trousVus.set(t.id, o);
      }
      // Taille du monde : une case ~ 1,6 unite ; grossit en douceur.
      o.cible = Math.max(3, t.rayon) * 1.6;
      o.rayon = t.rayon;
      o.echelle ??= o.cible;
    }
    for (const [id, o] of this.trousVus) {
      if (!vus.has(id)) {
        this.groupes.effets.remove(o.g);
        o.g.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        this.trousVus.delete(id);
      }
    }
  }

  animerTrousNoirs(t) {
    if (!this.trousVus) return;
    for (const o of this.trousVus.values()) {
      o.echelle += (o.cible - o.echelle) * 0.02;
      const R = o.echelle;
      o.g.scale.setScalar(R);
      o.g.position.y = o.y0;
      o.coeur.position.y = o.d1.position.y = o.d2.position.y = o.pts.position.y = 0.45;
      // Horizon au ras de l'eau (y = 0,04), rayon reel de la zone avalee.
      o.horizon.position.y = o.lisere.position.y = (0.04 - o.y0) / R;
      const rh = (Math.max(0.5, o.rayon) + 0.5) * 1.6 / R;
      o.horizon.scale.setScalar(rh);
      o.lisere.scale.setScalar(rh);
      o.lisere.material.opacity = 0.4 + 0.2 * Math.sin(t * 0.004);
      o.d1.rotation.set(-Math.PI / 2 + 0.35, 0, t * 0.0012);
      o.d2.rotation.set(-Math.PI / 2 - 0.25, 0, -t * 0.0018);
      o.part.forEach((q, j) => {
        const f = 1 - ((t * 0.00012 * q.v + q.p) % 1);
        const a = q.a + t * 0.0006 * q.v * (1 + 3 * (1 - f));
        o.pos[3 * j] = Math.cos(a) * q.r * f; o.pos[3 * j + 1] = q.h * f; o.pos[3 * j + 2] = Math.sin(a) * q.r * f;
      });
      o.pts.geometry.attributes.position.needsUpdate = true;
    }
  }

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
      s.visible = !this.vision || !!this.vision[i];   // caché sous le brouillard
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
    if (this.mode === 'religions') { this.labelsReligions(); this.labelsSales = false; return; }
    const sommes = new Map();
    for (let i = 0; i < this.g.n; i++) {
      const p = this.proprio[i];
      if (p < 0) continue;
      if (this.vision && !this.vision[i]) continue;   // nation invisible sous le brouillard
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

  /** Noms des religions : taille en pixels selon la region (70 a 170 px
   *  de large), et les plus petits qui chevauchent un plus grand sont caches. */
  placerNomsReligions() {
    const el = this.renderer.domElement, W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const f = 2 / (this.camera.projectionMatrix.elements[5] * H);
    const v = new THREE.Vector3(), places = [];
    const liste = [...this.groupes.labels.children].sort((a, b) => b.userData.n - a.userData.n);
    for (const s of liste) {
      const px = Math.min(170, Math.max(70, 50 + Math.sqrt(s.userData.n) * 2));
      s.scale.set(px * f, px * 0.1875 * f, 1);
      v.copy(s.position).project(this.camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      const r = { x0: x - px * s.userData.part / 2 - 4, x1: x + px * s.userData.part / 2 + 4, y0: y - px * 0.1 - 3, y1: y + px * 0.1 + 3 };
      const dehors = v.z > 1 || r.x1 < 0 || r.x0 > W || r.y1 < 0 || r.y0 > H;
      const chevauche = places.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      s.visible = !dehors && !chevauche;
      if (s.visible) places.push(r);
    }
  }

  /** Mode religions : le nom de chaque grande region religieuse (regions
   *  d'un seul tenant d'au moins 40 cases), ecrit en son centre. */
  labelsReligions() {
    if (!this._zonesRel || this.relSales) {
      const n = this.g.n, vu = new Uint8Array(n), zones = [];
      for (let i0 = 0; i0 < n; i0++) {
        const r = this.rel[i0];
        if (vu[i0] || !r || !this.defs.terrains[this.terrain[i0]].terre) continue;
        const pile = [i0];
        vu[i0] = 1;
        let sx = 0, sz = 0, k = 0;
        while (pile.length) {
          const i = pile.pop();
          const [x, z] = this.pos(i);
          sx += x; sz += z; k++;
          for (const v of this.g.voisins(i)) {
            if (v >= 0 && !vu[v] && this.rel[v] === r && this.defs.terrains[this.terrain[v]].terre) { vu[v] = 1; pile.push(v); }
          }
        }
        if (k >= 150) zones.push({ r, x: sx / k, z: sz / k, n: k });
      }
      this._zonesRel = zones;
      this.relSales = false;
    }
    for (const zn of this._zonesRel) {
      const d = this.relDefs.get(zn.r);
      if (!d) continue;
      // Taille fixe a l'ecran (placerNomsReligions), plus grande pour les
      // grandes regions ; les noms qui se chevauchent sont caches.
      const sp = this.sprite(this.texTexte(d.nom, melanger(d.couleur, '#ffffff', 0.55), 46), 0.1, 1, 0.1875);
      sp.material.sizeAttenuation = false;
      const mesure = (this._mesure ??= document.createElement('canvas').getContext('2d'));
      mesure.font = "800 46px 'Segoe UI', Arial, sans-serif";
      sp.userData = { n: zn.n, part: Math.min(1, (mesure.measureText(d.nom).width + 24) / 512) };
      sp.position.set(zn.x, 4.2, zn.z);
      sp.renderOrder = 9;
      sp.material.depthTest = false;
      this.groupes.labels.add(sp);
    }
  }

  // ── Effets ──────────────────────────────────────────────────────
  /** Animation ponctuelle sur une case. `rayon` (cases) : taille reelle de
   *  l'arme (frappe nucleaire, trou noir, antimatiere). Chaque arme a la
   *  sienne : croisiere, balistique, nucleaire (champignon), trou noir
   *  (disque qui aspire), antimatiere (implosion puis cratere). */
  effet(genre, i, rayon = 0) {
    const [x, z] = this.pos(i);
    const y = this.haut(i);
    const T = THREE;
    // Un objet anime : maj(k) avec k de 0 a 1 sur `duree` ms, apres `delai`.
    const anim = (obj, duree, maj, delai = 0) => {
      // Dessine apres la mer transparente (renderOrder 1), sinon elle les voile.
      obj.renderOrder = Math.max(obj.renderOrder, 5);
      this.effets.push({ m: obj, t0: performance.now() + delai, duree, maj });
    };
    const mat = (couleur, opacite = 0.9, additif = true) => new T.MeshBasicMaterial({
      color: couleur, transparent: true, opacity: opacite, depthWrite: false, side: T.DoubleSide, fog: false,
      blending: additif ? T.AdditiveBlending : T.NormalBlending,
    });
    const boule = (couleur, op = 0.9, add = true) => new T.Mesh(new T.SphereGeometry(1, 28, 18), mat(couleur, op, add));
    const anneau = (couleur, op = 0.9, int = 0.85) => new T.Mesh(new T.RingGeometry(int, 1, 72).rotateX(-Math.PI / 2), mat(couleur, op));
    const place = (o, h = 0.4) => { o.position.set(x, y + h, z); o.scale.setScalar(0.01); return o; };
    // Boule ou anneau qui gonfle et s'efface.
    const gonfle = (o, duree, echelle, op = 0.9, h = 0.4, delai = 0, puiss = 0.45) => {
      place(o, h);
      anim(o, duree, k => { o.scale.setScalar(0.05 + echelle * Math.pow(k, puiss)); o.material.opacity = op * (1 - k); }, delai);
    };
    // Debris / etincelles projetes puis retombant.
    const debris = (n, couleur, vitesse, duree, taille = 0.14, gravite = 5, delai = 0) => {
      const g = new T.BufferGeometry(), p = new Float32Array(n * 3), v = [];
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.1, s = vitesse * (0.35 + Math.random() * 0.9);
        v.push([Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s * 1.2, Math.sin(a) * Math.cos(e) * s]);
      }
      g.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ color: couleur, size: taille, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      pts.position.set(x, y + 0.3, z);
      anim(pts, duree, k => {
        const t = k * duree / 1000;
        for (let j = 0; j < n; j++) {
          p[3 * j] = v[j][0] * t; p[3 * j + 1] = Math.max(-0.2, v[j][1] * t - gravite * t * t / 2); p[3 * j + 2] = v[j][2] * t;
        }
        g.attributes.position.needsUpdate = true;
        pts.material.opacity = 1 - k * k;
      }, delai);
    };
    // Fumee grise qui monte et se dissipe.
    const fumee = (taille, montee, duree, delai = 0, couleur = 0x6d6d6d) => {
      const o = place(boule(couleur, 0.55, false), 0.5);
      anim(o, duree, k => {
        o.position.y = y + 0.5 + montee * Math.pow(k, 0.6);
        o.scale.set(taille * (0.4 + k), taille * (0.3 + 0.6 * k), taille * (0.4 + k));
        o.material.opacity = 0.55 * (1 - k);
      }, delai);
    };
    const sphere = () => boule(0xffffff);

    if (genre === 'explosion') {
      // Missile de croisiere : boule de feu nette, onde au sol, fumee.
      gonfle(boule(0xffd180), 350, 1.0, 1, 0.5);
      gonfle(boule(0xff6d00), 1100, 1.7, 0.95, 0.5);
      gonfle(anneau(0xffcc80), 900, 3, 0.8, 0.1);
      debris(28, 0xffab40, 3, 1200, 0.12);
      fumee(1.2, 2, 2600, 300);
    } else if (genre === 'balistique') {
      // Missile balistique : arrivee a la verticale, impact plus large.
      const trait = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1, 8), mat(0xfff3e0, 0.9));
      trait.position.set(x, y + 6, z);
      anim(trait, 250, k => { trait.scale.set(1, 12 * (1 - k) + 0.1, 1); trait.position.y = y + 6 * (1 - k) + 0.3; });
      gonfle(boule(0xffffff), 450, 1.6, 1, 0.5, 220);
      gonfle(boule(0xff3d00), 1500, 2.6, 0.95, 0.6, 220);
      gonfle(anneau(0xffe0b2), 1300, 5, 0.85, 0.1, 220);
      gonfle(anneau(0xff9100, 0.6), 1800, 3.5, 0.6, 0.1, 420);
      debris(70, 0xff9e40, 4.5, 1600, 0.16, 5, 220);
      fumee(1.8, 3, 3400, 500);
    } else if (genre === 'nucleaire') {
      // Champignon atomique a la taille de l'explosion.
      const R = Math.min(30, Math.max(2.5, (rayon || 4) * 1.5));
      this.rappels.flash?.();
      gonfle(boule(0xffffff, 1), 900, R * 0.55, 1, 0.6, 0, 0.3);
      gonfle(anneau(0xfff8e1, 1, 0.9), 2600, R * 1.15, 0.9, 0.15, 100, 0.6);
      gonfle(anneau(0xffab40, 0.7, 0.7), 3600, R * 0.85, 0.7, 0.12, 300, 0.7);
      // Lueur au sol
      const sol = place(new T.Mesh(new T.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mat(0xff6d00, 0.8)), 0.12);
      anim(sol, 6000, k => { sol.scale.setScalar(R * 0.55 * Math.min(1, k * 4)); sol.material.opacity = 0.8 * (1 - k); });
      // Colonne qui monte
      const H = R * 1.1;
      const pied = new T.Mesh(new T.CylinderGeometry(0.22, 0.42, 1, 18, 1, true).translate(0, 0.5, 0), mat(0x8d6e63, 0.75, false));
      pied.position.set(x, y + 0.2, z);
      anim(pied, 7500, k => {
        const m = Math.min(1, k * 2.2);
        pied.scale.set(R * 0.28, H * m, R * 0.28);
        pied.material.opacity = 0.75 * (k < 0.7 ? 1 : (1 - k) / 0.3);
      }, 300);
      // Boule de feu qui monte et devient le chapeau
      const feu = place(boule(0xff9100, 1), 0.6);
      anim(feu, 7500, k => {
        const m = Math.min(1, k * 2.2);
        feu.position.y = y + 0.6 + H * m;
        const e = R * (0.22 + 0.2 * m);
        feu.scale.set(e, e * (1 - 0.45 * m), e);
        feu.material.color.setRGB(1, 0.6 - 0.3 * k, 0.1 * (1 - k));
        feu.material.opacity = k < 0.6 ? 1 : (1 - k) / 0.4;
      }, 200);
      // Chapeau de fumee
      const chapeau = place(boule(0x8d6e63, 0.95, false), 0.6);
      chapeau.material.side = T.FrontSide;
      anim(chapeau, 8000, k => {
        const m = Math.min(1, k * 2);
        chapeau.position.y = y + 0.6 + H * Math.min(1, k * 2.2) + R * 0.05;
        chapeau.scale.set(R * (0.2 + 0.25 * m), R * (0.12 + 0.08 * m), R * (0.2 + 0.25 * m));
        chapeau.material.opacity = 0.95 * (k < 0.6 ? 1 : (1 - k) / 0.4);
      }, 600);
      // Anneau de condensation autour de la colonne
      const cond = anneau(0xeceff1, 0.6, 0.75);
      place(cond, H * 0.55);
      anim(cond, 4000, k => { cond.scale.setScalar(R * (0.3 + 0.6 * k)); cond.material.opacity = 0.6 * (1 - k); }, 1500);
      debris(Math.min(300, 80 + R * 8), 0xffcc80, 2 + R * 0.6, 2600, 0.2, 4);
    } else if (genre === 'trou_noir') {
      // Formation : eclair violet, onde, matiere aspiree vers le centre.
      // Le trou noir permanent (majTrousNoirs) reste ensuite sur la carte.
      const R = Math.max(3, (rayon || 3) * 1.6);
      this.rappels.flash?.();
      gonfle(boule(0xe040fb), 900, R * 0.6, 1, R * 0.2, 0, 0.3);
      gonfle(anneau(0xb388ff, 0.9, 0.9), 2200, R * 1.8, 0.9, 0.15, 100, 0.6);
      const n = 300, g = new T.BufferGeometry(), p = new Float32Array(n * 3);
      const part = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: R * (1 + Math.random() * 1.5), h: Math.random() * R * 0.6, v: 0.6 + Math.random() }));
      g.setAttribute('position', new T.BufferAttribute(p, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ color: 0xffd180, size: 0.18, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      pts.position.set(x, y, z);
      anim(pts, 4000, (k, t) => {
        const f = Math.pow(1 - k, 1.5);
        part.forEach((q, j) => {
          const a2 = q.a + t * 3 * q.v;
          p[3 * j] = Math.cos(a2) * q.r * f; p[3 * j + 1] = q.h * f + R * 0.2; p[3 * j + 2] = Math.sin(a2) * q.r * f;
        });
        g.attributes.position.needsUpdate = true;
        pts.material.opacity = k < 0.85 ? 1 : (1 - k) / 0.15;
      }, 200);
    } else if (genre === 'antimatiere') {
      // Implosion, eclair d'annihilation, puis le cratere se creuse (reformer).
      const R = Math.max(3, (rayon || 3) * 1.6);
      const implo = place(boule(0x18ffff, 0.9), 0.8);
      anim(implo, 700, k => { implo.scale.setScalar(R * 0.9 * (1 - k) + 0.05); implo.material.opacity = 0.3 + 0.6 * k; });
      const lignes = new T.BufferGeometry(), lp = new Float32Array(60 * 6), dirs = [];
      for (let j = 0; j < 60; j++) { const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.2) * 1.2; dirs.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]); }
      lignes.setAttribute('position', new T.BufferAttribute(lp, 3));
      const rayons = new T.LineSegments(lignes, new T.LineBasicMaterial({ color: 0x84ffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      rayons.position.set(x, y + 0.8, z);
      anim(rayons, 700, k => {
        dirs.forEach((d, j) => {
          const a = R * 1.4 * (1 - k), b = a + R * 0.4;
          lp.set([d[0] * a, d[1] * a, d[2] * a, d[0] * b, d[1] * b, d[2] * b], j * 6);
        });
        lignes.attributes.position.needsUpdate = true;
      });
      setTimeout(() => this.rappels.flash?.(), 700);
      gonfle(boule(0xffffff, 1), 700, R * 0.6, 1, 0.8, 700, 0.3);
      gonfle(boule(0xea80fc, 0.9), 1600, R * 0.9, 0.9, 0.8, 750, 0.4);
      gonfle(anneau(0x18ffff, 1, 0.9), 2000, R * 1.5, 1, 0.15, 700, 0.55);
      gonfle(anneau(0xea80fc, 0.7, 0.8), 2600, R * 1.1, 0.7, 0.15, 900, 0.6);
      debris(160, 0x80d8ff, 3 + R * 0.5, 2200, 0.16, 4, 700);
      // Vapeur au-dessus du cratere qui se remplit
      fumee(R * 0.5, 1.5, 4000, 1600, 0xb3e5fc);
    } else if (genre === 'interception') {
      gonfle(sphere(), 900, 1.3, 0.9, 5);
      gonfle(boule(0x40c4ff), 900, 1.3, 0.9, 5);
      debris(20, 0x80d8ff, 2, 900, 0.1, 3);
    } else if (genre === 'frappe') {
      for (let k = 0; k < 3; k++) gonfle(boule(0xff6e40), 700, 0.9, 0.9, 0.4, k * 160);
    } else if (genre === 'bataille') {
      gonfle(boule(0xffd740), 1000, 1.2);
    } else {
      gonfle(boule(genre === 'obus' ? 0xffab40 : 0xffe57f), 500, 0.55, 0.85, 0.6 + Math.random() * 0.4);
    }
  }

  // ── Selection / zone ────────────────────────────────────────────
  setMode(m) { this.mode = m; this.couleursSales = true; this.labelsSales = true; this.spritesDepot.forEach(s => this.groupes.depots.remove(s)); this.spritesDepot.clear(); }
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
        this.cam.d = Math.min(this.dMax, Math.max(7, bas.cam.d * bas.pinch / Math.max(1, d)));
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        // La carte tourne dans le meme sens que les doigts.
        this.cam.lacet = bas.cam.lacet + (angle - bas.angle);
        const my = (a.y + b.y) / 2;
        this.cam.tangage = Math.min(1.45, Math.max(0.3, bas.cam.tangage + (my - bas.milieuY) * SENSI.inclinaison));
        this.anim = null;
        return;
      }
      if (bas.bouton === 2 || e.shiftKey) {
        this.cam.lacet = bas.cam.lacet - dx * SENSI.rotation;
        this.cam.tangage = Math.min(1.45, Math.max(0.3, bas.cam.tangage + dy * SENSI.inclinaison));
      } else {
        // La carte suit la souris (le point saisi reste sous le curseur),
        // au lieu de filer deux fois plus vite qu'elle.
        const k = 2 * this.cam.d * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(1, cv.clientHeight) * SENSI.glisser;
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
      this.cam.d = Math.min(this.dMax, Math.max(7, this.cam.d * (1 + Math.sign(e.deltaY) * Math.min(SENSI.zoomMax, Math.abs(e.deltaY) * SENSI.zoom))));
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
    const v = this.cam.d * SENSI.clavier * dt;
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
    if (t.has('e')) this.cam.lacet -= SENSI.rotationClavier * dt;
    if (t.has('r')) this.cam.lacet += SENSI.rotationClavier * dt;
    if (t.has('+') || t.has('=')) this.cam.d = Math.max(7, this.cam.d * (1 - SENSI.zoomClavier * dt));
    if (t.has('-') || t.has('6')) this.cam.d = Math.min(this.dMax, this.cam.d * (1 + SENSI.zoomClavier * dt));
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
  /** Resolution adaptative : sous 30 images/s, on baisse la definition ;
   *  au-dessus de 55, on la remonte. */
  ajusterResolution(t) {
    this._img = (this._img || 0) + 1;
    if (!this._t0) this._t0 = t;
    if (t - this._t0 < 2000) return;
    const fps = this._img * 1000 / (t - this._t0);
    this.fps = fps;
    this._img = 0; this._t0 = t;
    let r = this.ratio;
    if (fps < 30 && r > 0.55) r = Math.max(0.55, r - 0.15);
    else if (fps > 55 && r < this.ratioMax) r = Math.min(this.ratioMax, r + 0.1);
    if (r !== this.ratio) { this.ratio = r; this.renderer.setPixelRatio(r); this.redimensionner(); }
  }

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
    this.animerTrousNoirs(t);
    // Teintes : au plus 4 fois par seconde (les messages du serveur arrivent
    // chaque seconde, les offensives changent des cases en continu).
    if (this.couleursSales && performance.now() - (this.derniereTeinte || 0) > 250) this.recolorer();
    // Avec les offensives, des cases changent de main chaque seconde : on
    // regroupe les reconstructions (frontieres, noms) au lieu de tout
    // refaire a chaque message du serveur.
    const maintenant = performance.now();
    if (this.bordSale && maintenant - (this.dernierBords || 0) > 700) { this.construireBords(); this.dernierBords = maintenant; }
    if (this.labelsSales && maintenant - (this.derniersLabels || 0) > 1500) { this.majLabels(); this.derniersLabels = maintenant; }
    this.majDepots();

    const c = this.cam;
    const cp = Math.cos(c.tangage), sp = Math.sin(c.tangage);
    this.camera.position.set(c.x + Math.sin(c.lacet) * cp * c.d, sp * c.d, c.z + Math.cos(c.lacet) * cp * c.d);
    this.camera.lookAt(c.x, 0, c.z);
    this.camera.updateMatrixWorld();
    this.majTuiles();
    // Ombres : la zone ombree suit la vue.
    if (this.soleil.castShadow) {
      const e = Math.min(90, Math.max(25, c.d * 1.2)), sc = this.soleil.shadow.camera;
      this.soleil.position.set(c.x - 70, 75, c.z - 45);
      this.soleil.target.position.set(c.x, 0, c.z);
      if (sc.right !== e) { sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.updateProjectionMatrix(); }
    }
    this.ajusterResolution(t);
    // Plans de la camera adaptes au recul : sans cela, de loin, la precision
    // de profondeur s'effondre et la mer passe devant le sol (telephones).
    const near = Math.max(0.3, c.d * 0.04), far = Math.max(400, c.d * 4 + 200);
    if (Math.abs(this.camera.near - near) > near * 0.1 || Math.abs(this.camera.far - far) > far * 0.1) {
      this.camera.near = near; this.camera.far = far; this.camera.updateProjectionMatrix();
    }
    // Reflet du soleil sur la mer : agreable de pres, eblouissant de loin.
    // De loin, la mer devient plus profonde et presque opaque (elle cache le
    // fond) ; de pres, elle reste transparente sur les hauts-fonds.
    const reflet = Math.max(0, Math.min(1, 1 - (c.d - 60) / 140));
    const loin = 1 - reflet;
    this.eau.material.specular.setRGB(0.44 * reflet, 0.58 * reflet, 0.66 * reflet);
    this.eau.material.opacity = 0.74 + 0.2 * loin;
    this.eau.material.color.copy(this.eauPres).lerp(this.eauLoin, loin);
    // Brouillard d'horizon proportionnel au recul (vue du monde entier).
    if (this.scene.fog) { this.scene.fog.near = Math.max(120, c.d * 1.4); this.scene.fog.far = Math.max(280, c.d * 3); }

    this.groupes.labels.visible = c.d > 20;
    if (this.mode === 'religions' && t - (this._nomsRel || 0) > 150) { this._nomsRel = t; this.placerNomsReligions(); }
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
      if (k < 0) return true;
      if (k >= 1) { this.groupes.effets.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); return false; }
      if (!f.m.parent) this.groupes.effets.add(f.m);
      f.maj(k, (maint - f.t0) / 1000);
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
