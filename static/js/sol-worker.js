// ══════════════════════════════════════════════════════════════════
// sol-worker.js — Calcule le sol en parallèle de l'affichage
// (carte lointaine, tuiles détaillées) : la carte reste fluide pendant
// que le relief, les couleurs et les arbres se préparent.
// ══════════════════════════════════════════════════════════════════
import { Sol, tampons, definirEchelle } from './sol.js';

let sol = null;
self.onmessage = e => {
  const m = e.data;
  if (m.t === 'init') {
    definirEchelle(m.echelle);
    sol = new Sol(m.terrain, m.l, m.h, m.sombre, m.mobile, m.reel);
    const loin = sol.maillageLoin(m.pasLoin);
    self.postMessage({ t: 'loin', loin }, tampons(loin));
  } else if (m.t === 'terrain') {
    for (const [i, t] of m.cases) sol.terrain[i] = t;
    if (m.pasLoin) {
      const loin = sol.maillageLoin(m.pasLoin);
      self.postMessage({ t: 'loin', loin }, tampons(loin));
    }
  } else if (m.t === 'tuile') {
    const d = sol.tuile(m.tx, m.tz, m.T, m.pas);
    self.postMessage({ t: 'tuile', cle: m.cle, version: m.version, ...d }, tampons(d));
  }
};
