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
  const slots = m.bilan.slots;
  let k = 0;
  return `<div class="wf-liste">${m.chantiers.map(c => {
    const annexion = c.bat === 'annexion';
    const cd = annexion ? m.commandants?.find(x => x.id === c.cmdt) : null;
    const d = annexion ? { nom: cd ? `Conquête · ${cd.nom}` : 'Annexion', icone: 'map-location-dot' } : batDef(S, c.bat);
    const actif = annexion || k++ < slots;
    const reste = c.reste / (annexion ? 1 : Math.max(0.01, m.bilan.vitesse)) / S.vitesse;
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
    <div class="wf-stat">${ico('map-location-dot')}<b>${b.cases} / ${b.capacite}</b><span>Provinces · capacité territoriale</span>${barre(b.cases / Math.max(1, b.capacite))}</div>
    <div class="wf-stat">${ico('handshake')}<b>${fmt(m.influence)}</b><span>Influence · ${signe(b.influence)}/min</span></div>
    <div class="wf-stat">${ico('flask')}<b>${signe(b.recherche)}/min</b><span>Recherche · ${fmt(m.recherche_stock)} pts en réserve</span></div>
    <div class="wf-stat ${elecOk ? '' : 'alerte'}">${ico('bolt')}<b>${fmt(b.elec_prod)} / ${fmt(b.elec_cons)}</b><span>Électricité ${elecOk ? 'suffisante' : '— rendement ' + Math.round(b.elec_ratio * 100) + ' %'}</span>${barre(b.elec_cons ? Math.min(1, b.elec_prod / b.elec_cons) : 1, elecOk ? '' : 'rouge')}</div>
    <div class="wf-stat">${ico('shield-halved')}<b>${fmt(b.puissance)}</b><span>Puissance militaire</span></div>
    <div class="wf-stat">${ico('gears')}<b>×${b.vitesse.toFixed(2).replace('.', ',')}</b><span>Vitesse de construction · ${b.slots} chantiers</span></div>
    <div class="wf-stat">${ico('ranking-star')}<b>${fmt(m.scores.global)}</b><span>Score global</span></div>
  </div>

  ${titre('Économie (par minute)', 'chart-line')}
  <table class="wf-table">
    <thead><tr><th>Ressource</th><th class="num">Stock</th><th class="num">Prod.</th><th class="num">Conso.</th><th class="num">Solde</th></tr></thead>
    <tbody>${lignesRes}</tbody>
  </table>
  ${m.res[0] <= 0 && b.conso[0] > b.prod[0] ? `<div class="wf-avert">${ico('triangle-exclamation')} Caisses vides : vos soldats désertent.</div>` : ''}
  ${m.res[1] <= 0 && b.conso[1] > b.prod[1] ? `<div class="wf-avert">${ico('triangle-exclamation')} Famine : votre population décline.</div>` : ''}

  ${titre('Chantiers', 'helmet-safety', `<small>${Math.min(b.slots, m.chantiers.length)} / ${b.slots} actifs</small>`)}
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
  return `${titre('Chantiers en cours', 'helmet-safety', `<small>${Math.min(m.bilan.slots, m.chantiers.length)} / ${m.bilan.slots} actifs</small>`)}${listeChantiers(S)}${corps}`;
}

// ══════════════════════════════════════════════════════════════════
// Menu de la case (inspecteur) : tout se fait depuis la case cliquée
// ══════════════════════════════════════════════════════════════════
const BAT_PRODUCTION = {
  ferme: [1, 'nourriture'], mine: [2, 'métal'], puits_petrole: [3, 'pétrole'],
  mine_uranium: [4, 'uranium'], extracteur_tr: [5, 'terres rares'],
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
    const d = chantier.bat === 'annexion' ? { nom: 'Annexion', icone: 'map-location-dot' } : batDef(S, chantier.bat);
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
      <div class="wf-insp-ligne">${ico('radiation')} Uranium brut : <b>${fmt(m.res[4], 1)}</b> · enrichi : <b>${fmt(m.ur_enrichi, 1)}</b></div>
      <div class="wf-insp-ligne petit">${esc(d.desc)}</div>
      ${m.res[4] < 1 && b === 'enrichissement' ? `<div class="wf-insp-ligne petit">${ico('scale-balanced')} Pas d'uranium brut : achetez-en au marché ou construisez une mine d'uranium.</div>` : ''}
      ${b === 'centrale_nucleaire' && !sur ? `<div class="wf-insp-ligne neg">${ico('triangle-exclamation')} Sans « Nucléaire civil », chaque amélioration a 25 % de risque d'accident.</div>` : ''}
    </div>`;
  } else if (b === 'usine') {
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne">${ico('gears')} Vitesse de construction <b>×${m.bilan.vitesse.toFixed(2).replace('.', ',')}</b> · ${m.bilan.slots} chantiers en parallèle</div></div>`;
  } else if (b === 'banque') {
    html += `<div class="wf-menu-bloc">${menuMarche(S)}</div>`;
  } else {
    html += `<div class="wf-menu-bloc"><div class="wf-insp-ligne petit">${esc(d.desc)}</div></div>`;
  }
  if (b !== 'capitale') html += `<div class="wf-boutons"><button class="wf-btn petit danger" data-act="demolir" data-case="${i}">${ico('trash')} Démolir</button></div>`;
  return html;
}

