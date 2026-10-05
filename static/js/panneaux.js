// ══════════════════════════════════════════════════════════════════
// panneaux.js — Contenu des panneaux lateraux
// Chaque panneau renvoie du HTML ; les boutons portent un attribut
// data-act lu par jeu.js (delegation d'evenements), jamais de
// gestionnaire attache ici.
// ══════════════════════════════════════════════════════════════════

import { ico, esc, fmt, fmtPop, duree, heure, signe, coutBatiment, tempsBatiment, coutUnite, contraste } from './util.js';

const NOMS_REL = { paix: 'Paix', guerre: 'Guerre', pna: 'Pacte de non-agression' };

// ── Petits composants ─────────────────────────────────────────────
export function drapeau(p, taille = 28) {
  if (!p) return `<span class="wf-drapeau" style="--pc:#607d8b;--t:${taille}px">${ico('question')}</span>`;
  return `<span class="wf-drapeau" style="--pc:${esc(p.couleur)};--t:${taille}px;color:${contraste(p.couleur)}" title="${esc(p.nom)}">${ico(p.embleme || 'star')}</span>`;
}

function puce(texte, cls = '', icone = '') {
  return `<span class="wf-puce ${cls}">${icone ? ico(icone) : ''}${esc(texte)}</span>`;
}

function barre(k, cls = '') {
  const v = Math.max(0, Math.min(1, k));
  return `<div class="wf-barre ${cls}"><div style="width:${(v * 100).toFixed(1)}%"></div></div>`;
}

export function cout(S, c, compact = false) {
  const res = S.moi ? S.moi.res : null;
  return `<span class="wf-cout">${c.map((v, i) => {
    if (!v) return '';
    const r = S.defs.ressources[i];
    const manque = res && res[i] + 1e-6 < v;
    return `<span class="wf-cout-r ${manque ? 'manque' : ''}" title="${esc(r.nom)}">${ico(r.icone, '', `color:${r.couleur}`)}${fmt(v)}${compact ? '' : ''}</span>`;
  }).join('')}</span>`;
}

function peutPayer(S, c) {
  return S.moi && c.every((v, i) => S.moi.res[i] + 1e-6 >= v);
}

function titre(t, icone, droite = '') {
  return `<div class="wf-section-titre">${ico(icone)}<span>${esc(t)}</span><span class="wf-espace"></span>${droite}</div>`;
}

function vide(texte, icone = 'circle-info') {
  return `<div class="wf-vide">${ico(icone)}<p>${texte}</p></div>`;
}

export function nomCase(S, i) {
  const [x, y] = S.g.xy(i);
  return `${S.defs.terrains[S.carte.terrain[i]].nom} (${x}, ${y})`;
}

function aTech(S, t) { return !t || (S.moi && S.moi.techs.includes(t)); }
function nomTech(S, t) {
  if (t.startsWith('am:')) {
    const a = S.defs.ameliorations.find(x => x.id === t.slice(3));
    return a ? `${a.nom} niv. ${(S.moi?.amelio?.[a.id] || 0) + 1}` : t;
  }
  return S.defs.techs.find(x => x.id === t)?.nom || t;
}
function batDef(S, id) { return S.defs.batiments.find(b => b.id === id); }
function uniDef(S, id) { return S.defs.unites.find(u => u.id === id); }

function composition(S, unites) {
  return Object.entries(unites || {}).map(([t, n]) => {
    const u = uniDef(S, t);
    return `<span class="wf-compo" title="${esc(u?.nom || t)}">${ico(u?.icone || 'question')}${n}</span>`;
  }).join('');
}

/** Joueur d'un pays : nom, ou « Ordinateur » avec une icone pour un bot. */
function joueurDe(p) {
  if (!p) return '';
  return p.bot ? `${ico('robot')} Ordinateur` : esc(p.joueur);
}

function listeChantiers(S) {
  const m = S.moi;
  if (!m || !m.chantiers.length) return vide('Aucun chantier en cours.', 'helmet-safety');
  return `<div class="wf-liste">${m.chantiers.map(c => {
    const d = batDef(S, c.bat);
    const actif = true; // tous les chantiers avancent en meme temps
    const reste = c.reste / Math.max(0.01, m.bilan.vitesse) / S.vitesse;
    return `<div class="wf-ligne">
      <span class="wf-ligne-ic">${ico(d?.icone)}</span>
      <div class="wf-ligne-corps">
        <div class="wf-ligne-titre">${esc(d?.nom)}${c.niv ? ` <small>niv. ${c.niv}</small>` : ''}</div>
        <div class="wf-ligne-sous">${esc(nomCase(S, c.case))} · ${actif ? duree(reste) : 'en attente d\'un chantier libre'}</div>
        ${barre(1 - c.reste / c.total, actif ? '' : 'attente')}
      </div>
      <button class="wf-btn-ic" data-act="voir" data-case="${c.case}" title="Localiser">${ico('location-crosshairs')}</button>
      <button class="wf-btn-ic danger" data-act="annuler_chantier" data-id="${c.id}" title="Annuler (50 % remboursés)">${ico('xmark')}</button>
    </div>`;
  }).join('')}</div>`;
}

function listeProductions(S) {
  const m = S.moi;
  if (!m || !m.productions.length) return vide('Aucune commande militaire.', 'industry');
  const vues = new Set();
  return `<div class="wf-liste">${m.productions.map(p => {
    const u = uniDef(S, p.unite);
    const actif = !vues.has(p.case);
    vues.add(p.case);
    return `<div class="wf-ligne">
      <span class="wf-ligne-ic">${ico(u?.icone)}</span>
      <div class="wf-ligne-corps">
        <div class="wf-ligne-titre">${p.qte} × ${esc(u?.nom)}</div>
        <div class="wf-ligne-sous">${esc(batDef(S, u?.batiment)?.nom || '')} · ${esc(nomCase(S, p.case))} · ${actif ? 'en production' : 'en file'}</div>
        ${barre(1 - p.reste / p.total, actif ? '' : 'attente')}
      </div>
      <button class="wf-btn-ic danger" data-act="annuler_production" data-id="${p.id}" title="Annuler (50 % remboursés)">${ico('xmark')}</button>
    </div>`;
  }).join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════
// Mon pays
// ══════════════════════════════════════════════════════════════════
function panneauPays(S) {
  const m = S.moi;
  if (!m) return vide('Vous ne dirigez encore aucune nation.<br><button class="wf-btn" data-act="fonder">Fonder ma nation</button>', 'flag');
  const b = m.bilan;
  const spe = S.defs.specialisations.find(s => s.id === m.spe);
  const bloc = m.bloc != null ? S.blocs.get(m.bloc) : null;
  const protection = Math.max(0, m.protection - Date.now() / 1000);
  const elecOk = b.elec_ratio >= 0.999;
  const lignesRes = S.defs.ressources.map((r, i) => {
    const net = b.prod[i] - b.conso[i];
    const cap = i === 0 ? b.stock * 20 : b.stock;
    return `<tr>
      <td>${ico(r.icone, '', `color:${r.couleur}`)} ${esc(r.nom)}</td>
      <td class="num">${fmt(m.res[i])}<small> / ${fmt(cap)}</small></td>
      <td class="num pos">${signe(b.prod[i])}</td>
      <td class="num neg">${b.conso[i] ? '-' + fmt(b.conso[i], 1) : '0'}</td>
      <td class="num ${net >= 0 ? 'pos' : 'neg'}"><b>${signe(net)}</b></td>
    </tr>`;
  }).join('');
  return `
  <div class="wf-carte-pays" style="--pc:${esc(m.couleur)}">
    ${drapeau(m, 58)}
    <div class="wf-carte-pays-txt">
      <h2>${esc(m.nom)}</h2>
      <p>${m.devise ? '« ' + esc(m.devise) + ' »' : '<i>Aucune devise</i>'}</p>
      <div class="wf-puces">
        ${spe ? puce(spe.nom, 'accent', spe.icone) : ''}
        ${bloc ? `<span class="wf-puce" style="--bc:${esc(bloc.couleur)}">${ico('people-group')}${esc(bloc.sigle)}</span>` : ''}
        ${protection > 0 ? puce('Protégé ' + duree(protection), 'bleu', 'shield-halved') : ''}
      </div>
    </div>
  </div>

  <div class="wf-stats">
    <div class="wf-stat">${ico('people-group')}<b>${fmtPop(m.pop)}</b><span>Population · capacité ${fmtPop(b.pop_cap)}</span>${barre(m.pop / Math.max(1, b.pop_cap))}</div>
    <div class="wf-stat">${ico('map-location-dot')}<b>${b.cases}</b><span>Provinces</span></div>
    <div class="wf-stat">${ico('person-military-rifle')}<b>${fmt(S.moi.troupes)} / ${fmt(b.troupes_max)}</b><span>Troupes</span>${barre(S.moi.troupes / Math.max(1, b.troupes_max))}</div>
    <div class="wf-stat">${ico('handshake')}<b>${fmt(m.influence)}</b><span>Influence · ${signe(b.influence)}/min</span></div>
    <div class="wf-stat">${ico('flask')}<b>${signe(b.recherche)}/min</b><span>Recherche · ${fmt(m.recherche_stock)} pts en réserve</span></div>
    <div class="wf-stat ${elecOk ? '' : 'alerte'}">${ico('bolt')}<b>${fmt(b.elec_prod)} / ${fmt(b.elec_cons)}</b><span>Électricité ${elecOk ? 'suffisante' : '— rendement ' + Math.round(b.elec_ratio * 100) + ' %'}</span>${barre(b.elec_cons ? Math.min(1, b.elec_prod / b.elec_cons) : 1, elecOk ? '' : 'rouge')}</div>
    <div class="wf-stat">${ico('shield-halved')}<b>${fmt(b.puissance)}</b><span>Puissance militaire</span></div>
    <div class="wf-stat">${ico('gears')}<b>×${b.vitesse.toFixed(2).replace('.', ',')}</b><span>Vitesse de construction · chantiers illimités</span></div>
    <div class="wf-stat">${ico('ranking-star')}<b>${fmt(m.scores.global)}</b><span>Score global</span></div>
  </div>

  ${titre('Économie (par minute)', 'chart-line')}
  <table class="wf-table">
    <thead><tr><th>Ressource</th><th class="num">Stock</th><th class="num">Prod.</th><th class="num">Conso.</th><th class="num">Solde</th></tr></thead>
    <tbody>${lignesRes}</tbody>
  </table>
  ${m.res[0] <= 0 && b.conso[0] > b.prod[0] ? `<div class="wf-avert">${ico('triangle-exclamation')} Caisses vides : vos soldats désertent.</div>` : ''}


  ${titre('Chantiers', 'helmet-safety', `<small>${m.chantiers.length} en cours</small>`)}
  ${listeChantiers(S)}
  ${titre('Commandes militaires', 'industry')}
  ${listeProductions(S)}

  ${titre('Bilan de guerre', 'medal')}
  <div class="wf-stats petit">
    <div class="wf-stat"><b>${m.stats.combats_gagnes}</b><span>Victoires</span></div>
    <div class="wf-stat"><b>${m.stats.combats_perdus}</b><span>Défaites</span></div>
    <div class="wf-stat"><b>${m.stats.cases_conquises}</b><span>Provinces conquises</span></div>
    <div class="wf-stat"><b>${fmt(m.stats.unites_detruites)}</b><span>Puissance ennemie détruite</span></div>
    <div class="wf-stat"><b>${m.stats.missiles_lances}</b><span>Missiles lancés</span></div>
    <div class="wf-stat"><b>${m.stats.frappes_nucleaires}</b><span>Frappes nucléaires</span></div>
  </div>

  ${titre('Profil de la nation', 'pen')}
  <div class="wf-form">
    <label>Devise<input id="profil-devise" data-garder maxlength="80" value="${esc(m.devise)}" placeholder="Ex. : Liberté, industrie, puissance"></label>
    <label>Couleur</label>
    <div class="wf-palette" data-choix="profil-couleur">${S.defs.couleurs.map(c => `<button class="wf-pastille ${c === m.couleur ? 'actif' : ''}" style="--c:${c}" data-act="choisir" data-groupe="profil-couleur" data-val="${c}"></button>`).join('')}
      <input type="color" id="profil-couleur" data-garder value="${esc(m.couleur)}" title="Couleur personnalisée"></div>
    <label>Emblème</label>
    <div class="wf-emblemes">${S.defs.emblemes.map(e => `<button class="wf-embleme ${e === m.embleme ? 'actif' : ''}" data-act="choisir" data-groupe="profil-embleme" data-val="${e}">${ico(e)}</button>`).join('')}</div>
    <input type="hidden" id="profil-embleme" data-garder value="${esc(m.embleme)}">
    <button class="wf-btn" data-act="profil">${ico('floppy-disk')} Enregistrer le profil</button>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════
// Construction
// ══════════════════════════════════════════════════════════════════
function raisonBatiment(S, d, i) {
  if (d.tech && !aTech(S, d.tech)) return 'Technologie : ' + nomTech(S, d.tech);
  if (d.depot && S.carte.depot[i] !== d.depot) return 'Nécessite : ' + S.defs.depots[d.depot].nom.toLowerCase();
  if (d.cote && S.carte.cotes[i] !== '1') return 'Uniquement sur une côte';
  return '';
}

function panneauConstruction(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  const i = S.selCase;
  let corps = '';
  if (i == null || S.carte.proprio[i] !== m.id) {
    // Resume des batiments
    const parType = new Map();
    for (let k = 0; k < S.g.n; k++) {
      if (S.carte.proprio[k] === m.id && S.carte.bat[k]) {
        const t = S.carte.bat[k];
        if (!parType.has(t)) parType.set(t, []);
        parType.get(t).push(k);
      }
    }
    corps = `${vide('Sélectionnez une de vos provinces sur la carte pour y bâtir ou améliorer un bâtiment.<br><small>Astuce : les provinces vides de votre territoire apparaissent avec un contour à vos couleurs.</small>', 'hand-pointer')}
    ${titre('Vos infrastructures', 'city')}
    <div class="wf-liste">${[...parType.entries()].map(([t, cases]) => {
      const d = batDef(S, t);
      const niveaux = cases.reduce((a, k) => a + S.carte.niv[k], 0);
      return `<div class="wf-ligne">
        <span class="wf-ligne-ic">${ico(d?.icone)}</span>
        <div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(d?.nom)}</div>
        <div class="wf-ligne-sous">${cases.length} site${cases.length > 1 ? 's' : ''} · ${niveaux} niveau${niveaux > 1 ? 'x' : ''} au total</div></div>
        <button class="wf-btn-ic" data-act="voir" data-case="${cases[0]}" title="Localiser">${ico('location-crosshairs')}</button>
      </div>`;
    }).join('') || vide('Aucune infrastructure pour le moment.')}</div>`;
  } else {
    const t = S.carte.terrain[i];
    const terre = S.defs.terrains[t].terre;
    const b = S.carte.bat[i];
    const irr = S.carte.irr[i];
    const enCours = m.chantiers.find(c => c.case === i);
    corps = `<div class="wf-case-entete">
      ${ico('location-dot')}<div><b>${esc(nomCase(S, i))}</b>
      <small>${S.carte.depot[i] ? esc(S.defs.depots[S.carte.depot[i]].nom) : 'Aucun gisement'}${S.carte.cotes[i] === '1' ? ' · Côte' : ''}</small></div></div>`;
    if (irr) corps += `<div class="wf-avert">${ico('radiation')} Zone irradiée : aucune construction possible pour le moment.</div>`;
    if (enCours) corps += `<div class="wf-info">${ico('helmet-safety')} Chantier en cours ici.</div>`;
    if (!terre) {
      corps += vide('On ne bâtit pas en mer.', 'water');
    } else if (b) {
      const d = batDef(S, b);
      const niv = S.carte.niv[i];
      const max = m.mods.niv_max;
      const c = niv < max ? coutBatiment(d, niv + 1, m.mods, m.spe) : null;
      const militaire = S.defs.unites.some(u => u.batiment === b);
      corps += `<div class="wf-bat-carte grand">
        <span class="wf-bat-ic">${ico(d.icone)}</span>
        <div><h3>${esc(d.nom)} <small>niveau ${niv} / ${max}</small></h3><p>${esc(d.desc)}</p></div>
      </div>
      ${c ? `<div class="wf-action-ligne"><div>Niveau ${niv + 1} : ${cout(S, c)} <small>${ico('clock')} ${duree(tempsBatiment(d, niv + 1) / m.bilan.vitesse / S.vitesse)}</small></div>
        <button class="wf-btn" data-act="ameliorer" data-case="${i}" ${!peutPayer(S, c) || enCours || irr ? 'disabled' : ''}>${ico('arrow-up')} Améliorer</button></div>` : `<div class="wf-info">${ico('crown')} Niveau maximal atteint.</div>`}
      <div class="wf-boutons">
        ${militaire ? `<button class="wf-btn secondaire" data-act="ouvrir" data-panneau="armee" data-prod="${i}">${ico('person-military-rifle')} Produire des unités</button>` : ''}
        ${b !== 'capitale' ? `<button class="wf-btn danger" data-act="demolir" data-case="${i}">${ico('trash')} Démolir</button>` : ''}
      </div>`;
    } else {
      const cats = new Map();
      for (const d of S.defs.batiments.filter(x => x.constructible)) {
        if (!cats.has(d.categorie)) cats.set(d.categorie, []);
        cats.get(d.categorie).push(d);
      }
      for (const [cat, liste] of cats) {
        corps += titre(cat, 'layer-group');
        corps += `<div class="wf-bat-grille">${liste.map(d => {
          const raison = raisonBatiment(S, d, i);
          const c = coutBatiment(d, 1, m.mods, m.spe);
          const ok = !raison && peutPayer(S, c) && !enCours && !irr;
          return `<div class="wf-bat-carte ${raison ? 'verrou' : ''}">
            <span class="wf-bat-ic">${ico(raison ? 'lock' : d.icone)}</span>
            <div class="wf-bat-txt"><h4>${esc(d.nom)}</h4><p>${esc(d.desc)}</p>
            ${raison ? `<div class="wf-raison">${esc(raison)}</div>` : `<div>${cout(S, c)} <small>${ico('clock')} ${duree(d.temps / m.bilan.vitesse / S.vitesse)}</small></div>`}</div>
            ${raison ? '' : `<button class="wf-btn petit" data-act="construire" data-case="${i}" data-bat="${d.id}" ${ok ? '' : 'disabled'}>Bâtir</button>`}
          </div>`;
        }).join('')}</div>`;
      }
    }
  }
  return `${titre('Chantiers en cours', 'helmet-safety', `<small>${m.chantiers.length} en même temps</small>`)}${listeChantiers(S)}${corps}`;
}

