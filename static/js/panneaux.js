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
  return esc(p.joueur);
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
  // La nourriture n'existe plus (case gardee pour les numeros).
  const lignesRes = S.defs.ressources.map((r, i) => {
    if (r.id === 'nourriture') return '';
    const net = b.prod[i] - b.conso[i];
    return `<tr>
      <td>${ico(r.icone, '', `color:${r.couleur}`)} ${esc(r.nom)}</td>
      <td class="num">${fmt(m.res[i])}${i === 0 ? '' : `<small> / ${fmt(b.stock)}</small>`}</td>
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

  ${blocTva(S)}

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
/** Produit fabrique exige (batiment ou unite debloques par une recette)
 *  et absent du stock : texte a afficher, sinon ''. */
function manqueProduit(S, d, qte = 1) {
  if (!d.produit || possede(S, d.produit) + 1e-9 >= qte) return '';
  return 'Exige : ' + nomObjet(S, d.produit).toLowerCase() + ' (Fabrication)';
}

/** Ce que debloque un produit (batiments et unites qui l'exigent). */
function debloque(S, id) {
  return [...S.defs.batiments.filter(d => d.produit === id), ...S.defs.unites.filter(u => u.produit === id)].map(d => d.nom);
}

function raisonBatiment(S, d, i) {
  // Montagne (terrain 5) : pente trop forte pour bâtir.
  if (S.carte.terrain[i] === 5) return 'Impossible en montagne (pente trop forte)';
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
  mine: [2, 'minerais'], carriere: [2, 'minerais'], puits_petrole: [2, 'minerais'],
  foreuse: [3, 'fragments de météorite'], mine_uranium: [4, 'uranium'], extracteur_tr: [5, 'minéraux rares'],
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
      <div class="wf-insp-ligne">${ico('res-uranium')} Uranium : <b>${fmt(m.res[4], 1)}</b> · uranium enrichi : <b>${fmt(m.ur_enrichi, 1)}</b></div>
      <div class="wf-insp-ligne petit">${esc(d.desc)}</div>
      ${m.res[4] < 1 && b === 'enrichissement' ? `<div class="wf-insp-ligne petit">${ico('scale-balanced')} Pas d'uranium : achetez-en au marché ou construisez une mine d'uranium.</div>` : ''}
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
  if (S.carte.terrain[i] === 5) {
    return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('mountain')} Montagne</div>
      <p class="wf-note">La pente est trop forte pour construire ici. Les collines et les plateaux, eux, sont constructibles.</p></div>`;
  }
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
      const exige = manqueProduit(S, d);
      const ok = peutPayer(S, c) && !exige;
      return `<div class="wf-menu-item ${ok ? '' : 'cher'}" title="${esc(d.desc)}">
        <span class="wf-bat-ic">${ico(d.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(d.nom)}</b><small>${cout(S, c)} · ${ico('clock')} ${duree(d.temps / m.bilan.vitesse / S.vitesse)}${d.produit ? ` · ${ico('box')} ${esc(nomObjet(S, d.produit))}` : ''}</small>${exige ? `<small class="neg">${esc(exige)}</small>` : ''}</div>
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
      const exige = manqueProduit(S, u);
      return `<div class="wf-menu-item ${exige ? 'cher' : ''}" title="${esc(u.desc)}">
        <span class="wf-bat-ic">${ico(u.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(u.nom)}</b><small>${cout(S, c)}${u.produit ? ` + 1 ${esc(nomObjet(S, u.produit).toLowerCase())} (${fmt(Math.floor(possede(S, u.produit)))} en stock)` : ''} / unité</small>${exige ? `<small class="neg">${esc(exige)}</small>` : ''}</div>
        <input type="number" min="1" max="50" value="1" id="qc-${u.id}" data-garder class="wf-qte">
        <button class="wf-btn petit" data-act="produire" data-case="${i}" data-unite="${u.id}" data-champ="qc-${u.id}" ${exige ? 'disabled' : ''}>${ico('plus')}</button>
      </div>`;
    }).join('') || '<div class="wf-insp-ligne petit">Aucune unité disponible : faites de la recherche.</div>'}</div>
    ${b === 'silo' ? blocArsenal(S, i) : ''}`;
}

// Missiles prets dans ce silo, tirables directement d'ici (avant, il
// fallait trouver et selectionner l'arsenal sur la carte).
function blocArsenal(S, i) {
  const m = S.moi;
  const lignes = [];
  for (const [id, n] of Object.entries(m.materiel || {})) {
    const u = uniDef(S, id);
    if (!u || !n || u.domaine !== 'missile') continue;
    lignes.push(`<div class="wf-menu-item" title="${esc(u.desc)}">
        <span class="wf-bat-ic">${ico(u.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(u.nom)}</b><small>${n} en stock · portée ${u.portee > 900 ? 'illimitée' : u.portee + ' cases'}</small></div>
      </div>`);
  }
  // Armes non conventionnelles (antimatière, trou noir, générateur de point zéro) : en stock, tirées depuis ce silo.
  for (const o of ['bombe_antimatiere', 'bombe_trou_noir', 'generateur_point_zero']) {
    const n = possede(S, o);
    if (n < 1) continue;
    const ic = o === 'bombe_trou_noir' ? 'circle' : o === 'generateur_point_zero' ? 'mountain' : 'explosion';
    lignes.push(`<div class="wf-menu-item" title="Arme non conventionnelle · portée illimitée">
      <span class="wf-bat-ic">${ico(ic)}</span>
      <div class="wf-ligne-corps"><b>${esc(nomObjet(S, o))}</b><small>${fmt(n)} en stock · portée illimitée</small></div>
      <button class="wf-btn petit danger" data-act="ordre_special" data-objet="${o}">${ico('crosshairs')} Lancer</button>
    </div>`);
  }
  const verrous = S.defs.unites.filter(u => u.batiment === 'silo' && u.tech && !aTech(S, u.tech))
    .map(u => `${esc(u.nom)} : recherchez « ${esc(nomTech(S, u.tech))} »`);
  return `<div class="wf-menu-titre">${ico('rocket')} Missiles en stock</div>
    <div class="wf-menu-liste">${lignes.join('') || '<div class="wf-insp-ligne petit">Aucun missile prêt : produisez-en ci-dessus, ils apparaîtront ici une fois terminés.</div>'}</div>
    <div class="wf-insp-ligne petit">${ico('circle-info')} Pour tirer : cliquez sur une case d'un pays <b>en guerre</b> avec vous, puis « Frappes ».</div>
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

// Soldats d'equipage par unite de materiel (memes valeurs que armee.rs).
const EQUIPAGE = { infanterie: 10, forces_speciales: 5, exosoldat: 2, blinde_leger: 4, char: 4, dca_mobile: 4, bombardier: 4, artillerie: 6,
  chasseur: 1, chasseur_furtif: 1, helicoptere: 2, fregate: 40, sous_marin: 40, destroyer: 80, porte_avions: 300 };

function panneauArmee(S) {
  const m = S.moi;
  if (!m) return vide('Fondez d\'abord votre nation.', 'flag');
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

  // Une seule armee : les soldats et leur materiel (armee.rs).
  const b = m.bilan;
  const materiel = Object.entries(m.materiel || {}).filter(([, n]) => n > 0).map(([id, n]) => ({ u: uniDef(S, id), n })).filter(x => x.u);
  const avions = materiel.filter(x => x.u.domaine === 'air').reduce((a, x) => a + x.n, 0);
  const navires = materiel.filter(x => x.u.domaine === 'mer').reduce((a, x) => a + x.n, 0);
  const missiles = materiel.filter(x => x.u.domaine === 'missile');
  const ligneMat = x => `<div class="wf-ligne"><span class="wf-ligne-ic">${ico(x.u.icone)}</span><div class="wf-ligne-corps">
      <div class="wf-ligne-titre">${esc(x.u.nom)} <b>× ${fmt(x.n)}</b></div>
      <div class="wf-ligne-sous">${x.u.domaine === 'missile' ? `portée ${x.u.portee > 900 ? 'illimitée' : x.u.portee + ' cases'}` : `attaque ${x.u.att_sol} · défense ${x.u.defense}`}${EQUIPAGE[x.u.id] ? ` · ${EQUIPAGE[x.u.id]} soldats d'équipage` : ''}</div></div></div>`;
  return `
  ${titre('Votre armée', 'shield-halved', `<small>Entretien : ${fmt(entretien[0] + 6 * entretien[2], 1)} ${ico('coins')} /min</small>`)}
  <p class="wf-note">${ico('circle-info')} Une seule armée : vos <b>soldats</b> (des habitants formés à la caserne) et leur <b>matériel</b>. Le matériel (chars, artillerie, avions, navires) multiplie la force de vos soldats en attaque et en défense, à condition d'avoir assez de soldats pour l'équiper.</p>
  <div class="wf-stats">
    <div class="wf-stat">${ico('person-military-rifle')}<b>${fmt(m.troupes)} / ${fmt(b.troupes_max)}</b><span>Soldats prêts${b.recrues >= 1 ? ` · ${fmt(b.recrues)} en formation` : ''}</span>${barre(m.troupes / Math.max(1, b.troupes_max))}</div>
    <div class="wf-stat">${ico('crosshairs')}<b>× ${(b.mult_attaque || 1).toFixed(2).replace('.', ',')}</b><span>Force en attaque</span></div>
    <div class="wf-stat">${ico('shield-halved')}<b>× ${(b.mult_defense || 1).toFixed(2).replace('.', ',')}</b><span>Force en défense</span></div>
    <div class="wf-stat ${(b.equipe ?? 1) < 1 ? 'alerte' : ''}">${ico('users')}<b>${Math.round((b.equipe ?? 1) * 100)} %</b><span>Matériel équipé · ${fmt(b.equipage || 0)} soldats requis</span>${barre(b.equipe ?? 1, (b.equipe ?? 1) < 1 ? 'rouge' : '')}</div>
  </div>
  ${(b.equipe ?? 1) < 1 ? `<div class="wf-avert">${ico('triangle-exclamation')} Pas assez de soldats pour tout votre matériel : recrutez (Population) ou il reste au hangar.</div>` : ''}

  ${titre('Matériel', 'truck-monster', `<small>${fmt(materiel.reduce((a, x) => a + x.n, 0))}</small>`)}
  <div class="wf-liste">${materiel.filter(x => x.u.domaine !== 'missile').map(ligneMat).join('') || vide('Aucun matériel. Produisez-en dans vos bâtiments militaires (ci-dessous) ou achetez-en au marché.', 'truck-monster')}</div>
  <p class="wf-note">${ico('jet-fighter')} <b>${avions} avion${avions > 1 ? 's' : ''}</b> : raids aériens depuis une base aérienne (clic sur une case d'un pays en guerre avec vous, « Frappes »). ${ico('ship')} <b>${navires} navire${navires > 1 ? 's' : ''}</b> : +${Math.min(30, navires * 2)} cases de portée pour les débarquements.</p>

  ${titre('Missiles et bombes', 'rocket', `<small>${fmt(missiles.reduce((a, x) => a + x.n, 0))}</small>`)}
  <div class="wf-liste">${missiles.map(ligneMat).join('') || vide('Aucun missile. Produisez-en au silo ou achetez-en au marché.', 'rocket')}</div>
  <p class="wf-note">${ico('circle-info')} Un missile part d'un <b>silo</b> à portée, ou d'un <b>bombardier</b> qui l'emporte depuis une base aérienne (rayon du bombardier + portée du missile). Pour tirer : cliquez sur une case d'un pays en guerre avec vous, puis « Frappes ».</p>

  ${titre('Offensives', 'flag', `<small>${(S.attaques || []).filter(a => a.de === m.id).length}</small>`)}
  <p class="wf-note">${ico('circle-info')} <b>Clic droit sur une case</b> : vous y envoyez ${Math.round(S.ratio * 100)} % de vos soldats (terre neutre : votre pays s'agrandit ; ennemi en guerre : vous l'envahissez ; côte lointaine : débarquement).</p>
  <div class="wf-liste">${(S.attaques || []).filter(a => a.de === m.id || a.cible === m.id).map(a => {
    const mienne = a.de === m.id;
    const autre = mienne ? (a.cible != null ? S.pays.get(a.cible) : null) : S.pays.get(a.de);
    const quoi = mienne ? (a.cible == null ? 'Expansion en terres neutres' : `Offensive contre ${esc(autre?.nom || '?')}`) : `${esc(autre?.nom || '?')} vous envahit`;
    return `<div class="wf-ligne cliquable" data-act="voir" data-case="${a.bateau ? a.bateau.case : a.vise}">
      <span class="wf-ligne-ic">${ico(a.bateau ? 'ship' : mienne ? 'person-military-pointing' : 'triangle-exclamation')}</span>
      <div class="wf-ligne-corps"><div class="wf-ligne-titre">${quoi}</div>
      <div class="wf-ligne-sous">${fmt(a.troupes)} soldats · ${a.prises} cases prises${a.bateau ? ` · en mer, débarquement dans ${duree(a.bateau.reste / S.vitesse)}` : ''}</div></div>
      ${mienne && !a.bateau ? `<button class="wf-btn petit secondaire" data-act="rappeler" data-id="${a.id}">Rappeler</button>` : ''}
    </div>`;
  }).join('') || vide('Aucune offensive. Faites un clic droit sur une case neutre qui touche votre pays pour vous agrandir.', 'map-location-dot')}</div>

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
  const connue = id => m.techs.includes(id) || actuelle === id || enFile(id);
  const verrouillee = t => !m.techs.includes(t.id) && t.prereq.some(q => !connue(q));
  const cartesTech = techs.map(t => {
    const acquise = m.techs.includes(t.id);
    const st = acquise ? 'acquise' : verrouillee(t) ? 'verrou' : etat(t.id);
    return `<div class="wf-tech ${st}" ${st === 'dispo' ? `data-act="rechercher" data-tech="${t.id}"` : ''} title="${esc(t.desc)}">
      <div class="wf-tech-tete">${ico(acquise ? 'circle-check' : st === 'verrou' ? 'lock' : t.icone)}<b>${esc(t.nom)}</b></div>
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
  ${compact ? `<div class="wf-tech-grille" style="--bc:${couleurBranche}">${cartesTech || vide('Aucune technologie dans cette branche.', 'flask')}</div>`
    : arbreTechs(S, techs, couleurBranche, { etat, verrouillee, actuelle })}
  <h3 class="wf-rech-titre">${ico('arrow-trend-up')} Améliorations</h3>
  <div class="wf-liste" style="--bc:${couleurBranche}">${lignesAmelio}</div>
  ${compact ? '' : `<p class="wf-note">${ico('circle-info')} Cliquez sur une technologie disponible pour la rechercher : si une recherche est déjà en cours, elle part en file d'attente. Une technologie verrouillée demande d'abord celles qui y mènent (elles peuvent être dans la file).</p>`}`;
}

/** Arbre d'une branche : une colonne par niveau, liens courbes vers les
 *  technologies qui en dependent, etats bien visibles. */
function arbreTechs(S, techs, couleur, { etat, verrouillee, actuelle }) {
  const m = S.moi;
  if (!techs.length) return vide('Aucune technologie dans cette branche.', 'flask');
  const W0 = 160, H0 = 72, GX = 44, GY = 16, PAD = 16, ENTETE = 26;
  const rangs = [...new Set(techs.map(t => t.rang))].sort((a, b) => a - b);
  const ici = new Map(techs.map(t => [t.id, t]));
  const pos = new Map();
  // Colonne par colonne, chaque technologie se place pres de ses prerequis
  // (moyenne de leurs lignes) pour limiter les croisements.
  rangs.forEach((r, col) => {
    const colonne = techs.filter(t => t.rang === r).map((t, k) => {
      const lignes = t.prereq.filter(q => pos.has(q)).map(q => pos.get(q).ligne);
      return { t, cle: lignes.length ? lignes.reduce((a, b) => a + b, 0) / lignes.length : k };
    }).sort((a, b) => a.cle - b.cle);
    const prises = new Set();
    colonne.forEach(({ t, cle }) => {
      let l = Math.max(0, Math.round(cle));
      while (prises.has(l)) l++;
      prises.add(l);
      pos.set(t.id, { col, ligne: l });
    });
  });
  const lignesMax = Math.max(...[...pos.values()].map(p => p.ligne)) + 1;
  const X = p => PAD + p.col * (W0 + GX), Y = p => PAD + ENTETE + p.ligne * (H0 + GY);
  const W = PAD * 2 + rangs.length * W0 + (rangs.length - 1) * GX, H = PAD * 2 + ENTETE + lignesMax * H0 + (lignesMax - 1) * GY;
  const liens = [];
  for (const t of techs) {
    const b = pos.get(t.id);
    for (const q of t.prereq) {
      const a = pos.get(q);
      if (!a) continue;
      const x1 = X(a) + W0, y1 = Y(a) + H0 / 2, x2 = X(b), y2 = Y(b) + H0 / 2, mx = (x1 + x2) / 2;
      const fait = m.techs.includes(q);
      const vers = actuelle === t.id;
      liens.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="${fait ? 'fait' : ''} ${vers ? 'actif' : ''}"/>`);
    }
  }
  const noeuds = techs.map(t => {
    const p = pos.get(t.id);
    const acquise = m.techs.includes(t.id);
    const st = acquise ? 'acquise' : verrouillee(t) ? 'verrou' : etat(t.id);
    const ailleurs = t.prereq.filter(q => !ici.has(q)).map(q => S.defs.techs.find(x => x.id === q)).filter(Boolean);
    const manque = t.prereq.filter(q => !m.techs.includes(q)).map(q => S.defs.techs.find(x => x.id === q)?.nom).filter(Boolean);
    const sous = acquise ? `${ico('circle-check')} Acquise` : st === 'encours' ? `${fmt(m.recherche_prog)} / ${fmt(t.cout)} pts`
      : st === 'file' ? 'En file d\'attente' : st === 'verrou' ? `${ico('lock')} ${esc(manque.join(', '))}` : `${ico('flask')} ${fmt(t.cout)} pts`;
    return `<div class="wf-noeud ${st}" style="left:${X(p)}px;top:${Y(p)}px;width:${W0}px;height:${H0}px" ${st === 'dispo' ? `data-act="rechercher" data-tech="${t.id}"` : ''}
      title="${esc(t.nom)} : ${esc(t.desc)}${manque.length ? '\nRequiert : ' + esc(manque.join(', ')) : ''}">
      <span class="wf-noeud-ic">${ico(acquise ? 'check' : t.icone)}</span>
      <div class="wf-noeud-txt"><b>${esc(t.nom)}</b><small>${sous}</small></div>
      ${ailleurs.length ? `<span class="wf-noeud-ext" title="Demande aussi : ${esc(ailleurs.map(x => x.nom).join(', '))}">${ico('link')}</span>` : ''}
      ${st === 'encours' ? `<div class="wf-noeud-prog"><i style="width:${Math.min(100, m.recherche_prog / t.cout * 100).toFixed(1)}%"></i></div>` : ''}
    </div>`;
  }).join('');
  const entetes = rangs.map((r, col) => `<div class="wf-arbre-col" style="left:${PAD + col * (W0 + GX)}px;width:${W0}px">Niveau ${r}</div>`).join('');
  const faites = techs.filter(t => m.techs.includes(t.id)).length;
  return `<div class="wf-arbre-cadre" style="--bc:${couleur}">
    <div class="wf-arbre-resume">${ico('diagram-project')} ${faites} / ${techs.length} technologies acquises</div>
    <div class="wf-arbre-defile"><div class="wf-arbre" style="width:${W}px;height:${H}px">
      <svg class="wf-arbre-liens" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${liens.join('')}</svg>
      ${entetes}${noeuds}
    </div></div>
  </div>`;
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
        ${o.el ? `<b class="wf-symbole grand" style="--c:${FAMILLES[o.el.categorie][1]}">${esc(o.id)}</b>` : blason(o.pr, 40)}
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

/** Materiel d'un type (vendable). */
function aurepos(S, type) {
  return S.moi?.materiel?.[type] || 0;
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
    <div class="wf-menu-liste">${S.defs.ressources.map((r, i) => i === 0 || r.id === 'nourriture' ? '' : `<div class="wf-menu-item">
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
  <div class="wf-guide-but">${ico('bullseye')}<div><b>Le but du jeu</b><p>Faire de votre pays la <b>première puissance mondiale</b> au classement général : économie, science, armée, territoire et diplomatie comptent. Le monde est partagé avec les autres joueurs et continue de tourner en votre absence.</p></div>
    <button class="wf-btn petit" data-act="tuto">${ico('graduation-cap')} Revoir le tutoriel</button></div>
  <h3>${ico('flag')} Premiers pas</h3>
  <p>Choisissez votre pays (sur la carte du monde, un vrai pays libre : vous recevez tout son territoire), ou fondez votre nation sur une carte aléatoire. Faites un <b>clic gauche</b> sur une de vos cases pour construire : des <b>mines</b> sur les gisements (une par type de minerai) ou des carrières, une <b>centrale</b> pour l'électricité, une <b>raffinerie</b> et un <b>complexe industriel</b> pour fabriquer, et des <b>laboratoires</b> qui inventent parfois des technologies (sinon, achetez les plans au marché). Cliquez sur un autre pays pour l'attaquer, lui proposer la paix ou une alliance. Les nouvelles nations sont protégées de toute déclaration de guerre pendant quelques heures.</p>
  <h3>${ico('map-location-dot')} Faire grandir son pays</h3>
  <p>Comme dans OpenFront, votre pays grandit avec vos <b>troupes</b>. Faites un <b>clic droit</b> sur une case : une part de votre réserve (curseur « Envoyer » en bas à gauche de la carte) part s'en emparer, case par case, en commençant par celle que vous avez visée. Sur une terre neutre, votre pays s'agrandit ; chez une nation avec qui vous êtes en guerre, vous l'envahissez (son relief, ses forts et ses troupes résistent) ; sur une côte lointaine, vos troupes débarquent depuis un chantier naval. Le <b>clic gauche</b> sert à construire.</p>
  <h4>${ico('gears')} Minerais et fabrication</h4>
  <p>Les <b>carrières</b> (partout) et les mines extraient quatre ressources : les minerais (fer, cuivre, bauxite, charbon), les minéraux rares (terres rares, lithium, cobalt, or), l'uranium et les fragments de météorite (cratères, très rares). La <b>raffinerie</b> les transforme en métal, terres rares, uranium, ou en n'importe lequel des 118 éléments du tableau périodique. La <b>fabrique</b> assemble ensuite plus de 100 produits, de l'acier jusqu'au trou noir : son niveau fixe la complexité des recettes. Les éléments légendaires se désintègrent vite, comme dans la réalité : utilisez-les sans attendre.</p>
  <h3>${ico('gem')} Ressources</h3>
  <p>Chaque région a ses gisements : filons de minerais (collines, montagnes, déserts), uranium (montagnes, toundra), minéraux rares (forêts, collines), et cratères de météorite (très rares). Une carrière extrait des minerais n'importe où. Ce qui vous manque s'achète au <b>marché mondial</b> ou se négocie avec vos alliés. L'<b>électricité</b> n'est pas stockée : si la consommation dépasse la production, tous les bâtiments consommateurs tournent au ralenti.</p>
  <h3>${ico('flask')} Recherche</h3>
  <p>Quatre branches (militaire, économie, diplomatie, industrie) débloquent bâtiments, unités et bonus. Les branches se croisent : les chars demandent la sidérurgie, les missiles l'aérospatiale, le nucléaire militaire le nucléaire civil.</p>
  <h3>${ico('person-military-rifle')} Une seule armée : soldats et matériel</h3>
  <p>Vos <b>soldats</b> sont des habitants formés à la caserne. <b>Clic droit</b> sur une case : une part de vos soldats y part (terre neutre : annexion ; pays en guerre : invasion ; côte : débarquement). Relief et <b>fortifications</b> avantagent le défenseur. Le <b>matériel</b> (chars, artillerie, avions, navires) se produit dans les bâtiments militaires ou s'achète au marché : il multiplie la force de vos soldats en attaque et en défense, s'ils sont assez nombreux pour l'équiper. Un soldat tué est un habitant en moins.</p>
  <h3>${ico('jet-fighter')} Aviation, marine et missiles</h3>
  <p>Les <b>avions</b> partent en <b>raid</b> depuis votre base aérienne la plus proche (clic sur une case ennemie, « Frappes ») ; batteries sol-air et chasseurs ennemis les abattent. Les <b>navires</b> allongent la portée des débarquements. Les <b>missiles</b> partent d'un silo à portée, ou d'un <b>bombardier</b> qui les emporte depuis une base aérienne ; les batteries sol-air peuvent les intercepter.</p>
  <h3>${ico('radiation')} Le nucléaire</h3>
  <p>Un missile nucléaire rase tout dans un rayon d'une case (bâtiments détruits, zone irradiée 30 min) et frappe encore fort jusqu'à deux cases (moitié des dégâts, bâtiments −2 niveaux, 15 min d'irradiation). Chaque nation touchée perd la moitié de sa population, et le lanceur perd 200 d'influence. Seul le <b>bouclier antimissile</b> peut l'intercepter. Toute la planète est prévenue au lancement.</p>
  <p><b>Comment tirer :</b> 1. recherchez « Missiles de croisière » et « Dissuasion nucléaire » (branche militaire) ; 2. construisez un <b>silo à missiles</b> ; 3. cliquez sur le silo et produisez un missile (le nucléaire demande de l'uranium enrichi) ; 4. déclarez la guerre à la cible (Diplomatie) ; 5. cliquez sur une case du pays visé, « Frappes », puis choisissez le missile et confirmez.</p>
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
// Mise a jour depuis GitHub : S.maj = reponse de GET admin/maj (voir jeu.js).
function blocMaj(S) {
  const m = S.maj;
  if (!m) return `<div class="wf-admin-actions"><button class="wf-btn petit secondaire" data-act="admin_maj_verifier">${ico('code-commit')} Vérifier GitHub</button><small>Compare cette version avec le dépôt officiel TheSolar1/wfront.</small></div>`;
  if (m.chargement) return `<p class="wf-note">${ico('rotate')} Vérification…</p>`;
  if (!m.autorise) return `<p class="wf-note">${ico('lock')} Il faut la permission « Mettre à jour WFront » (VEX › Admin › Rôles &amp; Plans).</p>`;
  const e = m.etat || {};
  let h = `<p class="wf-note">${ico('code-commit')} Version actuelle : <b>${esc(m.local || '?')}</b></p>`;
  if (m.en_cours) h += `<p class="wf-note">${ico('rotate')} ${esc(e.message || 'Mise à jour en cours…')}</p>`;
  else if (e.etape === 'ok' || e.etape === 'erreur') h += `<p class="wf-note">${ico(e.etape === 'ok' ? 'circle-check' : 'triangle-exclamation')} Dernière mise à jour : ${esc(e.message || '')}</p>`;
  if (!m.git) h += `<p class="wf-note">${ico('triangle-exclamation')} Le dossier du serveur n'est pas relié à GitHub.</p>`;
  else if (!m.fetch_ok) h += `<p class="wf-note">${ico('triangle-exclamation')} GitHub injoignable.</p>`;
  else if (m.modifs_locales) h += `<p class="wf-note">${ico('triangle-exclamation')} Le serveur a ${m.modifs_locales} fichier(s) modifié(s) qui ne sont pas sur GitHub : mise à jour bloquée pour ne rien perdre.</p>`;
  if (m.nouveautes && m.nouveautes.length) h += `<table class="wf-table"><thead><tr><th>Changement sur GitHub</th><th>Auteur</th><th>Date</th></tr></thead><tbody>${m.nouveautes.map(c => `<tr><td>${esc(c.titre || '')}</td><td>${esc(c.auteur || '')}</td><td>${esc((c.date || '').slice(0, 16))}</td></tr>`).join('')}</tbody></table>`;
  else if (m.git && m.fetch_ok) h += `<p class="wf-note">${ico('circle-check')} Déjà à jour avec GitHub.</p>`;
  h += `<div class="wf-admin-actions"><button class="wf-btn petit secondaire" data-act="admin_maj_verifier" ${m.en_cours ? 'disabled' : ''}>${ico('arrows-rotate')} Vérifier</button>`;
  if (m.nouveautes && m.nouveautes.length && !m.modifs_locales && !m.en_cours) h += `<button class="wf-btn petit danger" data-act="admin_maj_lancer">${ico('cloud-arrow-down')} Mettre à jour</button>`;
  return h + '</div>';
}

function panneauAdmin(S) {
  const tous = [...S.pays.values()].sort((a, b) => a.id - b.id);
  const vivants = tous.filter(p => !p.elimine);
  const guerres = Object.keys(S.relations || {}).length;
  return `<div class="wf-admin-grille">
    <div class="wf-admin-stat"><b>${vivants.length}</b><small>nations</small></div>
    <div class="wf-admin-stat"><b>${S.carte.terrain.length}</b><small>cases (graine ${S.graine ?? '?'})</small></div>
  </div>
  ${titre('Monde', 'earth-europe')}
  <div class="wf-admin-actions">
    <button class="wf-btn petit secondaire" data-act="admin_paix">${ico('dove')} Paix mondiale</button>
    <button class="wf-btn petit danger" data-act="admin_carte">${ico('arrows-rotate')} Nouvelle carte</button>
  </div>
  ${titre('Moi', 'user-shield')}
  <div class="wf-admin-actions">
    <button class="wf-btn petit secondaire" data-act="admin_moi" ${S.moi ? '' : 'disabled'}>${ico('wand-magic-sparkles')} Tout me donner (mode dev)</button>
    <small>Le maximum : toutes les technologies et améliorations, 10 millions de chaque ressource, 100 000 de chaque élément, 1 000 de chaque produit.</small>
  </div>
  ${titre('Mise à jour', 'cloud-arrow-down')}
  ${blocMaj(S)}
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
// Famille d'un element : la ressource dont on le tire.
const FAMILLES = { 1: ['Minerais', '#94a3b8'], 2: ['Minéraux rares', '#a855f7'], 3: ['Uranium', '#22c55e'], 4: ['Météorite', '#f43f5e'] };

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
      : `${blason(pr, 20)}${esc(pr?.nom || id)}`;
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

/** Blason d'un produit : forme selon le niveau (rond, carre, hexagone,
 *  octogone, etoile), degrade propre au produit (teinte tiree de son id)
 *  autour de la couleur du niveau, symbole blanc. `taille` en px. */
export function blason(pr, taille = 34) {
  if (!pr) return `<span class="wf-blason n1" style="--t:${taille}px;--c1:#94a3b8;--c2:#475569">${ico('box')}</span>`;
  let h = 0;
  for (const ch of pr.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const base = COULEURS_NIVEAU[pr.niveau] || COULEURS_NIVEAU[1];
  return `<span class="wf-blason n${pr.niveau}" style="--t:${taille}px;--c1:${melangerTeinte(base, h, 0.35, 1.25)};--c2:${melangerTeinte(base, h, 0.2, 0.6)}" title="${esc(pr.nom)} · niveau ${pr.niveau}">${ico(pr.icone || 'box')}</span>`;
}

/** Couleur `hex` tiree vers la teinte `h` (part `k`), eclaircie ou assombrie (`l`). */
function melangerTeinte(hex, h, k, l) {
  const n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const a = h / 60, x = 1 - Math.abs((a % 2) - 1);
  const [tr, tg, tb] = a < 1 ? [1, x, 0] : a < 2 ? [x, 1, 0] : a < 3 ? [0, 1, x] : a < 4 ? [0, x, 1] : a < 5 ? [x, 0, 1] : [1, 0, x];
  r = (r * (1 - k) + tr * 255 * k) * l; g = (g * (1 - k) + tg * 255 * k) * l; b = (b * (1 - k) + tb * 255 * k) * l;
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function iconeObjet(S, id, grand = false) {
  const el = S.defs.elements.find(e => e.id === id);
  if (el) return `<b class="wf-symbole ${grand ? 'grand' : ''}" style="--c:${FAMILLES[el.categorie][1]}">${esc(el.id)}</b>`;
  const pr = S.defs.produits.find(x => x.id === id);
  return blason(pr, grand ? 44 : 34);
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
        ${p.effet ? `<div class="wf-effet">${ico('star')} ${esc(p.effet.texte)}</div>` : ''}
        ${debloque(S, p.id).length ? `<div class="wf-effet">${ico('unlock')} Débloque : ${esc(debloque(S, p.id).join(', '))}</div>` : ''}</div></div>
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
    const arme = ['bombe_trou_noir', 'bombe_antimatiere', 'generateur_point_zero'].includes(p.id);
    return `<div class="wf-fab-carte">
      <div class="wf-fab-carte-tete">${blason(p, 42)}<div><b>${esc(p.nom)}</b><small>× ${fmt(n, 1)} · se vend ${fmt(prixCours(S, p.id))} ${ico('coins')} pièce</small></div></div>
      ${p.effet ? `<div class="wf-effet">${ico('star')} ${esc(p.effet.texte)}</div>` : ''}
      ${debloque(S, p.id).length ? `<div class="wf-effet">${ico('unlock')} Débloque : ${esc(debloque(S, p.id).join(', '))}</div>` : ''}
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


// ══════════════════════════════════════════════════════════════════
// TVA : la principale source de credits. Les employes (commerces,
// services, industrie) creent de l'activite ; l'Etat en preleve la TVA.
// Au-dela de 20 %, des actifs ne veulent plus travailler : chomage.
// ══════════════════════════════════════════════════════════════════
function participationTva(t) { return Math.min(1, Math.max(0.15, 1 - 2.2 * Math.max(0, t - 0.2))); }

/** Estimation (memes formules que le serveur) pour un taux de TVA donne. */
function estimerTva(S, t) {
  const b = S.moi.bilan;
  const civils = Math.max(0, b.actifs - b.soldats - b.recrues);
  const dispo = civils * participationTva(t);
  const trav = Math.min(dispo, b.emplois);
  const prive = (dispo - trav) * 0.92;
  const cc = b.niv?.centre_commercial || 0;
  const activite = prive / 1000 * (1 + Math.min(1, 0.05 * cc)) + trav / 1000 * 2 + 12 * cc * (b.emplois > 0 ? Math.min(1, dispo / b.emplois) : 1);
  return { recettes: activite * t, chomage: civils > 0 ? (civils - trav - prive) / civils : 0, travail: b.emplois > 0 ? Math.min(1, dispo / b.emplois) : 1 };
}

/** Apercu en direct pendant qu'on deplace le curseur de TVA. */
export function apercuTva(S, pct) {
  if (!S.moi) return '';
  const e = estimerTva(S, pct / 100);
  return `Recettes : <b>${fmt(e.recettes * S.vitesse, 1)}</b> crédits/min · chômage : <b class="${e.chomage > 0.15 ? 'neg' : ''}">${Math.round(e.chomage * 100)} %</b>${e.travail < 1 ? ` · <b class="neg">bâtiments à ${Math.round(e.travail * 100)} %</b>` : ''}`;
}

function blocTva(S) {
  const m = S.moi, b = m.bilan;
  const pct = Math.round((m.tva ?? 0.2) * 100);
  // Curseur deplace mais pas encore applique : l'apercu suit le curseur.
  const champ = typeof document !== 'undefined' && document.getElementById('tva-taux');
  const vu = champ ? +champ.value : pct;
  const h = (S.histo || []).filter(x => x.length > 10);
  const maint = Date.now() / 1000;
  const point = [maint, 0, 0, 0, 0, 0, b.chomage * 100, b.tva * 100, b.recettes_tva, m.res[0], b.prod[0] - b.conso[0]];
  const serie = k => h.concat([point]).map(x => [x[0], x[k]]);
  const faillite = m.res[0] <= 1 && b.prod[0] < b.conso[0];
  return `${titre('Impôts : TVA', 'percent', `<small>${pct} %</small>`)}
  <p class="wf-aide">Vos habitants qui travaillent (commerces, services, usines) créent de l'activité ; l'État en prélève la TVA. Plus la TVA est haute, plus vous gagnez… jusqu'à un point : <b>au-delà de 20 %</b>, des gens ne veulent plus travailler pour un salaire trop maigre, le <b>chômage monte</b> et vos bâtiments manquent d'ouvriers. Trop haut, vos recettes s'effondrent : <b>faillite</b>.</p>
  ${faillite ? `<div class="wf-avert">${ico('triangle-exclamation')} Faillite : les caisses sont vides et vous dépensez plus que vous ne gagnez. Baissez vos dépenses ou ajustez la TVA.</div>` : ''}
  <div class="wf-stats petit">
    <div class="wf-stat">${ico('coins', '', 'color:#f59e0b')}<b>${signe(b.recettes_tva * S.vitesse)}</b><span>Recettes de TVA par minute</span></div>
    <div class="wf-stat">${ico('chart-line')}<b>${fmt(b.activite * S.vitesse, 1)}</b><span>Activité taxable par minute</span></div>
    <div class="wf-stat ${b.chomage > 0.15 ? 'alerte' : ''}">${ico('user-slash')}<b>${Math.round(b.chomage * 100)} %</b><span>Chômage · ${nb(b.chomeurs)} sans emploi</span>${barre(b.chomage, b.chomage > 0.15 ? 'rouge' : '')}</div>
    <div class="wf-stat">${ico('briefcase')}<b>${Math.round(b.participation * 100)} %</b><span>Actifs prêts à travailler</span></div>
  </div>
  <div class="wf-form">
    <label>Taux de TVA : <b id="tva-val">${vu} %</b><input type="range" id="tva-taux" data-garder min="0" max="60" step="1" value="${pct}"></label>
    <p class="wf-aide" id="tva-apercu">${apercuTva(S, vu)}</p>
    <button class="wf-btn" data-act="tva">${ico('check')} Appliquer</button>
  </div>
  <h4 class="wf-graph-titre">Chômage et TVA (%)</h4>
  ${courbes([{ nom: 'Chômage', couleur: '#dc2626', valeurs: serie(6) }, { nom: 'TVA', couleur: '#f59e0b', valeurs: serie(7) }], ' %')}
  <h4 class="wf-graph-titre">Recettes de TVA et solde (crédits/min)</h4>
  ${courbes([{ nom: 'Recettes de TVA', couleur: '#f59e0b', valeurs: serie(8) }, { nom: 'Solde', couleur: '#4fa553', valeurs: serie(10) }])}
  <h4 class="wf-graph-titre">Crédits en caisse</h4>
  ${courbes([{ nom: 'Crédits', couleur: '#d99a1e', valeurs: serie(9) }])}
  ${h.length < 1 ? `<p class="wf-aide">${ico('circle-info')} Les courbes se remplissent avec le temps (un point toutes les 2 heures).</p>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// Population : main-d'oeuvre, armee de citoyens, natalite, ages,
// religions et revoltes (demographie.rs). 1 jour reel = 2 ans de jeu.
// ══════════════════════════════════════════════════════════════════
const COUL_POP = { travail: '#4fa553', chomage: '#a3c9a5', soldats: '#c0392b', recrues: '#e67e22', enfants: '#3b82f6', retraites: '#9ca3af' };

function nb(n) { return fmt(Math.round(n || 0)); }

/** Bonus de fecondite d'une prime (meme formule que le serveur). */
function bonusPrime(v) { return 0.8 * (1 - Math.exp(-Math.max(0, v) / 15)); }

/** Apercu d'une prime de natalite : naissances et cout par jour. */
export function apercuPrime(S, v) {
  const m = S.moi;
  if (!m) return '';
  const actuel = m.prime_natalite || 0;
  const active = actuel > 0 && (m.cout_natalite || 0) > 0;
  const base = active ? m.naissances / (1 + bonusPrime(actuel)) : m.naissances;
  const n = base * (1 + bonusPrime(v));
  return v > 0
    ? `Environ <b>${nb(n)}</b> naissances par jour (+${Math.round(bonusPrime(v) * 100)} %), pour <b>${nb(n * v)}</b> crédits par jour.`
    : `Environ <b>${nb(base)}</b> naissances par jour, sans dépense.`;
}

/** Courbes (SVG) : series = [{ nom, couleur, valeurs: [[t, v]...] }]. */
function courbes(series, unite = '') {
  const pts = series.flatMap(x => x.valeurs);
  if (pts.length < 2) return '';
  const W = 400, H = 150, g = 46, d = 8, h = 10, b = 22;
  const t0 = Math.min(...pts.map(p => p[0])), t1 = Math.max(...pts.map(p => p[0]));
  let v0 = Math.min(...pts.map(p => p[1])), v1 = Math.max(...pts.map(p => p[1]));
  if (v1 - v0 < Math.max(1, v1 * 0.02)) { const c = (v0 + v1) / 2, e = Math.max(1, Math.abs(c) * 0.02); v0 = c - e; v1 = c + e; }
  const X = t => g + (t - t0) / Math.max(1, t1 - t0) * (W - g - d);
  const Y = v => H - b - (v - v0) / (v1 - v0) * (H - b - h);
  const graduations = [v0, (v0 + v1) / 2, v1].map(v => `<line x1="${g}" x2="${W - d}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="wf-graph-grille"/>
    <text x="${g - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}${unite}</text>`).join('');
  const date = t => new Date(t * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lignes = series.map(x => x.valeurs.length < 2 ? '' : `<polyline points="${x.valeurs.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${x.couleur}" stroke-width="2" stroke-linejoin="round"/>`).join('');
  return `<svg class="wf-graph" viewBox="0 0 ${W} ${H}" role="img">${graduations}${lignes}
    <text x="${g}" y="${H - 6}">${date(t0)}</text><text x="${W - d}" y="${H - 6}" text-anchor="end">${date(t1)}</text></svg>
    ${series.length > 1 ? `<div class="wf-graph-legende">${series.map(x => `<span><i style="background:${x.couleur}"></i>${esc(x.nom)}</span>`).join('')}</div>` : ''}`;
}

/** Pyramide des ages par tranches de 5 ans (hommes a gauche, femmes a droite). */
function pyramideAges(ages) {
  if (!ages || !ages.length) return '';
  const tr = [];
  for (let a = 0; a < 100; a += 5) tr.push(ages.slice(a, a + 5).reduce((x, y) => x + y, 0));
  // Les femmes vivent un peu plus longtemps : leur part monte apres 50 ans.
  const part = a => Math.min(0.75, 0.49 + 0.004 * Math.max(0, a - 50));
  const max = Math.max(...tr.map((v, k) => Math.max(v * (1 - part(k * 5)), v * part(k * 5)))) || 1;
  const W = 400, H = 230, m = W / 2, lh = (H - 24) / 20, demi = m - 40;
  const barres = tr.map((v, k) => {
    const y = H - 24 - (k + 1) * lh, f = v * part(k * 5), hm = v - f;
    const wh = hm / max * demi, wf = f / max * demi;
    return `<rect x="${(m - 20 - wh).toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${wh.toFixed(1)}" height="${(lh - 2).toFixed(1)}" fill="#3b82f6" rx="1.5"/>
      <rect x="${m + 20}" y="${(y + 1).toFixed(1)}" width="${wf.toFixed(1)}" height="${(lh - 2).toFixed(1)}" fill="#ec4899" rx="1.5"/>
      ${k % 2 === 0 ? `<text x="${m}" y="${(y + lh - 3).toFixed(1)}" text-anchor="middle">${k * 5}</text>` : ''}`;
  }).join('');
  return `<svg class="wf-graph" viewBox="0 0 ${W} ${H}" role="img">${barres}
    <text x="${m - 20}" y="${H - 6}" text-anchor="end">Hommes</text><text x="${m + 20}" y="${H - 6}">Femmes</text></svg>`;
}

/** Barre empilee : parts = [[nom, valeur, couleur]...]. */
function empilee(parts) {
  const total = parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
  return `<div class="wf-empile">${parts.filter(p => p[1] > 0).map(([n, v, c]) => `<i style="flex:${v};background:${c}" title="${esc(n)} : ${nb(v)}"></i>`).join('')}</div>
    <div class="wf-graph-legende">${parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${esc(n)} <b>${nb(v)}</b> <small>${Math.round(v / total * 100)} %</small></span>`).join('')}</div>`;
}

function etapeFormation(k) {
  return k < 0.15 ? 'Incorporation : visite médicale et paquetage' : k < 0.55 ? 'Classes : formation de base' : k < 0.9 ? 'Exercices sur le terrain' : 'Affectation dans les unités';
}

function panneauPopulation(S) {
  const m = S.moi;
  if (!m) return vide('Vous ne dirigez encore aucune nation.<br><button class="wf-btn" data-act="fonder">Fonder ma nation</button>', 'people-group');
  const b = m.bilan;
  const D = S.defs.demographie || { emplois_par_niveau: 800, prime_max: 50 };
  const total = m.sync || m.pop * 1000;
  const religions = new Map((S.defs.religions || []).map(r => [r.id, r]));
  const etat = religions.get(m.religion);
  const histo = (S.histo || []).slice();
  const maint = Date.now() / 1000;
  histo.push([maint, total, b.actifs, b.soldats + b.recrues, m.naissances, m.deces]);
  const serie = (k, f = x => x) => histo.map(x => [x[0], f(x[k])]);
  const peu = (S.histo || []).length < 2;

  // ── Recrues en formation ──
  const vit = S.vitesse || 1;
  const formation = (m.formation || []).map(l => {
    const reste = Math.max(0, (l.fin - (S.temps || 0)) / vit);
    const k = Math.min(1, Math.max(0, 1 - reste * vit / Math.max(1, b.duree_formation)));
    return `<div class="wf-ligne"><span class="wf-ligne-ic">${ico('person-rifle')}</span><div class="wf-ligne-corps"><b>${nb(l.n)} recrues</b>
      <small>${etapeFormation(k)} · prêtes dans ${duree(reste)}</small>${barre(k)}</div></div>`;
  }).join('');

  // ── Revoltes ──
  const revoltes = (S.revoltes || []).filter(r => r.pays === m.id).map(r => {
    const rel = religions.get(r.religion);
    const reste = r.limite - maint;
    const besoin = Math.ceil((r.rebelles || 0) * 1.15) - (r.forces || 0);
    const defaut = Math.min(Math.floor(m.troupes), Math.max(10, Math.ceil((r.rebelles || 0) * 1.4)));
    return `<div class="wf-revolte">
      <div class="wf-revolte-tete">${ico('fire')}<b>Révolte ${rel ? '(' + esc(rel.nom.toLowerCase()) + ')' : ''}</b><span>${r.cases.length} provinces</span>
        <button class="wf-btn-ic" data-act="voir" data-case="${r.cases[0]}" title="Voir sur la carte">${ico('location-crosshairs')}</button></div>
      <div class="wf-stats petit">
        <div class="wf-stat"><b>${nb(r.rebelles)}</b><span>Rebelles</span></div>
        <div class="wf-stat"><b>${nb(r.forces)}</b><span>Vos soldats sur place</span></div>
        <div class="wf-stat ${reste < 86400 ? 'alerte' : ''}"><b>${duree(reste)}</b><span>Avant que la région ne devienne neutre</span></div>
      </div>
      <p class="wf-aide">Les rebelles se battent chez eux : il faut plus de <b>${nb(Math.ceil(r.rebelles * 1.15))}</b> soldats pour l'emporter. ${besoin > 0 ? `Il en manque environ <b>${nb(besoin)}</b>.` : 'Vos forces suffisent : le combat est en cours.'}</p>
      <div class="wf-form ligne"><input type="number" id="rev-${r.id}" data-garder min="10" step="10" value="${defaut}">
        <button class="wf-btn" data-act="reprimer" data-id="${r.id}">${ico('shield-halved')} Rétablir l'ordre</button></div>
    </div>`;
  }).join('');

  const religionsPays = (b.religions || []).map(([id, h]) => {
    const r = religions.get(id);
    const tot = (b.religions || []).reduce((a, x) => a + x[1], 0) || 1;
    return r ? `<div class="wf-rel-ligne"><span class="wf-rel-pastille" style="--rc:${r.couleur}"></span><span>${esc(r.nom)}${id === m.religion ? ' <small>(religion d\'État)</small>' : ''}</span>
      <div class="wf-barre"><div style="width:${(h / tot * 100).toFixed(1)}%;background:${r.couleur}"></div></div><b>${Math.round(h / tot * 100)} %</b></div>` : '';
  }).join('');

  const prime = m.prime_natalite || 0;
  const champPrime = typeof document !== 'undefined' && document.getElementById('pop-prime');
  const primeVue = champPrime ? +champPrime.value : prime;
  const pourvus = b.emplois ? Math.round(b.travail * 100) : 100;
  return `
  <div class="wf-stats">
    <div class="wf-stat">${ico('people-group')}<b>${nb(total)}</b><span>Habitants · capacité d'accueil ${nb(b.pop_cap * 1000)}</span>${barre(total / Math.max(1, b.pop_cap * 1000))}</div>
    <div class="wf-stat">${ico('baby')}<b>${nb(m.naissances)}</b><span>Naissances par jour</span></div>
    <div class="wf-stat">${ico('cross')}<b>${nb(m.deces)}</b><span>Décès par jour</span></div>
    <div class="wf-stat ${pourvus < 100 ? 'alerte' : ''}">${ico('helmet-safety')}<b>${pourvus} %</b><span>Emplois pourvus · ${nb(b.emplois)} postes</span>${barre(pourvus / 100, pourvus < 100 ? 'rouge' : '')}</div>
  </div>
  <p class="wf-aide">${ico('clock')} 1 jour réel = 2 ans dans le jeu : les enfants nés aujourd'hui travailleront dans 9 jours.</p>

  ${titre('Qui fait quoi', 'users')}
  ${empilee([['Ouvriers des bâtiments', b.travailleurs, COUL_POP.travail], ['Commerces et services', b.prive || 0, '#0ea5e9'], ['Sans emploi', b.chomeurs, COUL_POP.chomage], ['Soldats', b.soldats, COUL_POP.soldats],
    ['En formation', b.recrues, COUL_POP.recrues], ['Enfants (0-17 ans)', b.enfants, COUL_POP.enfants], ['Retraités (65 ans et +)', b.retraites, COUL_POP.retraites]])}
  <p class="wf-aide">Chaque niveau de bâtiment (sauf les villes) emploie <b>${nb(D.emplois_par_niveau)}</b> ouvriers, pris parmi les actifs (18-64 ans) qui ne sont pas soldats.
    ${pourvus < 100 ? `<b class="neg">Il manque des ouvriers : vos bâtiments ne tournent qu'à ${pourvus} %.</b> Démobilisez des soldats ou augmentez la natalité.` : ''}</p>

  ${titre('Armée de citoyens', 'person-military-rifle', `<small>${nb(m.troupes)} soldats prêts</small>`)}
  <p class="wf-aide">Un soldat est un habitant. Les recrues passent par la caserne (formation de ${duree(b.duree_formation / vit)}, plus courte avec des casernes) avant de rejoindre votre réserve. Un soldat tué au combat est un habitant en moins.</p>
  <label class="wf-case-a-cocher"><input type="checkbox" data-act="recrut_auto" ${m.recrut_auto !== false ? 'checked' : ''}> Recrutement automatique parmi les sans-emploi (n'enlève personne aux usines)</label>
  <div class="wf-form grille2">
    <label>Recruter (civils disponibles : ${nb(Math.max(0, b.actifs - b.soldats - b.recrues))})
      <span class="wf-form ligne"><input type="number" id="pop-recruter" data-garder min="1" step="100" value="500"><button class="wf-btn" data-act="recruter">${ico('user-plus')} Recruter</button></span></label>
    <label>Démobiliser (rendre à la vie civile)
      <span class="wf-form ligne"><input type="number" id="pop-demob" data-garder min="1" step="100" value="500"><button class="wf-btn secondaire" data-act="demobiliser">${ico('user-minus')} Démobiliser</button></span></label>
  </div>
  ${formation ? `<div class="wf-liste">${formation}</div>` : ''}

  ${titre('Campagne de natalité', 'baby-carriage')}
  <p class="wf-aide">Versez une prime aux familles pour chaque naissance : plus elle est élevée, plus les familles font d'enfants. Elle est payée à chaque nouveau-né, en crédits.</p>
  <div class="wf-form">
    <label>Prime par naissance : <b id="pop-prime-val">${primeVue ? primeVue + ' crédits par naissance' : 'Aucune prime'}</b>
      <input type="range" id="pop-prime" data-garder min="0" max="${D.prime_max}" step="1" value="${prime}"></label>
    <p class="wf-aide" id="pop-prime-apercu">${apercuPrime(S, primeVue)}</p>
    <button class="wf-btn" data-act="natalite">${ico('check')} Appliquer</button>
    ${prime > 0 ? `<p class="wf-aide">Coût actuel : <b>${nb(m.cout_natalite)}</b> crédits par jour.${(m.cout_natalite || 0) <= 0 ? ' <b class="neg">Caisses insuffisantes : la prime n\'est pas versée.</b>' : ''}</p>` : ''}
  </div>

  ${titre('Pyramide des âges', 'chart-simple')}
  ${pyramideAges(m.ages)}

  ${titre('Évolution', 'chart-line')}
  ${peu ? `<p class="wf-aide">${ico('circle-info')} Les courbes se remplissent avec le temps (un point toutes les 2 heures).</p>` : ''}
  <h4 class="wf-graph-titre">Habitants et actifs</h4>
  ${courbes([{ nom: 'Habitants', couleur: '#4fa553', valeurs: serie(1) }, { nom: 'Actifs (18-64 ans)', couleur: '#3b82f6', valeurs: serie(2) }])}
  <h4 class="wf-graph-titre">Naissances et décès par jour</h4>
  ${courbes([{ nom: 'Naissances', couleur: '#ec4899', valeurs: serie(4) }, { nom: 'Décès', couleur: '#6b7280', valeurs: serie(5) }])}
  <h4 class="wf-graph-titre">Soldats et recrues</h4>
  ${courbes([{ nom: 'Soldats', couleur: COUL_POP.soldats, valeurs: serie(3) }])}

  ${titre('Religions', 'place-of-worship', etat ? `<small>Religion d'État : ${esc(etat.nom)}</small>` : '')}
  ${religionsPays || vide('Aucune donnée.', 'place-of-worship')}
  <p class="wf-aide">Les provinces prises hors de votre pays d'origine gardent leur religion. Si elle diffère de la vôtre, elles ont une très faible chance de se révolter (encore plus faible pour les terres neutres annexées). Au bout de 50 à 80 jours, elles adoptent votre religion.</p>

  ${titre('Révoltes', 'fire', revoltes ? '' : '<small>aucune</small>')}
  ${revoltes || `<p class="wf-aide">${ico('circle-check')} Le calme règne. En cas de révolte, vous aurez 3 jours pour envoyer des troupes rétablir l'ordre ; sinon la région devient neutre et annexable par tous.</p>`}`;
}

export const PANNEAUX = {
  pays: { titre: 'Mon pays', icone: 'flag', rendre: panneauPays },
  population: { titre: 'Population', icone: 'people-group', rendre: panneauPopulation },
  construction: { titre: 'Construction', icone: 'helmet-safety', rendre: panneauConstruction },
  fabrication: { titre: 'Fabrication', icone: 'gears', rendre: panneauFabrication },
  armee: { titre: 'Armée', icone: 'person-military-rifle', rendre: panneauArmee },
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

// ══════════════════════════════════════════════════════════════════
// Menu radial (facon OpenFront) : les actions possibles sur une case,
// en cercle autour du curseur. Chaque entree : { ico, label, info,
// act + data (meme ACTIONS que les boutons), ou sous: [entrees] }.
// ══════════════════════════════════════════════════════════════════
function coutTexte(S, c) {
  return c.map((v, k) => v ? `${fmt(v)} ${S.defs.ressources[k].nom.toLowerCase()}` : '').filter(Boolean).join(' · ');
}

export function actionsRadiales(S, i) {
  const m = S.moi;
  const items = [];
  const t = S.defs.terrains[S.carte.terrain[i]];
  const pid = S.carte.proprio[i];
  const p = pid >= 0 ? S.pays.get(pid) : null;
  const vivant = m && !m.elimine;
  const rel = p && m && p.id !== m.id ? (S.relations[p.id]?.etat || 'paix') : null;

  if (vivant && pid === m.id && t.terre) {
    const b = S.carte.bat[i];
    const chantier = m.chantiers.find(c => c.case === i);
    if (chantier) {
      items.push({ ico: 'xmark', label: 'Annuler le chantier', info: '50 % remboursés', act: 'annuler_chantier', data: { id: chantier.id }, danger: true });
    } else if (S.carte.irr[i]) {
      // Rien a construire en zone irradiee.
    } else if (!b) {
      const possibles = S.defs.batiments.filter(d => d.constructible && !raisonBatiment(S, d, i));
      possibles.sort((x, y) => (y.depot ? 1 : 0) - (x.depot ? 1 : 0));
      const cats = [...new Set(possibles.map(d => d.categorie))];
      const ICONES_CAT = { Production: 'wheat-awn', Industrie: 'industry', Énergie: 'bolt', Économie: 'coins', Militaire: 'person-military-rifle', Défense: 'shield-halved', Administration: 'landmark' };
      const sous = cats.map(cat => ({
        ico: ICONES_CAT[cat] || 'helmet-safety', label: cat,
        sous: possibles.filter(d => d.categorie === cat).map(d => {
          const c = coutBatiment(d, 1, m.mods, m.spe);
          const exige = manqueProduit(S, d);
          return { ico: d.icone, label: d.nom, info: exige || coutTexte(S, c) + (d.produit ? ' · ' + nomObjet(S, d.produit).toLowerCase() : ''), act: 'construire', data: { case: i, bat: d.id }, off: !peutPayer(S, c) || !!exige };
        }),
      }));
      if (sous.length) items.push({ ico: 'helmet-safety', label: 'Construire', sous: sous.length === 1 ? sous[0].sous : sous });
    } else {
      const d = batDef(S, b);
      const niv = S.carte.niv[i];
      if (niv < m.mods.niv_max) {
        const c = coutBatiment(d, niv + 1, m.mods, m.spe);
        const exige = manqueProduit(S, d);
        items.push({ ico: 'arrow-up', label: `Améliorer (niveau ${niv + 1})`, info: exige || coutTexte(S, c), act: 'ameliorer', data: { case: i }, off: !peutPayer(S, c) || !!exige });
      }
      // Produire des unités depuis le menu rond (caserne, aéroport, usine, port, silo).
      const produisibles = S.defs.unites.filter(u => u.batiment === b);
      if (produisibles.length) {
        const sousP = produisibles.map(u => {
          if (u.tech && !aTech(S, u.tech)) return { ico: 'lock', label: u.nom, info: 'Technologie : ' + nomTech(S, u.tech), off: true };
          return { ico: u.icone, label: u.nom, info: coutTexte(S, coutUnite(u, 1, m.mods, m.spe)), sous: [1, 5, 10].map(q => {
            const c = coutUnite(u, q, m.mods, m.spe);
            return { ico: u.icone, label: `×${q}`, info: coutTexte(S, c), act: 'produire', data: { case: i, unite: u.id, qte: q }, off: !peutPayer(S, c) };
          }) };
        });
        items.push({ ico: 'hammer', label: 'Produire', sous: sousP });
      }
      // Silo : tirer missiles ET armes non conventionnelles directement depuis le menu rond.
      if (b === 'silo') {
        const tirs = [];
        for (const o of ['bombe_antimatiere', 'bombe_trou_noir', 'generateur_point_zero']) {
          const nn = possede(S, o);
          if (nn >= 1) tirs.push({ ico: o === 'bombe_trou_noir' ? 'circle' : o === 'generateur_point_zero' ? 'mountain' : 'explosion', label: `Lancer : ${nomObjet(S, o)}`, info: `${fmt(nn)} en stock`, act: 'ordre_special', data: { objet: o }, danger: true });
        }
        if (tirs.length) items.push({ ico: 'crosshairs', label: 'Tirer / Lancer', sous: tirs, danger: true });
      }
      items.push({ ico: 'sliders', label: `Gérer : ${d?.nom || b}`, info: 'Production, recherche, détails', act: 'infos_case', data: { case: i } });
      if (b !== 'capitale') items.push({ ico: 'trash', label: 'Démolir', act: 'demolir', data: { case: i }, danger: true });
    }
  }

  // Troupes : terre neutre ou ennemie en guerre qui touche votre territoire,
  // ou cote atteignable par bateau (comme le clic droit).
  if (vivant && t.terre && pid !== m.id) {
    const touche = S.g.voisins(i).some(v => v >= 0 && S.carte.proprio[v] === m.id);
    const ennemi = pid >= 0 && rel === 'guerre';
    const port = S.cotes?.[i] === '1' && S.carte.proprio.some((o, k) => o === m.id && (
      (S.carte.bat[k] === 'port' && S.g.distance(k, i) <= S.defs.troupes.portee_bateau)
      || (S.cotes[k] === '1' && S.g.distance(k, i) <= S.defs.troupes.portee_cote)));
    if ((pid < 0 || ennemi) && (touche || port)) {
      const mode = !touche ? 'bateau' : pid < 0 ? 'neutre' : 'attaque';
      const envoi = Math.floor(m.troupes * S.ratio);
      items.push({
        ico: mode === 'neutre' ? 'map-location-dot' : mode === 'bateau' ? 'ship' : 'person-military-pointing',
        label: mode === 'neutre' ? "S'étendre" : mode === 'bateau' ? 'Débarquer' : 'Attaquer',
        info: `${fmt(envoi)} troupes (${Math.round(S.ratio * 100)} %)`, act: 'etendre', data: { case: i },
        danger: mode === 'attaque', off: envoi < 10,
      });
    }
  }

  // Autre nation : diplomatie et frappes.
  if (vivant && p && p.id !== m.id && !p.elimine) {
    const allies = m.bloc != null && m.bloc === p.bloc;
    const envoyee = g => S.propositions.some(x => x.de === m.id && x.a === p.id && x.genre === g);
    const diplo = [];
    if (rel === 'guerre') diplo.push({ ico: 'dove', label: 'Proposer la paix', act: 'proposer', data: { pays: p.id, genre: 'paix' }, off: envoyee('paix') });
    else if (!allies) diplo.push({ ico: 'burst', label: 'Déclarer la guerre', act: 'guerre', data: { pays: p.id }, danger: true });
    if (rel === 'paix' && !allies) diplo.push({ ico: 'file-signature', label: 'Pacte de non-agression', act: 'proposer', data: { pays: p.id, genre: 'pna' }, off: envoyee('pna') });
    if (rel !== 'guerre' && !allies) diplo.push({ ico: 'people-group', label: 'Proposer une alliance', act: 'proposer', data: { pays: p.id, genre: 'alliance' }, off: envoyee('alliance') });
    diplo.push({ ico: 'box-open', label: 'Envoyer une aide', act: 'aide_form', data: { pays: p.id } });
    diplo.push({ ico: 'user-secret', label: 'Espionner', sous: [
      { ico: 'bomb', label: 'Sabotage', act: 'espion', data: { pays: p.id, op: 'sabotage' } },
      { ico: 'flask', label: 'Vol de technologie', act: 'espion', data: { pays: p.id, op: 'vol' } },
      { ico: 'masks-theater', label: 'Déstabilisation', act: 'espion', data: { pays: p.id, op: 'destabilisation' } },
    ] });
    items.push({ ico: 'handshake', label: `Diplomatie : ${p.nom}`, sous: diplo });

    if (rel === 'guerre') {
      const frappes = [];
      const vus = new Set();
      for (const [id, n] of Object.entries(m.materiel || {})) {
        const u = uniDef(S, id);
        if (!u || !n || u.domaine !== 'missile') continue;
        frappes.push({ ico: u.icone, label: `Tirer : ${u.nom}`, info: `${n} en stock · silo ou bombardier`, act: 'tirer_ici', data: { genre: id, case: i }, danger: id === 'missile_nucleaire' });
      }
      const avions = Object.entries(m.materiel || {}).filter(([id, n]) => n > 0 && uniDef(S, id)?.domaine === 'air').reduce((a, [, n]) => a + n, 0);
      if (avions) frappes.push({ ico: 'jet-fighter', label: 'Raid aérien', info: `${avions} avion${avions > 1 ? 's' : ''} · depuis votre base aérienne`, act: 'raid_ici', data: { case: i } });
      for (const o of ['bombe_antimatiere', 'bombe_trou_noir', 'generateur_point_zero']) {
        const n = possede(S, o);
        const ic = o === 'bombe_trou_noir' ? 'circle' : o === 'generateur_point_zero' ? 'mountain' : 'explosion';
        if (n >= 1) frappes.push({ ico: ic, label: nomObjet(S, o), info: `${fmt(n)} en stock · depuis votre silo`, act: 'arme_ici', data: { objet: o, case: i }, danger: true });
      }
      if (frappes.length) items.push(frappes.length === 1 ? frappes[0] : { ico: 'crosshairs', label: 'Frappes', sous: frappes, danger: true });
    }
  }

  // Vos armees sur la case
  const miennes = m ? S.armees.filter(a => a.case === i && a.proprio === m.id) : [];
  if (miennes.length) items.push({ ico: 'flag', label: miennes.length > 1 ? `Armées (${miennes.length})` : `Armée : ${miennes[0].nom}`, act: 'sel_armee', data: { armee: miennes[0].id } });

  items.push({ ico: 'circle-info', label: 'Infos', info: 'Fiche détaillée de la case', act: 'infos_case', data: { case: i } });
  return items;
}
