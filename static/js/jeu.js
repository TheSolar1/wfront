// ══════════════════════════════════════════════════════════════════
// jeu.js — Client WorldFront
// Connexion WebSocket, etat local, barre de ressources, inspecteur de
// case, ordres militaires, panneaux, notifications.
// ══════════════════════════════════════════════════════════════════

import { Carte } from './carte.js';
import { ico, esc, fmt, fmtPop, duree, signe, Grille, coutBatiment, contraste } from './util.js';
import { PANNEAUX, drapeau, cout, nomCase, statutArmee, listeChat, ICONES_EVT, menuCase, menuTroupes, menuDiplomatie, nomObjet, recetteDeTable } from './panneaux.js';

const $ = s => document.querySelector(s);
const corps = document.body;

const S = {
  defs: null, joueur: null, vitesse: 1, g: null, carte: null,
  moi: null, pays: new Map(), blocs: new Map(), classement: [],
  relations: {}, propositions: [], armees: [], missions: [], missiles: [], attaques: [],
  ratio: (() => { try { return Math.min(1, Math.max(0.05, +localStorage.getItem('wf-ratio') || 0.3)); } catch (e) { return 0.3; } })(),
  evenements: [], chat: [], prix: [], histPrix: [[], [], [], [], [], []],
  selCase: null, selArmee: null, prodCase: null, ordre: null,
  panneau: null, brancheRecherche: 'militaire', categorie: 'global', filtreJournal: 'tout', canal: 'global',
  nonLus: { journal: 0, chat: 0 }, pret: false,
};
window.WF = S; // pratique pour le debogage depuis la console

// ══════════════════════════════════════════════════════════════════
// Connexion
// ══════════════════════════════════════════════════════════════════
let ws = null, reqId = 0, echecs = 0, dejaInit = false;
const attente = new Map();

function connecter() {
  // Chemin relatif a la page : fonctionne a la racine comme derriere
  // un prefixe de reverse proxy (ex. https://vex.exemple/worldfront/).
  const base = location.pathname.replace(/[^/]*$/, '');
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + 'ws';
  ws = new WebSocket(url);
  ws.onopen = () => { echecs = 0; etatConnexion(true); };
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'init') recevoirInit(m);
    else if (m.t === 'etat') recevoirEtat(m);
    else if (m.t === 'reponse') {
      const r = attente.get(m.req);
      attente.delete(m.req);
      if (r) r(m);
    }
  };
  ws.onclose = () => {
    etatConnexion(false);
    echecs++;
    if (echecs >= 3) verifierSession();
    setTimeout(connecter, Math.min(8000, 1000 * echecs));
  };
}

async function verifierSession() {
  try {
    const r = await fetch('jeu', { redirect: 'manual', cache: 'no-store' });
    if (r.type === 'opaqueredirect' || r.status === 302 || r.status === 303) {
      modale(`<div class="wf-modale-tete">${ico('user-clock')}<h2>Session VEX expirée</h2></div>
        <p>Votre session VEX a expiré (elle dure une heure). Reconnectez-vous à VEX puis revenez ici : votre nation vous attend.</p>
        <div class="wf-boutons fin"><a class="wf-btn" href="${esc(corps.dataset.connexion)}">${ico('right-to-bracket')} Se reconnecter</a></div>`, { fermable: false });
    }
  } catch { /* serveur injoignable : on reessaie */ }
}

function etatConnexion(ok) {
  $('#wf-connexion').classList.toggle('ko', !ok);
  $('#wf-connexion').title = ok ? 'Connecté au serveur' : 'Connexion perdue — reconnexion…';
  $('#wf-hors-ligne').hidden = ok || !dejaInit;
}

function envoyer(action, params = {}) {
  return new Promise(ok => {
    if (!ws || ws.readyState !== 1) { toast('Connexion au serveur perdue.', 'err'); ok({ ok: false }); return; }
    const req = ++reqId;
    attente.set(req, ok);
    ws.send(JSON.stringify({ action, req, ...params }));
    setTimeout(() => { if (attente.has(req)) { attente.delete(req); ok({ ok: false, msg: 'Pas de réponse du serveur.' }); } }, 10000);
  });
}

async function agir(action, params = {}, silencieux = false) {
  const r = await envoyer(action, params);
  if (r.msg && (!silencieux || !r.ok)) toast(r.msg, r.ok ? 'ok' : 'err');
  return r;
}