// ══════════════════════════════════════════════════════════════════
// Menu de la case (inspecteur) : tout se fait depuis la case cliquée
// ══════════════════════════════════════════════════════════════════
const BAT_PRODUCTION = {
  ferme: [1, 'nourriture'], mine: [2, 'minerai commun'], carriere: [2, 'minerai commun'], puits_petrole: [2, 'minerai commun'],
  foreuse: [3, 'minerai légendaire'], mine_uranium: [4, 'minerai radioactif'], extracteur_tr: [5, 'minerai rare'],
};

export function menuCase(S, i) {
  const m = S.moi;
  if (!m || m.elimine) return '';
  const t = S.defs.terrains[S.carte.terrain[i]];
  const pid = S.carte.proprio[i];
  if (pid !== m.id || !t.terre) return '';
  const b = S.carte.bat[i];
  const irr = S.carte.irr[i];
  const chantier = m.chantiers.find(c => c.case === i);
  if (irr) return `<div class="wf-insp-ligne neg">${ico('radiation')} Zone irradiée : rien ne peut y être bâti pour le moment.</div>`;
  if (chantier) {
    const d = batDef(S, chantier.bat);
    return `<div class="wf-menu-bloc"><div class="wf-insp-ligne">${ico(d?.icone || 'helmet-safety')} <b>Chantier : ${esc(d?.nom)}${chantier.niv > 1 ? ` niv. ${chantier.niv}` : ''}</b></div>
      ${barre(1 - chantier.reste / chantier.total)}
      <button class="wf-btn petit danger" data-act="annuler_chantier" data-id="${chantier.id}">${ico('xmark')} Annuler (50 % remboursés)</button></div>`;
  }
  if (!b) return menuConstruire(S, i);

  const d = batDef(S, b);
  const niv = S.carte.niv[i];
  const max = m.mods.niv_max;
  const c = niv < max ? coutBatiment(d, niv + 1, m.mods, m.spe) : null;
  let html = `<div class="wf-menu-bloc">
    ${c ? `<div class="wf-action-ligne compacte"><div>${ico('arrow-up')} Niveau ${niv + 1} : ${cout(S, c)} <small>${ico('clock')} ${duree(tempsBatiment(d, niv + 1) / m.bilan.vitesse / S.vitesse)}</small></div>
      <button class="wf-btn petit" data-act="ameliorer" data-case="${i}" ${peutPayer(S, c) ? '' : 'disabled'}>Améliorer</button></div>`
      : `<div class="wf-insp-ligne petit">${ico('crown')} Niveau maximal (${max}).</div>`}
  </div>`;

  // Contenu propre au bâtiment
  if (b === 'laboratoire') {
    html += `<div class="wf-menu-bloc">${corpsRecherche(S, S.brancheRecherche || 'militaire', true)}</div>`;
  } else if (S.defs.unites.some(u => u.batiment === b)) {
    html += `<div class="wf-menu-bloc">${menuProduction(S, i)}</div>`;
  } else if (b === 'ville' || b === 'capitale') {
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne">${ico('people-group')} Population : <b>${fmtPop(m.pop)}</b> / ${fmtPop(m.bilan.pop_cap)}</div>
      <div class="wf-insp-ligne petit">${esc(d.desc)}</div></div>`;
  } else if (BAT_PRODUCTION[b]) {
    const [r, nom] = BAT_PRODUCTION[b];
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne">${ico(S.defs.ressources[r].icone)} Tout votre pays : <b>${signe(m.bilan.prod[r])} ${nom}/min</b></div>
      <div class="wf-insp-ligne petit">${esc(d.desc)}</div></div>`;
  } else if (b === 'enrichissement' || b === 'centrale_nucleaire') {
    const sur = m.techs.includes('ind_nucleaire_civil');
    html += `<div class="wf-menu-bloc">
      <div class="wf-insp-ligne">${ico('radiation')} Minerai radioactif : <b>${fmt(m.res[4], 1)}</b> · uranium enrichi : <b>${fmt(m.ur_enrichi, 1)}</b></div>
      <div class="wf-insp-ligne petit">${esc(d.desc)}</div>
      ${m.res[4] < 1 && b === 'enrichissement' ? `<div class="wf-insp-ligne petit">${ico('scale-balanced')} Pas de minerai radioactif : achetez-en au marché ou construisez une mine radioactive.</div>` : ''}
      ${b === 'centrale_nucleaire' && !sur ? `<div class="wf-insp-ligne neg">${ico('triangle-exclamation')} Sans « Nucléaire civil », chaque amélioration a 25 % de risque d'accident.</div>` : ''}
    </div>`;
  } else if (b === 'usine') {
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne">${ico('gears')} Vitesse de construction <b>×${m.bilan.vitesse.toFixed(2).replace('.', ',')}</b> · chantiers illimités en parallèle</div></div>`;
  } else if (b === 'banque') {
    html += `<div class="wf-menu-bloc">${menuMarche(S)}</div>`;
  } else {
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne petit">${esc(d.desc)}</div></div>`;
  }
  if (b !== 'capitale') html += `<div class="wf-boutons"><button class="wf-btn petit danger" data-act="demolir" data-case="${i}">${ico('trash')} Démolir</button></div>`;
  return html;
}

/** Coût en troupes d'une case (front.rs cout_case), côté client. */
function coutTroupes(S, i) {
  const t = S.defs.terrains[S.carte.terrain[i]];
  const pid = S.carte.proprio[i];
  if (pid < 0) return S.defs.troupes.cout_neutre * t.cout_mvt;
  const fort = S.carte.bat[i] === 'fort' ? 1 + 0.3 * S.carte.niv[i] : 1;
  return 9 * t.cout_mvt * (1 + t.defense) * fort;
}

/** Province neutre voisine, ou ennemie en guerre : envoyer des troupes
 *  (comme un clic droit sur la carte). */
export function menuTroupes(S, i, mode) {
  const m = S.moi;
  const envoi = Math.floor(m.troupes * S.ratio);
  const enCours = (S.attaques || []).filter(a => a.de === m.id && (mode === 'neutre' ? a.cible == null : a.cible === S.carte.proprio[i]));
  const titreBloc = mode === 'neutre' ? "S'étendre ici" : mode === 'bateau' ? 'Débarquer ici' : 'Attaquer ici';
  const icone = mode === 'neutre' ? 'map-location-dot' : mode === 'bateau' ? 'ship' : 'person-military-pointing';
  return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico(icone)} ${titreBloc}</div>
    <div class="wf-insp-ligne petit">${ico('person-military-rifle')} ${fmt(envoi)} troupes envoyées (${Math.round(S.ratio * 100)} % de la réserve) · environ ${fmt(coutTroupes(S, i), 0)} par case${mode === 'attaque' ? ' + la densité de ses troupes' : ''}</div>
    ${enCours.map(a => `<div class="wf-insp-ligne petit">${ico('flag')} Offensive en cours : ${fmt(a.troupes)} troupes, ${a.prises} cases prises
      ${a.bateau ? ` · en mer ${duree(a.bateau.reste / S.vitesse)}` : `<button class="wf-lien" data-act="rappeler" data-id="${a.id}">Rappeler</button>`}</div>`).join('')}
    <button class="wf-btn petit ${mode === 'attaque' ? 'danger' : ''}" data-act="etendre" data-case="${i}" ${envoi >= 10 ? '' : 'disabled'}>${ico(icone)} Envoyer ${fmt(envoi)} troupes</button>
    <div class="wf-insp-ligne petit">${ico('computer-mouse')} Raccourci : clic droit sur la case. Le curseur « Envoyer » en bas à gauche de la carte règle la part des troupes.</div>
  </div>`;
}

/** Diplomatie directe : cliquez sur une case d'un pays pour l'attaquer, lui
 *  proposer la paix, un pacte ou une alliance, l'aider ou l'espionner. */
export function menuDiplomatie(S, p) {
  const m = S.moi;
  const rel = S.relations[p.id]?.etat || 'paix';
  const allies = m.bloc != null && m.bloc === p.bloc;
  const envoyee = g => S.propositions.some(x => x.de === m.id && x.a === p.id && x.genre === g);
  const recue = S.propositions.filter(x => x.de === p.id && x.a === m.id);
  const b = [];
  if (rel === 'guerre') b.push(`<button class="wf-btn petit" data-act="proposer" data-pays="${p.id}" data-genre="paix" ${envoyee('paix') ? 'disabled' : ''}>${ico('dove')} ${envoyee('paix') ? 'Paix proposée' : 'Proposer la paix'}</button>`);
  else if (!allies) b.push(`<button class="wf-btn petit danger" data-act="guerre" data-pays="${p.id}">${ico('burst')} Attaquer (déclarer la guerre)</button>`);
  if (rel === 'paix' && !allies) b.push(`<button class="wf-btn petit secondaire" data-act="proposer" data-pays="${p.id}" data-genre="pna" ${envoyee('pna') ? 'disabled' : ''}>${ico('file-signature')} ${envoyee('pna') ? 'Pacte proposé' : 'Pacte de non-agression'}</button>`);
  if (rel !== 'guerre' && !allies) b.push(`<button class="wf-btn petit secondaire" data-act="proposer" data-pays="${p.id}" data-genre="alliance" ${envoyee('alliance') ? 'disabled' : ''}>${ico('people-group')} ${envoyee('alliance') ? 'Alliance proposée' : 'Créer une alliance'}</button>`);
  b.push(`<button class="wf-btn petit secondaire" data-act="aide_form" data-pays="${p.id}">${ico('box-open')} Envoyer une aide</button>`);
  return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('handshake')} Diplomatie avec ${esc(p.nom)}</div>
    ${recue.map(x => `<div class="wf-insp-ligne">${ico('envelope')} Vous propose ${x.genre === 'paix' ? 'la paix' : x.genre === 'alliance' ? 'une alliance' : 'un pacte'}
      <button class="wf-btn petit" data-act="repondre" data-pays="${p.id}" data-genre="${x.genre}" data-accepte="1">Accepter</button>
      <button class="wf-btn petit secondaire" data-act="repondre" data-pays="${p.id}" data-genre="${x.genre}" data-accepte="0">Refuser</button></div>`).join('')}
    <div class="wf-boutons wf-diplo">${b.join('')}</div>
    <div class="wf-insp-ligne petit">${ico('user-secret')} Espionner :
      <button class="wf-lien" data-act="espion" data-pays="${p.id}" data-op="sabotage">sabotage</button> ·
      <button class="wf-lien" data-act="espion" data-pays="${p.id}" data-op="vol">vol de technologie</button> ·
      <button class="wf-lien" data-act="espion" data-pays="${p.id}" data-op="destabilisation">déstabilisation</button></div>
  </div>`;
}

