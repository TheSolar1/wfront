// ══════════════════════════════════════════════════════════════════
// util.js — petits outils partages par l'interface WorldFront
// ══════════════════════════════════════════════════════════════════

/** Racine publique de WorldFront ("/" ou "/worldfront/" derriere un proxy). */
export const BASE = location.pathname.replace(/[^/]*$/, '');

/** Icone du jeu d'icones VEX (static/img/solid), teintee par CSS (currentColor).
 *  Chemin absolu obligatoire : une url() relative placee dans une variable
 *  CSS se resout par rapport a la feuille de style, pas a la page. */
export function ico(nom, cls = '', style = '') {
  if (!nom) return '';
  return `<i class="ico ${cls}" style="--ic:url('${BASE}static/img/solid/${nom}.svg');${style}" aria-hidden="true"></i>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 12345.6 -> "12 346", 1.2e6 -> "1,2 M" */
export function fmt(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' Md';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1e5) return Math.round(n / 1e3).toLocaleString('fr-FR') + ' k';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function signe(n, dec = 1) {
  const v = Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  return (n >= 0 ? '+' : '') + v;
}

/** Population (stockee en milliers). */
export function fmtPop(k) {
  if (k >= 1000) return (k / 1000).toFixed(2).replace('.', ',') + ' M hab.';
  return Math.round(k).toLocaleString('fr-FR') + ' k hab.';
}

export function duree(s) {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + ' min' + (r ? ' ' + String(r).padStart(2, '0') : '');
  const h = Math.floor(m / 60);
  return h + ' h ' + String(m % 60).padStart(2, '0');
}

export function heure(ms) {
  const d = new Date(ms);
  const auj = new Date();
  const hh = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === auj.toDateString()) return hh;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + hh;
}

export function melanger(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ra + (rb - ra) * t), g = Math.round(ga + (gb - ga) * t), bl = Math.round(ba + (bb - ba) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Texte lisible (noir ou blanc) sur une couleur de fond. */
export function contraste(hex) {
  const p = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255;
  return l > 0.62 ? '#1c1e21' : '#ffffff';
}

// ── Grille hexagonale (meme convention "odd-r" que le serveur) ────
export class Grille {
  constructor(largeur, hauteur) {
    this.l = largeur;
    this.h = hauteur;
    this.n = largeur * hauteur;
  }
  xy(i) { return [i % this.l, Math.floor(i / this.l)]; }
  idx(x, y) { return (x < 0 || y < 0 || x >= this.l || y >= this.h) ? -1 : y * this.l + x; }
  voisins(i) {
    const [x, y] = this.xy(i);
    const d = (y & 1) === 0
      ? [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]]
      : [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
    return d.map(([dx, dy]) => this.idx(x + dx, y + dy));
  }
  cube(i) {
    const [x, y] = this.xy(i);
    const q = x - (y - (y & 1)) / 2;
    return [q, y, -q - y];
  }
  distance(a, b) {
    const [ax, ay, az] = this.cube(a), [bx, by, bz] = this.cube(b);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  }
  rayon(c, r) {
    const [cx, cy] = this.xy(c), out = [];
    for (let y = Math.max(0, cy - r - 1); y <= Math.min(this.h - 1, cy + r + 1); y++)
      for (let x = Math.max(0, cx - r - 1); x <= Math.min(this.l - 1, cx + r + 1); x++) {
        const i = this.idx(x, y);
        if (i >= 0 && this.distance(c, i) <= r) out.push(i);
      }
    return out;
  }
}

/** Couts identiques a jeu.rs (cout_batiment / cout_unite). */
export function coutBatiment(def, niv, mods, spe) {
  const f = Math.pow(1.7, niv - 1);
  const c = def.cout.map(v => Math.round(v * f));
  c[2] = Math.round(c[2] * (1 - 0.03 * (mods?.siderurgie || 0)));
  if (spe === 'industrielle') c[2] = Math.round(c[2] * 0.9);
  if (spe === 'forteresse' && def.id === 'fort') return c.map(v => Math.round(v * 0.7));
  return c;
}
export function tempsBatiment(def, niv) { return def.temps * Math.pow(1.45, niv - 1); }
export function coutUnite(def, qte, mods, spe) {
  let c = def.cout.map(v => v * qte);
  c[2] *= 1 - 0.03 * (mods?.siderurgie || 0);
  if (spe === 'militaire') c = c.map(v => v * 0.85);
  return c.map(v => Math.round(v));
}