// ══════════════════════════════════════════════════════════════════
// Reception
// ══════════════════════════════════════════════════════════════════
function recevoirInit(m) {
  S.defs = m.defs;
  S.joueur = m.joueur;
  S.vitesse = m.vitesse || 1;
  S.cotes = m.carte.cotes;
  S.g = new Grille(m.carte.largeur, m.carte.hauteur);
  if (!dejaInit) {
    S.carte = new Carte($('#wf-carte-3d'), m, {
      clic: clicCarte, clicDroit: clicDroitCarte, survol: survolCarte,
      flash: () => { const f = $('#wf-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
    });
    S.carte.cotes = m.carte.cotes;
    S.carte.vitesseJeu = S.vitesse;
    dejaInit = true;
  }
  $('#wf-chargement').classList.add('fini');
  construireMenu();
  invite();
}

function recevoirEtat(e) {
  const premier = !S.pret;
  if (e.publics) {
    S.pays = new Map(e.publics.pays.map(p => [p.id, p]));
    S.blocs = new Map(e.publics.blocs.map(b => [b.id, b]));
    S.classement = e.publics.classement;
    S.carte.majPublics(e.publics);
  }
  const avant = S.moi;
  S.moi = e.moi;
  S.relations = e.relations || {};
  S.propositions = e.propositions || [];
  S.armees = e.armees || [];
  S.missions = e.missions || [];
  S.missiles = e.missiles || [];
  S.attaques = e.attaques || [];
  S.cours = e.cours || {};
  if (e.graine != null) {
    if (S.graine != null && e.graine !== S.graine) { location.reload(); return; }
    S.graine = e.graine;
  }
  S.prix = e.prix || S.prix;
  S.prix.forEach((p, i) => { const h = S.histPrix[i]; h.push(p); if (h.length > 90) h.shift(); });
  S.carte.setMoi(S.moi ? S.moi.id : null);
  S.carte.setRelations(S.relations);
  S.carte.majEtat(e);
  majTroupes();
  majPropositions();
  recuA = performance.now();

  // Evenements
  for (const ev of e.evenements || []) {
    S.evenements.push(ev);
    if (!premier) {
      if (S.panneau !== 'journal') S.nonLus.journal++;
      if (['alerte', 'victoire', 'nucleaire', 'guerre', 'annonce', 'recherche'].includes(ev.genre) || (ev.pays != null && ev.genre === 'construction')) {
        const [ic] = ICONES_EVT[ev.genre] || ['circle-info'];
        toast(ev.texte, ev.genre === 'alerte' || ev.genre === 'nucleaire' || ev.genre === 'guerre' ? 'alerte' : ev.genre === 'victoire' ? 'ok' : 'info', ic, ev.case);
      }
    }
  }
  if (S.evenements.length > 400) S.evenements.splice(0, S.evenements.length - 400);
  for (const c of e.chat || []) {
    S.chat.push(c);
    if (!premier && c.auteur !== S.joueur.nom && S.panneau !== 'chat') S.nonLus.chat++;
  }
  if (S.chat.length > 400) S.chat.splice(0, S.chat.length - 400);

  if (S.selArmee != null && !S.armees.some(a => a.id === S.selArmee)) choisirArmee(null);
  S.pret = true;

  majBarre();
  majMenu();
  majInspecteur();
  majAlertes();
  majPanneau(false);
  if (premier) {
    if (S.moi) S.carte.centrerSur(S.moi.capitale, 30);
    else if (!sessionStorage.getItem('wf-fondation-vue')) ouvrirFondation();
  }
  if (S.moi && S.moi.elimine && (!avant || !avant.elimine)) ouvrirAneantie();
}

// ══════════════════════════════════════════════════════════════════
// Barre de ressources
// ══════════════════════════════════════════════════════════════════
function majBarre() {
  const b = $('#wf-resbar');
  const m = S.moi;
  if (!m) {
    b.innerHTML = `<div class="wf-res-vide">${ico('earth-europe')} Mode observateur — <button class="wf-lien" data-act="fonder">fondez votre nation</button> pour entrer dans la partie.</div>`;
    return;
  }
  const bl = m.bilan;
  // Credits, puis les minerais du plus courant au plus rare (plus de nourriture).
  const res = [0, 2, 5, 4, 3].map(i => {
    const r = S.defs.ressources[i];
    const net = bl.prod[i] - bl.conso[i];
    const cap = i === 0 ? bl.stock * 20 : bl.stock;
    const plein = m.res[i] >= cap * 0.98;
    return `<div class="wf-res ${net < 0 && m.res[i] < 50 ? 'critique' : ''} ${plein ? 'plein' : ''}" title="${esc(r.nom)} : ${fmt(m.res[i])} / ${fmt(cap)}\nProduction ${signe(bl.prod[i])}/min · consommation ${fmt(bl.conso[i], 1)}/min">
      ${ico(r.icone, '', `color:${r.couleur}`)}<span class="wf-res-txt"><span><b>${fmt(m.res[i])}</b><small class="${net >= 0 ? 'pos' : 'neg'}">${signe(net * S.vitesse)}</small></span><em>${esc(r.nom.replace('Minerai ', ''))}</em></span></div>`;
  }).join('');
  const elecOk = bl.elec_ratio >= 0.999;
  const protection = Math.max(0, m.protection - Date.now() / 1000);
  const enrichi = m.ur_enrichi > 0 || bl.niv?.enrichissement || bl.niv?.centrale_nucleaire
    ? `<div class="wf-res" title="Uranium enrichi : ${fmt(m.ur_enrichi, 1)} (pour les centrales nucléaires)">${ico('flask-vial', '', 'color:#16a34a')}<b>${fmt(m.ur_enrichi)}</b></div>` : '';
  b.innerHTML = `${res}${enrichi}
    <span class="wf-res-sep"></span>
    <div class="wf-res" title="Population : ${fmtPop(m.pop)} / ${fmtPop(bl.pop_cap)}">${ico('people-group')}<b>${fmtPop(m.pop).replace(' hab.', '')}</b></div>
    <div class="wf-res" title="Influence (${signe(bl.influence)}/min)">${ico('handshake')}<b>${fmt(m.influence)}</b></div>
    <div class="wf-res" title="Recherche : ${signe(bl.recherche)} pts/min">${ico('flask')}<b>${signe(bl.recherche * S.vitesse)}</b></div>
    <div class="wf-res ${elecOk ? '' : 'critique'}" title="Électricité : ${fmt(bl.elec_prod)} produits / ${fmt(bl.elec_cons)} consommés">${ico('bolt', '', 'color:#facc15')}<b>${fmt(bl.elec_prod - bl.elec_cons)}</b></div>
    <div class="wf-res" title="Provinces">${ico('map-location-dot')}<b>${bl.cases}</b></div>
    <div class="wf-res" title="Troupes : ${fmt(m.troupes)} / ${fmt(bl.troupes_max)} (clic droit sur une case pour en envoyer)">${ico('person-military-rifle')}<b>${fmt(m.troupes)}</b></div>
    <span class="wf-espace"></span>
    ${protection > 0 ? `<div class="wf-res bleu" title="Aucune nation ne peut vous déclarer la guerre (sauf si vous attaquez)">${ico('shield-halved')}<b>${duree(protection)}</b></div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// Menu lateral
// ══════════════════════════════════════════════════════════════════
const MENU = [
  // Construire : clic gauche sur une case. Diplomatie : clic sur un pays.
  // Recherche : plans au marché. Journal : notifications.
  ['carte', 'Carte du monde', 'earth-europe'], ['pays', 'Mon pays', 'flag'], ['fabrication', 'Fabrication', 'gears'],
  ['armee', 'Armées', 'person-military-rifle'], ['blocs', 'Blocs & alliances', 'people-group'], ['marche', 'Marché mondial', 'scale-balanced'],
  ['classement', 'Classements', 'ranking-star'], ['chat', 'Messagerie', 'comments'], ['aide', 'Guide', 'circle-question'],
];

function construireMenu() {
  const admin = S.joueur.admin;
  $('#wf-menu').innerHTML = `<a href="#" class="nav-sidebar-item-7844 wf-menu-replier" data-act="reduire_menu" title="Réduire / agrandir le menu (H : masquer toute l'interface)">${ico('bars', 'sidebar-ico')}<span>Réduire le menu</span></a>` + MENU.map(([id, nom, ic], k) => `
    <a href="#" class="nav-sidebar-item-7844 wf-menu-item" data-act="ouvrir" data-panneau="${id}" title="${nom} (${k < 9 ? k + 1 : ''})">
      ${ico(ic, 'sidebar-ico')}<span>${nom}</span><span class="wf-badge" data-badge="${id}" hidden></span></a>`).join('')
    + (admin ? `<div class="nav-sidebar-divider-7844"></div><a href="#" class="nav-sidebar-item-7844 admin-item wf-menu-item" data-act="ouvrir" data-panneau="admin">${ico('shield-halved', 'sidebar-ico')}<span>Administration</span></a>` : '');
  majMenu();
}

function majMenu() {
  document.querySelectorAll('.wf-menu-item').forEach(a => a.classList.toggle('active', a.dataset.panneau === (S.panneau || 'carte')));
  const badge = (id, n) => { const b = document.querySelector(`[data-badge="${id}"]`); if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; } };
  badge('journal', S.nonLus.journal);
  badge('chat', S.nonLus.chat);
  const props = S.moi ? S.propositions.filter(p => p.a === S.moi.id).length : 0;
  badge('diplomatie', props);
  const bloc = S.moi?.bloc != null ? S.blocs.get(S.moi.bloc) : null;
  badge('blocs', bloc && bloc.chef === S.moi.id ? bloc.candidats.length : (S.moi ? [...S.blocs.values()].filter(b => b.invites.includes(S.moi.id)).length : 0));
  const m = S.moi;
  $('#wf-nation').innerHTML = m
    ? `${drapeau(m, 42)}<div><b>${esc(m.nom)}</b><small>${esc(S.defs.specialisations.find(s => s.id === m.spe)?.nom || '')}</small></div>`
    : `<button class="wf-btn plein" data-act="fonder">${ico('flag')} Fonder ma nation</button>`;
}

// ══════════════════════════════════════════════════════════════════
// Panneaux
// ══════════════════════════════════════════════════════════════════
function ouvrirPanneau(id, opts = {}) {
  if (id === 'carte' || (id === S.panneau && !opts.garder)) {
    S.panneau = null;
    corps.classList.remove('wf-panneau-ouvert');
  } else {
    S.panneau = id;
    corps.classList.toggle('wf-panneau-large', id === 'fabrication');
    if (id === 'journal') S.nonLus.journal = 0;
    if (id === 'chat') { S.nonLus.chat = 0; if (opts.canal) S.canal = opts.canal; }
    corps.classList.add('wf-panneau-ouvert');
    const p = PANNEAUX[id];
    $('#wf-panneau-titre').innerHTML = `${ico(p.icone)}<span>${esc(p.titre)}</span>`;
    $('#wf-panneau-corps').scrollTop = 0;
  }
  majMenu();
  majPanneau(true);
}

let dernierRendu = '';
function majPanneau(force) {
  const id = S.panneau;
  if (!id || !S.defs) return;
  const p = PANNEAUX[id];
  const el = $('#wf-panneau-corps');
  if (p.statique && !force) return;
  if (!force && el.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName)) {
    if (p.partiel) majChat();
    return;
  }
  const html = p.rendre(S);
  if (force || html !== dernierRendu) {
    const gardes = {};
    el.querySelectorAll('[data-garder]').forEach(i => { if (i.id) gardes[i.id] = i.value; });
    const scroll = el.scrollTop;
    el.innerHTML = html;
    if (!force) {
      for (const [k, v] of Object.entries(gardes)) { const i = document.getElementById(k); if (i) i.value = v; }
      el.scrollTop = scroll;
    }
    dernierRendu = html;
  }
  if (p.partiel) majChat(force);
}

function majChat(force) {
  const l = $('#wf-chat-liste');
  if (!l) return;
  const bas = l.scrollHeight - l.scrollTop - l.clientHeight < 60;
  const html = listeChat(S);
  if (l.dataset.h !== String(html.length) || force) {
    l.innerHTML = html;
    l.dataset.h = String(html.length);
    if (bas || force) l.scrollTop = l.scrollHeight;
  }
}

// ══════════════════════════════════════════════════════════════════
// Carte : clics, survol, inspecteur
// ══════════════════════════════════════════════════════════════════
function armeesSur(i) { return S.armees.filter(a => a.case === i); }
function mesArmeesSur(i) { return armeesSur(i).filter(a => S.moi && a.proprio === S.moi.id); }

function clicCarte(i, e) {
  if (i < 0) return;
  if (S.ordre) { executerOrdre(i); return; }
  // HUD minimal : un clic sur la carte referme le panneau ouvert.
  if (S.panneau) { ouvrirPanneau('carte'); return; }
  const miennes = mesArmeesSur(i);
  if (miennes.length && S.selCase === i) {
    // Clics successifs : on passe d'une armee a l'autre sur la meme case.
    const k = miennes.findIndex(a => a.id === S.selArmee);
    choisirArmee(k + 1 < miennes.length ? miennes[k + 1].id : null);
  } else if (miennes.length) {
    choisirArmee(miennes[0].id);
  } else if (!e?.shiftKey) {
    choisirArmee(null);
  }
  choisirCase(i);
}

// Clic droit : avec une armee selectionnee, l'ordre habituel ; sinon on
// envoie une part des troupes sur la case (facon OpenFront).
function clicDroitCarte(i) {
  if (i < 0) return;
  if (S.ordre) { annulerOrdre(); return; }
  const a = S.armees.find(x => x.id === S.selArmee);
  if (a && S.moi && a.proprio === S.moi.id) {
    if (a.dom === 'terre' || a.dom === 'mer') agir('deplacer', { armee: a.id, cible: i });
    else if (a.dom === 'air') demarrerOrdre('mission', a);
    return;
  }
  if (S.moi && !S.moi.elimine) envoyerTroupes(i);
}

function envoyerTroupes(i) {
  if (S.carte.proprio[i] === S.moi.id) { toast('Cette province est déjà à vous. Faites un clic droit sur une case voisine.', 'info'); return; }
  agir('etendre', { case: i, ratio: S.ratio });
}

/** Curseur de troupes en bas a gauche de la carte. */
/** Propositions recues (paix, pacte, alliance) : a accepter ou refuser. */
function majPropositions() {
  const el = $('#wf-propositions');
  if (!el) return;
  const m = S.moi;
  const recues = m ? S.propositions.filter(x => x.a === m.id) : [];
  const html = recues.map(x => {
    const p = S.pays.get(x.de);
    const quoi = x.genre === 'paix' ? 'vous propose la paix' : x.genre === 'alliance' ? 'vous propose une alliance' : 'vous propose un pacte de non-agression';
    return `<div class="wf-proposition">${drapeau(p, 22)}<span><b>${esc(p?.nom || '?')}</b> ${quoi}</span>
      <button class="wf-btn petit" data-act="repondre" data-pays="${x.de}" data-genre="${x.genre}" data-accepte="1">Accepter</button>
      <button class="wf-btn-ic" data-act="repondre" data-pays="${x.de}" data-genre="${x.genre}" data-accepte="0" title="Refuser">${ico('xmark')}</button></div>`;
  }).join('');
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  el.hidden = !recues.length;
}

function majTroupes() {
  const el = $('#wf-troupes');
  if (!el) return;
  const m = S.moi;
  el.hidden = !m || m.elimine;
  if (el.hidden) return;
  const max = Math.max(1, m.bilan.troupes_max);
  $('#wf-troupes-n').textContent = fmt(m.troupes);
  $('#wf-troupes-max').textContent = fmt(max);
  $('#wf-troupes-barre').style.width = (Math.min(1, m.troupes / max) * 100).toFixed(1) + '%';
  $('#wf-ratio-envoi').textContent = fmt(Math.floor(m.troupes * S.ratio));
  const r = $('#wf-ratio');
  if (document.activeElement !== r) r.value = Math.round(S.ratio * 100);
  $('#wf-ratio-val').textContent = Math.round(S.ratio * 100) + ' %';
  document.querySelectorAll('#wf-troupes [data-ratio]').forEach(b => b.classList.toggle('actif', Math.round(S.ratio * 100) === +b.dataset.ratio));
  const nb = S.attaques.filter(a => a.de === m.id).length;
  $('#wf-troupes-off').textContent = nb ? `${nb} offensive${nb > 1 ? 's' : ''}` : '';
}

function choisirRatio(pct) {
  S.ratio = Math.min(1, Math.max(0.05, pct / 100));
  try { localStorage.setItem('wf-ratio', String(S.ratio)); } catch (x) {}
  majTroupes();
  if (S.selCase != null) majInspecteur(true);
}

function survolCarte(i, e) {
  const t = $('#wf-survol');
  // La case selectionnee a deja son menu juste a cote : pas d'infobulle.
  if (i == null || !S.defs || i === S.selCase) { t.hidden = true; return; }
  const p = S.carte.proprio[i] >= 0 ? S.pays.get(S.carte.proprio[i]) : null;
  const b = S.carte.bat[i];
  const d = S.carte.depot[i];
  const nb = armeesSur(i).length;
  let dist = '';
  if (S.ordre) {
    const a = S.armees.find(x => x.id === S.ordre.armee);
    if (a) dist = ` · ${S.g.distance(a.case, i)} cases`;
  }
  t.innerHTML = `<b>${esc(nomCase(S, i))}</b>${dist}
    ${p ? `<div>${drapeau(p, 16)} ${esc(p.nom)}</div>` : ''}
    ${b ? `<div>${ico(S.defs.batiments.find(x => x.id === b)?.icone)} ${esc(S.defs.batiments.find(x => x.id === b)?.nom)} ${S.carte.niv[i]}</div>` : ''}
    ${d ? `<div>${ico(S.defs.depots[d].icone)} ${esc(S.defs.depots[d].nom)}</div>` : ''}
    ${S.carte.irr[i] ? `<div class="neg">${ico('radiation')} Zone irradiée</div>` : ''}
    ${nb ? `<div>${ico('flag')} ${nb} armée${nb > 1 ? 's' : ''}</div>` : ''}`;
  t.hidden = false;
  const r = $('#wf-carte').getBoundingClientRect();
  t.style.left = Math.min(r.width - 230, e.clientX - r.left + 16) + 'px';
  t.style.top = Math.min(r.height - 120, e.clientY - r.top + 14) + 'px';
}

function choisirCase(i) {
  S.selCase = i;
  S.carte.selectionnerCase(i);
  if (i != null) $('#wf-survol').hidden = true;
  majInspecteur();
  if (S.panneau === 'construction') majPanneau(true);
}

function choisirArmee(id) {
  S.selArmee = id;
  S.carte.selectionnerArmee(id);
  majInspecteur();
  if (S.panneau === 'armee') majPanneau(true);
}

let dernierInsp = '';
function majInspecteur(force) {
  const el = $('#wf-inspecteur');
  const i = S.selCase;
  if (i == null || !S.defs) { el.hidden = true; return; }
  const m = S.moi;
  const t = S.defs.terrains[S.carte.terrain[i]];
  const pid = S.carte.proprio[i];
  const p = pid >= 0 ? S.pays.get(pid) : null;
  const b = S.carte.bat[i];
  const bd = b ? S.defs.batiments.find(x => x.id === b) : null;
  const d = S.carte.depot[i];
  const rel = p && m && p.id !== m.id ? (S.relations[p.id]?.etat || 'paix') : null;
  const vue = !S.carte.vision || S.carte.vision[i];

  let actions = menuCase(S, i);
  // Troupes (facon OpenFront) : terre neutre ou ennemie qui touche votre
  // territoire, ou cote lointaine (debarquement depuis un chantier naval).
  if (m && !m.elimine && p && p.id !== m.id && !p.elimine) actions += menuDiplomatie(S, p);
  if (m && !m.elimine && t.terre && pid !== m.id) {
    const touche = S.g.voisins(i).some(v => v >= 0 && S.carte.proprio[v] === m.id);
    const ennemi = pid >= 0 && rel === 'guerre';
    const port = S.cotes?.[i] === '1' && S.carte.proprio.some((o, k) => o === m.id && (
      (S.carte.bat[k] === 'port' && S.g.distance(k, i) <= S.defs.troupes.portee_bateau)
      || (S.cotes[k] === '1' && S.g.distance(k, i) <= S.defs.troupes.portee_cote)));
    if ((pid < 0 || ennemi) && (touche || port)) actions += menuTroupes(S, i, !touche ? 'bateau' : pid < 0 ? 'neutre' : 'attaque');
  }

  const liste = armeesSur(i);
  const armeesHtml = liste.map(a => {
    const ap = S.pays.get(a.proprio);
    const mienne = m && a.proprio === m.id;
    const u = S.defs.unites.find(x => x.id === a.principal);
    return `<div class="wf-insp-armee ${a.id === S.selArmee ? 'actif' : ''} ${mienne ? 'cliquable' : ''}" ${mienne ? `data-act="sel_armee" data-armee="${a.id}"` : ''}>
      <span class="wf-pastille-armee" style="background:${esc(ap?.couleur || '#607d8b')};color:${contraste(ap?.couleur || '#607d8b')}">${ico(u?.icone)}</span>
      <div class="wf-ligne-corps"><b>${mienne ? esc(a.nom) : esc(ap?.nom || '?')}</b>
      <small>${a.unites ? Object.entries(a.unites).map(([k, n]) => `${n} ${esc(S.defs.unites.find(x => x.id === k)?.nom || k)}`).join(', ') : `environ ${a.estimation} unités`}</small></div>
    </div>`;
  }).join('');

  const html = `<div class="wf-insp-tete" style="--pc:${esc(p?.couleur || t.couleur)}">
      <span class="wf-carre" style="background:${t.couleur}"></span>
      <div class="wf-ligne-corps"><b>${esc(t.nom)}</b> <small>(${S.g.xy(i).join(', ')})${S.cotes[i] === '1' ? ' · côte' : ''}</small></div>
      <button class="wf-btn-ic" data-act="reduire_insp" title="${S.inspReduit ? 'Agrandir' : 'Réduire'}">${ico(S.inspReduit ? 'chevron-up' : 'chevron-down')}</button>
      <button class="wf-btn-ic" data-act="deselection" title="Fermer (Échap)">${ico('xmark')}</button>
    </div>
    <div class="wf-insp-corps" ${S.inspReduit ? 'hidden' : ''}>
      <div class="wf-insp-ligne">${p ? `${drapeau(p, 20)} <b>${esc(p.nom)}</b> ${m && p.id === m.id ? '<span class="wf-puce accent">vous</span>' : rel ? `<span class="wf-rel ${rel}">${rel === 'guerre' ? 'En guerre' : rel === 'pna' ? 'Pacte' : 'Paix'}</span>` : ''}` : `${ico('flag')} <i>Territoire neutre</i>`}</div>
      ${d ? `<div class="wf-insp-ligne">${ico(S.defs.depots[d].icone, '', `color:${S.defs.depots[d].couleur}`)} ${esc(S.defs.depots[d].nom)}</div>` : ''}
      ${bd ? `<div class="wf-insp-ligne">${ico(bd.icone)} ${esc(bd.nom)} <b>niv. ${S.carte.niv[i]}</b></div>` : ''}
      ${S.carte.irr[i] ? `<div class="wf-insp-ligne neg">${ico('radiation')} Zone irradiée</div>` : ''}
      ${t.terre ? `<div class="wf-insp-ligne petit">${ico('person-hiking')} Déplacement ×${String(t.cout_mvt).replace('.', ',')} · ${ico('shield-halved')} défense +${Math.round(t.defense * 100)} %</div>` : ''}
      ${!vue ? `<div class="wf-insp-ligne petit">${ico('eye-slash')} Hors de votre champ de vision</div>` : ''}
      ${armeesHtml ? `<div class="wf-insp-armees">${armeesHtml}</div>` : ''}
      ${actions}
      ${carteArmee()}
    </div>`;
  // Re-rendu a chaque tick : on garde le defilement et les quantites
  // saisies, et on ne touche a rien pendant une saisie.
  const saisie = el.contains(document.activeElement) && /input|select|textarea/i.test(document.activeElement.tagName);
  if (force || (!saisie && (html !== dernierInsp || el.hidden))) {
    const gardes = {};
    el.querySelectorAll('[data-garder]').forEach(x => { if (x.id) gardes[x.id] = x.value; });
    const scroll = el.scrollTop;
    const memeCase = el.dataset.case === String(i);
    el.innerHTML = html;
    el.dataset.case = i;
    if (memeCase) {
      for (const [k, v] of Object.entries(gardes)) { const x = document.getElementById(k); if (x && el.contains(x)) x.value = v; }
      el.scrollTop = scroll;
    }
    dernierInsp = html;
  }
  el.hidden = false;
}

// ── Suivi de la carte : menu ancre a la case, comptes a rebours ──
// Le menu de la case selectionnee s'ouvre juste a cote d'elle et la
// suit quand on deplace la camera (sauf sur petit ecran, ou il reste
// en bas). Au-dessus de chaque chantier / production en cours, une
// etiquette affiche le temps restant, interpole entre deux ticks.
const PETIT_ECRAN = matchMedia('(max-width: 760px)');
let recuA = performance.now();
const etiquettes = new Map(); // cle -> element

function placerInspecteur() {
  const el = $('#wf-inspecteur');
  if (el.hidden || S.selCase == null) return;
  if (PETIT_ECRAN.matches) { el.classList.remove('ancre'); el.style.left = el.style.top = ''; return; }
  const zone = $('#wf-carte');
  const W = zone.clientWidth, H = zone.clientHeight;
  const w = el.offsetWidth, h = el.offsetHeight;
  const p = S.carte.ecranDe(S.selCase, 0.3);
  const marge = 10, ecart = 26;
  let x = p.x + ecart;
  if (x + w > W - marge) x = p.x - ecart - w;          // pas la place a droite : a gauche
  x = Math.max(marge, Math.min(W - w - marge, x));
  let y = p.y - Math.min(70, h / 2);
  y = Math.max(58, Math.min(H - h - marge, y));        // sous la barre d'outils
  el.classList.add('ancre');
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
}

function tachesEnCours() {
  const m = S.moi;
  if (!m || m.elimine) return [];
  const ecoule = (performance.now() - recuA) / 1000 * S.vitesse;
  const out = [];
  const vit = Math.max(0.01, m.bilan.vitesse);
  m.chantiers.forEach(c => {
    const actif = true; // plus de file d'attente : tous les chantiers avancent
    const v = vit;
    const d = S.defs.batiments.find(x => x.id === c.bat);
    const reste = actif ? Math.max(0, c.reste / v - ecoule) / S.vitesse : null;
    out.push({ cle: 'c' + c.id, case: c.case, icone: d?.icone || 'helmet-safety', reste, prog: 1 - (actif ? reste * S.vitesse * v : c.reste) / c.total });
  });
  const robot = 1 + 0.07 * (m.mods.robotique || 0);
  const vues = new Set();
  for (const p of m.productions) {
    if (vues.has(p.case)) continue; // seule la tete de file avance
    vues.add(p.case);
    const niv = Math.max(1, S.carte.niv[p.case] || 1);
    const taux = (1 + 0.25 * (niv - 1)) * (1 + (vit - 1) * 0.5) * robot;
    const reste = Math.max(0, p.reste / taux - ecoule) / S.vitesse;
    const u = S.defs.unites.find(x => x.id === p.unite);
    const file = m.productions.filter(x => x.case === p.case).length;
    out.push({ cle: 'p' + p.id, case: p.case, icone: u?.icone || 'industry', reste, qte: p.qte, file, prog: 1 - reste * S.vitesse * taux / p.total, prod: true });
  }
  return out;
}

function placerEtiquettes() {
  const zone = $('#wf-carte');
  const loin = S.carte.cam.d > 75;
  const taches = loin ? [] : tachesEnCours();
  // Plusieurs taches sur une meme case : on les empile.
  const parCase = new Map();
  const vues = new Set();
  for (const t of taches) {
    const rang = parCase.get(t.case) || 0;
    parCase.set(t.case, rang + 1);
    const p = S.carte.ecranDe(t.case, 1.9);
    if (!p.devant || p.x < -60 || p.y < -30 || p.x > zone.clientWidth + 60 || p.y > zone.clientHeight + 30) continue;
    let el = etiquettes.get(t.cle);
    if (!el) {
      el = document.createElement('div');
      el.className = 'wf-minuteur' + (t.prod ? ' prod' : '');
      zone.appendChild(el);
      etiquettes.set(t.cle, el);
    }
    vues.add(t.cle);
    const texte = t.reste == null ? 'en attente' : t.reste < 1 ? 'terminé' : minuteur(t.reste);
    const html = `${ico(t.icone)}${t.qte > 1 ? `<small>${t.qte}×</small>` : ''}<b>${texte}</b>${t.file > 1 ? `<small>+${t.file - 1}</small>` : ''}<span style="width:${Math.round(Math.max(0, Math.min(1, t.prog)) * 100)}%"></span>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.classList.toggle('attente', t.reste == null);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - rang * 24)}px) translate(-50%, -100%)`;
  }
  for (const [k, el] of etiquettes) if (!vues.has(k)) { el.remove(); etiquettes.delete(k); }
}

function minuteur(s) {
  s = Math.ceil(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function suivreCarte() {
  requestAnimationFrame(suivreCarte);
  if (document.hidden || !S.pret || !S.carte) return;
  placerInspecteur();
  placerEtiquettes();
}
requestAnimationFrame(suivreCarte);

function carteArmee() {
  const a = S.armees.find(x => x.id === S.selArmee);
  if (!a || !S.moi || a.proprio !== S.moi.id) return '';
  const st = statutArmee(S, a);
  const unites = Object.keys(a.unites || {}).map(k => S.defs.unites.find(u => u.id === k)).filter(Boolean);
  const portee = Math.max(0, ...unites.filter(u => u.domaine === 'terre' || u.domaine === 'mer').map(u => u.portee));
  const autres = mesArmeesSur(a.case).filter(x => x.id !== a.id && x.dom === a.dom);
  let boutons = '';
  if (a.dom === 'terre' || a.dom === 'mer') {
    boutons += `<button class="wf-btn petit" data-act="ordre" data-type="deplacer">${ico('route')} Déplacer</button>`;
    if (portee > 0) boutons += `<button class="wf-btn petit secondaire" data-act="ordre" data-type="bombarder">${ico('bomb')} Bombarder</button>`;
    if (a.chemin?.length || a.assaut != null || a.bombarde != null) boutons += `<button class="wf-btn petit secondaire" data-act="arreter">${ico('hand')} Halte</button>`;
  } else if (a.dom === 'air') {
    boutons += `<button class="wf-btn petit" data-act="ordre" data-type="mission">${ico('jet-fighter')} Mission de frappe</button>`;
  } else if (a.dom === 'missile') {
    for (const u of unites) boutons += `<button class="wf-btn petit ${u.id === 'missile_nucleaire' ? 'danger' : ''}" data-act="ordre" data-type="missile" data-genre="${u.id}">${ico(u.icone)} Tirer : ${esc(u.nom)}</button>`;
  }
  if (a.total > 1 && (a.dom === 'terre' || a.dom === 'mer')) boutons += `<button class="wf-btn petit secondaire" data-act="scinder_form">${ico('code-branch')} Scinder</button>`;
  for (const o of autres) boutons += `<button class="wf-btn petit secondaire" data-act="fusionner" data-avec="${o.id}">${ico('object-group')} Fusionner avec ${esc(o.nom)}</button>`;
  boutons += `<button class="wf-btn-ic" data-act="renommer_form" title="Renommer">${ico('pen')}</button>`;
  boutons += `<button class="wf-btn-ic danger" data-act="dissoudre" title="Démobiliser">${ico('trash')}</button>`;
  return `<div class="wf-insp-selection">
    <div class="wf-insp-sel-tete">${ico('crosshairs')}<b>${esc(a.nom)}</b><span class="wf-puce ${st.c}">${ico(st.i)}${esc(st.t)}</span></div>
    <div class="wf-compos">${unites.map(u => `<span class="wf-compo" title="${esc(u.nom)}">${ico(u.icone)}${a.unites[u.id]}</span>`).join('')}
      <small>${ico('gauge-high')} ${String(a.vitesse).replace('.', ',')} cases/min${a.blessures ? ` · ${ico('heart-crack')} ${fmt(a.blessures)} PV de dégâts` : ''}</small></div>
    <div class="wf-boutons">${boutons}</div>
  </div>`;
}

function majAlertes() {
  const el = $('#wf-missiles');
  if (!S.moi) { el.hidden = true; return; }
  const entrants = S.missiles.filter(x => x.proprio !== S.moi.id && S.carte.proprio[x.cible] === S.moi.id);
  if (!entrants.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = entrants.map(x => {
    const u = S.defs.unites.find(k => k.id === x.genre);
    const reste = (1 - x.progres) * x.duree / S.vitesse;
    return `<button class="wf-alerte-missile ${x.genre === 'missile_nucleaire' ? 'nucl' : ''}" data-act="voir" data-case="${x.cible}">
      ${ico(u?.icone || 'rocket')}<b>${esc(u?.nom || 'Missile')}</b> de ${esc(S.pays.get(x.proprio)?.nom || '?')} · impact ${duree(reste)}</button>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// Ordres cibles (deplacement, bombardement, mission, missile)
// ══════════════════════════════════════════════════════════════════
function demarrerOrdre(type, a, genre) {
  const unites = Object.keys(a.unites || {}).map(k => S.defs.unites.find(u => u.id === k)).filter(Boolean);
  let portee = null, couleur = '#ffffff', texte = '';
  if (type === 'deplacer') texte = `Choisissez la destination de ${a.nom}.`;
  if (type === 'bombarder') { portee = Math.max(...unites.filter(u => u.portee > 0 && u.domaine !== 'air').map(u => u.portee)); couleur = '#ffb300'; texte = 'Choisissez la case à bombarder.'; }
  if (type === 'mission') { portee = Math.min(...unites.map(u => u.portee)); couleur = '#40c4ff'; texte = `Choisissez la cible du raid (rayon d'action ${portee} cases).`; }
  if (type === 'missile') {
    const u = S.defs.unites.find(x => x.id === genre);
    portee = u.portee > 900 ? null : u.portee;
    couleur = genre === 'missile_nucleaire' ? '#ff1744' : '#ff9100';
    texte = `Choisissez la cible du ${u.nom.toLowerCase()}${portee ? ` (portée ${portee} cases)` : ''}.`;
  }
  S.ordre = { type, armee: a.id, genre, portee };
  S.carte.visee = true;
  if (portee) S.carte.setZone(S.g.rayon(a.case, portee), couleur); else S.carte.setZone(null);
  const c = $('#wf-consigne');
  c.innerHTML = `${ico('crosshairs')} ${esc(texte)} <button class="wf-lien" data-act="annuler_ordre">Annuler (Échap)</button>`;
  c.hidden = false;
}

function annulerOrdre() {
  S.ordre = null;
  S.carte.visee = false;
  S.carte.survolMesh.visible = false;
  S.carte.setZone(null);
  $('#wf-consigne').hidden = true;
}

function demarrerOrdreSpecial(objet) {
  S.ordre = { type: 'special', objet };
  S.carte.visee = true;
  S.carte.setZone(null);
  const c = $('#wf-consigne');
  c.innerHTML = `${ico('crosshairs')} Choisissez la cible de la ${esc(nomObjet(S, objet).toLowerCase())} (portée illimitée, depuis votre silo). <button class="wf-lien" data-act="annuler_ordre">Annuler (Échap)</button>`;
  c.hidden = false;
}

/** Fenetre de lancement nucleaire : charge (matiere brute ou ogives fabriquees). */
const PUISSANCE_NUCL = { uranium: 1, plutonium: 1.5, ogive: 90, ogive_h: 2000 };
function lancerNucleaire(a, genre, i) {
  const m = S.moi;
  const cible = S.pays.get(S.carte.proprio[i]);
  const st = m.stock || {};
  const dispo = { uranium: m.ur_enrichi || 0, plutonium: st.Pu || 0, ogive: st.ogive_nucleaire || 0, ogive_h: st.ogive_h || 0 };
  const defaut = dispo.ogive_h >= 1 ? 'ogive_h' : dispo.ogive >= 1 ? 'ogive' : dispo.plutonium > dispo.uranium ? 'plutonium' : 'uranium';
  modaleOk = () => agir('missile', { armee: a.id, genre, cible: i, matiere: +val('n-kg') || 1, fissile: val('n-fissile'), explosifs: +val('n-expl') || 0 });
  modale(`<div class="wf-modale-tete">${ico('radiation')}<h2>Lancer une frappe nucléaire ?</h2></div>
    <p>Cible : <b>${esc(cible?.nom || 'cette zone')}</b>. Toute la planète verra le lancement. Le cœur de l'explosion devient une terre neutre et irradiée ; autour, les bâtiments sont détruits et les pertes dépendent de la densité de population. Plus la charge est grosse, plus le rayon est grand, <b>sans limite</b> : une charge énorme rase toute la carte, votre pays compris.</p>
    <div class="wf-form">
      <label>Charge
        <select id="n-fissile">
          <option value="uranium" ${defaut === 'uranium' ? 'selected' : ''}>Uranium enrichi : ${fmt(dispo.uranium)} kg</option>
          <option value="plutonium" ${defaut === 'plutonium' ? 'selected' : ''}>Plutonium (×1,5) : ${fmt(dispo.plutonium)} kg</option>
          <option value="ogive" ${defaut === 'ogive' ? 'selected' : ''}>Ogives nucléaires : ${fmt(dispo.ogive)} en stock</option>
          <option value="ogive_h" ${defaut === 'ogive_h' ? 'selected' : ''}>Bombes H : ${fmt(dispo.ogive_h)} en stock</option>
        </select></label>
      <label><span id="n-unite">Quantité</span><input type="number" id="n-kg" min="1" value="${defaut.startsWith('ogive') ? 1 : 20}"></label>
      <label id="n-expl-ligne">Explosifs de mise à feu <small>(matière brute seulement : minimum 5 + kg/4, jusqu'au double pour +30 % · ${fmt(st.explosifs || 0)} en stock)</small><input type="number" id="n-expl" min="0" value="0" placeholder="minimum"></label>
      <div class="wf-insp-ligne" id="n-rayon"></div>
    </div>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn danger" data-act="modale_ok">${ico('radiation')} Lancer</button></div>`);
  // Rayon estime en direct (meme formule que le serveur).
  const maj = () => {
    const f = val('n-fissile');
    const q = Math.max(0, +val('n-kg') || 0);
    const ogive = f.startsWith('ogive');
    $('#n-unite').textContent = ogive ? 'Nombre' : 'Quantité (kg, au moins 5)';
    $('#n-expl-ligne').hidden = ogive;
    // jeu.rs rayon_nucleaire : 5 kg de plutonium = 20 cases.
    const rayon = Math.min(Math.max(S.g.l, S.g.h), Math.floor(1 + 19 / Math.sqrt(7.5) * Math.sqrt(q * PUISSANCE_NUCL[f])));
    $('#n-rayon').innerHTML = `${ico('bullseye')} Rayon estimé : <b>${rayon} cases</b>${rayon >= Math.max(S.g.l, S.g.h) ? ' — <b class="neg">toute la carte</b>' : ''}`;
  };
  ['n-fissile', 'n-kg'].forEach(id => document.getElementById(id).addEventListener('input', maj));
  maj();
}

async function executerOrdre(i) {
  const o = S.ordre;
  if (o.type === 'special') {
    annulerOrdre();
    const cible = S.pays.get(S.carte.proprio[i]);
    confirmer(`${ico('circle')} Lancer la ${esc(nomObjet(S, o.objet).toLowerCase())} ?`,
      `Vous allez frapper <b>${esc(cible?.nom || 'cette zone')}</b>. Rien ne peut l'intercepter. Cette décision est irréversible.`,
      'Lancer', () => agir('arme_speciale', { objet: o.objet, cible: i }), true);
    return;
  }
  const a = S.armees.find(x => x.id === o.armee);
  if (!a) { annulerOrdre(); return; }
  if (o.portee && S.g.distance(a.case, i) > o.portee) { toast('Cible hors de portée.', 'err'); return; }
  if (o.type === 'deplacer') { annulerOrdre(); agir('deplacer', { armee: a.id, cible: i }); return; }
  if (o.type === 'bombarder') { annulerOrdre(); agir('bombarder', { armee: a.id, cible: i }); return; }
  if (o.type === 'mission') { annulerOrdre(); agir('mission', { armee: a.id, cible: i }); return; }
  if (o.type === 'missile') {
    const nucl = o.genre === 'missile_nucleaire';
    annulerOrdre();
    if (nucl) lancerNucleaire(a, o.genre, i);
    else agir('missile', { armee: a.id, genre: o.genre, cible: i });
  }
}

// ══════════════════════════════════════════════════════════════════
// Notifications et fenetres
// ══════════════════════════════════════════════════════════════════
function toast(texte, type = 'info', icone, caseCible) {
  if (!texte) return;
  const el = document.createElement('div');
  el.className = 'wf-toast ' + type;
  const ic = icone || { ok: 'circle-check', err: 'circle-xmark', alerte: 'triangle-exclamation', info: 'circle-info' }[type];
  el.innerHTML = `${ico(ic)}<span>${esc(texte)}</span>`;
  if (caseCible != null) { el.classList.add('cliquable'); el.onclick = () => { S.carte.centrerSur(caseCible); choisirCase(caseCible); }; }
  const zone = $('#wf-toasts');
  zone.appendChild(el);
  while (zone.children.length > 5) zone.firstChild.remove();
  setTimeout(() => { el.classList.add('sortie'); setTimeout(() => el.remove(), 400); }, type === 'alerte' ? 8000 : 4500);
}

let modaleOk = null;
function modale(html, { fermable = true, large = false } = {}) {
  const f = $('#wf-modale');
  f.innerHTML = `<div class="wf-modale ${large ? 'large' : ''}">${fermable ? `<button class="wf-modale-x" data-act="fermer_modale">${ico('xmark')}</button>` : ''}${html}</div>`;
  f.hidden = false;
  f.dataset.fermable = fermable ? '1' : '0';
  setTimeout(() => f.querySelector('input:not([type=hidden]):not([type=color])')?.focus(), 50);
}
function fermerModale() { $('#wf-modale').hidden = true; $('#wf-modale').innerHTML = ''; modaleOk = null; }

function confirmer(titre, texte, bouton, ok, danger = false) {
  modaleOk = ok;
  modale(`<div class="wf-modale-tete"><h2>${titre}</h2></div><p>${texte}</p>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button>
    <button class="wf-btn ${danger ? 'danger' : ''}" data-act="modale_ok">${esc(bouton)}</button></div>`);
}

function ouvrirFondation() {
  const d = S.defs;
  const couleur = d.couleurs[Math.floor(Math.random() * d.couleurs.length)];
  modale(`<div class="wf-modale-tete">${ico('flag')}<div><h2>Fonder votre nation</h2><p>Choisissez l'identité du pays que vous allez diriger. Sa capitale apparaîtra sur des terres libres.</p></div></div>
    <div class="wf-form">
      <label>Nom de la nation<input id="f-nom" maxlength="28" placeholder="Ex. : République de Valdor"></label>
      <label>Devise <small>(facultatif)</small><input id="f-devise" maxlength="80" placeholder="Ex. : Unité, travail, grandeur"></label>
      <label>Couleur</label>
      <div class="wf-palette">${d.couleurs.map(c => `<button class="wf-pastille ${c === couleur ? 'actif' : ''}" style="--c:${c}" data-act="choisir" data-groupe="f-couleur" data-val="${c}"></button>`).join('')}
        <input type="color" id="f-couleur" value="${couleur}"></div>
      <label>Emblème</label>
      <div class="wf-emblemes">${d.emblemes.map((e, k) => `<button class="wf-embleme ${k === 0 ? 'actif' : ''}" data-act="choisir" data-groupe="f-embleme" data-val="${e}">${ico(e)}</button>`).join('')}</div>
      <input type="hidden" id="f-embleme" value="${d.emblemes[0]}">
      <label>Spécialisation nationale</label>
      <div class="wf-spes">${d.specialisations.map((s, k) => `<button class="wf-spe ${k === 0 ? 'actif' : ''}" data-act="choisir" data-groupe="f-spe" data-val="${s.id}">${ico(s.icone)}<b>${esc(s.nom)}</b><small>${esc(s.desc)}</small></button>`).join('')}</div>
      <input type="hidden" id="f-spe" value="${d.specialisations[0].id}">
    </div>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="observer">${ico('eye')} Observer d'abord</button>
    <button class="wf-btn" data-act="rejoindre">${ico('flag')} Fonder ma nation</button></div>`, { large: true });
}

function ouvrirAneantie() {
  modale(`<div class="wf-modale-tete">${ico('skull')}<div><h2>Votre nation a été anéantie</h2><p>Sa dernière province est tombée. Vous pouvez la refonder sur des terres libres : vos technologies sont perdues, mais pas votre nom.</p></div></div>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Plus tard</button><button class="wf-btn" data-act="refonder">${ico('seedling')} Refonder</button></div>`);
}

// ══════════════════════════════════════════════════════════════════
// Actions (delegation)
// ══════════════════════════════════════════════════════════════════
const val = id => document.getElementById(id)?.value ?? '';
const selA = () => S.armees.find(x => x.id === S.selArmee);

const ACTIONS = {
  ouvrir: d => { if (d.prod) S.prodCase = +d.prod; ouvrirPanneau(d.panneau, { canal: d.canal, garder: !!(d.prod || d.canal) }); },
  fermer_panneau: () => ouvrirPanneau('carte'),
  voir: d => { const i = +d.case; S.carte.centrerSur(i); choisirCase(i); },
  deselection: () => { choisirArmee(null); choisirCase(null); },
  fonder: () => ouvrirFondation(),
  observer: () => { sessionStorage.setItem('wf-fondation-vue', '1'); fermerModale(); },
  fermer_modale: () => fermerModale(),
  modale_ok: () => { const f = modaleOk; fermerModale(); f && f(); },
  choisir: (d, el) => {
    el.parentElement.querySelectorAll('.actif').forEach(x => x.classList.remove('actif'));
    el.classList.add('actif');
    const i = document.getElementById(d.groupe);
    if (i) i.value = d.val;
  },
  rejoindre: async () => {
    const r = await agir('rejoindre', { nom: val('f-nom'), devise: val('f-devise'), couleur: val('f-couleur'), embleme: val('f-embleme'), spe: val('f-spe') });
    if (r.ok) { fermerModale(); setTimeout(() => S.moi && S.carte.centrerSur(S.moi.capitale, 24), 300); }
  },
  refonder: async () => { const r = await agir('refonder'); if (r.ok) { fermerModale(); setTimeout(() => S.moi && S.carte.centrerSur(S.moi.capitale, 24), 300); } },
  profil: () => agir('profil', { devise: val('profil-devise'), couleur: val('profil-couleur'), embleme: val('profil-embleme') }),

  construire: d => agir('construire', { case: +d.case, bat: d.bat }),
  ameliorer: d => agir('ameliorer', { case: +d.case }),
  demolir: d => confirmer('Démolir ce bâtiment ?', 'Le bâtiment sera détruit sans remboursement.', 'Démolir', () => agir('demolir', { case: +d.case }), true),
  annuler_chantier: d => agir('annuler_chantier', { id: +d.id }),
  etendre: d => envoyerTroupes(+d.case),
  rappeler: d => agir('rappeler', { id: +d.id }),
  fab_onglet: d => { S.fabOnglet = d.onglet; majPanneau(true); },
  fab_element: d => { S.qteRaf = Math.max(1, Math.min(1000, +val('qte-raf') || S.qteRaf || 10)); S.fabElement = d.objet; majPanneau(true); },
  fab_niveau: d => { S.qteFab = Math.max(1, Math.min(1000, +val('qte-fab') || S.qteFab || 1)); S.fabNiveau = +d.niveau; majPanneau(true); },
  fab_qte: d => { if (d.champ === 'qte-raf') S.qteRaf = +d.v; else S.qteFab = +d.v; const i = document.getElementById(d.champ); if (i) i.value = d.v; majPanneau(true); },
  raffiner: d => {
    S.qteRaf = Math.max(1, Math.min(1000, +val('qte-raf') || 1));
    S.rafCible = +val('raf-cible') || 0;
    agir('raffiner', { objet: d.objet, qte: S.qteRaf, auto: !!S.rafAuto, cible: S.rafCible });
  },
  fab_auto: (d, el) => { S[d.cle] = el.checked; majPanneau(true); },
  regler_fab: (d, el) => {
    if (d.champ === 'auto') agir('regler_fabrication', { id: +d.id, auto: el.checked });
    else agir('regler_fabrication', { id: +d.id, qte: Math.max(1, +val('lot-' + d.id) || 1), cible: +val('cible-' + d.id) || 0 });
  },
  admin_bots: () => agir('admin_bots', { nb: Math.max(0, Math.min(16, +val('admin-bots') || 0)) }),
  admin_paix: () => confirmer('Paix mondiale ?', 'Toutes les guerres s\'arrêtent immédiatement.', 'Imposer la paix', () => agir('admin_paix_mondiale')),
  admin_carte: () => confirmer('Générer une nouvelle carte ?', 'Le monde actuel est effacé : toutes les nations disparaissent et chacun doit refonder la sienne. Irréversible.', 'Nouvelle carte', () => agir('admin_nouvelle_carte'), true),
  admin_moi: () => agir('dev_tout'),
  admin_donner_form: d => {
    const p = S.pays.get(+d.pays);
    const idx = [0, 2, 5, 4, 3];
    modaleOk = () => agir('admin_donner', {
      pays: +d.pays,
      res: S.defs.ressources.map((_, i) => idx.includes(i) ? +val('ad-' + i) || 0 : 0),
      troupes: +val('ad-troupes') || 0,
      elements: +val('ad-elements') || 0,
      objet: (() => { const t = val('ad-objet').trim().toLowerCase(); const o = [...S.defs.elements, ...S.defs.produits].find(x => x.id.toLowerCase() === t || x.nom.toLowerCase() === t); return o ? o.id : ''; })(),
      qte: +val('ad-objet-qte') || 0,
      techs: !!document.getElementById('ad-techs')?.checked,
      unite: val('ad-unite'),
      unites_qte: +val('ad-unite-qte') || 0,
    });
    modale(`<div class="wf-modale-tete">${ico('gift')}<h2>Donner à ${esc(p?.nom)}</h2></div>
      <div class="wf-form grille2">${idx.map(i => { const r = S.defs.ressources[i]; return `<label>${ico(r.icone, '', `color:${r.couleur}`)} ${esc(r.nom)}<input type="number" id="ad-${i}" value="0"></label>`; }).join('')}
        <label>${ico('person-military-rifle')} Troupes<input type="number" id="ad-troupes" value="0"></label>
        <label>${ico('atom')} De chaque élément<input type="number" id="ad-elements" value="0"></label>
        <label>${ico('box')} Un élément ou un produit précis<input id="ad-objet" list="ad-objets" placeholder="ex. Fe, acier, trou noir"></label>
        <label>Quantité<input type="number" id="ad-objet-qte" value="10"></label>
        <label>${ico('person-military-rifle')} Unités (à la capitale)<select id="ad-unite"><option value="">—</option>${S.defs.unites.map(u => `<option value="${u.id}">${esc(u.nom)}</option>`).join('')}</select></label>
        <label>Nombre d'unités<input type="number" id="ad-unite-qte" value="10"></label>
        <label class="wf-ligne-form"><input type="checkbox" id="ad-techs"> Toutes les technologies et améliorations</label></div>
      <datalist id="ad-objets">${[...S.defs.elements, ...S.defs.produits].map(o => `<option value="${esc(o.nom)}">`).join('')}</datalist>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">${ico('gift')} Donner</button></div>`);
  },
  admin_protection_form: d => {
    const p = S.pays.get(+d.pays);
    modaleOk = () => agir('admin_protection', { pays: +d.pays, minutes: +val('ap-min') || 0 });
    modale(`<div class="wf-modale-tete">${ico('shield-halved')}<h2>Protection de ${esc(p?.nom)}</h2></div>
      <p>Pendant la protection, personne ne peut lui déclarer la guerre ni l'attaquer. 0 = lever la protection.</p>
      <div class="wf-form"><label>Minutes<input type="number" id="ap-min" min="0" value="60"></label></div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">Appliquer</button></div>`);
  },
  fabriquer: d => { S.qteFab = Math.max(1, Math.min(1000, +val('qte-fab') || 1)); agir('fabriquer', { objet: d.objet, qte: S.qteFab }); },
  annuler_fab: d => agir('annuler_fabrication', { id: +d.id }),
  vendre_objet: d => agir('vendre_objet', { objet: d.objet, qte: +d.qte || 1 }),
  ordre_special: d => demarrerOrdreSpecial(d.objet),
  acheter_plan: d => agir('acheter_plan', { plan: d.plan }),
  branche_plans: d => { S.branchePlans = d.branche; majPanneau(true); },
  reduire_insp: () => { S.inspReduit = !S.inspReduit; memoriserHud(); majInspecteur(true); },
  reduire_troupes: () => { S.troupesReduit = !S.troupesReduit; memoriserHud(); appliquerHud(); },
  reduire_menu: () => { S.menuReduit = !S.menuReduit; memoriserHud(); appliquerHud(); },
  // Table de fabrication
  table_pas: d => { S.tablePas = +d.v; majPanneau(true); },
  table_poser: d => {
    S.table ??= [];
    const c = S.table.find(x => x.id === d.objet);
    const dispo = (S.defs.index_minerais?.[d.objet] != null ? S.moi.res[S.defs.index_minerais[d.objet]] : S.moi.stock?.[d.objet] || 0) - (c?.q || 0);
    const n = Math.min(S.tablePas || 1, Math.floor(dispo + 1e-6));
    if (n < 1) return;
    if (c) c.q += n;
    else if (S.table.length >= 9) { toast('La table est pleine (9 cases).', 'err'); return; }
    else S.table.push({ id: d.objet, q: n });
    majPanneau(true);
  },
  table_retirer: d => {
    const c = S.table?.[+d.k];
    if (!c) return;
    c.q -= Math.min(c.q, S.tablePas || 1);
    if (c.q <= 0) S.table.splice(+d.k, 1);
    majPanneau(true);
  },
  table_vider: () => { S.table = []; majPanneau(true); },
  cat_construire: d => { S.catConstruire = d.cat; majInspecteur(true); },
  fab_direct: d => { S.qteFab = Math.max(1, Math.min(1000, +val('qte-fab') || 1)); agir('fabriquer', { objet: d.objet, qte: S.qteFab }); },
  fab_chaine: d => { S.qteFab = Math.max(1, Math.min(1000, +val('qte-fab') || 1)); agir('fabriquer_chaine', { objet: d.objet, qte: S.qteFab }); },
  acheter_objet: d => { S.marcheQte = Math.max(1, Math.min(1000, +val('marche-qte') || 1)); agir('acheter_objet', { objet: d.objet, qte: S.marcheQte }); },
  vendre_marche: d => {
    S.marcheQte = Math.max(1, Math.min(1000, +val('marche-qte') || 1));
    const n = Math.min(S.marcheQte, Math.floor(S.moi?.stock?.[d.objet] || 0));
    if (n >= 1) agir('vendre_objet', { objet: d.objet, qte: n });
  },
  table_remplir: d => {
    const p = S.defs.produits.find(x => x.id === d.objet);
    if (p) { S.table = p.entrees.map(([id, n]) => ({ id, q: n })); majPanneau(true); }
  },
  table_fabriquer: async () => {
    const t = recetteDeTable(S);
    if (!t) return;
    S.fabCible = +val('fab-cible') || 0;
    const r = await agir('fabriquer', { objet: t.p.id, qte: t.k, auto: !!S.fabAuto, cible: S.fabCible });
    if (r.ok) { S.table = []; majPanneau(true); }
  },
  rechercher: d => agir('rechercher', { tech: d.tech }),
  annuler_recherche: d => agir('annuler_recherche', { tech: d.tech }),
  branche: d => { S.brancheRecherche = d.branche; majPanneau(true); majInspecteur(true); },
  produire: d => agir('produire', { case: +d.case, unite: d.unite, qte: Math.max(1, Math.min(50, +val(d.champ || 'qte-' + d.unite) || 1)) }),
  annuler_production: d => agir('annuler_production', { id: +d.id }),
  prod_case: d => { S.prodCase = +d.case; majPanneau(true); },

  sel_armee: d => {
    const a = S.armees.find(x => x.id === +d.armee);
    if (!a) return;
    choisirArmee(a.id);
    choisirCase(a.case);
    S.carte.centrerSur(a.case);
  },
  ordre: d => { const a = d.armee ? S.armees.find(x => x.id === Number(d.armee)) : selA(); if (a) demarrerOrdre(d.type, a, d.genre); },
  annuler_ordre: () => annulerOrdre(),
  arreter: () => { const a = selA(); if (a) agir('arreter', { armee: a.id }); },
  fusionner: d => { const a = selA(); if (a) agir('fusionner', { armee: a.id, avec: +d.avec }); },
  dissoudre: () => { const a = selA(); if (a) confirmer('Démobiliser cette armée ?', `${esc(a.nom)} sera dissoute définitivement.`, 'Démobiliser', () => agir('dissoudre', { armee: a.id }), true); },
  renommer_form: () => {
    const a = selA(); if (!a) return;
    modaleOk = () => agir('renommer_armee', { armee: a.id, nom: val('r-nom') });
    modale(`<div class="wf-modale-tete">${ico('pen')}<h2>Renommer</h2></div><div class="wf-form"><input id="r-nom" maxlength="32" value="${esc(a.nom)}"></div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">Renommer</button></div>`);
  },
  scinder_form: () => {
    const a = selA(); if (!a) return;
    modaleOk = () => {
      const unites = {};
      for (const k of Object.keys(a.unites)) { const n = +val('s-' + k) || 0; if (n > 0) unites[k] = n; }
      agir('scinder', { armee: a.id, unites });
    };
    modale(`<div class="wf-modale-tete">${ico('code-branch')}<h2>Scinder ${esc(a.nom)}</h2></div><p>Unités qui formeront la nouvelle armée :</p>
      <div class="wf-form">${Object.entries(a.unites).map(([k, n]) => { const u = S.defs.unites.find(x => x.id === k); return `<label class="wf-ligne-form">${ico(u.icone)} ${esc(u.nom)} <small>(${n})</small><input type="number" id="s-${k}" min="0" max="${n}" value="${Math.floor(n / 2)}" class="wf-qte"></label>`; }).join('')}</div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">Scinder</button></div>`);
  },

  guerre: d => {
    const p = S.pays.get(+d.pays);
    const bloc = p?.bloc != null ? S.blocs.get(p.bloc) : null;
    confirmer(`${ico('burst')} Déclarer la guerre à ${esc(p?.nom)} ?`,
      `Coût : 10 d'influence. Votre propre protection de nouveau venu prend fin.${bloc ? `<br><b>${esc(p.nom)} appartient au bloc ${esc(bloc.nom)} : ses ${bloc.membres.length - 1} alliés entreront aussi en guerre contre vous.</b>` : ''}`,
      'Déclarer la guerre', () => agir('guerre', { pays: +d.pays }), true);
  },
  proposer: d => agir('proposer', { pays: +d.pays, genre: d.genre }),
  repondre: d => agir('repondre', { pays: +d.pays, genre: d.genre, accepte: d.accepte === '1' }),
  espion: d => agir('espionnage', { pays: +d.pays, op: d.op }),
  aide_form: d => {
    const p = S.pays.get(+d.pays);
    modaleOk = () => agir('aide', { pays: +d.pays, res: S.defs.ressources.map((_, i) => +val('aide-' + i) || 0) });
    modale(`<div class="wf-modale-tete">${ico('box-open')}<h2>Envoyer une aide à ${esc(p?.nom)}</h2></div><p>5 % des ressources sont perdues pendant le transport.</p>
      <div class="wf-form grille2">${S.defs.ressources.map((r, i) => `<label>${ico(r.icone, '', `color:${r.couleur}`)} ${esc(r.nom)} <small>(${fmt(S.moi?.res[i])})</small><input type="number" id="aide-${i}" min="0" value="0"></label>`).join('')}</div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">${ico('paper-plane')} Envoyer</button></div>`);
  },

  bloc_creer: () => agir('bloc_creer', { nom: val('bloc-nom'), sigle: val('bloc-sigle'), couleur: val('bloc-couleur'), charte: val('bloc-charte-new') }),
  bloc_postuler: d => agir('bloc_postuler', { bloc: +d.bloc }),
  bloc_accepter: d => agir('bloc_accepter', { pays: +d.pays }),
  bloc_refuser: d => agir('bloc_refuser', { pays: +d.pays }),
  bloc_inviter: d => agir('bloc_inviter', { pays: +d.pays }),
  bloc_exclure: d => confirmer('Exclure ce membre ?', `${esc(S.pays.get(+d.pays)?.nom)} quittera le bloc.`, 'Exclure', () => agir('bloc_exclure', { pays: +d.pays }), true),
  bloc_chef: d => confirmer('Transmettre la direction ?', `${esc(S.pays.get(+d.pays)?.nom)} dirigera désormais le bloc.`, 'Transmettre', () => agir('bloc_chef', { pays: +d.pays })),
  bloc_quitter: () => confirmer('Quitter le bloc ?', 'Vous perdrez la vision partagée et la défense collective.', 'Quitter', () => agir('bloc_quitter'), true),
  bloc_charte: () => agir('bloc_charte', { charte: val('bloc-charte') }),
  bloc_don: () => agir('bloc_don', { montant: +val('bloc-don') || 0 }),
  bloc_verser: d => agir('bloc_verser', { pays: +d.pays, montant: +val('verser-' + d.pays) || 0 }),

  marche: d => agir('marche', { res: +d.res, sens: d.sens, qte: +val(d.champ || 'marche-' + d.res) || 0 }),
  acheter_unite: d => agir('marche', { genre: 'unite', unite: d.unite, qte: Math.max(1, Math.min(20, +val(d.champ) || 1)) }),
  vendre_unite: d => agir('marche', { genre: 'vendre_unite', unite: d.unite, qte: Math.max(1, +val(d.champ) || 1) }),
  vendre_service: d => agir('marche', { genre: 'vendre_service', service: d.service, qte: Math.max(1, +val(d.champ) || 1) }),
  acheter_service: d => agir('marche', { genre: 'service', service: d.service, qte: Math.max(1, +val(d.champ) || 1) }),
  onglet_marche: d => { S.ongletMarche = d.onglet; majPanneau(true); },
  categorie: d => { S.categorie = d.cat; majPanneau(true); },
  filtre_journal: d => { S.filtreJournal = d.f; majPanneau(true); },
  canal: d => { S.canal = d.canal; majPanneau(true); },

  admin_annonce: () => agir('admin_annonce', { texte: val('admin-annonce') }),
  admin_supprimer: d => confirmer('Supprimer cette nation ?', `${esc(S.pays.get(+d.pays)?.nom)} et tout son territoire disparaîtront définitivement.`, 'Supprimer', () => agir('admin_supprimer_pays', { pays: +d.pays }), true),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const f = ACTIONS[el.dataset.act];
  if (!f) return;
  e.preventDefault();
  f(el.dataset, el);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="chat"]');
  if (!f) return;
  e.preventDefault();
  const i = $('#chat-texte');
  const t = i.value.trim();
  if (!t) return;
  agir('chat', { canal: S.canal, texte: t }, true).then(r => { if (r.ok) i.value = ''; });
});

$('#wf-modale').addEventListener('click', e => {
  if (e.target.id === 'wf-modale' && e.currentTarget.dataset.fermable === '1') fermerModale();
});

// Champs de recherche des panneaux : filtrage immediat des lignes.
// Le panneau est redessine avec le filtre, puis le champ retrouve le focus
// et la position du curseur (on peut taper sans interruption).
document.addEventListener('input', e => {
  const f = e.target.closest('[data-filtre]');
  if (!f) return;
  S[f.dataset.filtre] = f.value;
  const id = f.id, pos = f.selectionStart;
  majPanneau(true);
  const n = document.getElementById(id);
  if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} }
});

// Part des troupes envoyee par un clic droit (memorisee sur ce navigateur).
$('#wf-ratio')?.addEventListener('input', e => choisirRatio(+e.target.value));
// Boutons 10 / 25 / 50 / 75 / 100 % du curseur de troupes.
$('#wf-troupes')?.addEventListener('click', e => {
  const b = e.target.closest('[data-ratio]');
  if (b) choisirRatio(+b.dataset.ratio);
});

// Joueur invite : un bouton pour se connecter avec VEX en gardant sa partie
// (la nation passe sur le compte VEX, avec l'administration s'il est admin).
function invite() {
  if (corps.dataset.invite !== '1' || document.getElementById('wf-invite')) return;
  const m = document.querySelector('#profile-menu');
  if (m) m.insertAdjacentHTML('afterbegin', `<a id="wf-invite" href="${esc(corps.dataset.vexDirect)}" title="Votre nation passe sur votre compte VEX : vous la retrouvez partout."><img src="static/img/vex.svg" class="pm-icon-svg-7844" alt="">Se connecter avec VEX</a>`);
}

function memoriserHud() {
  try { localStorage.setItem('wf-hud', JSON.stringify({ i: !!S.inspReduit, t: !!S.troupesReduit, m: !!S.menuReduit })); } catch (x) {}
}
function appliquerHud() {
  corps.classList.toggle('wf-menu-reduit', !!S.menuReduit);
  $('#wf-troupes')?.classList.toggle('reduit', !!S.troupesReduit);
}
// Interface minimale par defaut : menu en icones, barre de troupes compacte.
try {
  const brut = localStorage.getItem('wf-hud');
  const h = brut ? JSON.parse(brut) : { i: false, t: true, m: true };
  S.inspReduit = h.i; S.troupesReduit = h.t; S.menuReduit = h.m;
} catch (x) { S.troupesReduit = true; S.menuReduit = true; }
appliquerHud();

document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(document.activeElement?.tagName)) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#wf-modale').hidden && $('#wf-modale').dataset.fermable === '1') fermerModale();
    else if (S.ordre) annulerOrdre();
    else if (S.selArmee != null) choisirArmee(null);
    else if (S.selCase != null) choisirCase(null);
    else if (S.panneau) ouvrirPanneau('carte');
    return;
  }
  // H : masquer / afficher toute l'interface par-dessus la carte.
  if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey) {
    corps.classList.toggle('wf-sans-hud');
    if (corps.classList.contains('wf-sans-hud')) toast('Interface masquée : appuyez sur H pour la réafficher.', 'info');
    return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= MENU.length && !e.ctrlKey && !e.altKey) ouvrirPanneau(MENU[n - 1][0]);
});