/** Bâtiments constructibles ici, avec leur coût : un clic sur « Bâtir » suffit. */
function menuConstruire(S, i) {
  const m = S.moi;
  const possibles = S.defs.batiments.filter(d => d.constructible && !raisonBatiment(S, d, i));
  // Les bâtiments qui exploitent le gisement de la case d'abord.
  possibles.sort((a, b) => (b.depot ? 1 : 0) - (a.depot ? 1 : 0));
  const verrous = S.defs.batiments.filter(d => d.constructible && d.tech && !aTech(S, d.tech)).length;
  // Une categorie a la fois : le menu reste court.
  const cats = [...new Set(possibles.map(d => d.categorie))];
  const cat = cats.includes(S.catConstruire) ? S.catConstruire : (possibles[0]?.categorie || cats[0]);
  return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('helmet-safety')} Construire ici</div>
    <div class="wf-fab-niveaux">${cats.map(c => `<button class="wf-chip ${c === cat ? 'actif' : ''}" data-act="cat_construire" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="wf-menu-liste">${possibles.filter(d => d.categorie === cat).map(d => {
      const c = coutBatiment(d, 1, m.mods, m.spe);
      const ok = peutPayer(S, c);
      return `<div class="wf-menu-item ${ok ? '' : 'cher'}" title="${esc(d.desc)}">
        <span class="wf-bat-ic">${ico(d.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(d.nom)}</b><small>${cout(S, c)} · ${ico('clock')} ${duree(d.temps / m.bilan.vitesse / S.vitesse)}</small></div>
        <button class="wf-btn petit" data-act="construire" data-case="${i}" data-bat="${d.id}" ${ok ? '' : 'disabled'}>Bâtir</button>
      </div>`;
    }).join('')}</div>
    ${verrous ? `<div class="wf-insp-ligne petit">${ico('scroll')} ${verrous} autres bâtiments se débloquent avec des plans (Marché › Plans).</div>` : ''}</div>`;
}

function menuProduction(S, i) {
  const m = S.moi;
  const b = S.carte.bat[i];
  const unites = S.defs.unites.filter(u => u.batiment === b && (!u.tech || aTech(S, u.tech)));
  const file = m.productions.filter(p => p.case === i);
  return `<div class="wf-menu-titre">${ico('person-military-rifle')} Produire</div>
    ${file.length ? `<div class="wf-insp-ligne petit">${ico('list-check')} En production : ${file.map(p => `${p.qte} × ${esc(uniDef(S, p.unite)?.nom)}`).join(', ')}</div>` : ''}
    <div class="wf-menu-liste">${unites.map(u => {
      const c = coutUnite(u, 1, m.mods, m.spe);
      return `<div class="wf-menu-item" title="${esc(u.desc)}">
        <span class="wf-bat-ic">${ico(u.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(u.nom)}</b><small>${cout(S, c)} / unité</small></div>
        <input type="number" min="1" max="50" value="1" id="qc-${u.id}" data-garder class="wf-qte">
        <button class="wf-btn petit" data-act="produire" data-case="${i}" data-unite="${u.id}" data-champ="qc-${u.id}">${ico('plus')}</button>
      </div>`;
    }).join('') || '<div class="wf-insp-ligne petit">Aucune unité disponible : faites de la recherche.</div>'}</div>
    ${b === 'silo' ? blocArsenal(S, i) : ''}`;
}

// Missiles prets dans ce silo, tirables directement d'ici (avant, il
// fallait trouver et selectionner l'arsenal sur la carte).
function blocArsenal(S, i) {
  const m = S.moi;
  const lignes = [];
  for (const a of S.armees.filter(x => x.proprio === m.id && x.case === i && x.dom === 'missile')) {
    for (const [id, n] of Object.entries(a.unites || {})) {
      const u = uniDef(S, id);
      if (!u || !n) continue;
      lignes.push(`<div class="wf-menu-item" title="${esc(u.desc)}">
        <span class="wf-bat-ic">${ico(u.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(u.nom)}</b><small>${n} en stock · portée ${u.portee > 900 ? 'illimitée' : u.portee + ' cases'}</small></div>
        <button class="wf-btn petit ${id === 'missile_nucleaire' ? 'danger' : ''}" data-act="ordre" data-type="missile" data-genre="${id}" data-armee="${a.id}">${ico('crosshairs')} Tirer</button>
      </div>`);
    }
  }
  const verrous = S.defs.unites.filter(u => u.batiment === 'silo' && u.tech && !aTech(S, u.tech))
    .map(u => `${esc(u.nom)} : recherchez « ${esc(nomTech(S, u.tech))} »`);
  return `<div class="wf-menu-titre">${ico('rocket')} Missiles en stock</div>
    <div class="wf-menu-liste">${lignes.join('') || '<div class="wf-insp-ligne petit">Aucun missile prêt : produisez-en ci-dessus, ils apparaîtront ici une fois terminés.</div>'}</div>
    <div class="wf-insp-ligne petit">${ico('circle-info')} Cliquez sur « Tirer » puis sur la case visée. On ne peut frapper qu'une nation avec qui vous êtes <b>en guerre</b>.</div>
    ${verrous.length ? `<div class="wf-insp-ligne petit">${ico('lock')} ${verrous.join(' · ')}</div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// Armees
// ══════════════════════════════════════════════════════════════════
export function statutArmee(S, a) {
  if (a.assaut != null) return { t: 'Au combat', c: 'rouge', i: 'burst' };
  if (a.bombarde != null) return { t: 'Bombarde', c: 'orange', i: 'bomb' };
  if (a.chemin && a.chemin.length) return { t: `En route (${a.chemin.length} cases)`, c: 'bleu', i: 'route' };
  if (a.dom === 'air') return { t: 'À la base', c: '', i: 'plane-departure' };
  if (a.dom === 'missile') return { t: 'En silo', c: '', i: 'rocket' };
  return { t: 'En position', c: '', i: 'flag' };
}

function panneauArmee(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  const miennes = S.armees.filter(a => a.proprio === m.id);
  const totaux = m.bilan.unites;
  const entretien = S.defs.unites.reduce((acc, u) => {
    const n = totaux[u.id] || 0;
    const k = 1 - 0.04 * (m.mods.logistique || 0);
    acc[0] += u.entretien[0] * n * k; acc[1] += u.entretien[1] * n * k; acc[2] += u.entretien[2] * n * k;
    return acc;
  }, [0, 0, 0]);

  // Batiments de production
  const producteurs = [];
  for (let k = 0; k < S.g.n; k++) {
    const b = S.carte.bat[k];
    if (S.carte.proprio[k] === m.id && b && S.defs.unites.some(u => u.batiment === b)) producteurs.push(k);
  }
  let prod = S.prodCase;
  if (prod == null || !producteurs.includes(prod)) prod = producteurs[0];
  let blocProd = vide('Construisez une caserne pour former vos premières troupes (onglet Construction).', 'person-military-rifle');
  if (prod != null) {
    const b = S.carte.bat[prod];
    const unites = S.defs.unites.filter(u => u.batiment === b);
    blocProd = `<div class="wf-onglets petits">${producteurs.map(k => {
      const d = batDef(S, S.carte.bat[k]);
      return `<button class="${k === prod ? 'actif' : ''}" data-act="prod_case" data-case="${k}">${ico(d.icone)} ${esc(d.nom)} <small>niv. ${S.carte.niv[k]}</small></button>`;
    }).join('')}</div>
    <div class="wf-unites">${unites.map(u => {
      const verrou = u.tech && !aTech(S, u.tech);
      const c = coutUnite(u, 1, m.mods, m.spe);
      const temps = u.temps / (1 + 0.25 * (S.carte.niv[prod] - 1)) / (1 + (m.bilan.vitesse - 1) * 0.5) / (1 + 0.07 * (m.mods.robotique || 0)) / S.vitesse;
      return `<div class="wf-unite ${verrou ? 'verrou' : ''}">
        <div class="wf-unite-tete"><span class="wf-bat-ic">${ico(verrou ? 'lock' : u.icone)}</span><div><h4>${esc(u.nom)}</h4><p>${esc(u.desc)}</p></div></div>
        <div class="wf-unite-stats">
          <span title="Attaque terrestre">${ico('crosshairs')}${u.att_sol}</span>
          <span title="Attaque aérienne">${ico('jet-fighter')}${u.att_air}</span>
          <span title="Attaque navale">${ico('ship')}${u.att_mer}</span>
          <span title="Défense">${ico('shield-halved')}${u.defense}</span>
          <span title="Points de vie">${ico('heart')}${u.pv}</span>
          <span title="Vitesse (cases/min)">${ico('gauge-high')}${u.vitesse}</span>
          ${u.portee ? `<span title="Portée (cases)">${ico('bullseye')}${u.portee > 900 ? '∞' : u.portee}</span>` : ''}
          ${u.furtif ? `<span title="Furtif">${ico('eye-slash')}</span>` : ''}
        </div>
        ${verrou ? `<div class="wf-raison">Technologie : ${esc(nomTech(S, u.tech))}</div>` : `
        <div class="wf-unite-pied">${cout(S, c)} <small>${ico('clock')} ${duree(temps)}/u</small>
          <span class="wf-espace"></span>
          <input type="number" min="1" max="50" value="1" id="qte-${u.id}" data-garder class="wf-qte">
          <button class="wf-btn petit" data-act="produire" data-case="${prod}" data-unite="${u.id}">${ico('plus')} Produire</button>
        </div>`}
      </div>`;
    }).join('')}</div>`;
  }

  return `
  ${titre('Forces armées', 'shield-halved', `<small>Entretien : ${fmt(entretien[0] + 6 * entretien[2], 1)} ${ico('coins')} /min</small>`)}
  <div class="wf-totaux">${Object.keys(totaux).length ? composition(S, totaux) : '<small>Aucune unité</small>'}</div>

  ${titre('Troupes', 'person-military-rifle', `<small>${fmt(m.troupes)} / ${fmt(m.bilan.troupes_max)}</small>`)}
  ${barre(m.troupes / Math.max(1, m.bilan.troupes_max))}
  <p class="wf-note">${ico('circle-info')} Votre réserve se remplit toute seule, plus vite quand elle est vide. Son maximum grandit avec votre territoire, vos villes, votre capitale, vos casernes et vos centres administratifs. <b>Clic droit sur une case</b> : vous y envoyez ${Math.round(S.ratio * 100)} % de vos troupes (terre neutre : votre pays s'agrandit ; ennemi en guerre : vous l'envahissez ; côte lointaine : débarquement depuis un chantier naval).</p>
  ${titre('Offensives', 'flag', `<small>${(S.attaques || []).filter(a => a.de === m.id).length}</small>`)}
  <div class="wf-liste">${(S.attaques || []).filter(a => a.de === m.id || a.cible === m.id).map(a => {
    const mienne = a.de === m.id;
    const autre = mienne ? (a.cible != null ? S.pays.get(a.cible) : null) : S.pays.get(a.de);
    const quoi = mienne ? (a.cible == null ? 'Expansion en terres neutres' : `Offensive contre ${esc(autre?.nom || '?')}`) : `${esc(autre?.nom || '?')} vous envahit`;
    return `<div class="wf-ligne cliquable" data-act="voir" data-case="${a.bateau ? a.bateau.case : a.vise}">
      <span class="wf-ligne-ic">${ico(a.bateau ? 'ship' : mienne ? 'person-military-pointing' : 'triangle-exclamation')}</span>
      <div class="wf-ligne-corps"><div class="wf-ligne-titre">${quoi}</div>
      <div class="wf-ligne-sous">${fmt(a.troupes)} troupes · ${a.prises} cases prises${a.bateau ? ` · en mer, débarquement dans ${duree(a.bateau.reste / S.vitesse)}` : ''}</div></div>
      ${mienne && !a.bateau ? `<button class="wf-btn petit secondaire" data-act="rappeler" data-id="${a.id}">Rappeler</button>` : ''}
    </div>`;
  }).join('') || vide('Aucune offensive. Faites un clic droit sur une case neutre qui touche votre pays pour vous agrandir.', 'map-location-dot')}</div>

  ${titre('Armées, flottes et escadres', 'flag', `<small>${miennes.length}</small>`)}
  <div class="wf-liste">${miennes.map(a => {
    const st = statutArmee(S, a);
    return `<div class="wf-ligne cliquable ${a.id === S.selArmee ? 'actif' : ''}" data-act="sel_armee" data-armee="${a.id}">
      <span class="wf-ligne-ic">${ico(uniDef(S, a.principal)?.icone || 'flag')}</span>
      <div class="wf-ligne-corps">
        <div class="wf-ligne-titre">${esc(a.nom)} <small>${a.total} u.</small></div>
        <div class="wf-ligne-sous">${esc(nomCase(S, a.case))} · ${puce(st.t, st.c, st.i)}</div>
        <div class="wf-compos">${composition(S, a.unites)}</div>
      </div>
    </div>`;
  }).join('') || vide('Aucune armée.', 'flag')}</div>

  ${titre('Production militaire', 'industry')}
  ${blocProd}
  ${titre('Commandes en cours', 'list-check')}
  ${listeProductions(S)}
  ${S.missions.filter(x => x.proprio === m.id).length ? titre('Missions aériennes en vol', 'jet-fighter') + `<div class="wf-liste">${S.missions.filter(x => x.proprio === m.id).map(x => `
    <div class="wf-ligne"><span class="wf-ligne-ic">${ico('jet-fighter')}</span><div class="wf-ligne-corps">
    <div class="wf-ligne-titre">${x.retour ? 'Retour vers la base' : 'Vers la cible'}</div>
    <div class="wf-ligne-sous">${composition(S, x.unites)}</div>${barre(x.progres)}</div>
    <button class="wf-btn-ic" data-act="voir" data-case="${x.retour ? x.base : x.cible}">${ico('location-crosshairs')}</button></div>`).join('')}</div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// Recherche
// ══════════════════════════════════════════════════════════════════
function panneauRecherche(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  return corpsRecherche(S, S.brancheRecherche || 'militaire');
}

/** Cout du prochain niveau d'une recherche (technologie ou « am:<id> »). */
export function coutRecherche(S, id) {
  if (id.startsWith('am:')) {
    const d = S.defs.ameliorations.find(a => a.id === id.slice(3));
    const n = S.moi.amelio?.[d?.id] || 0;
    return d && n < d.max ? Math.round(d.cout * Math.pow(1.5, n)) : null;
  }
  const t = S.defs.techs.find(x => x.id === id);
  return t && !S.moi.techs.includes(id) ? t.cout : null;
}

/** Recherche d'une branche : grosses technologies puis ameliorations.
 *  Aucun prerequis : tout se lance d'un clic. Sert aussi au menu du laboratoire. */
export function corpsRecherche(S, branche, compact = false) {
  const m = S.moi;
  const rythme = m.bilan.recherche * S.vitesse;
  const enFile = id => m.file_recherche.includes(id);
  const actuelle = m.recherche;
  const coutActuel = actuelle ? (coutRecherche(S, actuelle) || 1) : 0;
  const etat = id => actuelle === id ? 'encours' : enFile(id) ? 'file' : 'dispo';
  const couleurBranche = S.defs.branches.find(b => b.id === branche)?.couleur || 'var(--accent)';
  const techs = S.defs.techs.filter(t => t.branche === branche);
  const amelios = S.defs.ameliorations.filter(a => a.branche === branche);
  const tete = `
  <div class="wf-recherche-tete">
    ${actuelle ? `<div class="wf-rech-actuelle">
        <span class="wf-bat-ic">${ico(iconeRecherche(S, actuelle))}</span>
        <div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(nomTech(S, actuelle))}</div>
        <div class="wf-ligne-sous">${fmt(m.recherche_prog)} / ${fmt(coutActuel)} pts · ${rythme > 0 ? duree(Math.max(0, coutActuel - m.recherche_prog) / rythme * 60) : '∞'}</div>
        ${barre(m.recherche_prog / coutActuel)}</div>
        <button class="wf-btn-ic danger" data-act="annuler_recherche" data-tech="${actuelle}" title="Suspendre (points conservés)">${ico('pause')}</button>
      </div>` : `<div class="wf-info">${ico('flask')} Aucune recherche en cours : les points s'accumulent en réserve (${fmt(m.recherche_stock)} pts).</div>`}
    <div class="wf-rech-info">${ico('flask')} ${signe(m.bilan.recherche)} pts/min · réserve ${fmt(m.recherche_stock)} pts</div>
    ${m.file_recherche.length ? `<div class="wf-file">File : ${m.file_recherche.map(t => `<span class="wf-puce">${esc(nomTech(S, t))}<button data-act="annuler_recherche" data-tech="${t}" title="Retirer">${ico('xmark')}</button></span>`).join('')}</div>` : ''}
  </div>
  <div class="wf-onglets">${S.defs.branches.map(b => `<button class="${b.id === branche ? 'actif' : ''}" style="--bc:${b.couleur}" data-act="branche" data-branche="${b.id}">${ico(b.icone)} ${esc(b.nom)}</button>`).join('')}</div>`;
  const cartesTech = techs.map(t => {
    const acquise = m.techs.includes(t.id);
    const st = acquise ? 'acquise' : etat(t.id);
    return `<div class="wf-tech ${st}" ${st === 'dispo' ? `data-act="rechercher" data-tech="${t.id}"` : ''} title="${esc(t.desc)}">
      <div class="wf-tech-tete">${ico(acquise ? 'circle-check' : t.icone)}<b>${esc(t.nom)}</b></div>
      ${compact ? '' : `<p>${esc(t.desc)}</p>`}
      <div class="wf-tech-pied">
        ${acquise ? '<span>Acquise</span>' : `<span>${ico('flask')} ${fmt(t.cout)}</span>`}
        ${st === 'encours' ? barre(m.recherche_prog / t.cout) : ''}
        ${st === 'file' ? '<span class="wf-puce">En file</span>' : ''}
      </div>
    </div>`;
  }).join('');
  const lignesAmelio = amelios.map(a => {
    const id = 'am:' + a.id, n = m.amelio?.[a.id] || 0, c = coutRecherche(S, id), st = etat(id);
    return `<div class="wf-amelio ${st} ${c == null ? 'max' : ''}" ${c != null && st === 'dispo' ? `data-act="rechercher" data-tech="${id}"` : ''} title="${esc(a.desc)} par niveau">
      <span class="wf-bat-ic">${ico(a.icone)}</span>
      <div class="wf-ligne-corps">
        <div class="wf-ligne-titre">${esc(a.nom)} <small>niv. ${n} / ${a.max}</small></div>
        <div class="wf-ligne-sous">${esc(a.desc)} par niveau${n ? ` · actuellement ${esc(effetTotal(a, n))}` : ''}</div>
        <div class="wf-niveaux">${Array.from({ length: a.max }, (_, k) => `<i class="${k < n ? 'plein' : ''}"></i>`).join('')}</div>
      </div>
      <span class="wf-amelio-cout">${c == null ? 'Max' : st === 'encours' ? 'En cours' : st === 'file' ? 'En file' : `${ico('flask')} ${fmt(c)}`}</span>
    </div>`;
  }).join('');
  return `${tete}
  <h3 class="wf-rech-titre">${ico('star')} Grandes technologies</h3>
  <div class="wf-tech-grille" style="--bc:${couleurBranche}">${cartesTech || vide('Aucune technologie dans cette branche.', 'flask')}</div>
  <h3 class="wf-rech-titre">${ico('arrow-trend-up')} Améliorations</h3>
  <div class="wf-liste" style="--bc:${couleurBranche}">${lignesAmelio}</div>
  ${compact ? '' : `<p class="wf-note">${ico('circle-info')} Aucun prérequis : cliquez sur ce que vous voulez rechercher. Si une recherche est déjà en cours, elle part en file d'attente.</p>`}`;
}

/** « +5 % d'attaque » × 3 niveaux -> « +15 % d'attaque ». */
function effetTotal(a, n) {
  return a.desc.replace(/([+-]?)(\d+)/, (_, sg, v) => sg + (Number(v) * n));
}

function iconeRecherche(S, id) {
  if (id.startsWith('am:')) return S.defs.ameliorations.find(a => a.id === id.slice(3))?.icone || 'flask';
  return S.defs.techs.find(t => t.id === id)?.icone || 'flask';
}

// ══════════════════════════════════════════════════════════════════
// Diplomatie
// ══════════════════════════════════════════════════════════════════
function panneauDiplomatie(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  const autres = [...S.pays.values()].filter(p => p.id !== m.id && !p.elimine).sort((a, b) => b.score - a.score);
  const recues = S.propositions.filter(p => p.a === m.id);
  const envoyees = S.propositions.filter(p => p.de === m.id);
  const guerres = autres.filter(p => S.relations[p.id]?.etat === 'guerre');
  const espion = m.techs.includes('dip_espionnage');
  const chefBloc = m.bloc != null && S.blocs.get(m.bloc)?.chef === m.id;
  const maintenant = Date.now() / 1000;
  return `
  ${recues.length ? titre('Propositions reçues', 'envelope-open-text') + `<div class="wf-liste">${recues.map(p => {
    const de = S.pays.get(p.de);
    return `<div class="wf-ligne">${drapeau(de)}<div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(de?.nom)}</div>
      <div class="wf-ligne-sous">propose ${p.genre === 'paix' ? 'un traité de paix' : 'un pacte de non-agression'}</div></div>
      <button class="wf-btn petit" data-act="repondre" data-pays="${p.de}" data-genre="${p.genre}" data-accepte="1">${ico('check')} Accepter</button>
      <button class="wf-btn petit secondaire" data-act="repondre" data-pays="${p.de}" data-genre="${p.genre}" data-accepte="0">${ico('xmark')}</button></div>`;
  }).join('')}</div>` : ''}
  ${guerres.length ? titre('Guerres en cours', 'burst') + `<div class="wf-puces">${guerres.map(p => `<span class="wf-puce rouge">${drapeau(p, 18)} ${esc(p.nom)}</span>`).join('')}</div>` : ''}
  ${envoyees.length ? `<p class="wf-note">${ico('paper-plane')} En attente de réponse : ${envoyees.map(p => esc(S.pays.get(p.a)?.nom || '?')).join(', ')}</p>` : ''}

  ${titre('Nations du monde', 'earth-europe', `<small>${autres.length}</small>`)}
  <div class="wf-liste">${autres.map(p => {
    const rel = S.relations[p.id]?.etat || 'paix';
    const jusqu = S.relations[p.id]?.jusqu || 0;
    const bloc = p.bloc != null ? S.blocs.get(p.bloc) : null;
    const memeBloc = bloc && p.bloc === m.bloc;
    const envoye = t => envoyees.some(x => x.a === p.id && x.genre === t);
    return `<div class="wf-diplo">
      <div class="wf-diplo-tete">
        ${drapeau(p, 34)}
        <div class="wf-ligne-corps">
          <div class="wf-ligne-titre">${esc(p.nom)} ${bloc ? `<span class="wf-puce" style="--bc:${esc(bloc.couleur)}">${esc(bloc.sigle)}</span>` : ''}</div>
          <div class="wf-ligne-sous">${joueurDe(p)} · ${p.cases} provinces · score ${fmt(p.score)}</div>
        </div>
        <span class="wf-rel ${rel}">${NOMS_REL[rel]}${rel === 'pna' ? ' · ' + duree(jusqu - maintenant) : ''}</span>
      </div>
      <div class="wf-boutons">
        <button class="wf-btn-ic" data-act="voir" data-case="${p.capitale}" title="Voir la capitale">${ico('location-crosshairs')}</button>
        ${rel === 'guerre'
          ? `<button class="wf-btn petit" data-act="proposer" data-pays="${p.id}" data-genre="paix" ${envoye('paix') ? 'disabled' : ''}>${ico('dove')} Proposer la paix</button>`
          : `${!memeBloc ? `<button class="wf-btn petit danger" data-act="guerre" data-pays="${p.id}" ${p.protection > 0 || rel === 'pna' ? 'disabled' : ''} title="${p.protection > 0 ? 'Nation protégée encore ' + duree(p.protection) : 'Coûte 10 d\'influence'}">${ico('burst')} Guerre</button>` : ''}
             ${rel === 'paix' ? `<button class="wf-btn petit secondaire" data-act="proposer" data-pays="${p.id}" data-genre="pna" ${envoye('pna') ? 'disabled' : ''}>${ico('handshake')} Pacte</button>` : ''}
             <button class="wf-btn petit secondaire" data-act="aide_form" data-pays="${p.id}">${ico('box-open')} Aide</button>`}
        ${chefBloc && p.bloc == null ? `<button class="wf-btn petit secondaire" data-act="bloc_inviter" data-pays="${p.id}">${ico('user-plus')} Inviter</button>` : ''}
        ${espion && !memeBloc ? `<span class="wf-menu-espion">
          <button class="wf-btn petit secondaire" data-act="espion" data-pays="${p.id}" data-op="sabotage" title="30 influence : endommage un bâtiment">${ico('user-secret')} Sabotage</button>
          <button class="wf-btn petit secondaire" data-act="espion" data-pays="${p.id}" data-op="vol" title="40 influence : dérobe des points de recherche">${ico('microchip')} Vol</button>
          <button class="wf-btn petit secondaire" data-act="espion" data-pays="${p.id}" data-op="destabilisation" title="25 influence : fait chuter son influence">${ico('bullhorn')} Déstab.</button>
        </span>` : ''}
      </div>
      ${p.protection > 0 ? `<div class="wf-ligne-sous">${ico('shield-halved')} Protection des nouveaux venus : ${duree(p.protection)}</div>` : ''}
    </div>`;
  }).join('') || vide('Vous êtes seul au monde… pour l\'instant.', 'earth-europe')}</div>
  <p class="wf-note">${ico('circle-info')} Déclarer la guerre à un membre d'un bloc entraîne automatiquement tout son bloc dans le conflit (défense collective).</p>`;
}

// ══════════════════════════════════════════════════════════════════
// Blocs
// ══════════════════════════════════════════════════════════════════
function scoreBloc(S, b) {
  return b.membres.reduce((a, id) => a + (S.pays.get(id)?.score || 0), 0);
}

function panneauBlocs(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  const tous = [...S.blocs.values()].sort((a, b) => scoreBloc(S, b) - scoreBloc(S, a));
  const mien = m.bloc != null ? S.blocs.get(m.bloc) : null;
  let haut = '';
  if (mien) {
    const chef = mien.chef === m.id;
    haut = `<div class="wf-bloc grand" style="--bc:${esc(mien.couleur)}">
      <div class="wf-bloc-tete"><span class="wf-bloc-sigle">${esc(mien.sigle)}</span>
        <div><h2>${esc(mien.nom)}</h2><small>Fondé le ${new Date(mien.cree * 1000).toLocaleDateString('fr-FR')} · dirigé par ${esc(S.pays.get(mien.chef)?.nom)}</small></div></div>
      ${chef ? `<textarea id="bloc-charte" data-garder maxlength="400" placeholder="Charte du bloc">${esc(mien.charte)}</textarea>
        <button class="wf-btn petit secondaire" data-act="bloc_charte">${ico('floppy-disk')} Mettre à jour la charte</button>`
        : `<p class="wf-charte">${mien.charte ? esc(mien.charte) : '<i>Pas de charte.</i>'}</p>`}
      <div class="wf-action-ligne"><div>${ico('vault')} Trésor commun : <b>${fmt(mien.tresor)}</b> crédits</div>
        <input type="number" id="bloc-don" data-garder min="1" placeholder="Montant" class="wf-qte large">
        <button class="wf-btn petit" data-act="bloc_don">${ico('hand-holding-dollar')} Verser</button></div>
    </div>
    ${titre('Membres', 'people-group', `<small>${mien.membres.length} / 10</small>`)}
    <div class="wf-liste">${mien.membres.map(id => {
      const p = S.pays.get(id);
      return `<div class="wf-ligne">${drapeau(p)}<div class="wf-ligne-corps">
        <div class="wf-ligne-titre">${esc(p?.nom)} ${id === mien.chef ? `<span class="wf-puce accent">${ico('crown')}Dirigeant</span>` : ''}</div>
        <div class="wf-ligne-sous">${joueurDe(p)} · score ${fmt(p?.score)} · ${p?.cases} provinces</div></div>
        ${chef && id !== m.id ? `
          <input type="number" id="verser-${id}" data-garder min="1" placeholder="Crédits" class="wf-qte">
          <button class="wf-btn-ic" data-act="bloc_verser" data-pays="${id}" title="Verser depuis le trésor">${ico('hand-holding-dollar')}</button>
          <button class="wf-btn-ic" data-act="bloc_chef" data-pays="${id}" title="Transmettre la direction">${ico('crown')}</button>
          <button class="wf-btn-ic danger" data-act="bloc_exclure" data-pays="${id}" title="Exclure">${ico('user-minus')}</button>` : ''}
      </div>`;
    }).join('')}</div>
    ${chef && mien.candidats.length ? titre('Candidatures', 'inbox') + `<div class="wf-liste">${mien.candidats.map(id => {
      const p = S.pays.get(id);
      return `<div class="wf-ligne">${drapeau(p)}<div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(p?.nom)}</div><div class="wf-ligne-sous">score ${fmt(p?.score)}</div></div>
        <button class="wf-btn petit" data-act="bloc_accepter" data-pays="${id}">${ico('check')} Accepter</button>
        <button class="wf-btn petit secondaire" data-act="bloc_refuser" data-pays="${id}">${ico('xmark')}</button></div>`;
    }).join('')}</div>` : ''}
    ${chef && mien.invites.length ? `<p class="wf-note">${ico('paper-plane')} Invitations envoyées : ${mien.invites.map(id => esc(S.pays.get(id)?.nom || '?')).join(', ')}</p>` : ''}
    <div class="wf-boutons"><button class="wf-btn secondaire" data-act="ouvrir" data-panneau="chat" data-canal="bloc">${ico('comments')} Canal du bloc</button>
    <button class="wf-btn danger" data-act="bloc_quitter">${ico('right-from-bracket')} Quitter le bloc</button></div>`;
  } else {
    const invitations = tous.filter(b => b.invites.includes(m.id));
    const tech = m.techs.includes('dip_alliances');
    haut = `${invitations.length ? titre('Invitations reçues', 'envelope-open-text') + `<div class="wf-liste">${invitations.map(b => `
      <div class="wf-ligne"><span class="wf-bloc-sigle petit" style="--bc:${esc(b.couleur)}">${esc(b.sigle)}</span><div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(b.nom)}</div><div class="wf-ligne-sous">${b.membres.length} membres</div></div>
      <button class="wf-btn petit" data-act="bloc_postuler" data-bloc="${b.id}">${ico('check')} Rejoindre</button></div>`).join('')}</div>` : ''}
    ${titre('Fonder un bloc', 'flag')}
    ${tech ? `<div class="wf-form">
      <label>Nom du bloc<input id="bloc-nom" data-garder maxlength="40" placeholder="Ex. : Pacte du Nord"></label>
      <label>Sigle<input id="bloc-sigle" data-garder maxlength="6" placeholder="PDN"></label>
      <label>Couleur</label>
      <div class="wf-palette">${S.defs.couleurs.map((c, k) => `<button class="wf-pastille ${k === 1 ? 'actif' : ''}" style="--c:${c}" data-act="choisir" data-groupe="bloc-couleur" data-val="${c}"></button>`).join('')}
        <input type="color" id="bloc-couleur" data-garder value="${S.defs.couleurs[1]}"></div>
      <label>Charte<textarea id="bloc-charte-new" data-garder maxlength="400" placeholder="Nos valeurs, nos règles, nos ambitions…"></textarea></label>
      <button class="wf-btn" data-act="bloc_creer" ${m.influence < 100 ? 'disabled' : ''}>${ico('flag')} Fonder (100 influence)</button>
    </div>` : `<div class="wf-info">${ico('lock')} Recherchez « Traités d'alliance » (Diplomatie) pour fonder votre propre bloc. Vous pouvez déjà postuler à un bloc existant.</div>`}`;
  }
  return `${haut}
  ${titre('Blocs du monde', 'earth-europe', `<small>${tous.length}</small>`)}
  <div class="wf-blocs">${tous.map((b, k) => `
    <div class="wf-bloc" style="--bc:${esc(b.couleur)}">
      <div class="wf-bloc-tete"><span class="wf-bloc-sigle">${esc(b.sigle)}</span>
      <div><h3>#${k + 1} ${esc(b.nom)}</h3><small>${b.membres.length} membre${b.membres.length > 1 ? 's' : ''} · score ${fmt(scoreBloc(S, b))}</small></div></div>
      <div class="wf-bloc-membres">${b.membres.map(id => drapeau(S.pays.get(id), 22)).join('')}</div>
      ${b.charte ? `<p class="wf-charte">${esc(b.charte)}</p>` : ''}
      ${!mien && !b.candidats.includes(m.id) && b.membres.length < 10 ? `<button class="wf-btn petit secondaire" data-act="bloc_postuler" data-bloc="${b.id}">${ico('paper-plane')} Postuler</button>` : ''}
      ${!mien && b.candidats.includes(m.id) ? puce('Candidature envoyée', 'bleu', 'hourglass-half') : ''}
    </div>`).join('') || vide('Aucun bloc n\'a encore été fondé.', 'people-group')}</div>`;
}

// ══════════════════════════════════════════════════════════════════
// Marche
// ══════════════════════════════════════════════════════════════════
/** Elements et produits au marche : on achete 1,5 fois le prix du jour ; le
 *  cours baisse quand on vend et monte quand on achete. */
function marcheObjets(S) {
  const filtre = (S.marcheFiltre || '').trim().toLowerCase();
  // Sans recherche : ce que vous possedez ; avec : les 60 premiers resultats.
  const tous = [...S.defs.elements.map(e => ({ id: e.id, nom: e.nom, ic: null, el: e })), ...S.defs.produits.map(p => ({ id: p.id, nom: p.nom, ic: p.icone, pr: p }))];
  const liste = (filtre ? tous.filter(o => (o.nom + ' ' + o.id).toLowerCase().includes(filtre)) : tous.filter(o => possede(S, o.id) >= 1)).slice(0, 60);
  return `<div class="wf-info">${ico('scale-balanced')} Achetez ce qui vous manque, vendez vos surplus. Chaque vente fait baisser le cours, chaque achat le fait monter ; il revient lentement à la normale.</div>
    <div class="wf-livre-outils"><input type="search" id="marche-filtre" data-filtre="marcheFiltre" data-cible=".wf-objet-ligne" placeholder="Chercher (fer, acier, robot…)" value="${esc(S.marcheFiltre || '')}" data-garder>
      <label class="wf-ligne-form">Quantité <input type="number" id="marche-qte" min="1" max="1000" value="${S.marcheQte || 10}" class="wf-qte" data-garder></label></div>
    <div class="wf-liste">${liste.map(o => {
      const cours = S.cours?.[o.id] ?? 1;
      const prix = prixCours(S, o.id);
      const cherche = (o.nom + ' ' + o.id).toLowerCase();
      return `<div class="wf-plan wf-objet-ligne" data-nom="${esc(cherche)}" ${filtre && !cherche.includes(filtre) ? 'hidden' : ''}>
        ${o.el ? `<b class="wf-symbole grand" style="--c:${FAMILLES[o.el.categorie][1]}">${esc(o.id)}</b>` : `<span class="wf-bat-ic" style="color:${COULEURS_NIVEAU[o.pr.niveau]}">${ico(o.ic)}</span>`}
        <div class="wf-ligne-corps"><b>${esc(o.nom)}</b><small>${fmt(possede(S, o.id), 1)} en stock · vente ${fmt(prix)} · achat ${fmt(prix * 1.5)} ${ico('coins')}
          ${Math.abs(cours - 1) > 0.01 ? `<span class="${cours >= 1 ? 'pos' : 'neg'}">${cours >= 1 ? '▲' : '▼'} ${Math.round(Math.abs(cours - 1) * 100)} %</span>` : ''}</small></div>
        <button class="wf-btn petit" data-act="acheter_objet" data-objet="${o.id}">Acheter</button>
        <button class="wf-btn petit secondaire" data-act="vendre_marche" data-objet="${o.id}" ${possede(S, o.id) >= 1 ? '' : 'disabled'}>Vendre</button>
      </div>`;
    }).join('') || vide(filtre ? 'Aucun résultat.' : 'Vous ne possédez encore aucun élément ni produit : cherchez ce que vous voulez acheter.', 'magnifying-glass')}</div>`;
}

/** Plans de technologies et d'améliorations, achetés au marché (la recherche
 *  n'existe plus : sinon, les laboratoires en inventent de temps en temps). */
function marchePlans(S) {
  const m = S.moi;
  const k = S.defs.prix_plan * (m.spe === 'scientifique' ? 0.8 : 1);
  const branche = S.branchePlans || S.defs.branches[0].id;
  const techs = S.defs.techs.filter(t => t.branche === branche).sort((a, b) => a.rang - b.rang || a.cout - b.cout);
  const amelios = S.defs.ameliorations.filter(a => a.branche === branche);
  const ligne = (id, nom, desc, icone, prix, possede, extra = '') => `<div class="wf-plan ${possede ? 'possede' : ''}">
      <span class="wf-bat-ic">${ico(possede ? 'circle-check' : icone)}</span>
      <div class="wf-ligne-corps"><b>${esc(nom)}</b>${extra}<small>${esc(desc)}</small></div>
      ${possede ? '<span class="wf-puce accent">Acquis</span>' : `<button class="wf-btn petit" data-act="acheter_plan" data-plan="${id}" ${m.res[0] >= prix ? '' : 'disabled'}>${fmt(prix)} ${ico('coins')}</button>`}
    </div>`;
  return `<div class="wf-info">${ico('scroll')} Achetez les plans des technologies et des améliorations. Vos <b>laboratoires</b> en inventent aussi tout seuls de temps en temps (plus vous avez de niveaux, plus c'est fréquent).</div>
    <div class="wf-fab-niveaux">${S.defs.branches.map(b => `<button class="wf-chip ${b.id === branche ? 'actif' : ''}" data-act="branche_plans" data-branche="${b.id}">${ico(b.icone)} ${esc(b.nom)}</button>`).join('')}</div>
    ${titre('Technologies', 'flask')}
    <div class="wf-liste">${techs.map(t => ligne(t.id, t.nom, t.desc, t.icone, Math.round(t.cout * k), m.techs.includes(t.id))).join('')}</div>
    ${amelios.length ? titre('Améliorations', 'arrow-up-right-dots') + `<div class="wf-liste">${amelios.map(a => {
      const n = m.amelio?.[a.id] || 0;
      return ligne('am:' + a.id, a.nom, a.desc, a.icone, Math.round(a.cout * Math.pow(1.5, n) * k), n >= a.max, ` <small>niv. ${n} / ${a.max}</small>`);
    }).join('')}</div>` : ''}`;
}

function sparkline(valeurs, couleur) {
  if (!valeurs || valeurs.length < 2) return '';
  const min = Math.min(...valeurs), max = Math.max(...valeurs);
  const e = max - min || 1;
  const pts = valeurs.map((v, k) => `${(k / (valeurs.length - 1) * 100).toFixed(1)},${(28 - (v - min) / e * 24).toFixed(1)}`).join(' ');
  return `<svg class="wf-spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${couleur}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function panneauMarche(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
  const onglet = S.ongletMarche || 'ressources';
  const onglets = [['ressources', 'Minerais', 'cubes'], ['objets', 'Éléments & produits', 'boxes-stacked'], ['plans', 'Plans', 'scroll'], ['equipement', 'Équipement militaire', 'person-military-rifle'], ['services', 'Services', 'handshake']];
  const frais = m.mods.frais;
  let corps = '';
  if (onglet === 'ressources') {
    corps = `<div class="wf-info">${ico('scale-balanced')} Marché partagé par toutes les nations : chaque achat fait monter le prix, chaque vente le fait baisser. Frais : <b>${Math.round(frais * 100)} %</b>${m.mods.mondialisation ? ' · ventes +20 %' : ''}.</div>
    <div class="wf-marche">${S.defs.ressources.map((r, i) => {
      if (i === 0 || !(r.prix_base > 0)) return '';
      const p = S.prix[i];
      const ecart = (p / r.prix_base - 1) * 100;
      return `<div class="wf-marche-ligne">
        <div class="wf-marche-res">${ico(r.icone, '', `color:${r.couleur}`)}<div><b>${esc(r.nom)}</b><small>Stock : ${fmt(m.res[i])}</small></div></div>
        <div class="wf-marche-prix"><b>${p.toFixed(2).replace('.', ',')}</b> ${ico('coins')}<small class="${ecart >= 0 ? 'neg' : 'pos'}">${ecart >= 0 ? '▲' : '▼'} ${Math.abs(ecart).toFixed(0)} %</small></div>
        ${sparkline(S.histPrix[i], r.couleur)}
        <div class="wf-marche-ordre">
          <input type="number" min="1" max="5000" value="100" id="marche-${i}" data-garder class="wf-qte">
          <button class="wf-btn petit" data-act="marche" data-res="${i}" data-sens="achat">Acheter</button>
          <button class="wf-btn petit secondaire" data-act="marche" data-res="${i}" data-sens="vente">Vendre</button>
        </div>
      </div>`;
    }).join('')}</div>
    <p class="wf-note">${ico('circle-info')} Les prix reviennent lentement vers leur valeur de référence. Maximum 5 000 unités par ordre.</p>`;
  } else if (onglet === 'plans') {
    corps = marchePlans(S);
  } else if (onglet === 'objets') {
    corps = marcheObjets(S);
  } else if (onglet === 'equipement') {
    corps = `<div class="wf-info">${ico('truck-fast')} Unités livrées tout de suite : à un bâtiment qui peut les accueillir (port, base aérienne, silo), sinon à la capitale pour les troupes terrestres. Sans la technologie, c'est possible mais plus cher. Vos unités au repos (ni en marche ni au combat) se revendent.</div>
    <div class="wf-menu-liste">${listeEquipement(S, 'mq')}</div>`;
  } else {
    corps = `<div class="wf-menu-liste">${listeServices(S, 'ms')}</div>`;
  }
  return `<div class="wf-onglets">${onglets.map(([id, nom, ic]) => `<button class="${id === onglet ? 'actif' : ''}" data-act="onglet_marche" data-onglet="${id}">${ico(ic)} ${nom}</button>`).join('')}</div>${corps}`;
}

/** Prix d'une unité achetée toute faite (identique à jeu.rs prix_unite_marche). */
function prixUnite(S, u) {
  const c = coutUnite(u, 1, S.moi.mods, S.moi.spe);
  const valeur = c.reduce((a, v, i) => a + (i === 0 ? v : v * S.prix[i]), 0);
  return Math.ceil(valeur * (!u.tech || aTech(S, u.tech) ? 1.5 : 2.5));
}

function listeEquipement(S, prefixe) {
  return S.defs.unites.filter(u => u.id !== 'missile_nucleaire').map(u => {
    const px = prixUnite(S, u);
    const sansTech = u.tech && !aTech(S, u.tech);
    const revente = Math.floor(px / (sansTech ? 2.5 : 1.5) * 0.6);
    const possede = aurepos(S, u.id);
    return `<div class="wf-menu-item" title="${esc(u.desc)}">
      <span class="wf-bat-ic">${ico(u.icone)}</span>
      <div class="wf-ligne-corps"><b>${esc(u.nom)}</b><small>Achat ${fmt(px)} ${ico('coins')}${sansTech ? ' (sans la technologie ×2,5)' : ''} · revente ${fmt(revente)} ${ico('coins')}${possede ? ` · ${possede} au repos` : ''}</small></div>
      <input type="number" min="1" max="500" value="1" id="${prefixe}-${u.id}" data-garder class="wf-qte">
      <button class="wf-btn petit" data-act="acheter_unite" data-unite="${u.id}" data-champ="${prefixe}-${u.id}" ${S.moi.res[0] < px ? 'disabled' : ''}>Acheter</button>
      <button class="wf-btn petit secondaire" data-act="vendre_unite" data-unite="${u.id}" data-champ="${prefixe}-${u.id}" ${possede ? '' : 'disabled'}>Vendre</button>
    </div>`;
  }).join('');
}

/** Unités d'un type dans des armées au repos (vendables). */
function aurepos(S, type) {
  return S.armees.filter(a => a.proprio === S.moi.id && !(a.chemin && a.chemin.length) && a.assaut == null)
    .reduce((n, a) => n + (a.unites?.[type] || 0), 0);
}

function listeServices(S, prefixe) {
  const services = [
    ['recherche', 'Points de recherche', 'flask', 12, 'Ajoutés à votre réserve de recherche.'],
    ['influence', 'Influence', 'handshake', 30, 'Pour annexer, déclarer une guerre ou espionner.'],
  ];
  const dispo = { recherche: S.moi.recherche_stock, influence: S.moi.influence };
  return services.map(([id, nom, ic, px, desc]) => `<div class="wf-menu-item" title="${esc(desc)}">
      <span class="wf-bat-ic">${ico(ic)}</span>
      <div class="wf-ligne-corps"><b>${nom}</b><small>Achat ${px} ${ico('coins')} · revente ${px / 2} ${ico('coins')} le point · vous en avez ${fmt(dispo[id])}</small></div>
      <input type="number" min="1" max="5000" value="50" id="${prefixe}-${id}" data-garder class="wf-qte">
      <button class="wf-btn petit" data-act="acheter_service" data-service="${id}" data-champ="${prefixe}-${id}">Acheter</button>
      <button class="wf-btn petit secondaire" data-act="vendre_service" data-service="${id}" data-champ="${prefixe}-${id}">Vendre</button>
    </div>`).join('');
}

/** Mini-marché de la place financière (menu de la case). */
function menuMarche(S) {
  const m = S.moi;
  return `<div class="wf-menu-titre">${ico('scale-balanced')} Marché mondial</div>
    <div class="wf-menu-liste">${S.defs.ressources.map((r, i) => i === 0 ? '' : `<div class="wf-menu-item">
      <span class="wf-bat-ic">${ico(r.icone, '', `color:${r.couleur}`)}</span>
      <div class="wf-ligne-corps"><b>${esc(r.nom)}</b><small>${S.prix[i].toFixed(2).replace('.', ',')} ${ico('coins')} · stock ${fmt(m.res[i])}</small></div>
      <input type="number" min="1" max="5000" value="100" id="bq-${i}" data-garder class="wf-qte">
      <button class="wf-btn petit" data-act="marche" data-res="${i}" data-sens="achat" data-champ="bq-${i}" title="Acheter">${ico('plus')}</button>
      <button class="wf-btn petit secondaire" data-act="marche" data-res="${i}" data-sens="vente" data-champ="bq-${i}" title="Vendre">${ico('minus')}</button>
    </div>`).join('')}${listeServices(S, 'bs')}</div>
    <button class="wf-btn petit secondaire" data-act="ouvrir" data-panneau="marche">${ico('up-right-from-square')} Tout le marché (équipement militaire…)</button>`;
}

// ══════════════════════════════════════════════════════════════════
// Classements
// ══════════════════════════════════════════════════════════════════
const CATEGORIES = [
  ['global', 'Général', 'ranking-star'], ['militaire', 'Militaire', 'shield-halved'], ['economie', 'Économie', 'coins'],
  ['territoire', 'Territoire', 'map-location-dot'], ['technologie', 'Technologie', 'flask'], ['population', 'Population', 'people-group'],
  ['diplomatie', 'Diplomatie', 'handshake'], ['victoires', 'Victoires', 'medal'], ['blocs', 'Blocs', 'flag'],
];

function panneauClassement(S) {
  const cat = S.categorie || 'global';
  let lignes;
  if (cat === 'blocs') {
    lignes = [...S.blocs.values()].map(b => ({ b, v: scoreBloc(S, b) })).sort((a, b) => b.v - a.v).map((x, k) => `
      <tr class="${S.moi && x.b.membres.includes(S.moi.id) ? 'moi' : ''}"><td class="rang">${rang(k)}</td>
      <td><span class="wf-bloc-sigle petit" style="--bc:${esc(x.b.couleur)}">${esc(x.b.sigle)}</span> ${esc(x.b.nom)}</td>
      <td>${x.b.membres.length} membres</td><td class="num"><b>${fmt(x.v)}</b></td></tr>`);
  } else {
    lignes = S.classement.map(c => ({ p: S.pays.get(c.id), v: c.scores[cat] })).filter(x => x.p)
      .sort((a, b) => b.v - a.v).map((x, k) => `
      <tr class="${S.moi && x.p.id === S.moi.id ? 'moi' : ''}"><td class="rang">${rang(k)}</td>
      <td>${drapeau(x.p, 22)} ${esc(x.p.nom)}</td><td>${joueurDe(x.p)}</td>
      <td class="num"><b>${cat === 'population' ? fmtPop(x.v) : fmt(x.v)}</b></td></tr>`);
  }
  return `<div class="wf-onglets petits">${CATEGORIES.map(([id, nom, ic]) => `<button class="${id === cat ? 'actif' : ''}" data-act="categorie" data-cat="${id}">${ico(ic)} ${nom}</button>`).join('')}</div>
  <table class="wf-table classement"><thead><tr><th>#</th><th>${cat === 'blocs' ? 'Bloc' : 'Nation'}</th><th>${cat === 'blocs' ? 'Taille' : 'Dirigeant'}</th><th class="num">Valeur</th></tr></thead>
  <tbody>${lignes.join('') || '<tr><td colspan="4">Aucune donnée.</td></tr>'}</tbody></table>`;
}

function rang(k) {
  if (k < 3) return `<span class="wf-medaille m${k + 1}">${ico('medal')}${k + 1}</span>`;
  return String(k + 1);
}

// ══════════════════════════════════════════════════════════════════
// Journal
// ══════════════════════════════════════════════════════════════════
export const ICONES_EVT = {
  alerte: ['triangle-exclamation', 'rouge'], victoire: ['trophy', 'accent'], militaire: ['person-military-rifle', ''],
  construction: ['helmet-safety', ''], recherche: ['flask', 'bleu'], diplomatie: ['handshake', 'bleu'],
  guerre: ['burst', 'rouge'], nucleaire: ['radiation', 'rouge'], annonce: ['bullhorn', 'orange'],
};

function panneauJournal(S) {
  const f = S.filtreJournal || 'tout';
  const filtres = [['tout', 'Tout'], ['monde', 'Actualité mondiale'], ['alerte', 'Alertes'], ['militaire', 'Militaire'], ['construction', 'Construction'], ['recherche', 'Recherche'], ['diplomatie', 'Diplomatie']];
  const liste = S.evenements.slice().reverse().filter(e => {
    if (f === 'tout') return true;
    if (f === 'monde') return e.pays == null;
    if (f === 'militaire') return ['militaire', 'victoire', 'guerre', 'nucleaire'].includes(e.genre);
    return e.genre === f;
  });
  return `<div class="wf-onglets petits">${filtres.map(([id, nom]) => `<button class="${id === f ? 'actif' : ''}" data-act="filtre_journal" data-f="${id}">${nom}</button>`).join('')}</div>
  <div class="wf-journal">${liste.map(e => {
    const [ic, cls] = ICONES_EVT[e.genre] || ['circle-info', ''];
    return `<div class="wf-evt ${cls} ${e.pays == null ? 'monde' : ''}">
      <span class="wf-evt-ic">${ico(ic)}</span>
      <div class="wf-ligne-corps"><div>${esc(e.texte)}</div><small>${heure(e.t)}${e.pays == null ? ' · actualité mondiale' : ''}</small></div>
      ${e.case != null ? `<button class="wf-btn-ic" data-act="voir" data-case="${e.case}" title="Voir sur la carte">${ico('location-crosshairs')}</button>` : ''}
    </div>`;
  }).join('') || vide('Rien à signaler.', 'newspaper')}</div>`;
}

// ══════════════════════════════════════════════════════════════════
// Messagerie (rendu partiel : la zone de saisie n'est jamais redessinee)
// ══════════════════════════════════════════════════════════════════
function panneauChat(S) {
  const canal = S.canal || 'global';
  const bloc = S.moi?.bloc != null ? S.blocs.get(S.moi.bloc) : null;
  return `<div class="wf-onglets petits">
    <button class="${canal === 'global' ? 'actif' : ''}" data-act="canal" data-canal="global">${ico('earth-europe')} Monde</button>
    <button class="${canal === 'bloc' ? 'actif' : ''}" data-act="canal" data-canal="bloc" ${bloc ? '' : 'disabled'}>${ico('people-group')} ${bloc ? esc(bloc.sigle) : 'Bloc'}</button>
  </div>
  <div class="wf-chat" id="wf-chat-liste"></div>
  <form class="wf-chat-saisie" data-form="chat">
    <input id="chat-texte" maxlength="300" placeholder="${canal === 'bloc' ? 'Message à votre bloc…' : 'Message au monde entier…'}" autocomplete="off" ${S.moi ? '' : 'disabled'}>
    <button class="wf-btn" type="submit" ${S.moi ? '' : 'disabled'}>${ico('paper-plane')}</button>
  </form>`;
}

export function listeChat(S) {
  const canal = S.canal || 'global';
  const cle = canal === 'bloc' && S.moi?.bloc != null ? 'bloc:' + S.moi.bloc : 'global';
  const msgs = S.chat.filter(c => c.canal === cle);
  return msgs.map(c => `<div class="wf-msg ${c.auteur === S.joueur.nom ? 'moi' : ''}">
    <div class="wf-msg-tete"><b style="color:${esc(c.couleur)}">${esc(c.pays)}</b> <small>${esc(c.auteur)} · ${heure(c.t)}</small></div>
    <div class="wf-msg-txt">${esc(c.texte)}</div></div>`).join('') || vide('Aucun message. Lancez la conversation !', 'comments');
}

// ══════════════════════════════════════════════════════════════════
// Guide
// ══════════════════════════════════════════════════════════════════
function panneauAide(S) {
  const u = S.defs.unites;
  return `<div class="wf-guide">
  <h3>${ico('flag')} Premiers pas</h3>
  <p>Fondez votre nation : elle apparaît avec une capitale et quelques provinces. Faites un <b>clic gauche</b> sur une de vos cases pour construire : des <b>mines</b> sur les gisements (une par type de minerai) ou des carrières, une <b>centrale</b> pour l'électricité, une <b>raffinerie</b> et un <b>complexe industriel</b> pour fabriquer, et des <b>laboratoires</b> qui inventent parfois des technologies (sinon, achetez les plans au marché). Cliquez sur un autre pays pour l'attaquer, lui proposer la paix ou une alliance. Les nouvelles nations sont protégées de toute déclaration de guerre pendant quelques heures.</p>
  <h3>${ico('map-location-dot')} Faire grandir son pays</h3>
  <p>Comme dans OpenFront, votre pays grandit avec vos <b>troupes</b>. Faites un <b>clic droit</b> sur une case : une part de votre réserve (curseur « Envoyer » en bas à gauche de la carte) part s'en emparer, case par case, en commençant par celle que vous avez visée. Sur une terre neutre, votre pays s'agrandit ; chez une nation avec qui vous êtes en guerre, vous l'envahissez (son relief, ses forts et ses troupes résistent) ; sur une côte lointaine, vos troupes débarquent depuis un chantier naval. Le <b>clic gauche</b> sert à construire.</p>
  <h4>${ico('gears')} Minerais et fabrication</h4>
  <p>Les <b>carrières</b> (partout) et les mines extraient quatre minerais : commun, rare (gisements de terres rares), radioactif (gisements d'uranium) et légendaire (cratères de météorite, très rares). La <b>raffinerie</b> les transforme en métal, terres rares, uranium, ou en n'importe lequel des 118 éléments du tableau périodique. La <b>fabrique</b> assemble ensuite plus de 100 produits, de l'acier jusqu'au trou noir : son niveau fixe la complexité des recettes. Les éléments légendaires se désintègrent vite, comme dans la réalité : utilisez-les sans attendre.</p>
  <h3>${ico('gem')} Ressources</h3>
  <p>Chaque région a ses gisements : filons de minerai commun (collines, montagnes, déserts), minerai radioactif (montagnes, toundra), minerai rare (forêts, collines), cratères de météorite (minerai légendaire, très rares) et sols fertiles. Une carrière extrait du minerai commun n'importe où. Ce qui vous manque s'achète au <b>marché mondial</b> ou se négocie avec vos alliés. L'<b>électricité</b> n'est pas stockée : si la consommation dépasse la production, tous les bâtiments consommateurs tournent au ralenti.</p>
  <h3>${ico('flask')} Recherche</h3>
  <p>Quatre branches (militaire, économie, diplomatie, industrie) débloquent bâtiments, unités et bonus. Les branches se croisent : les chars demandent la sidérurgie, les missiles l'aérospatiale, le nucléaire militaire le nucléaire civil.</p>
  <h3>${ico('person-military-rifle')} Armées et combat</h3>
  <p>Sélectionnez une armée puis <b>clic droit</b> sur une case (ou « Déplacer ») : elle suit le meilleur chemin. Entrer dans une province ennemie la conquiert ; si elle est défendue, un combat s'engage en temps réel. Relief et <b>fortifications</b> avantagent le défenseur. L'<b>artillerie</b> et les navires lourds bombardent à distance sans riposte. Les troupes ne traversent un pays que s'il est allié ou en guerre avec vous.</p>
  <h3>${ico('jet-fighter')} Aviation, marine et missiles</h3>
  <p>Les avions restent à leur base aérienne et partent en <b>mission</b> dans leur rayon d'action ; batteries sol-air, DCA et chasseurs ennemis les abattent. Les navires naviguent de port en port ; avec les <b>opérations amphibies</b>, vos troupes peuvent traverser la mer. Les <b>missiles</b> partent d'un silo et peuvent être interceptés par les batteries sol-air.</p>
  <h3>${ico('radiation')} Le nucléaire</h3>
  <p>Un missile nucléaire rase tout dans un rayon d'une case (bâtiments détruits, zone irradiée 30 min) et frappe encore fort jusqu'à deux cases (moitié des dégâts, bâtiments −2 niveaux, 15 min d'irradiation). Chaque nation touchée perd la moitié de sa population, et le lanceur perd 200 d'influence. Seul le <b>bouclier antimissile</b> peut l'intercepter. Toute la planète est prévenue au lancement.</p>
  <p><b>Comment tirer :</b> 1. recherchez « Missiles de croisière » et « Dissuasion nucléaire » (branche militaire) ; 2. construisez un <b>silo à missiles</b> ; 3. cliquez sur le silo et produisez un missile nucléaire (il faut de l'uranium) ; 4. déclarez la guerre à la cible (Diplomatie) ; 5. recliquez sur le silo : dans « Missiles en stock », <b>Tirer</b>, puis cliquez sur la case visée et confirmez. Portée illimitée.</p>
  <h3>${ico('people-group')} Diplomatie et blocs</h3>
  <p>Pactes de non-agression, traités de paix, aide en ressources et espionnage. Les <b>blocs</b> fonctionnent comme de grandes alliances : vision partagée, trésor commun, canal privé, et <b>défense collective</b> — attaquer un membre, c'est attaquer tout le bloc.</p>
  <h3>${ico('keyboard')} Raccourcis</h3>
  <table class="wf-table"><tbody>
    <tr><td>Glisser (clic gauche)</td><td>Déplacer la carte</td></tr>
    <tr><td>Glisser (clic droit) ou Maj + glisser</td><td>Pivoter / incliner</td></tr>
    <tr><td>Molette</td><td>Zoom</td></tr>
    <tr><td>ZQSD / flèches, E / R</td><td>Déplacer, pivoter</td></tr>
    <tr><td>Clic droit (armée sélectionnée)</td><td>Ordre de mouvement</td></tr>
    <tr><td>Double-clic</td><td>Centrer et zoomer</td></tr>
    <tr><td>Échap</td><td>Annuler l'ordre en cours / désélectionner</td></tr>
    <tr><td>1 à 9</td><td>Ouvrir les panneaux</td></tr>
  </tbody></table>
  <h3>${ico('book')} Encyclopédie des unités</h3>
  <table class="wf-table petit"><thead><tr><th>Unité</th><th class="num">Sol</th><th class="num">Air</th><th class="num">Mer</th><th class="num">Déf.</th><th class="num">PV</th><th class="num">Vit.</th></tr></thead><tbody>
  ${u.map(x => `<tr><td>${ico(x.icone)} ${esc(x.nom)}</td><td class="num">${x.att_sol}</td><td class="num">${x.att_air}</td><td class="num">${x.att_mer}</td><td class="num">${x.defense}</td><td class="num">${x.pv}</td><td class="num">${x.vitesse}</td></tr>`).join('')}
  </tbody></table>
  <h3>${ico('mountain')} Terrains</h3>
  <table class="wf-table petit"><thead><tr><th>Terrain</th><th class="num">Déplacement</th><th class="num">Défense</th></tr></thead><tbody>
  ${S.defs.terrains.filter(t => t.terre).map(t => `<tr><td><span class="wf-carre" style="background:${t.couleur}"></span> ${esc(t.nom)}</td><td class="num">×${String(t.cout_mvt).replace('.', ',')}</td><td class="num">+${Math.round(t.defense * 100)} %</td></tr>`).join('')}
  </tbody></table>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════
// Administration (detenteur de la cle d'administration uniquement)
// ══════════════════════════════════════════════════════════════════
function panneauAdmin(S) {
  const tous = [...S.pays.values()].sort((a, b) => a.id - b.id);
  const vivants = tous.filter(p => !p.elimine);
  const bots = vivants.filter(p => p.joueur === 'Ordinateur').length;
  const guerres = Object.keys(S.relations || {}).length;
  return `<div class="wf-avert">${ico('key')} Administration déverrouillée avec votre clé.
      <a href="admin/sortir">Verrouiller</a> · <button class="wf-lien" data-act="admin_oublier">Oublier la clé sur ce navigateur</button></div>
  <div class="wf-admin-grille">
    <div class="wf-admin-stat"><b>${vivants.length}</b><small>nations</small></div>
    <div class="wf-admin-stat"><b>${vivants.length - bots}</b><small>joueurs</small></div>
    <div class="wf-admin-stat"><b>${bots}</b><small>bots</small></div>
    <div class="wf-admin-stat"><b>${S.carte.terrain.length}</b><small>cases (graine ${S.graine ?? '?'})</small></div>
  </div>
  ${titre('Monde', 'earth-europe')}
  <div class="wf-admin-actions">
    <label class="wf-ligne-form">Bots <input type="number" id="admin-bots" min="0" max="16" value="${bots}" class="wf-qte" data-garder></label>
    <button class="wf-btn petit" data-act="admin_bots">${ico('robot')} Appliquer</button>
    <button class="wf-btn petit secondaire" data-act="admin_paix">${ico('dove')} Paix mondiale</button>
    <button class="wf-btn petit danger" data-act="admin_carte">${ico('arrows-rotate')} Nouvelle carte</button>
  </div>
  ${titre('Moi', 'user-shield')}
  <div class="wf-admin-actions">
    <button class="wf-btn petit secondaire" data-act="admin_moi" ${S.moi ? '' : 'disabled'}>${ico('wand-magic-sparkles')} Tout me donner (mode dev)</button>
    <small>Toutes les technologies, des ressources, 200 de chaque élément.</small>
  </div>
  ${titre('Annonce mondiale', 'bullhorn')}
  <div class="wf-form"><textarea id="admin-annonce" data-garder maxlength="300" placeholder="Message diffusé à tous les joueurs"></textarea>
  <button class="wf-btn" data-act="admin_annonce">${ico('bullhorn')} Publier</button></div>
  ${titre('Nations', 'flag', `<small>${tous.length}</small>`)}
  <table class="wf-table"><thead><tr><th>Nation</th><th>Joueur</th><th class="num">Prov.</th><th></th></tr></thead><tbody>
  ${tous.map(p => `<tr><td>${drapeau(p, 20)} ${esc(p.nom)} ${p.elimine ? '<small>(anéantie)</small>' : ''}</td><td>${joueurDe(p)}</td><td class="num">${p.cases}</td>
    <td class="num">
      <button class="wf-btn-ic" data-act="voir" data-case="${p.capitale}" title="Voir sur la carte">${ico('location-crosshairs')}</button>
      <button class="wf-btn-ic" data-act="admin_donner_form" data-pays="${p.id}" title="Donner des ressources">${ico('gift')}</button>
      <button class="wf-btn-ic" data-act="admin_protection_form" data-pays="${p.id}" title="Protection">${ico('shield-halved')}</button>
      <button class="wf-btn-ic danger" data-act="admin_supprimer" data-pays="${p.id}" title="Supprimer définitivement">${ico('trash')}</button></td></tr>`).join('')}
  </tbody></table>`;
}

// ══════════════════════════════════════════════════════════════════
// Fabrication : raffinerie (tableau periodique), fabrique, produits
// ══════════════════════════════════════════════════════════════════
const FAMILLES = { 1: ['Commun', '#94a3b8'], 2: ['Rare', '#a855f7'], 3: ['Radioactif', '#22c55e'], 4: ['Légendaire', '#f43f5e'] };

export function nomObjet(S, id) {
  return S.defs.elements.find(e => e.id === id)?.nom || S.defs.minerais.find(x => x.id === id)?.nom
    || S.defs.produits.find(x => x.id === id)?.nom || id;
}

/** Quantite possedee : les minerais sont des ressources de base, le reste est dans le stock. */
function possede(S, id) {
  const i = S.defs.index_minerais?.[id];
  return i != null ? (S.moi?.res?.[i] || 0) : (S.moi?.stock?.[id] || 0);
}

/** Case du tableau periodique (ligne, colonne) d'un numero atomique. */
function posTableau(z) {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  if (z <= 4) return [2, z - 2];
  if (z <= 10) return [2, z + 8];
  if (z <= 12) return [3, z - 10];
  if (z <= 18) return [3, z];
  if (z <= 36) return [4, z - 18];
  if (z <= 54) return [5, z - 36];
  if (z <= 56) return [6, z - 54];
  if (z <= 71) return [9, z - 54];
  if (z <= 86) return [6, z - 68];
  if (z <= 88) return [7, z - 86];
  if (z <= 103) return [10, z - 86];
  return [7, z - 100];
}

/** Pastille d'une matiere demandee : verte si on l'a, rouge sinon. */
function puceMatiere(S, id, q) {
  const ok = possede(S, id) + 1e-6 >= q;
  const el = S.defs.elements.find(e => e.id === id);
  const mi = S.defs.minerais.find(x => x.id === id);
  const pr = !el && !mi ? S.defs.produits.find(x => x.id === id) : null;
  const label = el ? `<b class="wf-symbole" style="--c:${FAMILLES[el.categorie][1]}">${esc(el.id)}</b>`
    : mi ? `${ico(mi.icone, '', `color:${mi.couleur}`)}${esc(mi.nom.replace('Minerai ', 'minerai '))}`
      : `${ico(pr?.icone || 'box', '', `color:${COULEURS_NIVEAU[pr?.niveau || 1]}`)}${esc(pr?.nom || id)}`;
  const ou = el ? `à raffiner (${fmt(el.qte)} ${el.minerai.replace('minerai_', 'minerai ')} chacun)`
    : mi ? 'extrait par vos mines et carrières' : pr ? `à fabriquer (niveau ${pr.niveau})` : '';
  return `<span class="wf-fab-puce ${ok ? 'ok' : 'manque'}" title="${esc(nomObjet(S, id))} : ${fmt(possede(S, id), 1)} / ${fmt(q, 1)}${ok ? '' : ' · ' + ou}">${fmt(q, 1)} ${label}</span>`;
}

/** Prix au marche d'un element ou d'un produit, au cours du jour. */
export function prixCours(S, id) {
  const base = S.defs.elements.find(e => e.id === id)?.prix ?? S.defs.produits.find(p => p.id === id)?.prix ?? 0;
  return base * (S.cours?.[id] ?? 1);
}

/** Bonus que donnent les produits en stock (meme calcul que fabrication.rs). */
function bonusActifs(S) {
  const tot = {};
  for (const p of S.defs.produits) {
    if (!p.effet) continue;
    const v = Math.min(p.effet.max, possede(S, p.id) * p.effet.par_unite);
    if (v > 0) tot[p.effet.type] = (tot[p.effet.type] || 0) + v;
  }
  return tot;
}
const NOMS_EFFETS = {
  attaque: ['Pertes en attaque', 'person-military-pointing', v => `−${Math.round(v * 100)} %`],
  defense: ['Pertes de qui vous envahit', 'shield-halved', v => `+${Math.round(v * 100)} %`],
  troupes: ['Troupes maximum', 'person-military-rifle', v => `+${Math.round(v * 100)} %`],
  construction: ['Vitesse de construction', 'helmet-safety', v => `+${Math.round(v * 100)} %`],
  electricite: ['Électricité', 'bolt', v => `+${Math.round(v)}`],
  croissance: ['Croissance de la population', 'people-group', v => `+${Math.round(v * 100)} %`],
  invention: ['Inventions des laboratoires', 'flask', v => `+${Math.round(v * 100)} %`],
  interception: ['Missiles abattus', 'crosshairs', v => `+${Math.round(v * 100)} %`],
  credits: ['Crédits', 'coins', v => `+${Math.round(v * 100)} %`],
};

/** Duree d'un lot (jeu.rs duree_lot) : les grandes series vont plus vite a l'unite. */
const dureeLot = (unite, q) => unite * Math.pow(Math.max(1, q), 0.75);

function vitesseAtelier(S, atelier) {
  const m = S.moi;
  const niv = atelier === 'raffinerie' ? (m.bilan.niv.raffinerie || 0) : (m.bilan.niv.usine || 0) + (m.bilan.niv.fabrique || 0);
  return niv * m.bilan.elec_ratio * (1 + 0.07 * (m.mods.robotique || 0));
}

/** Lignes des deux ateliers : elles tournent en parallele (une par niveau
 *  d'atelier), les automatiques recommencent seules et se reglent ici. */
function fileFabrication(S) {
  const m = S.moi;
  const liste = m.fabrications || [];
  if (!liste.length) return '';
  const niv = a => a === 'raffinerie' ? (m.bilan.niv.raffinerie || 0) : (m.bilan.niv.usine || 0) + (m.bilan.niv.fabrique || 0);
  const places = { raffinerie: Math.min(S.defs.lignes_max, Math.floor(niv('raffinerie'))), fabrique: Math.min(S.defs.lignes_max, Math.floor(niv('fabrique'))) };
  const occupees = { raffinerie: 0, fabrique: 0 };
  const actives = { raffinerie: 0, fabrique: 0 };
  for (const f of liste) if (f.paye && actives[f.atelier] < places[f.atelier]) actives[f.atelier]++;
  const lignes = liste.map(f => {
    let etat;
    if (!f.paye) etat = f.cible > 0 && possede(S, f.objet) >= f.cible ? `stock atteint (${fmt(f.cible)})` : 'attend ses matières';
    else if (occupees[f.atelier] < places[f.atelier]) { occupees[f.atelier]++; etat = null; }
    else etat = 'en attente d\'une ligne libre';
    // Toute la puissance de l'atelier est partagee entre les lignes actives.
    const v = vitesseAtelier(S, f.atelier) / Math.max(1, actives[f.atelier]);
    const temps = etat ? etat : (v > 0 ? duree(f.reste / v / S.vitesse) : 'à l\'arrêt (électricité)');
    return `<div class="wf-fab-cmd ${f.auto ? 'auto' : ''} ${etat ? 'attente' : ''}">
      ${ico(f.atelier === 'raffinerie' ? 'flask-vial' : 'industry')}
      <span class="wf-fab-cmd-nom">${f.auto ? ico('arrows-rotate') + ' ' : ''}${f.qte} × ${esc(nomObjet(S, f.objet))}</span>
      <span class="wf-fab-cmd-temps">${temps}</span>
      <button class="wf-btn-ic" data-act="annuler_fab" data-id="${f.id}" title="Arrêter la ligne (matières rendues)">${ico('xmark')}</button>
      ${!etat ? barre(1 - f.reste / f.total) : ''}
      <div class="wf-fab-reglages">
        <label><input type="checkbox" data-act="regler_fab" data-id="${f.id}" data-champ="auto" ${f.auto ? 'checked' : ''}> en continu</label>
        · lot <input type="number" min="1" max="1000" value="${f.qte}" id="lot-${f.id}" class="wf-qte" data-garder>
        · s'arrêter à <input type="number" min="0" value="${f.cible || ''}" placeholder="∞" id="cible-${f.id}" class="wf-qte" data-garder> en stock
        <button class="wf-lien" data-act="regler_fab" data-id="${f.id}" data-champ="valeurs">Appliquer</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="wf-fab-lignes-tete"><span>${ico('flask-vial')} Raffinerie : ${occupees.raffinerie} / ${places.raffinerie} lignes · ${ico('industry')} Complexe : ${occupees.fabrique} / ${places.fabrique} lignes</span><small>une ligne par niveau d'atelier</small></div>
    <div class="wf-fab-file">${lignes}</div>`;
}

/** Case « en continu » + stock vise, sous les boutons Raffiner / Fabriquer. */
function controleAuto(prefixe, S) {
  return `<div class="wf-fab-auto">
    <label><input type="checkbox" id="${prefixe}-auto" data-garder ${S[prefixe + 'Auto'] ? 'checked' : ''} data-act="fab_auto" data-cle="${prefixe}Auto"> ${ico('arrows-rotate')} Automatiser (recommence tout seul)</label>
    <label>jusqu'à <input type="number" id="${prefixe}-cible" min="0" placeholder="∞" class="wf-qte" data-garder value="${S[prefixe + 'Cible'] || ''}"> en stock</label>
  </div>`;
}

function controleQte(id, valeur, presets) {
  return `<div class="wf-fab-qte">
    <span>Quantité</span>
    <input type="number" id="${id}" min="1" max="1000" value="${valeur}" class="wf-qte" data-garder>
    ${presets.map(v => `<button class="wf-chip" data-act="fab_qte" data-champ="${id}" data-v="${v}">${v}</button>`).join('')}
  </div>`;
}

function ongletRaffinerie(S) {
  const m = S.moi;
  const niv = m.bilan.niv.raffinerie || 0;
  const q = Math.max(1, Math.min(1000, +S.qteRaf || 10));
  const choisi = S.defs.elements.find(e => e.id === (S.fabElement || 'Fe'));
  let html = `<div class="wf-fab-minerais">${S.defs.minerais.map(mi => `<div class="wf-fab-minerai" style="--c:${mi.couleur}" title="${esc(mi.desc)}">
      ${ico(mi.icone)}<div><b>${fmt(possede(S, mi.id))}</b><small>${esc(mi.nom)}</small></div></div>`).join('')}</div>`;
  if (!niv) html += `<div class="wf-avert">${ico('triangle-exclamation')} Construisez une <b>raffinerie</b> (Construction › Industrie) pour transformer vos minerais en éléments.</div>`;

  // Tableau periodique
  html += `<div class="wf-periodique">${S.defs.elements.map(e => {
    const [l, c] = posTableau(e.z);
    const n = possede(S, e.id);
    return `<button class="wf-elem ${n > 0 ? 'possede' : ''} ${e.id === choisi.id ? 'choisi' : ''}" style="--c:${FAMILLES[e.categorie][1]};grid-row:${l};grid-column:${c}"
      data-act="fab_element" data-objet="${e.id}" title="${esc(e.nom)} · ${FAMILLES[e.categorie][0].toLowerCase()}${n > 0 ? ` · ${fmt(n, 1)} en stock` : ''}">
      <small>${e.z}</small><b>${esc(e.id)}</b>${n > 0 ? `<i>${fmt(n, n < 10 ? 1 : 0)}</i>` : ''}</button>`;
  }).join('')}
    <div class="wf-periodique-renvoi" style="grid-row:6;grid-column:3">57-71</div>
    <div class="wf-periodique-renvoi" style="grid-row:7;grid-column:3">89-103</div>
  </div>
  <div class="wf-legende">${Object.values(FAMILLES).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>`;

  // Fiche de l'element choisi
  const parUnite = choisi.qte;
  const peut = Math.floor(possede(S, choisi.minerai) / parUnite);
  const ok = niv > 0 && peut >= q;
  const temps = dureeLot(choisi.temps, q) / Math.max(0.01, vitesseAtelier(S, 'raffinerie') || niv || 1) / S.vitesse;
  html += `<div class="wf-fab-fiche" style="--c:${FAMILLES[choisi.categorie][1]}">
    <div class="wf-fab-fiche-symbole"><small>${choisi.z}</small><b>${esc(choisi.id)}</b></div>
    <div class="wf-fab-fiche-corps">
      <h4>${esc(choisi.nom)} <span class="wf-puce">${FAMILLES[choisi.categorie][0]}</span></h4>
      <p>${fmt(possede(S, choisi.id), 1)} en stock · rachat ${fmt(choisi.prix)} ${ico('coins')}${choisi.demi_vie ? ` · ${ico('hourglass-half')} se désintègre (demi-vie ${duree(choisi.demi_vie / S.vitesse)})` : ''}</p>
      <div class="wf-fab-recette">${puceMatiere(S, choisi.minerai, parUnite * q)} ${ico('arrow-right')} <b>${q} ${esc(choisi.id)}</b> · ${ico('clock')} ${duree(temps)}</div>
      ${controleQte('qte-raf', q, [1, 10, 50, 100])}
      ${controleAuto('raf', S)}
      <div class="wf-boutons">
        <button class="wf-btn" data-act="raffiner" data-objet="${choisi.id}" ${ok || (niv > 0 && S.rafAuto) ? '' : 'disabled'}>${ico(S.rafAuto ? 'arrows-rotate' : 'flask-vial')} ${S.rafAuto ? 'Lancer la ligne' : 'Raffiner'} ${q} ${esc(choisi.id)}</button>
        <small>${niv ? `Vous pouvez en raffiner ${fmt(peut)} avec votre minerai.` : ''}</small>
      </div>
    </div>
  </div>`;
  return html;
}

/** Table de fabrication (facon Minecraft, mais sans forme imposee) : on pose
 *  des quantites de materiaux sur 9 cases ; si la combinaison correspond a
 *  une recette (ou a un multiple exact), le resultat apparait. */
export function recetteDeTable(S) {
  const t = S.table || [];
  if (!t.length) return null;
  for (const p of S.defs.produits) {
    if (p.entrees.length !== t.length) continue;
    let k = null;
    const ok = p.entrees.every(([id, n]) => {
      const c = t.find(x => x.id === id);
      if (!c) return false;
      const r = c.q / n;
      if (!Number.isInteger(r) || r < 1 || (k !== null && r !== k)) return false;
      k = r;
      return true;
    });
    if (ok) return { p, k };
  }
  return null;
}

/** Couleur des produits selon leur niveau (1 gris … 8 or) : on les
 *  distingue d'un coup d'oeil. */
export const COULEURS_NIVEAU = ['#64748b', '#64748b', '#16a34a', '#0d9488', '#2563eb', '#4f46e5', '#9333ea', '#db2777', '#d97706'];

function iconeObjet(S, id, grand = false) {
  const el = S.defs.elements.find(e => e.id === id);
  if (el) return `<b class="wf-symbole ${grand ? 'grand' : ''}" style="--c:${FAMILLES[el.categorie][1]}">${esc(el.id)}</b>`;
  const pr = S.defs.produits.find(x => x.id === id);
  return `<span class="wf-table-ic" style="--nc:${COULEURS_NIVEAU[pr?.niveau || 1]}">${ico(pr?.icone || 'box')}</span>`;
}

function ongletFabrique(S) {
  const m = S.moi;
  const nivMax = m.bilan.fab_max || 0;
  const table = S.table || [];
  const trouve = recetteDeTable(S);
  const pose = id => table.find(x => x.id === id)?.q || 0;
  let html = nivMax ? `<p class="wf-note">${ico('industry')} Complexe industriel niveau <b>${nivMax}</b> : recettes jusqu'au niveau ${nivMax}. Les niveaux 6 à 8 (jusqu'au trou noir) demandent la technologie « Grands travaux ».</p>`
    : `<div class="wf-avert">${ico('triangle-exclamation')} Construisez un <b>complexe industriel</b> (clic gauche sur une de vos cases › Industrie) : c'est lui qui fabrique tout, avec les éléments de la raffinerie.</div>`;

  // ── La table ──
  const cases = Array.from({ length: 9 }, (_, k) => table[k]);
  let resultat = `<div class="wf-table-case resultat vide">?</div>`;
  let bouton = '';
  if (trouve) {
    const { p, k } = trouve;
    const ok = p.niveau <= nivMax && p.entrees.every(([id, n]) => possede(S, id) + 1e-6 >= n * k);
    resultat = `<div class="wf-table-case resultat trouve" title="${esc(p.desc)}${p.effet ? ' · ' + esc(p.effet.texte) : ''}">${iconeObjet(S, p.id, true)}<i>${fmt(p.sortie * k)}</i></div>`;
    bouton = `<b>${esc(p.nom)}</b>
      <small>${p.niveau > nivMax ? `${ico('lock')} Complexe industriel niveau ${p.niveau} requis` : `${ico('clock')} ${duree(dureeLot(p.temps, k) / Math.max(0.01, vitesseAtelier(S, 'fabrique') || 1) / S.vitesse)}`}</small>
      ${controleAuto('fab', S)}
      <button class="wf-btn" data-act="table_fabriquer" ${p.niveau <= nivMax ? '' : 'disabled'}>${ico(S.fabAuto ? 'arrows-rotate' : 'hammer')} ${S.fabAuto ? 'Lancer la ligne' : 'Fabriquer'}</button>`;
  } else if (table.length) {
    bouton = `<small>${ico('circle-question')} Aucune recette avec ces matériaux.</small>`;
  }
  html += `<div class="wf-etabli">
    <div class="wf-table-grille">${cases.map((c, k) => c
      ? `<button class="wf-table-case ${possede(S, c.id) + 1e-6 >= c.q ? '' : 'manque'}" data-act="table_retirer" data-k="${k}" title="${esc(nomObjet(S, c.id))} : clic pour en retirer">${iconeObjet(S, c.id)}<i>${fmt(c.q)}</i></button>`
      : `<div class="wf-table-case vide"></div>`).join('')}</div>
    <div class="wf-table-fleche">${ico('arrow-right')}</div>
    <div class="wf-table-sortie">${resultat}<div class="wf-table-info">${bouton}</div></div>
  </div>
  <div class="wf-table-outils">
    <span>Poser par</span>${[1, 5, 10].map(v => `<button class="wf-chip ${(S.tablePas || 1) === v ? 'actif' : ''}" data-act="table_pas" data-v="${v}">${v}</button>`).join('')}
    <span class="wf-espace"></span>
    ${table.length ? `<button class="wf-btn petit secondaire" data-act="table_vider">${ico('broom')} Vider la table</button>` : ''}
  </div>`;

  // ── Inventaire ──
  const inventaire = [...S.defs.elements.map(e => e.id), ...S.defs.produits.map(p => p.id)].filter(id => possede(S, id) - pose(id) > 1e-6);
  html += titre('Vos matériaux', 'boxes-stacked', '<small>cliquez pour poser sur la table</small>');
  html += inventaire.length ? `<div class="wf-inventaire">${inventaire.map(id => `<button class="wf-table-case" data-act="table_poser" data-objet="${id}" title="${esc(nomObjet(S, id))}">
      ${iconeObjet(S, id)}<i>${fmt(possede(S, id) - pose(id), possede(S, id) < 10 ? 1 : 0)}</i></button>`).join('')}</div>`
    : vide('Aucun matériau : raffinez vos minerais dans l\'onglet Raffinerie.', 'flask-vial');

  // ── Livre de recettes ──
  const niv = Math.max(1, Math.min(8, +S.fabNiveau || Math.max(1, nivMax)));
  const q = Math.max(1, Math.min(1000, +S.qteFab || 1));
  const filtre = (S.fabFiltre || '').trim().toLowerCase();
  html += titre('Livre de recettes', 'book', `<small>${S.defs.produits.length} recettes</small>`);
  html += `<div class="wf-livre-outils">
    <input type="search" id="fab-filtre" data-filtre="fabFiltre" data-cible=".wf-livre-ligne" placeholder="Chercher une recette (acier, trou noir, électricité…)" value="${esc(S.fabFiltre || '')}" data-garder>
    ${controleQte('qte-fab', q, [1, 5, 10, 25])}
  </div>`;
  html += `<div class="wf-fab-niveaux">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button class="wf-chip ${n === niv && !filtre ? 'actif' : ''} ${n > nivMax ? 'verrou' : ''}" data-act="fab_niveau" data-niveau="${n}">${n > nivMax ? ico('lock') : ''}Niv. ${n}</button>`).join('')}</div>`;
  const recettes = S.defs.produits.filter(p => filtre ? true : p.niveau === niv);
  html += `<div class="wf-livre">${recettes.map(p => {
    const ok = p.niveau <= nivMax && p.entrees.every(([id, n]) => possede(S, id) + 1e-6 >= n * q);
    const cherche = (p.nom + ' ' + p.desc + ' ' + (p.effet?.texte || '')).toLowerCase();
    return `<div class="wf-livre-ligne ${ok ? 'faisable' : ''} ${p.niveau > nivMax ? 'verrou' : ''}" data-nom="${esc(cherche)}" ${filtre && !cherche.includes(filtre) ? 'hidden' : ''}>
      <div class="wf-livre-sortie">${iconeObjet(S, p.id)}<div><b>${esc(p.nom)}</b> <small>niv. ${p.niveau} · → ${fmt(p.sortie * q)}${possede(S, p.id) > 0 ? ` · ${fmt(possede(S, p.id), 1)} en stock` : ''}</small>
        ${p.effet ? `<div class="wf-effet">${ico('star')} ${esc(p.effet.texte)}</div>` : ''}</div></div>
      <span class="wf-fab-recette">${p.entrees.map(([id, n]) => puceMatiere(S, id, n * q)).join('')}</span>
      <span class="wf-livre-boutons">
        <button class="wf-btn petit" data-act="fab_direct" data-objet="${p.id}" ${p.niveau <= nivMax ? '' : 'disabled'} title="${ok ? `Fabriquer ${q} fois avec ce que vous avez` : 'Il manque des matières : elles seront raffinées et fabriquées automatiquement avec votre minerai'}">${ico(ok ? 'hammer' : 'sitemap')} Fabriquer</button>
        <button class="wf-btn-ic" data-act="table_remplir" data-objet="${p.id}" title="Poser sur la table">${ico('table-cells')}</button>
      </span>
    </div>`;
  }).join('')}</div>
  <p class="wf-note">${ico('circle-info')} <b>Fabriquer</b> utilise ce que vous avez. S'il manque des éléments ou des produits intermédiaires, ils sont raffinés et fabriqués automatiquement avec votre minerai, étape par étape.</p>`;
  return html;
}

function ongletProduits(S) {
  const m = S.moi;
  const produits = S.defs.produits.filter(p => possede(S, p.id) > 0);
  const elements = S.defs.elements.filter(e => possede(S, e.id) > 0);
  const bonus = bonusActifs(S);
  let html = titre('Bonus de vos produits', 'star', '<small>tant que vous les gardez</small>');
  html += Object.keys(bonus).length ? `<div class="wf-admin-grille">${Object.entries(bonus).map(([k, v]) => {
    const [nom, ic, f] = NOMS_EFFETS[k] || [k, 'star', x => x];
    return `<div class="wf-admin-stat">${ico(ic)} <b>${f(v)}</b><small>${nom}</small></div>`;
  }).join('')}</div>` : vide('Aucun bonus : beaucoup de produits donnent des bonus permanents (armes, robots, centrales, médicaments…). Voir le livre de recettes.', 'star');
  html += titre('Produits', 'boxes-stacked', `<small>${produits.length}</small>`);
  html += produits.length ? `<div class="wf-fab-cartes">${produits.map(p => {
    const n = possede(S, p.id);
    const arme = ['bombe_trou_noir', 'bombe_antimatiere'].includes(p.id);
    return `<div class="wf-fab-carte">
      <div class="wf-fab-carte-tete"><span class="wf-bat-ic" style="color:${COULEURS_NIVEAU[p.niveau]}">${ico(p.icone)}</span><div><b>${esc(p.nom)}</b><small>× ${fmt(n, 1)} · se vend ${fmt(prixCours(S, p.id))} ${ico('coins')} pièce</small></div></div>
      ${p.effet ? `<div class="wf-effet">${ico('star')} ${esc(p.effet.texte)}</div>` : ''}
      <div class="wf-fab-carte-pied">
        ${arme ? `<button class="wf-btn petit danger" data-act="ordre_special" data-objet="${p.id}">${ico('crosshairs')} Lancer</button>` : '<span></span>'}
        <span class="wf-boutons"><button class="wf-btn petit secondaire" data-act="vendre_objet" data-objet="${p.id}" data-qte="1">Vendre 1</button>
        ${n >= 2 ? `<button class="wf-btn petit secondaire" data-act="vendre_objet" data-objet="${p.id}" data-qte="${Math.floor(n)}">Tout</button>` : ''}</span>
      </div></div>`;
  }).join('')}</div>` : vide('Rien pour l\'instant : passez commande dans l\'onglet Fabrique.', 'gears');
  html += titre('Éléments', 'atom', `<small>${elements.length} / 118</small>`);
  html += elements.length ? `<div class="wf-fab-elements">${elements.map(e => `<span class="wf-fab-puce ok" title="${esc(e.nom)}">
      <b class="wf-symbole" style="--c:${FAMILLES[e.categorie][1]}">${esc(e.id)}</b> ${fmt(possede(S, e.id), 1)}${e.demi_vie ? ' ' + ico('hourglass-half') : ''}</span>`).join('')}</div>`
    : vide('Aucun élément : raffinez vos minerais dans l\'onglet Raffinerie.', 'flask-vial');
  return html;
}

function panneauFabrication(S) {
  const m = S.moi;
  if (!m) return vide('Fondez votre nation pour fabriquer.', 'flag');
  const onglet = S.fabOnglet || 'raffinerie';
  const onglets = [['raffinerie', 'Raffinerie', 'flask-vial'], ['fabrique', 'Complexe industriel', 'industry'], ['produits', 'Mes produits', 'boxes-stacked']];
  const html = `<div class="wf-segment wf-fab-onglets">${onglets.map(([id, nom, ic]) => `<button class="${id === onglet ? 'actif' : ''}" data-act="fab_onglet" data-onglet="${id}">${ico(ic)}<span>${nom}</span></button>`).join('')}</div>`
    + fileFabrication(S)
    + (onglet === 'raffinerie' ? ongletRaffinerie(S) : onglet === 'fabrique' ? ongletFabrique(S) : ongletProduits(S));
  return html;
}

export const PANNEAUX = {
  pays: { titre: 'Mon pays', icone: 'flag', rendre: panneauPays },
  construction: { titre: 'Construction', icone: 'helmet-safety', rendre: panneauConstruction },
  fabrication: { titre: 'Fabrication', icone: 'gears', rendre: panneauFabrication },
  armee: { titre: 'Armées', icone: 'person-military-rifle', rendre: panneauArmee },
  recherche: { titre: 'Recherche', icone: 'flask', rendre: panneauRecherche },
  diplomatie: { titre: 'Diplomatie', icone: 'handshake', rendre: panneauDiplomatie },
  blocs: { titre: 'Blocs & alliances', icone: 'people-group', rendre: panneauBlocs },
  marche: { titre: 'Marché mondial', icone: 'scale-balanced', rendre: panneauMarche },
  classement: { titre: 'Classements', icone: 'ranking-star', rendre: panneauClassement },
  journal: { titre: 'Journal', icone: 'newspaper', rendre: panneauJournal },
  chat: { titre: 'Messagerie', icone: 'comments', rendre: panneauChat, partiel: true },
  aide: { titre: 'Guide du dirigeant', icone: 'circle-question', rendre: panneauAide, statique: true },
  admin: { titre: 'Administration', icone: 'shield-halved', rendre: panneauAdmin },
};