/** Durée d'une conquête (s de jeu) selon la vitesse du commandant (jeu.rs duree_annexion). */
export const dureeConquete = v => Math.round(50 / (0.55 + 0.3 * v));
const etoiles = v => '★'.repeat(v) + '☆'.repeat(5 - v);

/** Conquête d'une province neutre voisine : il faut un commandant libre,
 *  3 000 hommes, des crédits et de l'influence. */
export function menuConquete(S, i) {
  const m = S.moi;
  const [cr, inf] = m.mods.annexion;
  const cmdts = m.commandants || [];
  const occupe = cd => m.chantiers.some(c => c.cmdt === cd.id);
  const enCours = m.chantiers.find(c => c.case === i && c.bat === 'annexion');
  if (enCours) {
    const cd = cmdts.find(x => x.id === enCours.cmdt);
    return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('person-military-pointing')} Conquête en cours</div>
      <div class="wf-insp-ligne">${cd ? `${esc(cd.nom)} <span class="wf-etoiles">${etoiles(cd.vitesse)}</span>` : 'Annexion'}</div>
      ${barre(1 - enCours.reste / enCours.total)}
      <button class="wf-btn petit danger" data-act="annuler_chantier" data-id="${enCours.id}">${ico('xmark')} Rappeler (50 % remboursés)</button></div>`;
  }
  const ok = m.res[0] >= cr && m.influence >= inf && m.pop >= 23;
  return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('person-military-pointing')} Conquérir cette province</div>
    <div class="wf-insp-ligne petit">Coût : ${fmt(cr)} ${ico('coins')} · ${inf} ${ico('handshake')} · 3 000 hommes ${ico('people-group')}</div>
    ${cmdts.length ? `<div class="wf-menu-liste">${cmdts.map(cd => {
      const libre = !occupe(cd);
      return `<div class="wf-menu-item ${libre ? '' : 'cher'}">
        <span class="wf-bat-ic">${ico('user-tie')}</span>
        <div class="wf-ligne-corps"><b>${esc(cd.nom)}</b>
          <small><span class="wf-etoiles">${etoiles(cd.vitesse)}</span> · ${ico('clock')} ${duree(dureeConquete(cd.vitesse) / S.vitesse)} · ${ico('wheat-awn')} ${cd.vitesse + 2 * cd.vitesse * cd.vitesse}/min en campagne</small></div>
        ${libre ? `<button class="wf-btn petit" data-act="annexer" data-case="${i}" data-cmdt="${cd.id}" ${ok ? '' : 'disabled'}>Envoyer</button>` : '<span class="wf-puce">En campagne</span>'}
      </div>`;
    }).join('')}</div>` : `<div class="wf-insp-ligne petit">${ico('user-clock')} Aucun commandant pour l'instant : il en apparaît au hasard dans votre pays (environ toutes les 6 minutes, 4 au maximum).</div>`}
    <div class="wf-insp-ligne petit">${ico('circle-info')} Plus un commandant est rapide, plus il mange : sans nourriture, la conquête s'arrête.</div>
  </div>`;
}

/** Bâtiments constructibles ici, avec leur coût : un clic sur « Bâtir » suffit. */
function menuConstruire(S, i) {
  const m = S.moi;
  const possibles = S.defs.batiments.filter(d => d.constructible && !raisonBatiment(S, d, i));
  // Les bâtiments qui exploitent le gisement de la case d'abord.
  possibles.sort((a, b) => (b.depot ? 1 : 0) - (a.depot ? 1 : 0));
  const verrous = S.defs.batiments.filter(d => d.constructible && d.tech && !aTech(S, d.tech)).length;
  return `<div class="wf-menu-bloc"><div class="wf-menu-titre">${ico('helmet-safety')} Construire ici</div>
    <div class="wf-menu-liste">${possibles.map(d => {
      const c = coutBatiment(d, 1, m.mods, m.spe);
      const ok = peutPayer(S, c);
      return `<div class="wf-menu-item ${ok ? '' : 'cher'}" title="${esc(d.desc)}">
        <span class="wf-bat-ic">${ico(d.icone)}</span>
        <div class="wf-ligne-corps"><b>${esc(d.nom)}</b><small>${cout(S, c)} · ${ico('clock')} ${duree(d.temps / m.bilan.vitesse / S.vitesse)}</small></div>
        <button class="wf-btn petit" data-act="construire" data-case="${i}" data-bat="${d.id}" ${ok ? '' : 'disabled'}>Bâtir</button>
      </div>`;
    }).join('')}</div>
    ${verrous ? `<div class="wf-insp-ligne petit">${ico('flask')} ${verrous} autres bâtiments se débloquent par la recherche (cliquez sur un laboratoire).</div>` : ''}</div>`;
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
  ${titre('Forces armées', 'shield-halved', `<small>Entretien : ${fmt(entretien[0], 1)} ${ico('coins')} · ${fmt(entretien[1], 1)} ${ico('wheat-awn')} · ${fmt(entretien[2], 1)} ${ico('oil-well')} /min</small>`)}
  <div class="wf-totaux">${Object.keys(totaux).length ? composition(S, totaux) : '<small>Aucune unité</small>'}</div>

  ${titre('Commandants', 'user-tie', `<small>${(m.commandants || []).length} / 4</small>`)}
  <div class="wf-liste">${(m.commandants || []).map(cd => {
    const c = m.chantiers.find(x => x.cmdt === cd.id);
    return `<div class="wf-ligne cliquable" data-act="voir" data-case="${c ? c.case : cd.case}">
      <span class="wf-ligne-ic">${ico('user-tie')}</span>
      <div class="wf-ligne-corps"><div class="wf-ligne-titre">${esc(cd.nom)} <span class="wf-etoiles">${etoiles(cd.vitesse)}</span></div>
      <div class="wf-ligne-sous">${c ? `En campagne · ${duree(c.reste / S.vitesse)}` : 'Disponible'} · conquête en ${duree(dureeConquete(cd.vitesse) / S.vitesse)} · ${ico('wheat-awn')} ${cd.vitesse}/min (${cd.vitesse + 2 * cd.vitesse * cd.vitesse}/min en campagne)</div>
      ${c ? barre(1 - c.reste / c.total) : ''}</div>
    </div>`;
  }).join('') || vide('Aucun commandant : il en apparaît au hasard dans votre pays, environ toutes les 6 minutes.', 'user-clock')}</div>
  <p class="wf-note">${ico('circle-info')} Pour conquérir une province neutre, cliquez dessus et envoyez un commandant libre.</p>

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
  const onglets = [['ressources', 'Matières premières', 'cubes'], ['equipement', 'Équipement militaire', 'person-military-rifle'], ['services', 'Services', 'handshake']];
  const frais = m.mods.frais;
  let corps = '';
  if (onglet === 'ressources') {
    corps = `<div class="wf-info">${ico('scale-balanced')} Marché partagé par toutes les nations : chaque achat fait monter le prix, chaque vente le fait baisser. Frais : <b>${Math.round(frais * 100)} %</b>${m.mods.mondialisation ? ' · ventes +20 %' : ''}.</div>
    <div class="wf-marche">${S.defs.ressources.map((r, i) => {
      if (i === 0) return '';
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
  <p>Fondez votre nation : elle apparaît avec une capitale et quelques provinces. Bâtissez des <b>fermes</b> (nourriture), des <b>mines</b> et <b>puits</b> sur les gisements, une <b>centrale</b> pour l'électricité et des <b>laboratoires</b> pour la recherche. Les nouvelles nations sont protégées de toute déclaration de guerre pendant quelques heures.</p>
  <h3>${ico('map-location-dot')} Faire grandir son pays</h3>
  <p>La taille de votre pays dépend de ce que vous construisez : chaque <b>centre administratif</b> (+6) et chaque <b>ville</b> (+2) augmente votre capacité territoriale. Sélectionnez une province neutre qui touche vos frontières, <b>ou qu'une de vos flottes longe</b>, puis <b>Annexer</b> (crédits + influence). La guerre permet aussi de conquérir des provinces, sans limite de capacité.</p>
  <h3>${ico('gem')} Ressources</h3>
  <p>Chaque région a ses gisements : pétrole (déserts, plaines), métal (collines, montagnes), uranium (montagnes, toundra), terres rares (forêts, collines) et sols fertiles. Ce qui vous manque s'achète au <b>marché mondial</b> ou se négocie avec vos alliés. L'<b>électricité</b> n'est pas stockée : si la consommation dépasse la production, tous les bâtiments consommateurs tournent au ralenti.</p>
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
// Administration (privilege VEX)
// ══════════════════════════════════════════════════════════════════
function panneauAdmin(S) {
  const tous = [...S.pays.values()].sort((a, b) => a.id - b.id);
  return `<div class="wf-avert">${ico('shield-halved')} Outils réservés aux administrateurs VEX.</div>
  ${titre('Annonce mondiale', 'bullhorn')}
  <div class="wf-form"><textarea id="admin-annonce" data-garder maxlength="300" placeholder="Message diffusé dans le journal de tous les joueurs"></textarea>
  <button class="wf-btn" data-act="admin_annonce">${ico('bullhorn')} Publier</button></div>
  ${titre('Nations', 'earth-europe', `<small>${tous.length}</small>`)}
  <table class="wf-table"><thead><tr><th>Nation</th><th>Joueur</th><th class="num">Provinces</th><th></th></tr></thead><tbody>
  ${tous.map(p => `<tr><td>${drapeau(p, 20)} ${esc(p.nom)} ${p.elimine ? '<small>(anéantie)</small>' : ''}</td><td>${joueurDe(p)}</td><td class="num">${p.cases}</td>
    <td><button class="wf-btn-ic danger" data-act="admin_supprimer" data-pays="${p.id}" title="Supprimer définitivement">${ico('trash')}</button></td></tr>`).join('')}
  </tbody></table>`;
}

export const PANNEAUX = {
  pays: { titre: 'Mon pays', icone: 'flag', rendre: panneauPays },
  construction: { titre: 'Construction', icone: 'helmet-safety', rendre: panneauConstruction },
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