// Boutons de mode de carte
document.querySelectorAll('[data-mode-carte]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-mode-carte]').forEach(x => x.classList.toggle('actif', x === b));
  S.carte?.setMode(b.dataset.modeCarte);
}));
$('#wf-recentrer').addEventListener('click', () => { if (S.moi) S.carte.centrerSur(S.moi.capitale, 30); else S.carte.centrerSur(Math.floor(S.g.n / 2), 70); });
$('#wf-vue-globale').addEventListener('click', () => S.carte.centrerSur(Math.floor(S.g.n / 2) + Math.floor(S.g.l / 2), 95));

// Horloge + rafraichissement leger (comptes a rebours)
setInterval(() => {
  $('#wf-horloge').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (S.pret) majAlertes();
}, 1000);

// Dev : le menu profil pointe vers la deconnexion locale, et
// devTout() (console du navigateur) donne toutes les technologies et des
// ressources pour tester la fin de partie. Refuse par le serveur hors mode dev.
if (corps.dataset.mode === 'reseau') {
  // Connexion reseau : se deconnecter de WorldFront (pas du nœud VEX).
  document.querySelectorAll('#profile-menu a').forEach(a => { if (a.href.includes('logout')) a.href = 'deconnexion'; });
}
if (corps.dataset.mode === 'dev') {
  document.querySelectorAll('#profile-menu a').forEach(a => { if (a.href.includes('logout')) a.href = 'dev/sortir'; });
  // Seulement avec la cle d'administration (le serveur le verifie aussi).
  window.devTout = () => S.joueur?.admin ? agir('dev_tout') : console.warn("devTout : clé d'administration requise (page /admin).");
}

connecter();
